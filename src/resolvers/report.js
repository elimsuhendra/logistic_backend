import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"
import executeReport from 'utils/executeReport'

export default {
  Report: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    Report: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Report'),
          (payload, args) => {
            return compareObject(payload.Report.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getReport: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentReport = id ? await mongo.Report.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentReport
    }),
    allReports: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Report.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allReportsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.Report.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createReport: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.status = 'PENDING'
        const report = await mongoCreate('Report', args, context)
        executeReport({ id: report._id }, context)
        return {
          success: true,
          message: "Report has been created successfully!",
          report,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    deleteReport: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Report', args, context)
        return {
          success: true,
          message: "Report has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  }
}
