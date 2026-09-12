import requiresAuth, { checkUserAuth, checkPermissions } from 'utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'utils/buildMongoFilters'
import buildMongoOrders from 'utils/buildMongoOrders'
import { prepareUpdate, prepareCreate, softNestedDelete, compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
export default {
  Photo: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    Photo: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Photo'),
          (payload, args) => {
            return compareObject(payload.Photo.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getPhoto: async (parent, { id }, { mongo }) =>
      id? await mongo.Photo.findOne({ _id: ObjectId(id), deletedAt: null }) : null,
    allPhotos: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Photo.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allPhotosMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter)
        const obj = mongo.Photo.find(filters)

        return {
          count: obj.count()
        }
      }
    ),
    getPhotos: requiresAuth.createResolver(async (parent, { productId, orderBy }, { mongo }) => {
      const limit = first || 10
      const offset = skip || 0
      await mongo.Photo.find({
        productId: ObjectId(productId),
        deletedAt: null
      })
      if (first) obj.limit(limit)
      if (skip) obj.skip(offset)
      if (orderBy) obj.sort(buildMongoOrders(orderBy))
      else obj.sort({ createdAt: -1 }) // -1 = DESC

      return obj.toArray()
    }),
    _getPhotosMeta: requiresAuth.createResolver(
      async (parent, { productId, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const obj = mongo.Photo.find({
          productId: ObjectId(productId),
          deletedAt: null
        })
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return { count: (await obj.toArray()).length }
      }
    )
  },
  Mutation: {
    createPhoto: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      // add listener for affected parent object
      if (args.objectId && args.objectType) {
        await mongoUpdate(args.objectType, { id: args.objectId, updatedAt: new Date().getTime() }, context)
      }

      return await mongoCreate('Photo', args, context)
    }),
    updatePhoto: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoUpdate('Photo', args, context)
    }),
    deletePhoto: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      // add listener for affected parent object
      const photoObj = await context.mongo.Photo.findOne({ _id: ObjectId(args.id), deletedAt: null })
      if (photoObj && photoObj.objectId && photoObj.objectType) {
        await mongoUpdate(photoObj.objectType, { id: photoObj.objectId, updatedAt: new Date().getTime() }, context)
      }

      return await mongoDelete('Photo', args, context)
    }),
    deletePhotos: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoMultiDelete('Photo', args, context)
    }),
    createPhotos: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { photos } = args
      const { mongo } = context

      const newObjs = photos && photos.map(photo => prepareCreate(photo))
      const obj = await mongo.Photo.insertMany(newObjs)
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
    updatePhotoPosition: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { photos } = args
      const { mongo } = context

      return await Promise.all(
        photos.map(obj => {
          return new Promise((resolve, reject) => {
            mongo.Photo.findOneAndUpdate(
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
