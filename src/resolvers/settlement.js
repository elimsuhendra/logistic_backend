import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'
import { num, normalizeSettlementItem } from 'utils/settlement'

// ids may be stored as ObjectId or string
const idMatch = id =>
  ObjectId.isValid(String(id)) ? { $in: [ObjectId(String(id)), String(id)] } : String(id)

function buildSettlementFilters(filter) {
  const f = filter || {}
  const out = { deletedAt: null }
  if (f._id_in) out._id = { $in: f._id_in.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id)) }
  if (f._id_nin) out._id = { ...(out._id || {}), $nin: f._id_nin.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id)) }
  if (f.accountId) out.accountId = idMatch(f.accountId)
  if (f.cashRequestId) out.cashRequestId = idMatch(f.cashRequestId)
  if (Array.isArray(f.cashRequestId_in)) out.cashRequestId = { $in: f.cashRequestId_in.map(String) }
  if (f.cashNo) out.cashNo = f.cashNo
  if (f.cashNo_regex) out.cashNo = { $regex: sanitizeRegex(f.cashNo_regex.trim()), $options: 'i' }
  if (f.settlementType) out.settlementType = f.settlementType
  if (f.createdAt_gte || f.createdAt_lte) {
    out.createdAt = {
      ...(f.createdAt_gte ? { $gte: new Date(f.createdAt_gte).valueOf() } : {}),
      ...(f.createdAt_lte ? { $lte: new Date(f.createdAt_lte).valueOf() } : {}),
    }
  }
  if (Array.isArray(f.OR) && f.OR.length > 0) out.$or = f.OR.map(buildSettlementFilters)
  if (Array.isArray(f.AND) && f.AND.length > 0) out.$and = f.AND.map(buildSettlementFilters)
  return out
}

function findCashRequest(mongo, id) {
  if (!id) return null
  return ObjectId.isValid(String(id))
    ? mongo.CashRequest.findOne({ _id: ObjectId(String(id)), deletedAt: null })
    : mongo.CashRequest.findOne({ cashNo: String(id), deletedAt: null })
}

export default {
  Settlement: {
    id: parent => parent._id || parent.id,
    items: parent => (Array.isArray(parent.items) ? parent.items : []).map(normalizeSettlementItem),
    total: parent => num(parent.total),
    cashRequest: async (parent, args, { mongo }) => findCashRequest(mongo, parent.cashRequestId),
  },
  settlementItemObject: {
    jobPlanning: async ({ jobPlanningId }, args, { mongo }) => {
      if (!jobPlanningId) return null
      return ObjectId.isValid(jobPlanningId)
        ? mongo.JobPlanning.findOne({ _id: ObjectId(jobPlanningId), deletedAt: null })
        : mongo.JobPlanning.findOne({ jobPlanningNo: jobPlanningId, deletedAt: null })
    },
    customer: async ({ customerId }, args, { dataloaders }) =>
      customerId && ObjectId.isValid(customerId)
        ? dataloaders.get('customerByIdLoader').load(customerId)
        : null,
  },
  Subscription: {
    Settlement: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Settlement'),
          (payload, args) => compareObject(payload.Settlement.node, args.dataFilter)
        )
      ),
    },
  },
  Query: {
    allSettlements: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const obj = mongo.Settlement.find(buildSettlementFilters(filter))
        if (first) obj.limit(first)
        if (skip) obj.skip(skip)
        obj.sort(orderBy ? buildMongoOrders(orderBy) : { createdAt: 1 })
        return obj.toArray()
      }
    ),
    _allSettlementsMeta: requiresAuth.createResolver(async (parent, { filter }, { mongo }) => {
      const count = await mongo.Settlement.countDocuments(buildSettlementFilters(filter))
      return { count }
    }),
    getSettlement: requiresAuth.createResolver(
      async (parent, { id, cashRequestId, settlementType }, { mongo }) => {
        if (id && ObjectId.isValid(id)) {
          return mongo.Settlement.findOne({ _id: ObjectId(id), deletedAt: null })
        }
        if (!cashRequestId) return null
        return mongo.Settlement.findOne({
          cashRequestId: idMatch(cashRequestId),
          ...(settlementType ? { settlementType } : {}),
          deletedAt: null,
        })
      }
    ),
  },
  Mutation: {
    saveSettlements: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { cashRequestId, input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!currentUser) return { success: false, message: 'User is not authorized.' }

      const cashRequest = await findCashRequest(mongo, cashRequestId)
      if (!cashRequest) return { success: false, message: 'Cash request not found.' }
      const crId = String(cashRequest._id)

      const types = (input || []).map(s => s.settlementType)
      if (new Set(types).size !== types.length) {
        return { success: false, message: 'Each settlementType may be sent only once.' }
      }

      for (const s of input || []) {
        const items = (s.items || []).map(normalizeSettlementItem)
        const total =
          s.total !== undefined && s.total !== null
            ? num(s.total)
            : s.settlementType === 'Lolo'
            ? items.reduce((sum, i) => sum + i.loloTotalCost, 0)
            : items.reduce((sum, i) => sum + i.totalSettlement, 0)
        const doc = {
          accountId: cashRequest.accountId || null,
          cashRequestId: crId,
          cashNo: cashRequest.cashNo || null,
          settlementType: s.settlementType,
          items,
          total,
          note: s.note || '',
        }
        const existing = await mongo.Settlement.findOne({
          cashRequestId: crId,
          settlementType: s.settlementType,
          deletedAt: null,
        })
        if (existing) {
          await mongoUpdate(
            'Settlement',
            { id: existing._id, ...doc, updatedAt: new Date().getTime() },
            context
          )
        } else {
          await mongoCreate('Settlement', doc, context)
        }
      }

      const settlements = await mongo.Settlement.find({ cashRequestId: crId, deletedAt: null })
        .sort({ createdAt: 1 })
        .toArray()
      return { success: true, message: 'Settlement has been saved successfully!', settlements }
    }),
    deleteSettlement: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!currentUser) return { success: false, message: 'User is not authorized.' }
      await mongoDelete('Settlement', args, context)
      return { success: true, message: 'Settlement has been deleted successfully!' }
    }),
  },
}
