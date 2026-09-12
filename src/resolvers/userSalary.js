import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import moment from 'moment'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

export default {
  UserSalary: {
    id: parent => parent._id || parent.id,
    user: async ({ userId }, args, { dataloaders }) => {
      return !!userId ? await dataloaders.get('userByIdLoader').load(userId) : null
    },
  },
  Subscription: {
    UserSalary: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-UserSalary'),
          (payload, args) => {
            return compareObject(payload.UserSalary.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getUserSalaryByUser: requiresAuth.createResolver(
      async (parent, { userId, year }, { mongo, user }) => {
        const currentUserSalary = userId && year ? await mongo.UserSalary.findOne({ userId: ObjectId(userId), year, deletedAt: null }) : null
        return currentUserSalary
    }),
    allUserSalaries: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.UserSalary.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allUserSalariesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.UserSalary.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    saveUserSalary: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!!args.id) {
          args.id = ObjectId(args.id)
          await mongoUpdate('UserSalary', args, context)
        } else {
          delete args.id
          await mongoCreate('UserSalary', args, context)
        }
        return {
          success: true,
          message: "User salary has been updated successfully!",
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  }
}
