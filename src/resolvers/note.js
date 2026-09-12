import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

export default {
  Note: {
    id: parent => parent._id || parent.id,
    creator: async ({ creatorId }, args, { dataloaders }) => {
      return !!creatorId ? await dataloaders.get('userByIdLoader').load(creatorId) : null
    },
  },
  Subscription: {
    Note: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Note'),
          (payload, args) => {
            return compareObject(payload.Note.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getNote: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentNote = id ? await mongo.Note.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentNote
    }),
    allNotes: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Note.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allNotesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.Note.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createNote: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const note = await mongoCreate('Note', args, context)
        return {
          success: true,
          message: "Note has been created successfully!",
          note,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateNote: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {

        const currentNote = await mongoUpdate('Note', args, context)
        const noteResponse = await mongo.Note.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Note has been updated successfully!",
          note: noteResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteNote: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Note', args, context)
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
