import requiresAuth, { checkUserAuth, checkPermissions } from 'utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'utils/buildMongoFilters'
import buildMongoOrders from 'utils/buildMongoOrders'
import { compareObject } from 'utils/model'
import { getRoles } from 'utils/authentication'
import pubsub from 'utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'

export default {
  ParameterType: {
    id: parent => parent._id || parent.id,
    parameterValues: async ({ parameterValues }, args, { dataloaders }) => {
      return (parameterValues || []).filter(parameterValue => {
        return !parameterValue.deletedAt
      })
    },
  },
  Subscription: {
    ParameterType: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-ParameterType'),
          (payload, args) => {
            return compareObject(payload.ParameterType.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    allParameterTypes: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.ParameterType.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ label: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    getParameterType: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const parameterType = id? await mongo.ParameterType.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return parameterType
    }),
    getParameterValuesByType: requiresAuth.createResolver(
      async (parent, { code }, { mongo, user, dataloaders }) => {
        const parameterValues = code ? await dataloaders.get('parameterValuesByType').load(code) : []
        return parameterValues.filter(parameterValue => {
          return !parameterValue.deletedAt
        })
    }),
    _allParameterTypesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.ParameterType.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createParameterType: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)
      
      if (!!currentUser) {
        const params = {...args, parameterValues: []}
        const parameterType = await mongoCreate('ParameterType', params, context)
        return {
          success: true,
          message: "Parameter Type has been created successfully!",
          parameterType
        }
      }
      return  {
        success: false,
        message: "Create Parameter Type failed!",
        parameterType: null
      }
    }),

    updateParameterType: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser) {
        const parameterType =  await mongoUpdate('ParameterType', args, context)
        return {
          success: true,
          message: "Parameter Type has been updated successfully!",
          parameterType
        }
      }
      return  {
        success: false,
        message: "Update Parameter Type failed!",
        parameterType: null
      }
    }),

    deleteParameterType: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser) {
        const parameterType = await mongo.ParameterType.findOne({ _id: ObjectId(id), deletedAt: null })

        if (!parameterType) {
          return {
            success: true,
            message: "Parameter Type has been deleted successfully!",
          }
        }

        if ((parameterType.parameterValues || []).length == 0) {
          await mongoDelete('ParameterType', args, context)
          return {
            success: true,
            message: "Parameter Type has been deleted successfully!",
          }
        } else {
          return {
            success: false,
            message: "Parameter Type can't be deleted because of dependent Parameter Values"
          }
        }
      }

      return {
        success: false,
        message: "Delete Parameter Type failed!",
      }
    }),

    createParameterValue: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { parameterTypeId, ...params } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser) {
        const parameterType = await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })

        if (!!parameterType) {
          const parameterValueId = new ObjectId()
          await mongo.ParameterType.updateOne(
            { _id: ObjectId(parameterTypeId) },
            { $push: {
              parameterValues: {
                ...params,
                id: parameterValueId,
                position: (parameterType.parameterValues || []).length
              }
            } }
          )

          const updatedParameterType =  await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })
          const parameterValue = updatedParameterType.parameterValues.find(value => value.id.toString() === parameterValueId.toString())

          return  {
            success: true,
            message: "Parameter Type has been created successfully!",
            parameterValue
          }
        }
      }

      return  {
        success: false,
        message: "Create Parameter Value failed!",
        parameterValue: null
      }
    }),

    updateParameterValue: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id, parameterTypeId, ...params } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)
      if (!!currentUser) {
        const parameterType = await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })

        if (!!parameterType) {
          const updateParams = !!params && Object.keys(params).reduce((prev, key) => {
            return {
              ...prev,
              [`parameterValues.$.${key}`]: params[key]
            }
          }, {})

          if (!!updateParams) {
            await mongo.ParameterType.updateOne(
              { _id: ObjectId(parameterTypeId), "parameterValues.id": ObjectId(id) },
              { $set: updateParams }
            )
          }

          const updatedParameterType =  await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })
          const parameterValue = updatedParameterType.parameterValues.find(value => value.id.toString() === id)
          
          return  {
            success: true,
            message: "Parameter Type has been updated successfully!",
            parameterValue
          }
        }
      }

      return  {
        success: false,
        message: "Update Parameter Value failed!",
        parameterValue: null
      }
    }),

    deleteParameterValue: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      
      const { mongo, user } = context
      const { id, parameterTypeId } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser) {
        const parameterType = await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })

        if (!!parameterType) {
          await mongo.ParameterType.updateOne(
            { _id: ObjectId(parameterTypeId) },
            { $pull: {
              parameterValues: { id: ObjectId(id) }
            } }
          )

          return {
            success: true,
            message:  "Parameter Type has been deleted successfully!",
          }
        }
      }

      return {
        success: false,
        message:  "Delete Parameter Value failed!",
      }
    }),
    updateParameterValuePosition: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { parameterValues, parameterTypeId } = args
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      if (!!currentUser) {
        const parameterType = await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })
        if (!!parameterType) {
          const positionMapping =  parameterValues.reduce((prev, value) => {
            return {
              ...prev,
              [value.id]: value.position
            }
          }, {})
          const updateParams = parameterType.parameterValues.map((value) => {
            return {
              ...value,
              position: positionMapping[value.id.toString()]
            }
          })

          await mongo.ParameterType.updateOne(
            { _id: ObjectId(parameterTypeId) },
            { $set: {
              parameterValues:  (updateParams|| []).sort((a, b) => (a.position || 0) - (b.position || 0))
             } }
          )

          const updatedParameterType =  await mongo.ParameterType.findOne({ _id: ObjectId(parameterTypeId), deletedAt: null })

          return {
            success: true,
            message: "Parameter Value Position has been updated successfully!",
            parameterValues: (updatedParameterType.parameterValues || []),
          }
        }
        return {
          success: false,
          message: "Update Parameter Value Position failed",
        }
      } else {
        return {
          success: false,
          message: "Update Parameter Value Position failed",
        }
      }
    }),
  }
}
