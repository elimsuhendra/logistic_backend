import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import moment from 'moment'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import _ from "lodash"

export default {
  ExternalSale: {
    id: parent => parent._id || parent.id,
    owner: async ({ ownerId }, args, { dataloaders }) => {
      return !!ownerId ? await dataloaders.get('userByIdLoader').load(ownerId) : null
    },
  },
  Subscription: {
    ExternalSale: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-ExternalSale'),
          (payload, args) => {
            return compareObject(payload.ExternalSale.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getExternalSale: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentExternalSale = id ? await mongo.ExternalSale.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentExternalSale
    }),
    allExternalSales: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.ExternalSale.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allExternalSalesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.ExternalSale.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createExternalSale: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      args.month = args["month"] ? moment.utc(moment(args["month"]).format("YYYY-MM-DD")).valueOf() : null
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const externalSale = await mongoCreate('ExternalSale', args, context)
        return {
          success: true,
          message: "External sale has been created successfully!",
          externalSale,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateExternalSale: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.month = args["month"] ? moment.utc(moment(args["month"]).format("YYYY-MM-DD")).valueOf() : null
        await mongoUpdate('ExternalSale', args, context)
        const externalSaleResponse = await mongo.ExternalSale.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "External sale has been updated successfully!",
          externalSale: externalSaleResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteExternalSale: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('ExternalSale', args, context)
        return {
          success: true,
          message: "External sale has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  }
}
