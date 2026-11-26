import { toApprovalStatus, refreshCurrentTurn, setNextApproverPending } from 'utils/approval'
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

// reffIds of the given approval ids (read before they are deleted)
async function reffIdsOfApprovals(mongo, ids) {
  const objectIds = (ids || []).map(String).filter(i => ObjectId.isValid(i)).map(i => ObjectId(i))
  if (objectIds.length === 0) return []
  const rows = await mongo.Approval.find({ _id: { $in: objectIds } }, { projection: { reffId: 1 } }).toArray()
  return _.uniq(rows.map(r => r.reffId).filter(r => r !== undefined && r !== null).map(String))
}

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

        // records (reffId) whose current turn is refreshed after the approvals are created
        const reffIds = _.uniq(inputs.map(input => input.reffId).filter(Boolean).map(String))

        const approvals = []
        for (const input of inputs) {
          // mongoCreate returns (not throws) an Error on failure
          // isCurrentTurn is set by the server (refreshCurrentTurn below), never from the input
          const { isCurrentTurn: ignoredTurn, ...createFields } = input
          const approval = await mongoCreate('Approval', { ...createFields, isCurrentTurn: false }, context)
          if (approval instanceof Error) {
            for (const reffId of reffIds) await refreshCurrentTurn(mongo, reffId)
            return {
              success: false,
              message: approval.message,
              approval: approvals[0] || null,
              approvals,
            }
          }
          approvals.push(approval)
        }

        for (const reffId of reffIds) await refreshCurrentTurn(mongo, reffId)
        // return the approvals as saved, with their isCurrentTurn
        const createdId = a => a && (a._id || a.id)
        const createdIds = approvals.map(createdId).filter(Boolean)
        if (createdIds.length > 0) {
          const saved = await mongo.Approval.find({ _id: { $in: createdIds } }).toArray()
          const byId = _.keyBy(saved, a => String(a._id))
          for (let i = 0; i < approvals.length; i++) {
            const fresh = byId[String(createdId(approvals[i]))]
            if (fresh) approvals[i] = fresh
          }
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
      // Updates one approval: args.id is the approval's id (approvalId). The fields sent
      // in input are set on it (fields not sent keep their value) and updatedAt = now.
      const { id, input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!id || !ObjectId.isValid(String(id))) {
          return { success: false, message: "A valid approval id is required." }
        }
        const existing = await mongo.Approval.findOne({ _id: ObjectId(String(id)), deletedAt: null })
        if (!existing) {
          return { success: false, message: "Approval not found." }
        }

        // the approval's own id comes from args.id, never from input
        // isCurrentTurn is set by the server (refreshCurrentTurn), never from the input
        const { id: ignoredId, isCurrentTurn: ignoredTurn, ...fields } = input || {}
        const update = Object.keys(fields).reduce((acc, key) => {
          if (fields[key] !== undefined) acc[key] = fields[key]
          return acc
        }, {})
        if (update.reffId !== undefined && update.reffId !== null) update.reffId = String(update.reffId)

        const result = await mongoUpdate(
          'Approval',
          { id: existing._id, ...update, updatedAt: new Date().getTime() },
          context
        )
        if (result instanceof Error) {
          return { success: false, message: result.message }
        }

        // "Approve" passes the approval on: the next approver of the record becomes Pending
        if (update.approval === 'Approve' && toApprovalStatus(existing.approval) !== 'Approve') {
          await setNextApproverPending(mongo, {
            _id: existing._id,
            reffId: update.reffId !== undefined ? update.reffId : existing.reffId,
          })
        }

        // the turn moves on when a status changes (e.g. Approve → next approver Pending);
        // refresh the old record too when the approval was moved to another reffId
        await refreshCurrentTurn(mongo, update.reffId !== undefined ? update.reffId : existing.reffId)
        if (update.reffId !== undefined && String(update.reffId) !== String(existing.reffId)) {
          await refreshCurrentTurn(mongo, existing.reffId)
        }

        const approval = await mongo.Approval.findOne({ _id: existing._id })
        return {
          success: true,
          message: "Approval has been updated successfully!",
          approval,
          approvals: approval ? [approval] : [],
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
        const reffIds = await reffIdsOfApprovals(mongo, [args.id])
        await mongoDelete('Approval', args, context)
        for (const reffId of reffIds) await refreshCurrentTurn(mongo, reffId)
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
        const reffIds = await reffIdsOfApprovals(mongo, args.ids)
        await mongoMultiDelete('Approval', args, context)
        for (const reffId of reffIds) await refreshCurrentTurn(mongo, reffId)
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

