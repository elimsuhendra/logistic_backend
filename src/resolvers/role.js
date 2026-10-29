import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import { sanitizeRegex } from 'utils/common'

function normalizeMenuPermissions(list) {
  if (!Array.isArray(list)) return []
  if (list.includes('all')) return ['all']
  return list
    .filter(item => item && (typeof item === 'string' || item.menuCode))
    .map(item => {
      if (typeof item === 'string') return item
      const canView = Boolean(item.canView)
      const canCreate = Boolean(item.canCreate)
      const canUpdate = Boolean(item.canUpdate)
      const canDelete = Boolean(item.canDelete)
      return {
        menuCode: String(item.menuCode).trim(),
        canAccess: Boolean(item.canAccess) || canView || canCreate || canUpdate || canDelete,
        canView,
        canCreate,
        canUpdate,
        canDelete,
      }
    })
}

function normalizeAccountIds(ids) {
  if (!Array.isArray(ids)) return []
  return ids
    .filter(Boolean)
    .map(id => (ObjectId.isValid(String(id)) ? ObjectId(String(id)) : id))
}

function normalizeRoleFilters(rawFilter) {
  const { search, accountIds_in, ...restFilter } = rawFilter || {}
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

  if (Array.isArray(accountIds_in) && accountIds_in.length > 0) {
    filters.accountIds = { $in: normalizeAccountIds(accountIds_in) }
  }

  if (search) {
    const regexStr = sanitizeRegex(search.trim())
    filters = {
      ...filters,
      $or: [
        { name: { $regex: regexStr, $options: 'i' } },
        { code: { $regex: regexStr, $options: 'i' } },
      ]
    }
  }

  return { ...filters, deletedAt: null }
}

async function getCurrentUser(context) {
  const { mongo, user } = context
  if (!user || !user._id) return null
  return await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
}

export default {
  Role: {
    id: parent => parent._id || parent.id,
    code: parent => (parent && parent.code) || '',
    name: parent => (parent && parent.name) || '',
    inactive: parent => Boolean(parent && parent.inactive),
    accountIds: parent =>
      Array.isArray(parent && parent.accountIds)
        ? parent.accountIds.filter(Boolean).map(id => String(id))
        : [],
    menuPermissions: parent => normalizeMenuPermissions(parent && parent.menuPermissions),
    accounts: async (parent, args, { mongo }) => {
      const ids = Array.isArray(parent && parent.accountIds) ? parent.accountIds : []
      const validIds = ids.filter(id => id && ObjectId.isValid(String(id))).map(id => ObjectId(String(id)))
      if (validIds.length === 0) return []
      return await mongo.Account.find({ _id: { $in: validIds }, deletedAt: null }).toArray()
    },
  },
  Subscription: {
    Role: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Role'),
          (payload, args) => {
            if (!payload || !payload.Role) return false
            return compareObject(payload.Role.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getRole: requiresAuth.createResolver(
      async (parent, { id }, { mongo }) => {
        if (!id) return null
        const query = ObjectId.isValid(id)
          ? { _id: ObjectId(id), deletedAt: null }
          : { code: id, deletedAt: null }
        return await mongo.Role.findOne(query)
      }
    ),
    allRoles: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const filters = normalizeRoleFilters(filter)
        const obj = mongo.Role.find(filters)

        if (first) obj.limit(first)
        if (skip) obj.skip(skip)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 })

        return await obj.toArray()
      }
    ),
    _allRolesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = normalizeRoleFilters(filter)
        const count = await mongo.Role.countDocuments(filters)
        return { count }
      }
    ),
  },
  Mutation: {
    createRole: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo } = context
      const currentUser = await getCurrentUser(context)

      if (!currentUser) {
        return { success: false, message: 'User is not authorized.' }
      }

      const name = args.name ? String(args.name).trim() : ''
      const code = args.code ? String(args.code).trim() : ''

      if (!name) {
        return {
          success: false,
          message: 'Name is required.',
          errors: [{ path: 'name', field: 'name', message: 'Name is required.' }]
        }
      }
      if (!code) {
        return {
          success: false,
          message: 'Code is required.',
          errors: [{ path: 'code', field: 'code', message: 'Code is required.' }]
        }
      }

      const existing = await mongo.Role.findOne({
        code: { $regex: `^${sanitizeRegex(code)}$`, $options: 'i' },
        deletedAt: null,
      })
      if (existing) {
        return {
          success: false,
          message: 'Failed to create role. Code already exists.',
          errors: [{ path: 'code', field: 'code', message: 'Code already exists.' }]
        }
      }

      const payload = {
        code,
        name,
        description: args.description ? String(args.description).trim() : null,
        accountIds: normalizeAccountIds(args.accountIds),
        menuPermissions: normalizeMenuPermissions(args.menuPermissions),
        inactive: typeof args.inactive === 'boolean' ? args.inactive : false,
      }

      const role = await mongoCreate('Role', payload, context)
      return {
        success: true,
        message: 'New role has been created',
        role,
      }
    }),
    updateRole: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo } = context
      const currentUser = await getCurrentUser(context)

      if (!currentUser) {
        return { success: false, message: 'User is not authorized.' }
      }

      const input = { ...args }

      if (input.name !== undefined) {
        input.name = String(input.name).trim()
      }
      if (input.code !== undefined) {
        input.code = String(input.code).trim()
        const duplicate = await mongo.Role.findOne({
          _id: { $ne: ObjectId(input.id) },
          code: { $regex: `^${sanitizeRegex(input.code)}$`, $options: 'i' },
          deletedAt: null,
        })
        if (duplicate) {
          return {
            success: false,
            message: 'Failed to update role. Code already exists.',
            errors: [{ path: 'code', field: 'code', message: 'Code already exists.' }]
          }
        }
      }
      if (input.description !== undefined) {
        input.description = input.description ? String(input.description).trim() : null
      }
      if (input.accountIds !== undefined) {
        input.accountIds = normalizeAccountIds(input.accountIds)
      }
      if (input.menuPermissions !== undefined) {
        input.menuPermissions = normalizeMenuPermissions(input.menuPermissions)
      }

      await mongoUpdate('Role', input, context)
      const role = await mongo.Role.findOne({ _id: ObjectId(input.id), deletedAt: null })

      return {
        success: true,
        message: 'Role has been updated',
        role,
      }
    }),
    deleteRole: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const currentUser = await getCurrentUser(context)

      if (!currentUser) {
        return { success: false, message: 'User is not authorized.' }
      }

      await mongoDelete('Role', args, context)
      return {
        success: true,
        message: 'Role has been deleted',
      }
    }),
  }
}

