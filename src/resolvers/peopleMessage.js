import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import moment from 'moment'
import { sms } from "utils/smsServices"
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

export default {
  PeopleMessage: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    PeopleMessage: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-PeopleMessage'),
          (payload, args) => {
            return compareObject(payload.PeopleMessage.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getPeopleMessage: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentPeopleMessage = id ? await mongo.PeopleMessage.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentPeopleMessage
    }),
    allPeopleMessages: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.PeopleMessage.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allPeopleMessagesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.PeopleMessage.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createPeopleMessage: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const {personId} = args
        args.sentAt = args["sentAt"] ? moment.utc(moment(args["sentAt"]).format("YYYY-MM-DD")).valueOf() : null
        const peopleMessage = await mongoCreate('PeopleMessage', args, context)
        const currentPeople = personId ? await mongo.People.findOne({ _id: ObjectId(personId), deletedAt: null}) : null
        if (currentPeople && currentPeople.mobileCode && currentPeople.mobileNumber) {
          await sms(
          {
            to: `${currentPeople.mobileCode}${currentPeople.mobileNumber}`,
            text: `${args.content}`
          },
          { mongo }
        )
        }
        return {
          success: true,
          message: "Message has been sent successfully!",
          peopleMessage,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updatePeopleMessage: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.sentAt = args["sentAt"] ? moment.utc(moment(args["sentAt"]).format("YYYY-MM-DD")).valueOf() : null
        const currentPeopleMessage = await mongoUpdate('PeopleMessage', args, context)
        const peopleMessageResponse = await mongo.PeopleMessage.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Message has been updated successfully!",
          peopleMessage: peopleMessageResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deletePeopleMessage: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('PeopleMessage', args, context)
        return {
          success: true,
          message: "People message has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
