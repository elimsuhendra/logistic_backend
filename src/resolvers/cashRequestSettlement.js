// CashRequestSettlement: same resolvers as Settlement (settlement.js) on the
// cashRequestSettlements collection. The settlementItemObject resolvers are
// shared and stay in settlement.js.
import { toApprovalStatus } from 'utils/approval'
import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'
import { num, normalizeCashRequestSettlementItem } from 'utils/settlement'

// ids may be stored as ObjectId or string
const idMatch = id =>
  ObjectId.isValid(String(id)) ? { $in: [ObjectId(String(id)), String(id)] } : String(id)

function buildCashRequestSettlementFilters(filter) {
  const f = filter || {}
  const out = { deletedAt: null }
  if (f._id_in) out._id = { $in: f._id_in.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id)) }
  if (f._id_nin) out._id = { ...(out._id || {}), $nin: f._id_nin.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id)) }
  if (f.accountId) out.accountId = idMatch(f.accountId)
  if (f.cashRequestId) out.cashRequestId = idMatch(f.cashRequestId)
  if (Array.isArray(f.cashRequestId_in)) out.cashRequestId = { $in: f.cashRequestId_in.map(String) }
  if (f.cashNo) out.cashNo = f.cashNo
  if (f.cashNo_regex) out.cashNo = { $regex: sanitizeRegex(f.cashNo_regex.trim()), $options: 'i' }
  if (f.settlementNo) out.settlementNo = f.settlementNo
  if (f.settlementNo_regex) {
    out.settlementNo = { $regex: sanitizeRegex(f.settlementNo_regex.trim()), $options: 'i' }
  }
  if (f.userId) out.userId = idMatch(f.userId)
  // isDraft false also matches settlements saved before isDraft existed
  if (typeof f.isDraft === 'boolean') out.isDraft = f.isDraft ? true : { $ne: true }
  if (f.settlementType) out.settlementType = f.settlementType
  if (f.createdAt_gte || f.createdAt_lte) {
    out.createdAt = {
      ...(f.createdAt_gte ? { $gte: new Date(f.createdAt_gte).valueOf() } : {}),
      ...(f.createdAt_lte ? { $lte: new Date(f.createdAt_lte).valueOf() } : {}),
    }
  }
  if (Array.isArray(f.OR) && f.OR.length > 0) out.$or = f.OR.map(buildCashRequestSettlementFilters)
  const and = Array.isArray(f.AND) && f.AND.length > 0 ? f.AND.map(buildCashRequestSettlementFilters) : []
  if (f.search && f.search.trim()) {
    const regex = { $regex: sanitizeRegex(f.search.trim()), $options: 'i' }
    and.push({ $or: [{ settlementNo: regex }, { cashNo: regex }] })
  }
  if (and.length > 0) out.$and = and
  return out
}

function findCashRequest(mongo, id) {
  if (!id) return null
  return ObjectId.isValid(String(id))
    ? mongo.CashRequest.findOne({ _id: ObjectId(String(id)), deletedAt: null })
    : mongo.CashRequest.findOne({ $or: [{ cashRequestNo: String(id) }, { cashNo: String(id) }], deletedAt: null })
}

export default {
  CashRequestSettlement: {
    id: parent => parent._id || parent.id,
    items: parent => (Array.isArray(parent.items) ? parent.items : []).map(normalizeCashRequestSettlementItem),
    total: parent => num(parent.total),
    rounding: parent => num(parent.rounding),
    totalAfterRounding: parent => num(parent.total) + num(parent.rounding),
    isDraft: parent => Boolean(parent.isDraft),
    cashRequest: async (parent, args, { mongo }) => findCashRequest(mongo, parent.cashRequestId),
    user: async (parent, args, { dataloaders }) => {
      const uid = parent.userId
      if (!uid || !ObjectId.isValid(String(uid))) return null
      return dataloaders.get('userByIdLoader').load(String(uid))
    },
    // latest decided approval of the settlement (same as CashRequest.lastApprovalStatus)
    lastApprovalStatus: async (parent, args, { mongo }) => {
      const id = parent && (parent._id || parent.id)
      if (!id) return null
      const approval = await mongo.Approval.findOne(
        {
          reffId: idMatch(id),
          deletedAt: null,
          approval: { $in: ['Approved', 'Rejected', 'Pending', 'Revision', 'Cancelled'] }, // Cancelled: not yet migrated
        },
        { sort: { updatedAt: -1, createdAt: -1 } }
      )
      return approval ? toApprovalStatus(approval.approval) : null
    },
  },
  // relations of a cash request settlement row (same as settlementItemObject)
  cashRequestSettlementItemObject: {
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
    CashRequestSettlement: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-CashRequestSettlement'),
          (payload, args) => compareObject(payload.CashRequestSettlement.node, args.dataFilter)
        )
      ),
    },
  },
  Query: {
    allCashRequestSettlements: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const obj = mongo.CashRequestSettlement.find(buildCashRequestSettlementFilters(filter))
        if (first) obj.limit(first)
        if (skip) obj.skip(skip)
        obj.sort(orderBy ? buildMongoOrders(orderBy) : { createdAt: 1 })
        return obj.toArray()
      }
    ),
    _allCashRequestSettlementsMeta: requiresAuth.createResolver(async (parent, { filter }, { mongo }) => {
      const count = await mongo.CashRequestSettlement.countDocuments(buildCashRequestSettlementFilters(filter))
      return { count }
    }),
    getCashRequestSettlement: requiresAuth.createResolver(
      async (parent, { id, cashRequestId, settlementType }, { mongo }) => {
        if (id && ObjectId.isValid(id)) {
          return mongo.CashRequestSettlement.findOne({ _id: ObjectId(id), deletedAt: null })
        }
        if (!cashRequestId) return null
        return mongo.CashRequestSettlement.findOne({
          cashRequestId: idMatch(cashRequestId),
          ...(settlementType ? { settlementType } : {}),
          deletedAt: null,
        })
      }
    ),
    // Settlement with the highest settlementNo starting with the prefix; the
    // dashboard increments its number for the next settlement
    getLastCashRequestSettlement: requiresAuth.createResolver(
      async (parent, { prefixSettlementNo }, { mongo }) => {
        if (!prefixSettlementNo) return null
        const prefix = sanitizeRegex(prefixSettlementNo.trim())
        const [settlement] = await mongo.CashRequestSettlement.find({
          settlementNo: { $regex: `^${prefix}`, $options: 'i' },
          deletedAt: null,
        })
          .sort({ settlementNo: -1 })
          .limit(1)
          .toArray()
        return settlement || null
      }
    ),
  },
  Mutation: {
    createCashRequestSettlement: requiresAuth.createResolver(async (parent, args, context) => {
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
        const items = (s.items || []).map(normalizeCashRequestSettlementItem)
        const total =
          s.total !== undefined && s.total !== null
            ? num(s.total)
            : s.settlementType === 'Lolo'
            ? items.reduce((sum, i) => sum + i.loloTotalCost, 0)
            : items.reduce((sum, i) => sum + i.totalSettlement, 0)
        const existing = await mongo.CashRequestSettlement.findOne({
          cashRequestId: crId,
          settlementType: s.settlementType,
          deletedAt: null,
        })
        const doc = {
          accountId: cashRequest.accountId || null,
          cashRequestId: crId,
          cashNo: cashRequest.cashRequestNo || cashRequest.cashNo || null,
          // a settlement keeps its number; a new one takes the number sent
          settlementNo: (existing && existing.settlementNo) || s.settlementNo || null,
          settlementType: s.settlementType,
          items,
          total,
          rounding: s.rounding !== undefined && s.rounding !== null ? num(s.rounding) : num(existing && existing.rounding),
          note: s.note || '',
          isDraft: typeof s.isDraft === 'boolean' ? s.isDraft : Boolean(existing && existing.isDraft),
          // created by: the user who first saved the settlement
          userId: (existing && existing.userId) || String(currentUser._id),
        }
        if (existing) {
          await mongoUpdate(
            'CashRequestSettlement',
            { id: existing._id, ...doc, updatedAt: new Date().getTime() },
            context
          )
        } else {
          await mongoCreate('CashRequestSettlement', doc, context)
        }
      }

      const cashRequestSettlements = await mongo.CashRequestSettlement.find({ cashRequestId: crId, deletedAt: null })
        .sort({ createdAt: 1 })
        .toArray()
      return { success: true, message: 'Cash request settlement has been saved successfully!', cashRequestSettlements }
    }),
    // Updates an existing cash request settlement by id: items / total / note from
    // the input; the settlementNo is kept (the input's only when it has none)
    updateCashRequestSettlement: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id, input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!currentUser) return { success: false, message: 'User is not authorized.' }

      const existing =
        id && ObjectId.isValid(String(id))
          ? await mongo.CashRequestSettlement.findOne({ _id: ObjectId(String(id)), deletedAt: null })
          : null
      if (!existing) return { success: false, message: 'Cash request settlement not found.' }
      if (input.settlementType && input.settlementType !== existing.settlementType) {
        return { success: false, message: 'The settlementType of a settlement cannot change.' }
      }

      const items = (input.items || []).map(normalizeCashRequestSettlementItem)
      const total =
        input.total !== undefined && input.total !== null
          ? num(input.total)
          : existing.settlementType === 'Lolo'
          ? items.reduce((sum, i) => sum + i.loloTotalCost, 0)
          : items.reduce((sum, i) => sum + i.totalSettlement, 0)
      const updated = await mongoUpdate(
        'CashRequestSettlement',
        {
          id: existing._id,
          settlementNo: existing.settlementNo || input.settlementNo || null,
          items,
          total,
          rounding:
            input.rounding !== undefined && input.rounding !== null ? num(input.rounding) : num(existing.rounding),
          note: input.note !== undefined && input.note !== null ? input.note : existing.note || '',
          isDraft: typeof input.isDraft === 'boolean' ? input.isDraft : Boolean(existing.isDraft),
          userId: existing.userId || String(currentUser._id),
          updatedAt: new Date().getTime(),
        },
        context
      )
      if (updated instanceof Error) {
        return { success: false, message: 'Failed to update cash request settlement.' }
      }

      const cashRequestSettlement = await mongo.CashRequestSettlement.findOne({ _id: existing._id })
      return {
        success: true,
        message: 'Cash request settlement has been updated successfully!',
        cashRequestSettlement,
      }
    }),
    deleteCashRequestSettlement: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!currentUser) return { success: false, message: 'User is not authorized.' }
      await mongoDelete('CashRequestSettlement', args, context)
      return { success: true, message: 'Cash request settlement has been deleted successfully!' }
    }),
  },
}
