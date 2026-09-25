import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'
import _ from "lodash"

export default {
  JobPlanning: {
    id: parent => parent._id || parent.id,
    size: parent => (parent.size !== undefined && parent.size !== null) ? parent.size : parent.containerSize,
    customer: async ({ customerId }, args, { dataloaders }) => {
      return customerId ? await dataloaders.get('companyByIdLoader').load(customerId) : null
    },
    consignee: async ({ consigneeId }, args, { dataloaders }) => {
      return consigneeId ? await dataloaders.get('companyByIdLoader').load(consigneeId) : null
    },
  },
  Subscription: {
    JobPlanning: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-JobPlanning'),
          (payload, args) => {
            return compareObject(payload.JobPlanning.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getJobPlanning: requiresAuth.createResolver(
      async (parent, { id }, { mongo }) => {
        if (!id) return null
        const query = ObjectId.isValid(id) ? { _id: ObjectId(id), deletedAt: null } : { jobPlanningNo: id, deletedAt: null }
        return await mongo.JobPlanning.findOne(query)
      }
    ),
    getLastJobPlanning: requiresAuth.createResolver(
      async (parent, { prefixJobPlanningNo }, { mongo }) => {
        if (!prefixJobPlanningNo) return null
        const prefix = sanitizeRegex(prefixJobPlanningNo.trim())
        const [jobPlanning] = await mongo.JobPlanning.find({
          jobPlanningNo: { $regex: `^${prefix}`, $options: 'i' },
          deletedAt: null,
        })
          .sort({ jobPlanningNo: -1 })
          .limit(1)
          .toArray()

        return jobPlanning || null
      }
    ),
    allJobPlannings: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 20
        const offset = skip || 0
        const { search, ...restFilter } = filter || {}
        let filters = buildMongoFilters(restFilter) || {}

        if (search) {
          const regexStr = search.trim()
          filters = {
            ...filters,
            $or: [
              { jobPlanningNo: { $regex: regexStr, $options: 'i' } },
              { reffNo: { $regex: regexStr, $options: 'i' } },
              { containerSize: { $regex: regexStr, $options: 'i' } },
              { size: { $regex: regexStr, $options: 'i' } },
              { carType: { $regex: regexStr, $options: 'i' } },
              { sizeMeasurement: { $regex: regexStr, $options: 'i' } },
            ]
          }
        }

        filters = { ...filters, deletedAt: null }
        const obj = mongo.JobPlanning.find(filters)

        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 })

        return await obj.toArray()
      }
    ),
    _allJobPlanningsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const { search, ...restFilter } = filter || {}
        let filters = buildMongoFilters(restFilter) || {}

        if (search) {
          const regexStr = search.trim()
          filters = {
            ...filters,
            $or: [
              { jobPlanningNo: { $regex: regexStr, $options: 'i' } },
              { reffNo: { $regex: regexStr, $options: 'i' } },
              { containerSize: { $regex: regexStr, $options: 'i' } },
              { size: { $regex: regexStr, $options: 'i' } },
              { carType: { $regex: regexStr, $options: 'i' } },
              { sizeMeasurement: { $regex: regexStr, $options: 'i' } },
            ]
          }
        }

        filters = { ...filters, deletedAt: null }
        const count = await mongo.JobPlanning.countDocuments(filters)
        return { count }
      }
    ),
  },
  Mutation: {
    createJobPlanning: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!args.jobPlanningNo) {
          return {
            success: false,
            message: "Job Planning No is required.",
          }
        }

        args.isDraft = typeof args.isDraft === 'boolean' ? args.isDraft : false
        const jobPlanning = await mongoCreate('JobPlanning', args, context)
        return {
          success: true,
          message: args.isDraft
            ? "Job planning draft has been saved successfully!"
            : "Job planning has been created successfully!",
          jobPlanning,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateJobPlanning: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {

        if (typeof args.isDraft === 'boolean') {
          args.isDraft = args.isDraft
        }
        args["updatedAt"] = new Date().getTime()
        await mongoUpdate('JobPlanning', args, context)
        const jobPlanningResponse = await mongo.JobPlanning.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: args.isDraft
            ? "Job planning draft has been updated successfully!"
            : "Job planning has been updated successfully!",
          jobPlanning: jobPlanningResponse,
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteJobPlanning: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('JobPlanning', args, context)
        return {
          success: true,
          message: "Job planning has been deleted successfully!"
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteJobPlannings: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoMultiDelete('JobPlanning', args, context)
        return {
          success: true,
          message: "Job plannings have been deleted successfully!"
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  }
}
