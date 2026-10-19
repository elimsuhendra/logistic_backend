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
    carType: parent => parent.carType || '',
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
    importVehicles: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      const emptyResponse = (message) => ({
        success: false,
        message,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
        results: []
      })

      if (!currentUser) return emptyResponse('Unauthorized Action')

      const MAX_IMPORT_ROWS = 1000
      const rows = args.vehicles || []
      if (rows.length === 0) return emptyResponse('No vehicle records found to import.')
      if (rows.length > MAX_IMPORT_ROWS) return emptyResponse(`Too many rows. Maximum ${MAX_IMPORT_ROWS} vehicles per import.`)

      const clean = (value) => (value === null || value === undefined ? '' : String(value).trim())
      const parseFloatOrNull = (value) => {
        const s = clean(value)
        if (!s) return null
        const n = parseFloat(s)
        return isNaN(n) ? null : n
      }

      let createdCount = 0
      let updatedCount = 0
      let failedCount = 0
      const results = []

      for (let i = 0; i < rows.length; i++) {
        const input = rows[i]
        const rowNumber = input.row || i + 2
        const policeNo = clean(input.policeNo)

        const fail = (message, action = null) => {
          failedCount++
          results.push({ row: rowNumber, policeNo, action, success: false, message })
        }

        try {
          if (!policeNo) {
            fail('Police No. is required.')
            continue
          }

          if (input.stnkExp) {
            // change format date 30-May-26 to YYYY-MM-DD
            const date = new Date(input.stnkExp)
            const y = date.getFullYear()
            const m = String(date.getMonth() + 1).padStart(2, '0')
            const d = String(date.getDate()).padStart(2, '0')
            input.stnkExp = `${y}-${m}-${d}`
          }

          if (input.kirExp) {
            // change format date 30-May-26 to YYYY-MM-DD
            const date = new Date(input.kirExp)
            const y = date.getFullYear()
            const m = String(date.getMonth() + 1).padStart(2, '0')
            const d = String(date.getDate()).padStart(2, '0')
            input.kirExp = `${y}-${m}-${d}`
          }

          const existing = await mongo.Vehicle.findOne({ policeNo, deletedAt: null })

          if (existing) {
            // UPDATE: only overwrite fields that are provided
            const update = { policeNo }
            if (clean(input.stnk)) update.stnk = clean(input.stnk)
            if (clean(input.stnkExp)) update.stnkExp = clean(input.stnkExp)
            if (clean(input.kirExp)) update.kirExp = clean(input.kirExp)
            if (clean(input.ownerName)) update.ownerName = clean(input.ownerName)
            if (clean(input.brand)) update.brand = clean(input.brand)
            if (clean(input.carType)) update.carType = clean(input.carType)
            if (clean(input.type)) update.type = clean(input.type)
            const cbm = parseFloatOrNull(input.cbm)
            if (cbm !== null) update.cbm = cbm
            const tonase = parseFloatOrNull(input.tonase)
            if (tonase !== null) update.tonase = tonase
            if (clean(input.outsideDimension)) update.outsideDimension = clean(input.outsideDimension)
            if (clean(input.insideDimension)) update.insideDimension = clean(input.insideDimension)
            if (clean(input.machineNo)) update.machineNo = clean(input.machineNo)
            if (clean(input.chasisNo)) update.chasisNo = clean(input.chasisNo)
            const cbmIng2 = parseFloatOrNull(input.cbmIng2)
            if (cbmIng2 !== null) update.cbmIng2 = cbmIng2
            if (clean(input.insideDimension_1)) update.insideDimension_1 = clean(input.insideDimension_1)
            if (clean(input.insideDimension_2)) update.insideDimension_2 = clean(input.insideDimension_2)
            if (clean(input.insideDimension_3)) update.insideDimension_3 = clean(input.insideDimension_3)
            const cbmInsideDimension = parseFloatOrNull(input.cbmInsideDimension)
            if (cbmInsideDimension !== null) update.cbmInsideDimension = cbmInsideDimension
            if (typeof input.inactive === 'boolean') update.inactive = input.inactive
            const rs = await mongoUpdate('Vehicle', { id: existing._id.toString(), ...update }, context)
            if (!rs || rs instanceof Error) {
              fail('Failed to update vehicle.', 'updated')
              continue
            }

            updatedCount++
            results.push({ row: rowNumber, policeNo, action: 'updated', success: true, message: 'Vehicle updated.' })
          } else {
            // CREATE
            const newObj = prepareCreate({
              policeNo,
              plat: policeNo,
              stnk: clean(input.stnk),
              stnkExp: clean(input.stnkExp),
              kirExp: clean(input.kirExp),
              ownerName: clean(input.ownerName),
              brand: clean(input.brand),
              carType: clean(input.carType),
              type: clean(input.type),
              cbm: parseFloatOrNull(input.cbm),
              tonase: parseFloatOrNull(input.tonase),
              outsideDimension: clean(input.outsideDimension),
              insideDimension: clean(input.insideDimension),
              machineNo: clean(input.machineNo),
              chasisNo: clean(input.chasisNo),
              cbmIng2: parseFloatOrNull(input.cbmIng2),
              insideDimension_1: clean(input.insideDimension_1),
              insideDimension_2: clean(input.insideDimension_2),
              insideDimension_3: clean(input.insideDimension_3),
              cbmInsideDimension: parseFloatOrNull(input.cbmInsideDimension),
              inactive: typeof input.inactive === 'boolean' ? input.inactive : false,
            })
            newObj._id = new ObjectId()

            const rs = await mongoCreate('Vehicle', newObj, context)
            if (!rs || rs instanceof Error) {
              fail('Failed to create vehicle.', 'created')
              continue
            }

            createdCount++
            results.push({ row: rowNumber, policeNo, action: 'created', success: true, message: 'Vehicle created.' })
          }
        } catch (err) {
          console.log('⛔️ importVehicles row error - ', err)
          fail(err.message || 'Unexpected error.')
        }
      }

      return {
        success: createdCount + updatedCount > 0,
        message: `Created ${createdCount}, updated ${updatedCount}, failed ${failedCount}.`,
        createdCount,
        updatedCount,
        failedCount,
        results
      }
    },
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
            carType: args.carType || '',
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
