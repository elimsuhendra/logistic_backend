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
  PostalCode: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    PostalCode: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-PostalCode'),
          (payload, args) => {
            return compareObject(payload.PostalCode.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getPostalCode: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentPostalCode = id ? await mongo.PostalCode.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentPostalCode
    }),
    getPostalCodeBySlug: requiresAuth.createResolver(
      async (parent, { slug }, { mongo, user }) => {
        const currentPostalCode = slug ? await mongo.PostalCode.findOne({ slug: slug, deletedAt: null }) : null
        return currentPostalCode
    }),
    allPostalCodes: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.PostalCode.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allPostalCodesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.PostalCode.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createPostalCode: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const postalCode = await mongoCreate('PostalCode', args, context)
        return {
          success: true,
          message: "PostalCode has been created successfully!",
          postalCode,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updatePostalCode: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const currentPostalCode = await mongoUpdate('PostalCode', args, context)
        const postalCodeResponse = await mongo.PostalCode.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Postal code has been updated successfully!",
          postalCode: postalCodeResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deletePostalCode: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('PostalCode', args, context)
        return {
          success: true,
          message: "Postal code has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
