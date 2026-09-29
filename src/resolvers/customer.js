import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import { prepareCreate, prepareUpdate, compareObject } from 'src/utils/model'
import { withFilter } from 'graphql-subscriptions'
import pubsub from 'src/utils/pubsub'
import buildMongoFilters from 'src/utils/buildMongoFilters'
import buildMongoOrders from 'src/utils/buildMongoOrders'
import { mongoCreate, mongoUpdate, mongoDelete } from "utils/crud"

export default {
  Customer: {
    id: parent => parent._id || parent.id,
    logo: async ({ _id }, args, { dataloaders }) => {
      if (!dataloaders) {
        console.log('No dataloaders provided')
        return null
      }
      return await dataloaders.get('photoByObjectLoader').load({ objectId: _id, objectType: 'Customer' })
    },
    activityLogs: async ({ _id }, args, { mongo }) => {
      if (!mongo || !mongo.ActivityLog) return []
      return await mongo.ActivityLog.find({ objectId: ObjectId(_id), objectType: 'Customer', deletedAt: null }).sort({ createdAt: -1 }).toArray()
    }
  },
  Subscription: {
    Customer: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Customer'),
          (payload, args) => {
            if (!payload) return false
            return compareObject(payload.Customer.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getCustomer: async (parent, args, context) => {
      if (!args.id) return null

      await checkPermissions(checkUserAuth)({ context })
      const { mongo } = context

      return await mongo.Customer.findOne({ _id: ObjectId(args.id), deletedAt: null })
    },
    allCustomers: requiresAuth.createResolver(async (parent, args, context) => {
      const { filter = {}, first, skip, orderBy } = args
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (currentUser) {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = await mongo.Customer.find(filters)
          .sort(orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .toArray()

        return obj
      }
      return null
    }),
    _allCustomersMeta: requiresAuth.createResolver(
      async (parent, { filter = {} }, { mongo, user }) => {
        const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
        if (currentUser) {
          const filters = buildMongoFilters(filter)
          const count = await mongo.Customer.countDocuments(filters)
          return { count }
        }
        return { count: 0 }
      }
    )
  },
  Mutation: {
    createCustomer: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!args.name || !args.name.trim()) {
          return {
            success: false,
            message: "Customer name is required.",
            errors: [{ field: "name", message: "Name is required" }]
          }
        }

        try {
          const newObj = prepareCreate(args)
          newObj._id = new ObjectId()

          const rs = await mongoCreate('Customer', newObj, context)
          return {
            success: true,
            message: "New customer has been created",
            customer: rs
          }
        } catch (err) {
          return {
            success: false,
            message: err.message || "Failed to create customer"
          }
        }
      }

      return {
        success: false,
        message: "Unauthorized"
      }
    },
    updateCustomer: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const { id, ...updateArgs } = args
        try {
          const rs = await mongoUpdate('Customer', { id, ...updateArgs }, context)
          if (rs && !(rs instanceof Error)) {
            const updatedCustomer = await mongo.Customer.findOne({ _id: ObjectId(id) })
            return {
              success: true,
              message: "Customer has been updated",
              customer: updatedCustomer
            }
          } else {
            return {
              success: false,
              message: `Cannot update Customer ${id}`
            }
          }
        } catch (err) {
          return {
            success: false,
            message: err.message || "Failed to update customer"
          }
        }
      }

      return {
        success: false,
        message: "Unauthorized"
      }
    },
    deleteCustomer: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const deletedCustomer = await mongo.Customer.findOne({ _id: ObjectId(args.id), deletedAt: null })
        if (!deletedCustomer) {
          return {
            success: false,
            message: "Customer not found"
          }
        }

        const rs = await mongoDelete('Customer', args, context)
        return {
          success: rs.success !== false,
          message: rs.success !== false ? 'Customer has been deleted' : 'Failed to delete customer'
        }
      }

      return {
        success: false,
        message: "Unauthorized"
      }
    }
  }
}
