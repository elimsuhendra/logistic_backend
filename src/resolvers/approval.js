import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'
import _ from 'lodash'

export default {
  Approval: {
    id: parent => parent._id || parent.id,
    reffId: parent => (parent && parent.reffId) ? String(parent.reffId) : null,
    userId: parent => (parent && parent.userId) ? String(parent.userId) : null,
    user: async ({ userId }, args, { dataloaders }) => {
      return userId && ObjectId.isValid(userId)
        ? await dataloaders.get('userByIdLoader').load(userId)
        : null
    },
  },
  Subscription: {
    Approval: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Approval'),
          (payload, args) => {
            return compareObject(payload.Approval.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getApproval: requiresAuth.createResolver(
      async (parent, { reffId, id }, { mongo }) => {
        if (!reffId && !id) return null
        if (reffId) {
          const query = ObjectId.isValid(reffId)
            ? { $or: [{ reffId: ObjectId(reffId) }, { reffId: String(reffId) }], deletedAt: null }
            : { reffId: reffId, deletedAt: null }
          return await mongo.Approval.findOne(query)
        }
        const query = ObjectId.isValid(id)
          ? { _id: ObjectId(id), deletedAt: null }
          : { reffNo: id, deletedAt: null }
        return await mongo.Approval.findOne(query)
      }
    ),
    allApprovals: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 20
        const offset = skip || 0
        const { search, ...restFilter } = filter || {}
        let filters = buildMongoFilters(restFilter) || {}

        if (search) {
          const regexStr = sanitizeRegex(search.trim())
          filters = {
            ...filters,
            $or: [
              { reffNo: { $regex: regexStr, $options: 'i' } },
              { collectionName: { $regex: regexStr, $options: 'i' } },
              { approval: { $regex: regexStr, $options: 'i' } },
            ]
          }
        }

        filters = { ...filters, deletedAt: null }
        const obj = mongo.Approval.find(filters)

        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 })

        return await obj.toArray()
      }
    ),
    _allApprovalsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const { search, ...restFilter } = filter || {}
        let filters = buildMongoFilters(restFilter) || {}

        if (search) {
          const regexStr = sanitizeRegex(search.trim())
          filters = {
            ...filters,
            $or: [
              { reffNo: { $regex: regexStr, $options: 'i' } },
              { collectionName: { $regex: regexStr, $options: 'i' } },
              { approval: { $regex: regexStr, $options: 'i' } },
            ]
          }
        }

        filters = { ...filters, deletedAt: null }
        const count = await mongo.Approval.countDocuments(filters)
        return { count }
      }
    ),
  },
  Mutation: {
    createApproval: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const input = { ...(args.input || {}), ..._.omit(args, ['input']) }
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const approval = await mongoCreate('Approval', input, context)
        return {
          success: true,
          message: "Approval has been created successfully!",
          approval,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateApproval: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id } = args
      const input = { ...(args.input || {}), ..._.omit(args, ['input']) }
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (id) {
          input.id = id
        }
        input["updatedAt"] = new Date().getTime()
        await mongoUpdate('Approval', input, context)
        const approvalResponse = await mongo.Approval.findOne({ _id: ObjectId(input.id), deletedAt: null })

        return {
          success: true,
          message: "Approval has been updated successfully!",
          approval: approvalResponse,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    deleteApproval: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Approval', args, context)
        return {
          success: true,
          message: "Approval has been deleted successfully!",
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    deleteApprovals: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoMultiDelete('Approval', args, context)
        return {
          success: true,
          message: "Approvals have been deleted successfully!",
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
  }
}

