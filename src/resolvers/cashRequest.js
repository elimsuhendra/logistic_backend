import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'

function normalizeUjlDetails(list) {
  if (!Array.isArray(list)) return []
  return list.map(u => ({
    costId: (u && u.costId) || '',
    biaya: (u && u.biaya) || '',
    isCost: u && u.isCost !== undefined && u.isCost !== null ? Boolean(u.isCost) : true,
    nominal: u && u.nominal !== undefined && u.nominal !== null ? parseFloat(u.nominal) || 0 : 0,
    uploadUrl: (u && u.uploadUrl) || '',
    isUploaded: Boolean((u && u.isUploaded) || (u && u.uploadUrl)),
    paymentDate: (u && u.paymentDate) || null,
    account: (u && u.account) || '',
    memo: (u && u.memo) || '',
  }))
}

function normalizeDestinationItem(item, fallbackJob) {
  const fb = fallbackJob || {}
  if (typeof item === 'string') {
    return {
      jobPlanningId: fb.jobPlanningId || null,
      customerId: fb.customerId || null,
      consigneeId: fb.consigneeId || null,
      destination: item,
      nominal: 0,
      qty: null,
      size: null,
      sizeMeasurement: '',
      vehicleId: null,
      driverId: null,
      policeNo: '',
      driver: '',
      departureDate: null,
      transferDate: null,
      kasbon: 0,
      settlementDate: null,
      addCostSettlement: 0,
      totalSettlement: 0,
      ujlNote: '',
      ujlDetails: [],
      kasbonDiff: 0,
      kasbonDiffNote: '',
      uploadUrl: '',
      isUploaded: false,
    }
  }
  const kasbon =
    item && item.kasbon !== undefined && item.kasbon !== null ? parseFloat(item.kasbon) || 0 : 0
  const totalSettlement =
    item && item.totalSettlement !== undefined && item.totalSettlement !== null
      ? parseFloat(item.totalSettlement) || 0
      : 0
  const kasbonDiff =
    item && item.kasbonDiff !== undefined && item.kasbonDiff !== null
      ? parseFloat(item.kasbonDiff) || 0
      : kasbon - totalSettlement

  return {
    jobPlanningId: (item && item.jobPlanningId) || fb.jobPlanningId || null,
    customerId: (item && item.customerId) || fb.customerId || null,
    consigneeId: (item && item.consigneeId) || fb.consigneeId || null,
    destination: (item && (item.destination || item.value || item.name)) || '',
    nominal: (item && item.nominal !== undefined && item.nominal !== null) ? parseFloat(item.nominal) : 0,
    qty: (item && item.qty) ? parseInt(item.qty, 10) : null,
    size: (item && item.size) ? parseFloat(item.size) : null,
    sizeMeasurement: (item && (item.sizeMeasurement || item.sizeMeasurment)) || '',
    vehicleId: (item && item.vehicleId) || null,
    driverId: (item && item.driverId) || null,
    policeNo: (item && item.policeNo) || '',
    driver: (item && item.driver) || '',
    departureDate: (item && item.departureDate) || null,
    transferDate: (item && item.transferDate) || null,
    kasbon,
    settlementDate: (item && item.settlementDate) || null,
    addCostSettlement:
      item && item.addCostSettlement !== undefined && item.addCostSettlement !== null
        ? parseFloat(item.addCostSettlement) || 0
        : 0,
    totalSettlement,
    ujlNote: (item && item.ujlNote) || '',
    ujlDetails: normalizeUjlDetails(item && item.ujlDetails),
    kasbonDiff,
    kasbonDiffNote: (item && item.kasbonDiffNote) || '',
    uploadUrl: (item && item.uploadUrl) || '',
    isUploaded: Boolean((item && item.isUploaded) || (item && item.uploadUrl)),
  }
}

export default {
  cashJobObject: {
    jobPlanning: async ({ jobPlanningId }, args, { mongo }) => {
      if (!jobPlanningId) return null
      const query = ObjectId.isValid(jobPlanningId)
        ? { _id: ObjectId(jobPlanningId), deletedAt: null }
        : { jobPlanningNo: jobPlanningId, deletedAt: null }
      return await mongo.JobPlanning.findOne(query)
    },
    customer: async (parent, args, { dataloaders, mongo }) => {
      let customerId = parent.customerId
      if (!customerId && parent.jobPlanningId) {
        const query = ObjectId.isValid(parent.jobPlanningId)
          ? { _id: ObjectId(parent.jobPlanningId), deletedAt: null }
          : { jobPlanningNo: parent.jobPlanningId, deletedAt: null }
        const jp = await mongo.JobPlanning.findOne(query)
        customerId = jp ? jp.customerId : null
      }
      return customerId && ObjectId.isValid(customerId)
        ? await dataloaders.get('customerByIdLoader').load(customerId)
        : null
    },
    consignee: async (parent, args, { dataloaders, mongo }) => {
      let consigneeId = parent.consigneeId
      if (!consigneeId && parent.jobPlanningId) {
        const query = ObjectId.isValid(parent.jobPlanningId)
          ? { _id: ObjectId(parent.jobPlanningId), deletedAt: null }
          : { jobPlanningNo: parent.jobPlanningId, deletedAt: null }
        const jp = await mongo.JobPlanning.findOne(query)
        consigneeId = jp ? jp.consigneeId : null
      }
      return consigneeId && ObjectId.isValid(consigneeId)
        ? await dataloaders.get('customerByIdLoader').load(consigneeId)
        : null
    },
  },
  CashRequest: {
    id: parent => parent._id || parent.id,
    statusOperation: parent => parent.statusOperation,
    jobPlanning: async (parent, args, { mongo }) => {
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
    employee: async ({ employeeId }, args, { dataloaders }) => {
      return employeeId && ObjectId.isValid(employeeId)
        ? await dataloaders.get('userByIdLoader').load(employeeId)
        : null
    },
    destination: parent => {
      if (parent && Array.isArray(parent.destination)) {
        return parent.destination.map(d => (typeof d === 'string' ? d : (d && d.destination) || ''))
      }
      if (parent && Array.isArray(parent.destinations)) {
        return parent.destinations.map(d => (typeof d === 'string' ? d : (d && d.destination) || '')).filter(Boolean)
      }
      return []
    },
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
        const query = ObjectId.isValid(id) ? { _id: ObjectId(id), deletedAt: null } : { cashNo: id, deletedAt: null }
        return await mongo.CashRequest.findOne(query)
      }
    ),
    getLastCashRequest: requiresAuth.createResolver(
      async (parent, { prefixCashNo }, { mongo }) => {
        if (!prefixCashNo) return null
        const prefix = sanitizeRegex(prefixCashNo.trim())
        const [cashRequest] = await mongo.CashRequest.find({
          cashNo: { $regex: `^${prefix}`, $options: 'i' },
          deletedAt: null,
        })
          .sort({ cashNo: -1 })
          .limit(1)
          .toArray()

        return cashRequest || null
      }
    ),
    allCashRequests: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 20
        const offset = skip || 0
        const { search, ...restFilter } = filter || {}
        let filters = buildMongoFilters(restFilter) || {}

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
              { cashNo: { $regex: regexStr, $options: 'i' } },
              { cashType: { $regex: regexStr, $options: 'i' } },
              { destination: { $regex: regexStr, $options: 'i' } },
              { 'destinations.destination': { $regex: regexStr, $options: 'i' } },
              ...(jobIds.length > 0 ? [{ jobPlanningId: { $in: jobIds } }, { 'jobs.jobPlanningId': { $in: jobIds } }] : []),
              ...(userIds.length > 0 ? [{ employeeId: { $in: userIds } }] : []),
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
        const { search, ...restFilter } = filter || {}
        let filters = buildMongoFilters(restFilter) || {}

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
              { cashNo: { $regex: regexStr, $options: 'i' } },
              { cashType: { $regex: regexStr, $options: 'i' } },
              { destination: { $regex: regexStr, $options: 'i' } },
              { 'destinations.destination': { $regex: regexStr, $options: 'i' } },
              ...(jobIds.length > 0 ? [{ jobPlanningId: { $in: jobIds } }, { 'jobs.jobPlanningId': { $in: jobIds } }] : []),
              ...(userIds.length > 0 ? [{ employeeId: { $in: userIds } }] : []),
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
        if (!input.cashNo) {
          return {
            success: false,
            message: "Bond No. (Cash No) is required.",
          }
        }

        input.isDraft = typeof input.isDraft === 'boolean' ? input.isDraft : false
        if (Array.isArray(input.jobs) && input.jobs.length > 0) {
          const firstJob = input.jobs[0]
          if (!input.jobPlanningId && firstJob.jobPlanningId) input.jobPlanningId = firstJob.jobPlanningId
          if (!input.customerId && firstJob.customerId) input.customerId = firstJob.customerId
          if (!input.consigneeId && firstJob.consigneeId) input.consigneeId = firstJob.consigneeId
          const flatDests = []
          input.jobs.forEach(job => {
            if (job && Array.isArray(job.destinations)) {
              job.destinations = job.destinations.map(d => normalizeDestinationItem(d, job))
              job.destinations.forEach(d => {
                flatDests.push(d)
              })
            }
          })
          input.destinations = flatDests
        }
        if (!input.destination && Array.isArray(input.destinations)) {
          input.destination = input.destinations.map(d => (d && d.destination) || '').filter(Boolean)
        }
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
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id, input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (id) {
          input.id = id
        }
        if (Array.isArray(input.jobs) && input.jobs.length > 0) {
          const firstJob = input.jobs[0]
          if (!input.jobPlanningId && firstJob.jobPlanningId) input.jobPlanningId = firstJob.jobPlanningId
          if (!input.customerId && firstJob.customerId) input.customerId = firstJob.customerId
          if (!input.consigneeId && firstJob.consigneeId) input.consigneeId = firstJob.consigneeId
          const flatDests = []
          input.jobs.forEach(job => {
            if (job && Array.isArray(job.destinations)) {
              job.destinations = job.destinations.map(d => normalizeDestinationItem(d, job))
              job.destinations.forEach(d => {
                flatDests.push(d)
              })
            }
          })
          input.destinations = flatDests
        }
        if (!input.destination && Array.isArray(input.destinations)) {
          input.destination = input.destinations.map(d => (d && d.destination) || '').filter(Boolean)
        }
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
