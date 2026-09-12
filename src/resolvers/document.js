import requiresAuth, { checkUserAuth, checkPermissions } from 'utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'utils/buildMongoFilters'
import buildMongoOrders from 'utils/buildMongoOrders'
import { prepareUpdate, prepareCreate, softNestedDelete, compareObject } from 'utils/model'
import { getRoles } from 'utils/authentication'
import pubsub from 'utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
// import { notifyMultipleDocumentsUploaded, notifyDocumentUploaded } from 'utils/notification'

import { parseResume } from 'utils/document'

export default {
  Document: {
    id: parent => parent._id || parent.id,
    creator: async ({ creatorId }, args, { dataloaders }) => {
      return !!creatorId ? await dataloaders.get('userByIdLoader').load(creatorId) : null
    },
  },
  Subscription: {
    Document: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Document'),
          (payload, args) => {
            return compareObject(payload.Document.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getDocument: async (parent, { id }, { mongo }) =>
      id? await mongo.Document.findOne({ _id: ObjectId(id), deletedAt: null }) : null,
    allDocuments: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Document.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allDocumentsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter)
        const obj = mongo.Document.find(filters)

        return {
          count: obj.count()
        }
      }
    ),
  },
  Mutation: {
    createDocument: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser && (!!rolesObj.isAdmin || !!rolesObj.isStaff)) {
        if (args.objectId && args.objectType) {
          await mongoUpdate(args.objectType, { id: args.objectId, updatedAt: new Date().getTime() }, context)
        }
      }

      const newDocument = await mongoCreate('Document', args, context)
      // if (!!newDocument) {
      //   await notifyDocumentUploaded({ document: newDocument }, context)
      // }
      return newDocument
    }),
    updateDocument: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser && (!!rolesObj.isAdmin || !!rolesObj.isStaff)) {
        if (args.objectId && args.objectType) {
          await mongoUpdate(args.objectType, { id: args.objectId, updatedAt: new Date().getTime() }, context)
        }
      }

      return await mongoUpdate('Document', args, context)
    }),
    deleteDocument: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser && (!!rolesObj.isAdmin || !!rolesObj.isStaff)) {
        const documentObj = await context.mongo.Document.findOne({ _id: ObjectId(args.id), deletedAt: null })
        if (documentObj && documentObj.objectId && documentObj.objectType) {
          await mongoUpdate(documentObj.objectType, { id: documentObj.objectId, updatedAt: new Date().getTime() }, context)
        }
      }

      return await mongoDelete('Document', args, context)
    }),
    deleteDocuments: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser && (!!rolesObj.isAdmin || !!rolesObj.isStaff)) {
        return await mongoMultiDelete('Document', args, context)
      }

      return null
    }),
    createDocuments: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { documents } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser && (!!rolesObj.isAdmin || !!rolesObj.isStaff)) {
        const newObjs = documents && documents.map(document => prepareCreate(document))
        const obj = await mongo.Document.insertMany(newObjs)
        if (obj.insertedCount) {
          return await mongo.Document.find({ _id: { $in: Object.values(obj.insertedIds)}}).toArray()
        } else {
          return new Error(
            JSON.stringify({
              matchedCount: obj.matchedCount,
              modifiedCount: obj.modifiedCount
            })
          )
        }
      }

      return null
    }),
    updateDocumentPosition: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { documents } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser && (!!rolesObj.isAdmin || !!rolesObj.isStaff)) {
        return await Promise.all(
          documents.map(obj => {
            return new Promise((resolve, reject) => {
              mongo.Document.findOneAndUpdate(
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
      }

      return null
    }),
    resumeParser: requiresAuth.createResolver(async (parent, args, context) => {
      if (!args.resumeUrls || !args.resumeUrls.length) {
        return {
          success: false,
          message: 'Url not found',
        }
      }
      const urls = args.resumeUrls

      try {
        const json = await parseResume(urls[0])
        return {
          success: true,
          data: json,
        }
      } catch (error) {
        return {
          success: false,
          message: error,
        }
      }
    }),
  }
}
