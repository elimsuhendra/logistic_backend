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
  EmailEnquiry: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    EmailEnquiry: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-EmailEnquiry'),
          (payload, args) => {
            return compareObject(payload.EmailEnquiry.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getEmailEnquiry: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentEmailEnquiry = id ? await mongo.EmailEnquiry.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentEmailEnquiry
    }),
    allEmailEnquiries: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.EmailEnquiry.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allEmailEnquiriesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.EmailEnquiry.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createEmailEnquiry: requiresAuth.createResolver(async (parent, args, context) => {
      const { mongo } = context
      const emailEnquiry = await mongoCreate('EmailEnquiry', args, context)
      const {email} = args || {}
      agenda.now("contact-us-forward", {
        emailEnquiryId: emailEnquiry._id.toString()
      })
      return {
        success: true,
        message: "Email enquiry has been send successfully!",
        emailEnquiry,
      }
    }),
    deleteEmailEnquiry: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('EmailEnquiry', args, context)
        return {
          success: true,
          message: "Email enquiry has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
