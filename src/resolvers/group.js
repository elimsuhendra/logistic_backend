import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import _ from "lodash"

export default {
  Group: {
    id: parent => parent._id || parent.id,
    manager: async ({ managerId }, args, { dataloaders }) => {
      return !!managerId ? await dataloaders.get('userByIdLoader').load(managerId) : null
    },
    teamLeader: async ({ teamLeaderId }, args, { dataloaders }) => {
      return !!teamLeaderId ? await dataloaders.get('userByIdLoader').load(teamLeaderId) : null
    },
    staffs: async ({ staffIds }, args, { dataloaders }) => {
      return staffIds && staffIds.length > 0 ? await dataloaders.get('userByIdLoader').loadMany(staffIds) : []
    },
    forecasts: async ({ forecastIds }, args, { dataloaders }) => {
      return forecastIds && forecastIds.length > 0 ? await dataloaders.get('userByIdLoader').loadMany(forecastIds) : []
    },
  },
  Subscription: {
    Group: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Group'),
          (payload, args) => {
            return compareObject(payload.Group.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getGroup: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentGroup = id ? await mongo.Group.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentGroup
    }),
    allGroups: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Group.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allGroupsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.Group.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createGroup: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const group = await mongoCreate('Group', args, context)
        return {
          success: true,
          message: "Group has been created successfully!",
          group,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateGroup: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoUpdate('Group', args, context)
        const groupResponse = await mongo.Group.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Group has been updated successfully!",
          group: groupResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    addMembersToGroup: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const currentGroup = await mongo.Group.findOne({ _id: ObjectId(args.id), deletedAt: null })
        const newStaffIds = [...args.userIds, ...currentGroup.staffIds]
        const newArgs = {
          id: args.id, staffIds: newStaffIds
        }
        await mongoUpdate('Group', newArgs, context)

        return {
          success: true,
          message: "Group has been updated successfully!",
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteGroup: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Group', args, context)
        return {
          success: true,
          message: "Group has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteGroups: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoMultiDelete('Group', args, context)
    }),
  }
}
