import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import { prepareCreate, prepareUpdate, compareObject } from 'src/utils/model'
import { withFilter } from 'graphql-subscriptions'
import pubsub from 'src/utils/pubsub'
import buildMongoFilters from 'src/utils/buildMongoFilters'
import buildMongoOrders from 'src/utils/buildMongoOrders'
import { mongoCreate, mongoUpdate, mongoDelete } from "utils/crud"

export default {
  Vehicle: {
    id: parent => parent._id || parent.id,
    policeNo: parent => parent.policeNo || parent.plat || '',
    stnk: parent => parent.stnk || '',
    stnkExp: parent => parent.stnkExp || parent.exp_stnk || '',
    kirExp: parent => parent.kirExp || parent.exp_kir || '',
    ownerName: parent => parent.ownerName || parent.nama_pemilik || '',
    brand: parent => parent.brand || parent.merk || '',
    type: parent => parent.type || '',
    cbm: parent => parent.cbm,
    tonase: parent => parent.tonase,
    outsideDimension: parent => parent.outsideDimension || parent.dimensi_luar || '',
    insideDimension: parent => parent.insideDimension || parent.dimensi_dalam || '',
    machineNo: parent => parent.machineNo || parent.nomor_mesin || '',
    chasisNo: parent => parent.chasisNo || parent.nomor_rangka || '',
    cbmIng2: parent => parent.cbmIng2 !== undefined ? parent.cbmIng2 : parent.cbm_ing2,
    insideDimension_1: parent => parent.insideDimension_1 || parent.dimensi_dalam_2 || '',
    insideDimension_2: parent => parent.insideDimension_2 || parent.dimensi_dalam_3 || '',
    insideDimension_3: parent => parent.insideDimension_3 || parent.dimensi_dalam_4 || '',
    cbmInsideDimension: parent => parent.cbmInsideDimension !== undefined ? parent.cbmInsideDimension : parent.cbm_dimensi_dalam,
    activityLogs: async ({ _id }, args, { mongo }) => {
      if (!mongo || !mongo.ActivityLog) return []
      return await mongo.ActivityLog.find({ objectId: ObjectId(_id), objectType: 'Vehicle', deletedAt: null }).sort({ createdAt: -1 }).toArray()
    },
    driver: async (parent, args, { mongo }) => {
      if (!mongo || !mongo.User) return null
      if (!parent.driverId) return null
      return await mongo.User.findOne({ _id: ObjectId(parent.driverId), deletedAt: null })
    }
  },
  Subscription: {
    Vehicle: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Vehicle'),
          (payload, args) => {
            if (!payload) return false
            return compareObject(payload.Vehicle.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getVehicle: async (parent, args, context) => {
      if (!args.id) return null

      await checkPermissions(checkUserAuth)({ context })
      const { mongo } = context

      return await mongo.Vehicle.findOne({ _id: ObjectId(args.id), deletedAt: null })
    },
    allVehicles: requiresAuth.createResolver(async (parent, args, context) => {
      const { filter = {}, first, skip, orderBy } = args
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (currentUser) {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = await mongo.Vehicle.find(filters)
          .sort(orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .toArray()

        return obj
      }
      return null
    }),
    _allVehiclesMeta: requiresAuth.createResolver(
      async (parent, { filter = {} }, { mongo, user }) => {
        const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
        if (currentUser) {
          const filters = buildMongoFilters(filter)
          const count = await mongo.Vehicle.countDocuments(filters)
          return { count }
        }
        return { count: 0 }
      }
    )
  },
  Mutation: {
    createVehicle: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const policeNo = args.policeNo || args.plat
        if (!policeNo || !policeNo.trim()) {
          return {
            success: false,
            message: "Police No. is required.",
            errors: [{ field: "policeNo", message: "Police No. is required" }]
          }
        }

        // Check if policeNo already exists
        const existingVehicle = await mongo.Vehicle.findOne({ policeNo: policeNo.trim(), deletedAt: null })
        if (existingVehicle) {
          return {
            success: false,
            message: "Vehicle with this police No. already exists.",
            errors: [{ field: "policeNo", message: "Vehicle with this police No. already exists" }]
          }
        }

        try {
          const normalizedArgs = {
            ...args,
            policeNo: policeNo.trim(),
            plat: policeNo.trim(),
            stnk: args.stnk || '',
            stnkExp: args.stnkExp || '',
            kirExp: args.kirExp || '',
            ownerName: args.ownerName || '',
            brand: args.brand || '',
            type: args.type || '',
            cbm: args.cbm !== undefined && args.cbm !== null ? args.cbm : null,
            tonase: args.tonase !== undefined && args.tonase !== null ? args.tonase : null,
            outsideDimension: args.outsideDimension || '',
            insideDimension: args.insideDimension || '',
            machineNo: args.machineNo || '',
            chasisNo: args.chasisNo || '',
            cbmIng2: args.cbmIng2 !== undefined && args.cbmIng2 !== null ? args.cbmIng2 : null,
            insideDimension_1: args.insideDimension_1 || '',
            insideDimension_2: args.insideDimension_2 || '',
            insideDimension_3: args.insideDimension_3 || '',
            cbmInsideDimension: args.cbmInsideDimension !== undefined && args.cbmInsideDimension !== null ? args.cbmInsideDimension : null,
            inactive: Boolean(args.inactive),
          }

          const newObj = prepareCreate(normalizedArgs)
          newObj._id = new ObjectId()
          console.log({ newObj })
          const rs = await mongoCreate('Vehicle', newObj, context)
          return {
            success: true,
            message: "New vehicle has been created",
            vehicle: rs
          }
        } catch (err) {
          return {
            success: false,
            message: err.message || "Failed to create vehicle"
          }
        }
      }

      return {
        success: false,
        message: "Unauthorized"
      }
    },
    updateVehicle: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const { id, ...updateArgs } = args
        try {
          const policeNo = updateArgs.policeNo || updateArgs.plat
          const normalizedArgs = {
            ...updateArgs,
          }
          if (policeNo) {
            normalizedArgs.policeNo = policeNo.trim()
            normalizedArgs.plat = policeNo.trim()

            // Check if policeNo already exists for another vehicle
            const existingVehicle = await mongo.Vehicle.findOne({ policeNo: policeNo.trim(), deletedAt: null, _id: { $ne: ObjectId(id) } })
            if (existingVehicle) {
              return {
                success: false,
                message: "Vehicle with this police No. already exists.",
                errors: [{ field: "policeNo", message: "Vehicle with this police No. already exists" }]
              }
            }
          }

          const rs = await mongoUpdate('Vehicle', { id, ...normalizedArgs }, context)
          if (rs && !(rs instanceof Error)) {
            const updatedVehicle = await mongo.Vehicle.findOne({ _id: ObjectId(id) })
            return {
              success: true,
              message: "Vehicle has been updated",
              vehicle: updatedVehicle
            }
          } else {
            return {
              success: false,
              message: `Cannot update Vehicle ${id}`
            }
          }
        } catch (err) {
          return {
            success: false,
            message: err.message || "Failed to update vehicle"
          }
        }
      }

      return {
        success: false,
        message: "Unauthorized"
      }
    },
    deleteVehicle: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const deletedVehicle = await mongo.Vehicle.findOne({ _id: ObjectId(args.id), deletedAt: null })
        if (!deletedVehicle) {
          return {
            success: false,
            message: "Vehicle not found"
          }
        }

        const rs = await mongoDelete('Vehicle', args, context)
        return {
          success: rs.success !== false,
          message: rs.success !== false ? 'Vehicle has been deleted' : 'Failed to delete vehicle'
        }
      }

      return {
        success: false,
        message: "Unauthorized"
      }
    }
  }
}
