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

// voucherItemObject; vouchers saved before the rename may still hold costId / biaya
function normalizeItems(items) {
  return (Array.isArray(items) ? items : []).map(i => ({
    categoryIdCostRevenue: i.categoryIdCostRevenue || i.costId || '',
    categoryNameCostRevenue: i.categoryNameCostRevenue || i.biaya || '',
    isCost: i.isCost !== undefined && i.isCost !== null ? Boolean(i.isCost) : true,
    nominal: num(i.nominal),
    uploadUrl: i.uploadUrl || '',
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
  // reffId stored as string or ObjectId: match both forms of every id
  if (Array.isArray(f.reffId_in)) {
    const ids = f.reffId_in.filter(Boolean).map(String)
    out.reffId = {
      $in: [...ids, ...ids.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id))],
    }
  }
  if (f.reffCollectionName) out.reffCollectionName = f.reffCollectionName
  if (f.jobPlanningId) out.jobPlanningId = idMatch(f.jobPlanningId)
  if (f.categoryIdVoucherAccount) out.categoryIdVoucherAccount = f.categoryIdVoucherAccount
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
// (accountId, createdBy and voucherNo are handled by create / update)
function buildVoucherDoc(input) {
  const items = normalizeItems(input.items)
  return {
    paymentDate: input.paymentDate ? new Date(input.paymentDate).valueOf() : null,
    categoryIdVoucherAccount: input.categoryIdVoucherAccount || '',
    memo: (input.memo || '').trim(),
    items,
    ...computeTotals(items),
    isDraft: Boolean(input.isDraft),
  }
}

const VOUCHER_REFF_JOB_PLANNING = 'jobPlannings'

// Record the voucher belongs to (reffId / reffNo / reffCollectionName). Detail Add
// Cost Penyelesaian sends its No. Job: reffId = jobPlanningId, reffNo =
// jobPlanningNo, reffCollectionName = "jobPlannings". The collection defaults to
// jobPlannings and an empty reffNo is looked up. Without reffId nothing changes.
async function buildReff(mongo, input) {
  if (!input || !input.reffId) return {}
  const reffId = String(input.reffId)
  const reffCollectionName = input.reffCollectionName || VOUCHER_REFF_JOB_PLANNING
  let reffNo = input.reffNo || null
  if (!reffNo && reffCollectionName === VOUCHER_REFF_JOB_PLANNING) {
    const jobPlanning = await findById(mongo.JobPlanning, reffId)
    reffNo = (jobPlanning && jobPlanning.jobPlanningNo) || null
  }
  return { reffId, reffNo, reffCollectionName }
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
    settlement: (parent, args, { mongo }) =>
      parent.reffCollectionName === 'settlements' ? findById(mongo.Settlement, parent.reffId) : null,
    cashRequest: (parent, args, { mongo }) => findById(mongo.CashRequest, parent.cashRequestId),
    jobPlanning: (parent, args, { mongo }) =>
      findById(
        mongo.JobPlanning,
        parent.reffCollectionName === VOUCHER_REFF_JOB_PLANNING ? parent.reffId : parent.jobPlanningId
      ),
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
    // by id (the dashboard takes it from settlement.items[].voucherId)
    getVoucher: requiresAuth.createResolver(async (parent, { id }, { mongo }) => {
      const result = findById(mongo.Voucher, id)
      return result
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
        // reffId = jobPlanningId, reffNo = jobPlanningNo, reffCollectionName = "jobPlannings"
        const doc = { ...input, ...(await buildReff(mongo, input)) }
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
        // reffId = jobPlanningId, reffNo = jobPlanningNo, reffCollectionName = "jobPlannings"
        const doc = { ...input, ...(await buildReff(mongo, input)) }
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
