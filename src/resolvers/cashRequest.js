import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'

// ids may be stored as ObjectId or string
const idMatch = id =>
  ObjectId.isValid(String(id)) ? { $in: [ObjectId(String(id)), String(id)] } : String(id)

// Cash requests of the given account that the given user either created
// (userId / employeeId) or is an approver of (Approval.userId + accountId)
async function buildAccessFilter(mongo, accountId, userId) {
  if (!userId || !accountId) return { _id: { $in: [] } }

  const approvals = await mongo.Approval.find({
    userId: idMatch(userId),
    accountId: idMatch(accountId),
    deletedAt: null,
  }).project({ reffId: 1 }).toArray()
  const approvalReffIds = (approvals || [])
    .map(a => a.reffId)
    .filter(id => id && ObjectId.isValid(String(id)))
    .map(id => ObjectId(String(id)))

  return {
    accountId: idMatch(accountId),
    $or: [
      { userId: idMatch(userId) },
      { employeeId: idMatch(userId) },
      // as an approver: only cash requests that are no longer a draft (a missing
      // statusOperation counts as Draft, as in the list); the creator still sees drafts
      ...(approvalReffIds.length > 0
        ? [{
            _id: { $in: approvalReffIds },
            statusOperation: { $nin: ['Draft', null] },
            isDraft: { $ne: true },
          }]
        : []),
    ],
  }
}

// Base mongo filter for allCashRequests / _allCashRequestsMeta (without search).
// userId + accountId together → cash requests of that account the user created or
// approves; either one alone keeps the plain field filter.
async function buildCashRequestFilters(mongo, filter) {
  const { search, userId, accountId, ...restFilter } = filter || {}
  if (userId && accountId) {
    return { $and: [buildMongoFilters(restFilter) || {}, await buildAccessFilter(mongo, accountId, userId)] }
  }
  return buildMongoFilters({
    ...restFilter,
    ...(userId ? { userId } : {}),
    ...(accountId ? { accountId } : {}),
  }) || {}
}

// Legacy line (cash request part only). Settlement data lives in the Settlement collection.
function normalizeDestinationItem(item, fallbackJob) {
  const fb = fallbackJob || {}
  const it = typeof item === 'string' ? { destination: item } : item || {}
  return {
    jobPlanningId: it.jobPlanningId || fb.jobPlanningId || null,
    customerId: it.customerId || fb.customerId || null,
    consigneeId: it.consigneeId || fb.consigneeId || null,
    destination: it.destination || it.value || it.name || '',
    nominal: it.nominal !== undefined && it.nominal !== null ? parseFloat(it.nominal) || 0 : 0,
    qty: it.qty ? parseInt(it.qty, 10) : null,
    size: it.size ? parseFloat(it.size) : null,
    sizeMeasurement: it.sizeMeasurement || it.sizeMeasurment || '',
  }
}

// Settlement totals that used to be stored on the cash request itself
const LEGACY_SETTLEMENT_KEYS = [
  'jobSettlement',
  'sparePartSettlement',
  'otherSettlement',
  'driverSettlement',
  'loloSettlement',
]

// Soft-deletes the settlements of deleted cash requests: the CashRequestSettlement
// collection, and the older Settlement collection so no orphans stay behind there
async function softDeleteSettlements(mongo, cashRequestIds) {
  const ids = (cashRequestIds || []).filter(Boolean).map(String)
  if (ids.length === 0) return
  const filter = { cashRequestId: { $in: ids }, deletedAt: null }
  const update = { $set: { deletedAt: new Date().getTime() } }
  await mongo.CashRequestSettlement.updateMany(filter, update)
  await mongo.Settlement.updateMany(filter, update)
}

function isSet(value) {
  return value !== undefined && value !== null && value !== ''
}

function sumNominal(destinations) {
  return (destinations || []).reduce((sum, d) => sum + (parseFloat(d && d.nominal) || 0), 0)
}

function findJobPlanning(mongo, jobPlanningId) {
  if (!jobPlanningId) return null
  const query = ObjectId.isValid(jobPlanningId)
    ? { _id: ObjectId(jobPlanningId), deletedAt: null }
    : { jobPlanningNo: jobPlanningId, deletedAt: null }
  return mongo.JobPlanning.findOne(query)
}

// Shapes any stored/incoming line into a cashRequestItemObject.
// Accepts legacy destination rows ({ destination, nominal, ... }) for old records.
function normalizeCashRequestItem(item) {
  const it = typeof item === 'string' ? { daerah: item } : item || {}
  return {
    qty: isSet(it.qty) ? parseInt(it.qty, 10) || null : null,
    size: isSet(it.size) ? parseFloat(it.size) || null : null,
    sizeMeasurement: it.sizeMeasurement || it.sizeMeasurment || '',
    daerah: it.daerah || it.destination || it.value || it.name || '',
    nominal: isSet(it.nominal) ? parseFloat(it.nominal) || 0 : 0,
  }
}

// Shapes any stored/incoming detail into a cashRequestDetailObject
// (one row per No. Job, with its stacked Qty / Daerah / Nominal items).
// Accepts legacy keys (destinations, details, subTotal, totalPengajuan, jobPlannnigNo).
function normalizeCashRequestDetail(detail) {
  const d = detail || {}
  const rawItems = Array.isArray(d.items)
    ? d.items
    : Array.isArray(d.destinations)
    ? d.destinations
    : Array.isArray(d.details)
    ? d.details
    : []
  const items = rawItems.map(normalizeCashRequestItem)
  const legacyTotal = [d.total, d.subTotal, d.totalPengajuan, d.nominal].find(isSet)
  // Total = sum of items[].nominal
  const total = items.length > 0 ? sumNominal(items) : parseFloat(legacyTotal) || 0
  return {
    jobPlanningId: d.jobPlanningId || null,
    jobPlanningNo: d.jobPlanningNo || d.jobPlannnigNo || null,
    customerId: d.customerId || null,
    items,
    total,
  }
}

// Legacy records stored one detail per destination row; merge them back into one row per job.
function mergeDetailsByJob(details) {
  const merged = []
  details.forEach(detail => {
    const existing = detail.jobPlanningId
      ? merged.find(m => m.jobPlanningId === detail.jobPlanningId)
      : null
    if (existing) {
      existing.items = existing.items.concat(detail.items)
      existing.total += detail.total
      existing.jobPlanningNo = existing.jobPlanningNo || detail.jobPlanningNo
      existing.customerId = existing.customerId || detail.customerId
    } else {
      merged.push({ ...detail, items: [...detail.items] })
    }
  })
  return merged
}

// Builds the legacy `jobs` entry (used by the settlement tables) from a detail row.
// Settlement fields already saved on the same job/line are kept.
function jobFromDetail(detail, existingJobs) {
  const prevJob =
    (existingJobs || []).find(j => j && detail.jobPlanningId && j.jobPlanningId === detail.jobPlanningId) || {}
  const prevDests = Array.isArray(prevJob.destinations) ? prevJob.destinations : []
  return {
    jobPlanningId: detail.jobPlanningId,
    customerId: detail.customerId,
    consigneeId: detail.consigneeId || prevJob.consigneeId || null,
    destinations: detail.items.map((item, idx) => ({
      ...(prevDests[idx] && typeof prevDests[idx] === 'object' ? prevDests[idx] : {}),
      jobPlanningId: detail.jobPlanningId,
      customerId: detail.customerId,
      destination: item.daerah,
      nominal: item.nominal,
      qty: item.qty,
      size: item.size,
      sizeMeasurement: item.sizeMeasurement,
    })),
    total: detail.total,
  }
}

// Normalizes a create/update input so cashRequestDetails is stored as
// [cashRequestDetailObject] and the legacy jobs/destinations fields stay in sync.
async function prepareCashRequestInput(input, existing, mongo) {
  // Settlement totals are saved through createCashRequestSettlement, never on the cash request
  LEGACY_SETTLEMENT_KEYS.forEach(key => delete input[key])

  if (Array.isArray(input.cashRequestDetails)) {
    const details = input.cashRequestDetails.map(normalizeCashRequestDetail)

    // Fill jobPlanningNo / customerId from the job planning when not sent
    const consigneeByJob = {}
    await Promise.all(
      details.map(async detail => {
        if (!detail.jobPlanningId) return
        const jp = await findJobPlanning(mongo, detail.jobPlanningId)
        if (!jp) return
        if (!detail.jobPlanningNo) detail.jobPlanningNo = jp.jobPlanningNo || null
        if (!detail.customerId) detail.customerId = jp.customerId || null
        consigneeByJob[detail.jobPlanningId] = jp.consigneeId || null
      })
    )

    input.cashRequestDetails = details
    const existingJobs = existing && Array.isArray(existing.jobs) ? existing.jobs : []
    // input.jobs = details.map(detail =>
    //   jobFromDetail({ ...detail, consigneeId: consigneeByJob[detail.jobPlanningId] }, existingJobs)
    // )
  }

  // if (Array.isArray(input.jobs) && input.jobs.length > 0) {
  //   const firstJob = input.jobs[0]
  //   if (!input.jobPlanningId && firstJob.jobPlanningId) input.jobPlanningId = firstJob.jobPlanningId
  //   if (!input.customerId && firstJob.customerId) input.customerId = firstJob.customerId
  //   if (!input.consigneeId && firstJob.consigneeId) input.consigneeId = firstJob.consigneeId
  //   const flatDests = []
  //   input.jobs.forEach(job => {
  //     if (job && Array.isArray(job.destinations)) {
  //       job.destinations = job.destinations.map(d => normalizeDestinationItem(d, job))
  //       flatDests.push(...job.destinations)
  //     }
  //   })
  //   input.destinations = flatDests
  // }

  // if (!input.destination && Array.isArray(input.destinations)) {
  //   input.destination = input.destinations.map(d => (d && d.destination) || '').filter(Boolean)
  // }
  return input
}

const jobRelationResolvers = {
  jobPlanning: async ({ jobPlanningId }, args, { mongo }) => {
    return await findJobPlanning(mongo, jobPlanningId)
  },
  customer: async (parent, args, { dataloaders, mongo }) => {
    let customerId = parent.customerId
    if (!customerId && parent.jobPlanningId) {
      const jp = await findJobPlanning(mongo, parent.jobPlanningId)
      customerId = jp ? jp.customerId : null
    }
    return customerId && ObjectId.isValid(customerId)
      ? await dataloaders.get('customerByIdLoader').load(customerId)
      : null
  },
  consignee: async (parent, args, { dataloaders, mongo }) => {
    let consigneeId = parent.consigneeId
    if (!consigneeId && parent.jobPlanningId) {
      const jp = await findJobPlanning(mongo, parent.jobPlanningId)
      consigneeId = jp ? jp.consigneeId : null
    }
    return consigneeId && ObjectId.isValid(consigneeId)
      ? await dataloaders.get('customerByIdLoader').load(consigneeId)
      : null
  },
}

export default {
  cashRequestDetailObject: {
    // cashRequestDetailObject has no consignee in the schema
    jobPlanning: jobRelationResolvers.jobPlanning,
    customer: jobRelationResolvers.customer,
    jobPlanningNo: async (parent, args, { mongo }) => {
      if (parent.jobPlanningNo) return parent.jobPlanningNo
      const jp = await findJobPlanning(mongo, parent.jobPlanningId)
      return jp ? jp.jobPlanningNo || null : null
    },
  },
  cashJobObject: {
    ...jobRelationResolvers,
  },
  CashRequest: {
    id: parent => parent._id || parent.id,
    // stored as cashNo before the rename (db:migrate:cashRequestNo)
    cashRequestNo: parent => parent.cashRequestNo || parent.cashNo || null,
    statusOperation: parent => parent.statusOperation,
    // Latest approval of this record (reffId) whose status is Approved, Rejected,
    // Pending or Cancelled; approvals still Waiting are ignored
    lastApprovalStatus: async (parent, args, { mongo }) => {
      const id = parent && (parent._id || parent.id)
      if (!id) return null
      const reffId = ObjectId.isValid(String(id))
        ? { $in: [ObjectId(String(id)), String(id)] }
        : String(id)
      const approval = await mongo.Approval.findOne(
        {
          reffId,
          deletedAt: null,
          approval: { $in: ['Approved', 'Rejected', 'Pending', 'Cancelled'] },
        },
        { sort: { updatedAt: -1, createdAt: -1 } }
      )
      return approval ? approval.approval : null
    },
    jobPlanning: async (parent, args, { mongo }) => {
      console.log('jobPlanning')
      const firstJobId =
        parent.jobPlanningId ||
        (Array.isArray(parent.jobs) && parent.jobs[0] && parent.jobs[0].jobPlanningId) ||
        null
      if (!firstJobId) return null
      const query = ObjectId.isValid(firstJobId)
        ? { _id: ObjectId(firstJobId), deletedAt: null }
        : { jobPlanningNo: firstJobId, deletedAt: null }
      return await mongo.JobPlanning.findOne(query)
    },
    customer: async (parent, args, { dataloaders, mongo }) => {
      let customerId =
        parent.customerId ||
        (Array.isArray(parent.jobs) && parent.jobs[0] && parent.jobs[0].customerId) ||
        null
      const firstJobId =
        parent.jobPlanningId ||
        (Array.isArray(parent.jobs) && parent.jobs[0] && parent.jobs[0].jobPlanningId) ||
        null
      if (!customerId && firstJobId) {
        const query = ObjectId.isValid(firstJobId)
          ? { _id: ObjectId(firstJobId), deletedAt: null }
          : { jobPlanningNo: firstJobId, deletedAt: null }
        const jp = await mongo.JobPlanning.findOne(query)
        customerId = jp ? jp.customerId : null
      }
      return customerId && ObjectId.isValid(customerId)
        ? await dataloaders.get('customerByIdLoader').load(customerId)
        : null
    },
    consignee: async (parent, args, { dataloaders, mongo }) => {
      let consigneeId =
        parent.consigneeId ||
        (Array.isArray(parent.jobs) && parent.jobs[0] && parent.jobs[0].consigneeId) ||
        null
      const firstJobId =
        parent.jobPlanningId ||
        (Array.isArray(parent.jobs) && parent.jobs[0] && parent.jobs[0].jobPlanningId) ||
        null
      if (!consigneeId && firstJobId) {
        const query = ObjectId.isValid(firstJobId)
          ? { _id: ObjectId(firstJobId), deletedAt: null }
          : { jobPlanningNo: firstJobId, deletedAt: null }
        const jp = await mongo.JobPlanning.findOne(query)
        consigneeId = jp ? jp.consigneeId : null
      }
      return consigneeId && ObjectId.isValid(consigneeId)
        ? await dataloaders.get('customerByIdLoader').load(consigneeId)
        : null
    },
    userId: parent => parent.userId || parent.employeeId || null,
    employeeId: parent => parent.employeeId || parent.userId || null,
    accountId: parent => parent.accountId || null,
    user: async (parent, args, { dataloaders }) => {
      const uid = parent.userId || parent.employeeId
      if (!uid || !ObjectId.isValid(uid)) return null
      const userObj = await dataloaders.get('userByIdLoader').load(uid)
      if (userObj && parent.accountId) {
        return Object.assign({}, userObj, { accountId: parent.accountId })
      }
      return userObj
    },
    employee: async (parent, args, { dataloaders }) => {
      const uid = parent.userId || parent.employeeId
      if (!uid || !ObjectId.isValid(uid)) return null
      const userObj = await dataloaders.get('userByIdLoader').load(uid)
      if (userObj && parent.accountId) {
        return Object.assign({}, userObj, { accountId: parent.accountId })
      }
      return userObj
    },
    // destination: parent => {
    //   if (parent && Array.isArray(parent.destination)) {
    //     return parent.destination.map(d => (typeof d === 'string' ? d : (d && d.destination) || ''))
    //   }
    //   if (parent && Array.isArray(parent.destinations)) {
    //     return parent.destinations.map(d => (typeof d === 'string' ? d : (d && d.destination) || '')).filter(Boolean)
    //   }
    //   return []
    // },
    destinations: parent => {
      if (!parent) return []
      if (Array.isArray(parent.jobs) && parent.jobs.length > 0) {
        const listFromJobs = []
        parent.jobs.forEach(job => {
          if (job && Array.isArray(job.destinations)) {
            job.destinations.forEach(d => {
              listFromJobs.push(normalizeDestinationItem(d, job))
            })
          }
        })
        if (listFromJobs.length > 0) return listFromJobs
      }
      let list = parent.destinations || parent.destination
      if (!list) return []
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list)
        } catch (_) {
          list = [list]
        }
      }
      if (!Array.isArray(list)) return []
      return list.map(item => normalizeDestinationItem(item, parent))
    },
    jobs: parent => {
      if (!parent) return []
      if (Array.isArray(parent.jobs) && parent.jobs.length > 0) {
        return parent.jobs.map(job => {
          const dests = Array.isArray(job.destinations)
            ? job.destinations.map(d => normalizeDestinationItem(d, job))
            : []
          const total =
            job.total !== undefined && job.total !== null
              ? parseFloat(job.total)
              : dests.reduce((sum, d) => sum + (parseFloat(d.nominal) || 0), 0)
          return {
            jobPlanningId: job.jobPlanningId || null,
            customerId: job.customerId || null,
            consigneeId: job.consigneeId || null,
            destinations: dests,
            total,
          }
        })
      }

      // Backward compatibility for records with top-level jobPlanningId / destinations
      const rawDests = Array.isArray(parent.destinations)
        ? parent.destinations
        : Array.isArray(parent.destination)
        ? parent.destination
        : []
      const normalizedDests = rawDests.map(d => normalizeDestinationItem(d, parent))
      if (parent.jobPlanningId || normalizedDests.length > 0) {
        const total = normalizedDests.reduce((sum, d) => sum + (parseFloat(d.nominal) || 0), 0)
        return [
          {
            jobPlanningId: parent.jobPlanningId || null,
            customerId: parent.customerId || null,
            consigneeId: parent.consigneeId || null,
            destinations: normalizedDests,
            total,
          },
        ]
      }
      return []
    },
    cashRequestDetails: parent => {
      if (!parent) return []
      let list = parent.cashRequestDetails
      if (typeof list === 'string') {
        try {
          list = JSON.parse(list)
        } catch (_) {
          list = null
        }
      }
      if (!Array.isArray(list)) list = []
      const hasItems = list.some(d => d && Array.isArray(d.items))
      const jobs = Array.isArray(parent.jobs) ? parent.jobs : []
      // Legacy records (no items yet): rebuild the rows from the synced jobs when available
      if (!hasItems && jobs.length > 0) list = jobs
      return mergeDetailsByJob(list.map(normalizeCashRequestDetail))
    },
    cashRequestSettlements: async (parent, args, { mongo }) => {
      const id = parent && (parent._id || parent.id)
      if (!id) return []
      return mongo.CashRequestSettlement.find({ cashRequestId: String(id), deletedAt: null })
        .sort({ createdAt: 1 })
        .toArray()
    },
  },
  Subscription: {
    CashRequest: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-CashRequest'),
          (payload, args) => {
            return compareObject(payload.CashRequest.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getCashRequest: requiresAuth.createResolver(
      async (parent, { id }, { mongo }) => {
        if (!id) return null
        const query = ObjectId.isValid(id)
          ? { _id: ObjectId(id), deletedAt: null }
          : { $or: [{ cashRequestNo: id }, { cashNo: id }], deletedAt: null }
        return await mongo.CashRequest.findOne(query)
      }
    ),
    getLastCashRequest: requiresAuth.createResolver(
      async (parent, { prefixCashRequestNo }, { mongo }) => {
        if (!prefixCashRequestNo) return null
        const prefix = sanitizeRegex(prefixCashRequestNo.trim())
        // highest number on cashRequestNo, or on cashNo for documents not yet
        // migrated (db:migrate:cashRequestNo)
        const lastBy = async field => {
          const [doc] = await mongo.CashRequest.find({
            [field]: { $regex: `^${prefix}`, $options: 'i' },
            deletedAt: null,
          })
            .sort({ [field]: -1 })
            .limit(1)
            .toArray()
          return doc || null
        }
        const [byNew, byOld] = await Promise.all([lastBy('cashRequestNo'), lastBy('cashNo')])
        if (!byNew || !byOld) return byNew || byOld
        return String(byOld.cashNo) > String(byNew.cashRequestNo) ? byOld : byNew
      }
    ),
    allCashRequests: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 20
        const offset = skip || 0
        const search = filter && filter.search
        let filters = await buildCashRequestFilters(mongo, filter)

        if (search) {
          const regexStr = sanitizeRegex(search.trim())
          const [matchedJobs, matchedUsers, matchedCustomers] = await Promise.all([
            mongo.JobPlanning.find({ jobPlanningNo: { $regex: regexStr, $options: 'i' }, deletedAt: null }).project({ _id: 1 }).toArray(),
            mongo.User.find({
              $or: [
                { fullName: { $regex: regexStr, $options: 'i' } },
                { username: { $regex: regexStr, $options: 'i' } },
              ],
              deletedAt: null
            }).project({ _id: 1 }).toArray(),
            mongo.Customer.find({ name: { $regex: regexStr, $options: 'i' }, deletedAt: null }).project({ _id: 1 }).toArray(),
          ])
          const jobIds = matchedJobs.map(j => String(j._id))
          const userIds = matchedUsers.map(u => String(u._id))
          const customerIds = matchedCustomers.map(c => String(c._id))

          filters = {
            ...filters,
            $or: [
              { cashRequestNo: { $regex: regexStr, $options: 'i' } },
              { cashNo: { $regex: regexStr, $options: 'i' } }, // not yet migrated (db:migrate:cashRequestNo)
              { cashType: { $regex: regexStr, $options: 'i' } },
              { destination: { $regex: regexStr, $options: 'i' } },
              { 'destinations.destination': { $regex: regexStr, $options: 'i' } },
              ...(jobIds.length > 0 ? [{ jobPlanningId: { $in: jobIds } }, { 'jobs.jobPlanningId': { $in: jobIds } }] : []),
              ...(userIds.length > 0 ? [{ userId: { $in: userIds } }, { employeeId: { $in: userIds } }] : []),
              ...(customerIds.length > 0 ? [{ customerId: { $in: customerIds } }, { 'jobs.customerId': { $in: customerIds } }] : []),
            ]
          }
        }

        filters = { ...filters, deletedAt: null }
        const obj = mongo.CashRequest.find(filters)

        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 })

        return await obj.toArray()
      }
    ),
    _allCashRequestsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const search = filter && filter.search
        let filters = await buildCashRequestFilters(mongo, filter)

        if (search) {
          const regexStr = sanitizeRegex(search.trim())
          const [matchedJobs, matchedUsers, matchedCustomers] = await Promise.all([
            mongo.JobPlanning.find({ jobPlanningNo: { $regex: regexStr, $options: 'i' }, deletedAt: null }).project({ _id: 1 }).toArray(),
            mongo.User.find({
              $or: [
                { fullName: { $regex: regexStr, $options: 'i' } },
                { username: { $regex: regexStr, $options: 'i' } },
              ],
              deletedAt: null
            }).project({ _id: 1 }).toArray(),
            mongo.Customer.find({ name: { $regex: regexStr, $options: 'i' }, deletedAt: null }).project({ _id: 1 }).toArray(),
          ])
          const jobIds = matchedJobs.map(j => String(j._id))
          const userIds = matchedUsers.map(u => String(u._id))
          const customerIds = matchedCustomers.map(c => String(c._id))

          filters = {
            ...filters,
            $or: [
              { cashRequestNo: { $regex: regexStr, $options: 'i' } },
              { cashNo: { $regex: regexStr, $options: 'i' } }, // not yet migrated (db:migrate:cashRequestNo)
              { cashType: { $regex: regexStr, $options: 'i' } },
              { destination: { $regex: regexStr, $options: 'i' } },
              { 'destinations.destination': { $regex: regexStr, $options: 'i' } },
              ...(jobIds.length > 0 ? [{ jobPlanningId: { $in: jobIds } }, { 'jobs.jobPlanningId': { $in: jobIds } }] : []),
              ...(userIds.length > 0 ? [{ userId: { $in: userIds } }, { employeeId: { $in: userIds } }] : []),
              ...(customerIds.length > 0 ? [{ customerId: { $in: customerIds } }, { 'jobs.customerId': { $in: customerIds } }] : []),
            ]
          }
        }

        filters = { ...filters, deletedAt: null }
        const count = await mongo.CashRequest.countDocuments(filters)
        return { count }
      }
    ),
  },
  Mutation: {
    createCashRequest: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!input.cashRequestNo) {
          return {
            success: false,
            message: "Bond No. (Cash Request No) is required.",
          }
        }

        input.isDraft = typeof input.isDraft === 'boolean' ? input.isDraft : false
        await prepareCashRequestInput(input, null, mongo)
        const cashRequest = await mongoCreate('CashRequest', input, context)
        return {
          success: true,
          message: input.isDraft
            ? "Cash request draft has been saved successfully!"
            : "Cash request has been created successfully!",
          cashRequest,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateCashRequest: requiresAuth.createResolver(async (parent, args, context) => {
      console.log('updateCashRequest')
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id, input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (id) {
          input.id = id
        }
        const existing = ObjectId.isValid(id)
          ? await mongo.CashRequest.findOne({ _id: ObjectId(id), deletedAt: null })
          : null
        await prepareCashRequestInput(input, existing, mongo)
        input["updatedAt"] = new Date().getTime()
        await mongoUpdate('CashRequest', input, context)
        const cashRequestResponse = await mongo.CashRequest.findOne({ _id: ObjectId(input.id), deletedAt: null })

        return {
          success: true,
          message: input.isDraft
            ? "Cash request draft has been updated successfully!"
            : "Cash request has been updated successfully!",
          cashRequest: cashRequestResponse,
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteCashRequest: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('CashRequest', args, context)
        await softDeleteSettlements(mongo, [args.id])
        return {
          success: true,
          message: "Cash request has been deleted successfully!"
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteCashRequests: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoMultiDelete('CashRequest', args, context)
        await softDeleteSettlements(mongo, args.ids)
        return {
          success: true,
          message: "Cash requests have been deleted successfully!"
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  }
}
