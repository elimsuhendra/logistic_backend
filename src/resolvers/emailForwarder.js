import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"
import agenda from 'jobs'

export default {
  EmailForwarder: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    EmailForwarder: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-EmailForwarder'),
          (payload, args) => {
            return compareObject(payload.EmailForwarder.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getEmailForwarder: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentEmailForwarder = id ? await mongo.EmailForwarder.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentEmailForwarder
    }),
    allEmailForwarders: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.EmailForwarder.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allEmailForwardersMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.EmailForwarder.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createEmailForwarder: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      
      if (!!currentUser) {
        const emailForwarder = await mongoCreate('EmailForwarder', args, context)
        return {
          success: true,
          message: "Email forwarder has been created successfully!",
          emailForwarder
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    updateEmailForwarder: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const currentEmailForwarder = await mongoUpdate('EmailForwarder', args, context)
        const emailForwarderResponse = await mongo.EmailForwarder.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Email forwarder has been updated successfully!",
          company: emailForwarderResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteEmailForwarder: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('EmailForwarder', args, context)
        return {
          success: true,
          message: "Email forwarder has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
