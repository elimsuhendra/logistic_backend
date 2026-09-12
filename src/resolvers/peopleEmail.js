import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject, prepareCreate } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"
import agenda from 'jobs'

export default {
  PeopleEmail: {
    id: parent => parent._id || parent.id,
    attachments: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'PeopleEmail', documentType: 'attachments' })
    },
  },
  Subscription: {
    PeopleEmail: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-PeopleEmail'),
          (payload, args) => {
            return compareObject(payload.PeopleEmail.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getPeopleEmail: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentPeopleEmail = id ? await mongo.PeopleEmail.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentPeopleEmail
    }),
    allPeopleEmails: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.PeopleEmail.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allPeopleEmailsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.PeopleEmail.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createPeopleEmail: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        const {subject, personId, attachments} = args
        const peopleEmail = await mongoCreate('PeopleEmail', args, context)
        const currentPeople = personId ? await mongo.People.findOne({ _id: ObjectId(personId), deletedAt: null}) : null
        if (currentPeople && currentPeople.email && subject) {
          agenda.now("people-email-worker", {
            peopleEmailId: peopleEmail.id, 
            candidateName: currentPeople.fullName,
            to: currentPeople.email,
          })
        }
        return {
          success: true,
          message: "Email has been sent successfully!",
          peopleEmail,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updatePeopleEmail: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {

        const currentPeopleEmail = await mongoUpdate('PeopleEmail', args, context)
        const peopleEmailResponse = await mongo.PeopleEmail.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Email has been updated successfully!",
          peopleEmail: peopleEmailResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deletePeopleEmail: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('PeopleEmail', args, context)
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
