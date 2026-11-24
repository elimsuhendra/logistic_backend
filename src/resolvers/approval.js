import { toApprovalStatus } from 'utils/approval'
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
    approval: parent => toApprovalStatus(parent && parent.approval),
    accountId: parent => (parent && parent.accountId) ? String(parent.accountId) : null,
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
        if (orderBy) {
          // index ties (e.g. approvals saved before index existed) keep their saved order
          obj.sort(String(orderBy).startsWith('index_')
            ? { ...buildMongoOrders(orderBy), createdAt: 1 }
            : buildMongoOrders(orderBy))
        } else obj.sort({ createdAt: -1 })

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
      // input is [ApprovalInput]: one Approval document per entry
      const inputs = (Array.isArray(args.input) ? args.input : [args.input]).filter(Boolean)
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (inputs.length === 0) {
          return { success: false, message: "No approval to create." }
        }

        const approvals = []
        for (const input of inputs) {
          // mongoCreate returns (not throws) an Error on failure
          const approval = await mongoCreate('Approval', { ...input }, context)
          if (approval instanceof Error) {
            return {
              success: false,
              message: approval.message,
              approval: approvals[0] || null,
              approvals,
            }
          }
          approvals.push(approval)
        }

        return {
          success: true,
          message: approvals.length > 1
            ? "Approvals have been created successfully!"
            : "Approval has been created successfully!",
          approval: approvals[0],
          approvals,
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
      // Replaces the approvals of a record: (1) the current approvals with this reffId are
      // retired (inactive: true, deletedAt: now), then (2) input: [ApprovalInput] is inserted.
      const entries = (Array.isArray(args.input) ? args.input : [args.input]).filter(Boolean)
      const reffId = args.reffId || (entries.find(e => e.reffId) || {}).reffId || null
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!reffId) {
          return { success: false, message: "reffId is required." }
        }

        const now = new Date().getTime()
        // reffId may be stored as ObjectId or string
        const reffIdMatch = ObjectId.isValid(String(reffId))
          ? { $in: [ObjectId(String(reffId)), String(reffId)] }
          : String(reffId)

        // 1. retire the old approvals of this record
        await mongo.Approval.updateMany(
          { reffId: reffIdMatch, deletedAt: null },
          { $set: { inactive: true, deletedAt: now, updatedAt: now } }
        )

        // 2. insert the new approvals (a passed id is ignored: these are new documents)
        const approvals = []
        for (const entry of entries) {
          const { id, ...rest } = entry
          // mongoCreate returns (not throws) an Error on failure
          const approval = await mongoCreate('Approval', { ...rest, reffId: String(reffId) }, context)
          if (approval instanceof Error) {
            return {
              success: false,
              message: approval.message,
              approval: approvals[0] || null,
              approvals,
            }
          }
          approvals.push(approval)
        }

        return {
          success: true,
          message: "Approvals have been updated successfully!",
          approval: approvals[0] || null,
          approvals,
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

