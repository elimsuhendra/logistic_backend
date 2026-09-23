import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { prepareUpdate, prepareCreate, softNestedDelete, compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

import jobApplicant from './jobApplicant'

export default {
  ActivityLog: {
    id: parent => parent._id || parent.id,
    payload: parent => parent.payload || parent.info,
    lastData: parent => parent.lastData,
    creator: async ({ creatorId }, args, { dataloaders }) => {
      return !!creatorId ? await dataloaders.get('userByIdLoader').load(creatorId) : null
    },
    jobApplicant: async ({ objectType, objectId }, args, { dataloaders }) => {
      return objectType === "JobApplicant" && !!objectId ? await dataloaders.get('jobApplicantByIdLoader').load(objectId) : null
    },
  },
  Subscription: {
    ActivityLog: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-ActivityLog'),
          (payload, args) => {
            return compareObject(payload.ActivityLog.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getActivity: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentActivity = id ? await mongo.ActivityLog.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentActivity
      }),
    getActivityLog: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentActivity = id ? await mongo.ActivityLog.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentActivity
      }),
    allActivities: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.ActivityLog.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    allActivityLogs: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.ActivityLog.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allActivitiesMeta: requiresAuth.createResolver(
      async (parent, { filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)

        const filters = buildMongoFilters(filter) || {}
        const count = await mongo.ActivityLog.countDocuments(filters)
        const activities = await mongo.ActivityLog.find(filters).skip(offset).limit(limit).toArray()

        return {
          count,
          hasPrev: skip > 0,
          hasNext: (activities || []).length > 0
        }
      }
    ),
    _allActivityLogsMeta: requiresAuth.createResolver(
      async (parent, { filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)

        const filters = buildMongoFilters(filter) || {}
        const count = await mongo.ActivityLog.countDocuments(filters)
        const activities = await mongo.ActivityLog.find(filters).skip(offset).limit(limit).toArray()

        return {
          count,
          hasPrev: skip > 0,
          hasNext: (activities || []).length > 0
        }
      }
    ),
    allJobApplicantActivities: requiresAuth.createResolver(
      async (parent, { filter, jobApplicantFilter, first, skip, orderBy }, context) => {
        const { mongo } = context

        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)

        const jobApplicants = await jobApplicant.Query.allJobApplicants(
          parent,
          { filter: jobApplicantFilter, first: 9999 },
          context
        )

        if ((jobApplicants || []).length > 0) {
          const jobApplicantIds = (jobApplicants || []).map(jobApplicant => jobApplicant._id)

          filters.objectId = { $in: jobApplicantIds }

          const obj = mongo.ActivityLog.find(filters)
          if (first) obj.limit(limit)
          if (skip) obj.skip(offset)
          if (orderBy) obj.sort(buildMongoOrders(orderBy))
          else obj.sort({ createdAt: -1 }) // -1 = DESC

          const activities = await obj.toArray()

          return activities
        }

        return null
      }
    ),
  },
  Mutation: {
    createActivityLog: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const payload = args.input ? { ...args.input, ...args } : args
        const activity = await mongoCreate('ActivityLog', payload, context)
        return {
          success: true,
          message: "Activity Log has been created successfully!",
          activity,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    createActivityLogs: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { activities } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const newObjs = activities && activities.map(activity => prepareCreate(activity))
        const obj = await mongo.ActivityLog.insertMany(newObjs)
        if (obj.insertedCount) {
          return await mongo.ActivityLog.find({ _id: { $in: Object.values(obj.insertedIds) } }).toArray()
        } else {
          return new Error(
            JSON.stringify({
              matchedCount: obj.matchedCount,
              modifiedCount: obj.modifiedCount
            })
          )
        }
      }

      return null
    }),
    updateActivityLog: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const payload = args.input ? { ...args.input, ...args } : args
        const currentCategory = await mongoUpdate('ActivityLog', payload, context)
        const activityResponse = await mongo.ActivityLog.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Activity Log has been updated successfully!",
          activity: activityResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteActivityLog: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('ActivityLog', args, context)
        return {
          success: true,
          message: "Activity Log has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
