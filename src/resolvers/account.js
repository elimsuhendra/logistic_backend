import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'
import _ from 'lodash'

function normalizeAccountFilters(rawFilter, showAll) {
  const { search, ...restFilter } = rawFilter || {}
  if (!showAll && !restFilter.type) {
    restFilter.type = 'BUSINESS'
  }
  let filters = buildMongoFilters(restFilter) || {}

  if (filters.inactive === false) {
    filters.inactive = { $ne: true }
  }
  if (Array.isArray(filters.$and)) {
    filters.$and = filters.$and.map(cond => {
      if (cond && cond.inactive === false) {
        return { ...cond, inactive: { $ne: true } }
      }
      return cond
    })
  }

  if (search) {
    const regexStr = sanitizeRegex(search.trim())
    filters = {
      ...filters,
      $or: [
        { accountName: { $regex: regexStr, $options: 'i' } },
        { initial: { $regex: regexStr, $options: 'i' } },
        { email: { $regex: regexStr, $options: 'i' } },
      ]
    }
  }

  return { ...filters, deletedAt: null }
}

function normalizeUserIds(input) {
  if (Array.isArray(input.userIds)) {
    return input.userIds
      .filter(Boolean)
      .map(id => (ObjectId.isValid(String(id)) ? ObjectId(String(id)) : id))
  }
  if (input.userId) {
    return [ObjectId.isValid(String(input.userId)) ? ObjectId(String(input.userId)) : input.userId]
  }
  return undefined
}

export default {
  Account: {
    id: parent => parent._id || parent.id,
    type: parent => (parent && parent.type) || 'BUSINESS',
    inactive: parent => Boolean(parent && parent.inactive),
    avatar: async ({ _id }, args, { dataloaders }) => {
      if (!dataloaders) {
        return null
      }
      return await dataloaders.get('photoByObjectLoader').load({ objectId: _id, objectType: 'Account' })
    },
    userIds: parent =>
      Array.isArray(parent && parent.userIds)
        ? parent.userIds.filter(Boolean).map(id => String(id))
        : [],
    users: async ({ userIds }, args, { dataloaders }) => {
      if (!Array.isArray(userIds) || userIds.length === 0) return []
      const validIds = userIds
        .filter(id => id && ObjectId.isValid(String(id)))
        .map(id => String(id))
      if (validIds.length === 0) return []
      const loaded = await dataloaders.get('userByIdLoader').loadMany(validIds)
      return (loaded || []).filter(u => u && !(u instanceof Error))
    },
  },
  Subscription: {
    Account: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Account'),
          (payload, args) => {
            if (!payload || !payload.Account) return false
            return compareObject(payload.Account.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getAccount: requiresAuth.createResolver(
      async (parent, { id }, { mongo }) => {
        if (!id) return null
        const query = ObjectId.isValid(id)
          ? { _id: ObjectId(id), deletedAt: null }
          : { accountName: id, deletedAt: null }
        return await mongo.Account.findOne(query)
      }
    ),
    allAccounts: requiresAuth.createResolver(
      async (parent, { filter, first, skip, showAll, orderBy }, { mongo }) => {
        const limit = first || 20
        const offset = skip || 0
        const filters = normalizeAccountFilters(filter, showAll)
        const obj = mongo.Account.find(filters)

        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 })

        return await obj.toArray()
      }
    ),
    _allAccountsMeta: requiresAuth.createResolver(
      async (parent, { filter, showAll }, { mongo }) => {
        const filters = normalizeAccountFilters(filter, showAll)
        const count = await mongo.Account.countDocuments(filters)
        return { count }
      }
    ),
  },
  Mutation: {
    createAccount: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const input = { ...(args.input || {}), ..._.omit(args, ['input']) }
        const accountName = input.accountName ? String(input.accountName).trim() : ''
        const initial = input.initial ? String(input.initial).trim() : ''

        if (!accountName) {
          return {
            success: false,
            message: 'Account Name is required.',
            errors: [{ path: 'accountName', field: 'accountName', message: 'Account Name is required.' }]
          }
        }
        if (!initial) {
          return {
            success: false,
            message: 'Initial is required.',
            errors: [{ path: 'initial', field: 'initial', message: 'Initial is required.' }]
          }
        }

        const existing = await mongo.Account.findOne({
          accountName: { $regex: `^${sanitizeRegex(accountName)}$`, $options: 'i' },
          deletedAt: null,
        })
        if (existing) {
          return {
            success: false,
            message: 'Failed to create new account. Account already exists.',
            errors: [{ path: 'accountName', field: 'accountName', message: 'Account already exists.' }]
          }
        }

        const formattedUserIds = normalizeUserIds(input)
        const payload = {
          accountName,
          fullName: input.fullName ? String(input.fullName).trim() : null,
          initial,
          type: input.type || 'BUSINESS',
          email: input.email ? String(input.email).trim().toLowerCase() : null,
          logoUrl: input.logoUrl || null,
          logoWidth: input.logoWidth !== undefined ? input.logoWidth : null,
          logoHeight: input.logoHeight !== undefined ? input.logoHeight : null,
          inactive: typeof input.inactive === 'boolean' ? input.inactive : false,
          userIds: formattedUserIds || [],
        }

        const account = await mongoCreate('Account', payload, context)
        return {
          success: true,
          message: 'New account has been created',
          account,
        }
      }

      return {
        success: false,
        message: 'User is not authorized.',
      }
    }),
    updateAccount: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const { id } = args
        const input = { ...(args.input || {}), ..._.omit(args, ['input']) }
        if (id) {
          input.id = id
        }

        if (input.accountName !== undefined) {
          input.accountName = String(input.accountName).trim()
        }
        if (input.fullName !== undefined) {
          input.fullName = input.fullName ? String(input.fullName).trim() : null
        }
        if (input.initial !== undefined) {
          input.initial = String(input.initial).trim()
        }
        if (input.email !== undefined) {
          input.email = input.email ? String(input.email).trim().toLowerCase() : null
        }

        const formattedUserIds = normalizeUserIds(input)
        if (formattedUserIds !== undefined) {
          input.userIds = formattedUserIds
        }
        delete input.userId

        await mongoUpdate('Account', input, context)
        const accountResponse = await mongo.Account.findOne({ _id: ObjectId(input.id), deletedAt: null })

        return {
          success: true,
          message: 'Account has been updated',
          account: accountResponse,
        }
      }

      return {
        success: false,
        message: 'User is not authorized.',
      }
    }),
    deleteAccount: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Account', args, context)
        return {
          success: true,
          message: 'Account has been deleted',
        }
      }

      return {
        success: false,
        message: 'User is not authorized.',
      }
    }),
  }
}

