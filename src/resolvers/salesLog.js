import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { addSalesLog } from 'utils/jobApplicant'

import _ from "lodash"

export default {
  SalesLog: {
    id: parent => parent._id || parent.id,
    creator: async ({ creatorId }, args, { dataloaders }) => {
      return !!creatorId ? await dataloaders.get('userByIdLoader').load(creatorId) : null
    },
    consultant: async ({ consultantId }, args, { dataloaders }) => {
      return !!consultantId ? await dataloaders.get('userByIdLoader').load(consultantId) : null
    },
    jobApplicant: async ({ jobApplicantId }, args, { dataloaders }) => {
      return !!jobApplicantId ? await dataloaders.get('jobApplicantByIdLoader').load(jobApplicantId) : null
    }
  },
  Subscription: {
   
  },
  Query: {
    allSalesLogs: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.SalesLog.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        const salesLogs = await obj.toArray()
 
        return salesLogs
      }
    ),
    _allSalesLogsMeta: requiresAuth.createResolver(
      async (parent, { filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.SalesLog.find(filters)

        return {
          hasPrev: skip > 0,
          hasNext: (obj || []).length > 0
        }
      }
    )
  },
  Mutation: {
    createSalesLog: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const {jobApplicantId} = args
        const newJobApplicantId = new ObjectId(jobApplicantId)
        const getJobApplicant = await mongo.JobApplicant.findOne({_id: newJobApplicantId})
        const phase = getJobApplicant.phase

        const creatorId = currentUser._id
        if(phase == "Offered"){
          const salesLog = await addSalesLog({context, currentJobApplicant: getJobApplicant, phase, creatorId})
        }

        return {
          success: true,
          message: "SalesLog has been created successfully!",
          activity,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    })
  }
}
