import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import moment from 'moment'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

export default {
  PersonNote: {
    id: parent => parent._id || parent.id,
    user: async ({ userId }, args, { dataloaders }) => {
      return !!userId ? await dataloaders.get('userByIdLoader').load(userId) : null
    },
  },
  Subscription: {
    PersonNote: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-PersonNote'),
          (payload, args) => {
            return compareObject(payload.PersonNote.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getPersonNote: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentPersonNote = id ? await mongo.PersonNote.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentPersonNote
    }),
    allPersonNotes: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.PersonNote.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allPersonNotesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.PersonNote.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createPersonNote: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.createdAt = moment.utc(moment(args.createdAt).format("YYYY-MM-DD")).valueOf()
        const personNote = await mongoCreate('PersonNote', args, context)
        return {
          success: true,
          message: "Note has been created successfully!",
          personNote,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updatePersonNote: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.createdAt = moment.utc(moment(args.createdAt).format("YYYY-MM-DD")).valueOf()
        const currentPersonNote = await mongoUpdate('PersonNote', args, context)
        const personNoteResponse = await mongo.PersonNote.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Note has been updated successfully!",
          personNote: personNoteResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deletePersonNote: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('PersonNote', args, context)
        return {
          success: true,
          message: "Note has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
