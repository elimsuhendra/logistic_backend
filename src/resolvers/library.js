import requiresAuth, { checkUserAuth, checkPermissions } from 'utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'utils/buildMongoFilters'
import buildMongoOrders from 'utils/buildMongoOrders'
import { prepareUpdate, prepareCreate, softNestedDelete, compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
export default {
  Library: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    Library: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Library'),
          (payload, args) => {
            return compareObject(payload.Library.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getLibrary: async (parent, { id }, { mongo }) =>
      id? await mongo.Library.findOne({ _id: ObjectId(id), deletedAt: null }) : null,
    allLibraries: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Library.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allLibrariesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter)
        const obj = mongo.Library.find(filters)

        return {
          count: obj.count()
        }
      }
    ),
  },
  Mutation: {
    createLibrary: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoCreate('Library', args, context)
    }),
    updateLibrary: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoUpdate('Library', args, context)
    }),
    deleteLibrary: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoDelete('Library', args, context)
    }),
    deleteLibraries: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoMultiDelete('Library', args, context)
    }),
    createLibraries: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { libraries } = args
      const { mongo } = context

      const newObjs = libraries && libraries.map(library => prepareCreate(library))
      const obj = await mongo.Library.insertMany(newObjs)
      if (obj.insertedCount) {
        return obj.ops
      } else {
        return new Error(
          JSON.stringify({
            matchedCount: obj.matchedCount,
            modifiedCount: obj.modifiedCount
          })
        )
      }
    }),
    updateLibraryPosition: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { libraries } = args
      const { mongo } = context

      return await Promise.all(
        libraries.map(obj => {
          return new Promise((resolve, reject) => {
            mongo.Library.findOneAndUpdate(
              {
                _id: ObjectId(obj.id)
              },
              {
                $set: {
                  position: obj.position
                }
              },
              {
                returnOriginal: false
              }, // Return new Document
              (err, doc) => {
                resolve(doc.value)
              }
            )
          })
        })
      ).then(docs => docs)
    })
  }
}
