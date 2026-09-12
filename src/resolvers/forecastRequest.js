import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import moment from 'moment'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

export default {
  ForecastRequest: {
    id: parent => parent._id || parent.id,
    user: async ({ userId }, args, { dataloaders }) => {
      return !!userId ? await dataloaders.get('userByIdLoader').load(userId) : null
    },
  },
  Subscription: {
    ForecastRequest: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-ForecastRequest'),
          (payload, args) => {
            return compareObject(payload.ForecastRequest.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getForecastRequest: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentForecastRequest = id ? await mongo.ForecastRequest.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentForecastRequest
    }),
    allForecastRequests: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.ForecastRequest.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allForecastRequestsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.ForecastRequest.find(filters)

        return { count: obj.count() }
      }
    ),
    checkForecastEditable: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { year } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const forecastRequests = await mongo.ForecastRequest.find({
          userId: ObjectId(user._id),
          deletedAt: null,
          year: parseInt(year),
        })
          .sort({ createdAt: -1 })
          .limit(1)
          .toArray();
        if (forecastRequests.length === 0) return { editable: true }
        const forecastRequest = forecastRequests[0]
        if (["SUBMITTED", "DECLINED", "CANCELLED"].includes(forecastRequest.status)) {
          return {
            editable: false
          }
        }
        if (["PENDING"].includes(forecastRequest.status)) {
          return {
            editable: false,
            status: "Pending"
          }
        }
        return {
          editable: true
        }
      }
      return {
        editable: false,
      }
    }),
  },
  Mutation: {
    submitForecast: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { year } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const variables = {
          userId: ObjectId(user._id),
          status: "SUBMITTED",
          year: parseInt(year),
          editable: false,
        };
        await mongoCreate('ForecastRequest', variables, context)
        return {
          success: true
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    createForecastRequest: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { year } = args;

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args["status"] = "PENDING"
        args["editable"] = false
        args["year"] = parseInt(year)
        await mongoCreate("ForecastRequest", args, context);
        return {
          success: true,
          message: "Forecast request has been created successfully!",
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateForecastRequest: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.respondedAt = args["respondedAt"] ? moment.utc(moment(args["respondedAt"]).format("YYYY-MM-DD")).valueOf() : null
        await mongoUpdate('ForecastRequest', args, context)
        return {
          success: true,
          message: "Forecast request has been updated successfully!",
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  }
}
