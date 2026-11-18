import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'
import { generateVoucherNo } from 'src/utils/voucher'

// ids may be stored as ObjectId or string
const idMatch = id =>
  ObjectId.isValid(String(id)) ? { $in: [ObjectId(String(id)), String(id)] } : String(id)

const num = v => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(i => ({
    costId: i.costId || '',
    biaya: i.biaya || '',
    isCost: i.isCost !== undefined && i.isCost !== null ? Boolean(i.isCost) : true,
    nominal: num(i.nominal),
    uploadUrl: i.uploadUrl || '',
    isUploaded: Boolean(i.isUploaded || i.uploadUrl),
  }))
}

// totalCost / totalRevenue / total (= cost - revenue) of the Cost / Revenue table
function computeTotals(items) {
  const totalCost = items.filter(i => i.isCost).reduce((sum, i) => sum + i.nominal, 0)
  const totalRevenue = items.filter(i => !i.isCost).reduce((sum, i) => sum + i.nominal, 0)
  return { totalCost, totalRevenue, total: totalCost - totalRevenue }
}

function buildVoucherFilters(filter) {
  const f = filter || {}
  const out = { deletedAt: null }
  if (f._id_in) out._id = { $in: f._id_in.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id)) }
  if (f.accountId) out.accountId = idMatch(f.accountId)
  if (f.voucherNo_regex) out.voucherNo = { $regex: sanitizeRegex(f.voucherNo_regex), $options: 'i' }
  if (f.reffId) out.reffId = idMatch(f.reffId)
  if (f.cashRequestId) out.cashRequestId = idMatch(f.cashRequestId)
  if (f.jobPlanningId) out.jobPlanningId = idMatch(f.jobPlanningId)
  if (f.cashAccountId) out.cashAccountId = f.cashAccountId
  if (f.paymentDate_gte || f.paymentDate_lte) {
    out.paymentDate = {
      ...(f.paymentDate_gte ? { $gte: new Date(f.paymentDate_gte).valueOf() } : {}),
      ...(f.paymentDate_lte ? { $lte: new Date(f.paymentDate_lte).valueOf() } : {}),
    }
  }
  if (Array.isArray(f.OR) && f.OR.length > 0) out.$or = f.OR.map(buildVoucherFilters)
  if (Array.isArray(f.AND) && f.AND.length > 0) out.$and = f.AND.map(buildVoucherFilters)
  return out
}

const findById = (collection, id) =>
  id && ObjectId.isValid(String(id))
    ? collection.findOne({ _id: ObjectId(String(id)), deletedAt: null })
    : null

// Fields shared by create and update, taken from VoucherInput
async function buildVoucherDoc(mongo, input) {
  const items = normalizeItems(input.items)
  const doc = {
    paymentDate: input.paymentDate ? new Date(input.paymentDate).valueOf() : null,
    cashAccountId: input.cashAccountId || '',
    cashAccountName: input.cashAccountName || input.cashAccountId || '',
    memo: (input.memo || '').trim(),
    items,
    ...computeTotals(items),
    cashRequestId: input.cashRequestId || null,
    jobPlanningId: input.jobPlanningId || null,
    lineIndex: Number.isInteger(input.lineIndex) ? input.lineIndex : null,
    isDraft: Boolean(input.isDraft),
  }
  if (input.reffId) {
    const settlement = await findById(mongo.Settlement, input.reffId)
    doc.reffId = String(input.reffId)
    doc.reffNo = settlement ? settlement.settlementNo || null : null
    doc.reffCollectionName = 'settlements'
  }
  return doc
}

async function getCurrentUser(context) {
  await checkPermissions(checkUserAuth)({ context })
  const { mongo, user } = context
  return mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
}

export default {
  Voucher: {
    id: parent => parent._id || parent.id,
    items: parent => normalizeItems(parent.items),
    settlement: (parent, args, { mongo }) => findById(mongo.Settlement, parent.reffId),
    cashRequest: (parent, args, { mongo }) => findById(mongo.CashRequest, parent.cashRequestId),
    jobPlanning: (parent, args, { mongo }) => findById(mongo.JobPlanning, parent.jobPlanningId),
    user: (parent, args, { mongo }) => findById(mongo.User, parent.createdBy),
  },
  Query: {
    allVouchers: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const obj = mongo.Voucher.find(buildVoucherFilters(filter))
        if (first) obj.limit(first)
        if (skip) obj.skip(skip)
        obj.sort(orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 })
        return obj.toArray()
      }
    ),
    _allVouchersMeta: requiresAuth.createResolver(async (parent, { filter }, { mongo }) => {
      const count = await mongo.Voucher.countDocuments(buildVoucherFilters(filter))
      return { count }
    }),
    // by id, or by the settlement row it belongs to (reffId + lineIndex)
    getVoucher: requiresAuth.createResolver(async (parent, { id, reffId, lineIndex }, { mongo }) => {
      if (id) return findById(mongo.Voucher, id)
      if (!reffId) return null
      return mongo.Voucher.findOne({
        reffId: idMatch(reffId),
        ...(Number.isInteger(lineIndex) ? { lineIndex } : {}),
        deletedAt: null,
      })
    }),
    // Preview of the number the next voucher of the account gets; createVoucher
    // calls generateVoucherNo again when saving, in case another voucher took it.
    getNextVoucherNo: requiresAuth.createResolver(
      async (parent, { accountId, paymentDate }, { mongo }) => {
        return await generateVoucherNo(mongo, { accountId, date: paymentDate })
      }
    ),
  },
  Mutation: {
    createVoucher: requiresAuth.createResolver(async (parent, { input }, context) => {
      const { mongo, user } = context
      const currentUser = await getCurrentUser(context)
      if (!currentUser) return { success: false, message: 'User is not authorized.' }

      try {
        const accountId = input.accountId || currentUser.accountId || null
        const doc = await buildVoucherDoc(mongo, input)
        // numbered when saved, so a preview number taken meanwhile is not reused
        const voucherNo =
          input.voucherNo || (await generateVoucherNo(mongo, { accountId, date: doc.paymentDate }))

        const created = await mongoCreate(
          'Voucher',
          {
            ...doc,
            accountId: accountId ? String(accountId) : null,
            voucherNo,
            createdBy: input.createdBy || String(user._id),
            updatedBy: String(user._id),
          },
          context
        )
        if (created instanceof Error) throw created

        const voucher = await findById(mongo.Voucher, created.id || created._id)
        return { success: true, message: 'Voucher has been created successfully!', voucher }
      } catch (err) {
        return { success: false, message: err.message || 'Failed to create voucher.' }
      }
    }),
    updateVoucher: requiresAuth.createResolver(async (parent, { id, input }, context) => {
      const { mongo, user } = context
      const currentUser = await getCurrentUser(context)
      if (!currentUser) return { success: false, message: 'User is not authorized.' }

      const existing = await findById(mongo.Voucher, id)
      if (!existing) return { success: false, message: 'Voucher not found.' }

      try {
        const doc = await buildVoucherDoc(mongo, input)
        // accountId, voucherNo and createdBy stay as created
        const updated = await mongoUpdate(
          'Voucher',
          {
            id: existing._id,
            ...doc,
            voucherNo: existing.voucherNo || input.voucherNo || null,
            updatedBy: String(user._id),
          },
          context
        )
        if (updated instanceof Error) throw updated

        const voucher = await findById(mongo.Voucher, existing._id)
        return { success: true, message: 'Voucher has been updated successfully!', voucher }
      } catch (err) {
        return { success: false, message: err.message || 'Failed to update voucher.' }
      }
    }),
    deleteVoucher: requiresAuth.createResolver(async (parent, { id }, context) => {
      const currentUser = await getCurrentUser(context)
      if (!currentUser) return { success: false, message: 'User is not authorized.' }
      if (!(await findById(context.mongo.Voucher, id))) {
        return { success: false, message: 'Voucher not found.' }
      }
      const rs = await mongoDelete('Voucher', { id }, context)
      if (!rs.success) return { success: false, message: 'Failed to delete voucher.' }
      return { success: true, message: 'Voucher has been deleted successfully!' }
    }),
  },
}
