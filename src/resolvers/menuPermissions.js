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

function normalizePermissionAction(actionObj) {
  const item = actionObj || {}
  return {
    enable: Boolean(item.enable),
    url: item.url ? String(item.url).trim() : '',
  }
}

function normalizePermissions(permissions) {
  const perms = permissions || {}
  return {
    view: normalizePermissionAction(perms.view),
    create: normalizePermissionAction(perms.create),
    update: normalizePermissionAction(perms.update),
    delete: normalizePermissionAction(perms.delete),
  }
}

function normalizeMenuPermissionsFilters(rawFilter) {
  const { search, ...restFilter } = rawFilter || {}
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
        { label: { $regex: regexStr, $options: 'i' } },
        { code: { $regex: regexStr, $options: 'i' } },
      ]
    }
  }

  return { ...filters, deletedAt: null }
}

export default {
  MenuPermissions: {
    id: parent => parent._id || parent.id,
    label: parent => (parent && parent.label) || '',
    code: parent => (parent && parent.code) || '',
    inactive: parent => Boolean(parent && parent.inactive),
    permissions: parent => normalizePermissions(parent && parent.permissions),
  },
  Subscription: {
    MenuPermissions: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-MenuPermissions'),
          (payload, args) => {
            if (!payload || !payload.MenuPermissions) return false
            return compareObject(payload.MenuPermissions.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getMenuPermissions: requiresAuth.createResolver(
      async (parent, { id }, { mongo }) => {
        if (!id) return null
        const query = ObjectId.isValid(id)
          ? { _id: ObjectId(id), deletedAt: null }
          : { code: id, deletedAt: null }
        return await mongo.MenuPermissions.findOne(query)
      }
    ),
    allMenuPermissions: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 20
        const offset = skip || 0
        const filters = normalizeMenuPermissionsFilters(filter)
        const obj = mongo.MenuPermissions.find(filters)

        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 })

        return await obj.toArray()
      }
    ),
    _allMenuPermissionsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = normalizeMenuPermissionsFilters(filter)
        const count = await mongo.MenuPermissions.countDocuments(filters)
        return { count }
      }
    ),
  },
  Mutation: {
    createMenuPermissions: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const input = { ...(args.input || {}), ..._.omit(args, ['input']) }
        const label = input.label ? String(input.label).trim() : ''
        const code = input.code ? String(input.code).trim() : ''

        if (!label) {
          return {
            success: false,
            message: 'Label is required.',
            errors: [{ path: 'label', field: 'label', message: 'Label is required.' }]
          }
        }
        if (!code) {
          return {
            success: false,
            message: 'Code is required.',
            errors: [{ path: 'code', field: 'code', message: 'Code is required.' }]
          }
        }

        const existing = await mongo.MenuPermissions.findOne({
          code: { $regex: `^${sanitizeRegex(code)}$`, $options: 'i' },
          deletedAt: null,
        })
        if (existing) {
          return {
            success: false,
            message: 'Failed to create menu permission. Code already exists.',
            errors: [{ path: 'code', field: 'code', message: 'Code already exists.' }]
          }
        }

        const payload = {
          label,
          code,
          permissions: normalizePermissions(input.permissions),
          inactive: typeof input.inactive === 'boolean' ? input.inactive : false,
        }

        const menuPermission = await mongoCreate('MenuPermissions', payload, context)
        return {
          success: true,
          message: 'New menu permission has been created',
          menuPermission,
        }
      }

      return {
        success: false,
        message: 'User is not authorized.',
      }
    }),
    updateMenuPermissions: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const { id } = args
        const input = { ...(args.input || {}), ..._.omit(args, ['input']) }
        if (id) {
          input.id = id
        }

        if (input.label !== undefined) {
          input.label = String(input.label).trim()
        }
        if (input.code !== undefined) {
          input.code = String(input.code).trim()
        }
        if (input.permissions !== undefined) {
          input.permissions = normalizePermissions(input.permissions)
        }

        await mongoUpdate('MenuPermissions', input, context)
        const menuPermissionResponse = await mongo.MenuPermissions.findOne({ _id: ObjectId(input.id), deletedAt: null })

        return {
          success: true,
          message: 'Menu permission has been updated',
          menuPermission: menuPermissionResponse,
        }
      }

      return {
        success: false,
        message: 'User is not authorized.',
      }
    }),
    deleteMenuPermissions: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('MenuPermissions', args, context)
        return {
          success: true,
          message: 'Menu permission has been deleted',
        }
      }

      return {
        success: false,
        message: 'User is not authorized.',
      }
    }),
  }
}

