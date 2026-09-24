import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import kebabCase from 'lodash/kebabCase'
import { sanitizeRegex, formatSlug } from 'utils/common'
import pubsub from 'src/utils/pubsub'
import moment from 'moment'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import _ from "lodash"

function addUniqueSlugs(arr) {
  const slugSet = new Set();
  return arr.map(item => {
    let slug = kebabCase(item.title);
    let uniqueSlug = slug;
    let counter = 1;
    while (slugSet.has(uniqueSlug)) {
      uniqueSlug = `${slug}-${counter}`;
      counter++;
    }
    slugSet.add(uniqueSlug);
    return { ...item, slug: uniqueSlug };
  });
}

export default {
  JobOrder: {
    id: parent => parent._id || parent.id,
    company: async ({ companyId }, args, { dataloaders }) => {
      return companyId ? await dataloaders.get('companyByIdLoader').load(companyId) : null
    },
    consultants: async ({ consultantIds }, args, { dataloaders }) => {
      return consultantIds && consultantIds.length > 0 ? await dataloaders.get('userByIdLoader').loadMany(consultantIds) : []
    },
    owner: async ({ ownerId }, args, { dataloaders }) => {
      return ownerId ? await dataloaders.get('userByIdLoader').load(ownerId) : null
    },
    workflow: async ({ workflowId }, args, { dataloaders }) => {
      return workflowId ? await dataloaders.get('workflowByIdLoader').load(workflowId) : null
    },
    documents: async ({ _id }, args, { dataloaders }) => {
      if (!_id) return []
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'JobOrder', documentType: 'documents' })
    },
    notes: async ({ _id }, args, { dataloaders }) => {
      if (!_id) return []
      return await dataloaders.get('notesByJobOrderIdLoader').load(_id)
    },
    activityLogs: async ({ _id }, args, { dataloaders }) => {
      if (!_id) return []
      return await dataloaders.get('activitiesByJobOrderIdLoader').load(_id)
    },
    jobApplicants: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('jobApplicantsByJobOrderIdLoader').load(_id)
    },
    lastActive: async ({ _id }, args, { dataloaders, mongo }) => {
      const activities = await mongo.ActivityLog.find({
        objectType: "JobOrder", objectId: ObjectId(_id), deletedAt: null
      }).sort({ createdAt: -1 }).toArray()
      if (activities && activities.length) {
        const first = activities[0]
        return first.createdAt
      }
      return null
    }
  },
  Subscription: {
    JobOrder: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-JobOrder'),
          (payload, args) => {
            return compareObject(payload.JobOrder.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getJobOrder: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentJobOrder = id ? await mongo.JobOrder.findOne(
          Object.assign(!ObjectId.isValid(id)
            ? { slug: id }
            : {
              $or: [
                { _id: ObjectId(id) },
                { slug: id }
              ]
            },
            { deletedAt: null })
        ) : null
        return currentJobOrder
      }),
    allJobOrders: requiresAuth.createResolver(
      async (parent, { filter, ownerFilter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const { search, salary_lte, salary_gte, candidateId, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt
        let searchFilter = null
        if (!!search) {
          let searchArr = {}
          const companies = await mongo.Company.find({
            name: { $regex: `${sanitizeRegex(search)}`, $options: 'i' },
            deletedAt: null
          }).project({ _id: 1 }).toArray()
          const companyIds = companies.map(company => ObjectId(company._id))
          const users = await mongo.User.find({
            fullName: { $regex: `${sanitizeRegex(search)}`, $options: 'i' },
            deletedAt: null
          }).project({ _id: 1 }).toArray()
          const userIds = users.map(user => ObjectId(user._id))
          if (companyIds && companyIds.length > 0) {
            searchArr = {
              companyId: {
                $in: companyIds
              }
            }
          }
          if (userIds && userIds.length > 0) {
            searchArr = {
              ...searchArr,
              "$or": [
                {
                  ownerId: {
                    $in: userIds
                  }
                },
              ]
            }
          }
          if (Object.keys(searchArr).length > 1) {
            const formatSearch = Object.keys(searchArr).map(i => ({ [i]: searchArr[i] }))
            searchFilter = { "$or": formatSearch }
          } else {
            searchFilter = searchArr
          }
        }
        if (!!candidateId) {
          const jobApplicantsByCandidateId = await mongo.JobApplicant.find({ candidateId: ObjectId(candidateId), deletedAt: null }).toArray()
          const jobOrderIds = jobApplicantsByCandidateId.map(jobApplicant => ObjectId(jobApplicant.jobId))
          if (jobOrderIds && jobOrderIds.length > 0) {
            filters = {
              ...filters,
              "_id": {
                "$in": jobOrderIds
              }
            }
          }
        }

        const filterResponse = [filters, searchFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = (filterResponse && filterResponse.length > 0) ? {
          $and: [
            { deletedAt: null },
            Object.keys(filters || []).length && Object.keys(searchFilter || []).length ? {
              $or: [
                filters || {},
                searchFilter || {},
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {},
              ]
            }
          ]
        } : { deletedAt: null }

        if (ownerFilter != undefined) {
          const userFilters = buildMongoFilters(ownerFilter)
          const eligibleOwners = await mongo.User.distinct('_id', userFilters)
          const ownerIds = eligibleOwners.map(owner => ObjectId(owner))
          if (ownerIds && ownerIds.length > 0) {
            filterResult.ownerId = { $in: ownerIds }
          }

        }
        const obj = mongo.JobOrder.find(filterResult)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC
        return await obj.toArray()
      }
    ),
    _allJobOrdersMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const { search, salary_lte, salary_gte, candidateId, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt
        let searchFilter = null
        if (!!search) {
          let searchArr = {}
          const companies = await mongo.Company.find({
            name: { $regex: `${sanitizeRegex(search)}`, $options: 'i' },
            deletedAt: null
          }).project({ _id: 1 }).toArray()
          const companyIds = companies.map(company => ObjectId(company._id))
          const users = await mongo.User.find({
            fullName: { $regex: `${sanitizeRegex(search)}`, $options: 'i' },
            deletedAt: null
          }).project({ _id: 1 }).toArray()
          const userIds = users.map(user => ObjectId(user._id))
          if (companyIds && companyIds.length > 0) {
            searchArr = {
              companyId: {
                $in: companyIds
              }
            }
          }
          if (userIds && userIds.length > 0) {
            searchArr = {
              ...searchArr,
              "$or": [
                {
                  ownerId: {
                    $in: userIds
                  }
                }
              ]
            }
          }
          if (Object.keys(searchArr).length > 1) {
            const formatSearch = Object.keys(searchArr).map(i => ({ [i]: searchArr[i] }))
            searchFilter = { "$or": formatSearch }
          } else {
            searchFilter = searchArr
          }
        }
        if (!!candidateId) {
          const jobApplicantsByCandidateId = await mongo.JobApplicant.find({ candidateId: ObjectId(candidateId), deletedAt: null }).toArray()
          const jobOrderIds = jobApplicantsByCandidateId.map(jobApplicant => ObjectId(jobApplicant.jobId))
          if (jobOrderIds && jobOrderIds.length > 0) {
            filters = {
              ...filters,
              "_id": {
                "$in": jobOrderIds
              }
            }
          }
        }
        const filterResponse = [filters, searchFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = (filterResponse && filterResponse.length > 0) ? {
          $and: [
            { deletedAt: null },
            Object.keys(filters || []).length && Object.keys(searchFilter || []).length ? {
              $or: [
                filters || {},
                searchFilter || {},
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {},
              ]
            }
          ]
        } : { deletedAt: null }
        const obj = mongo.JobOrder.find(filterResult)
        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createJobOrder: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if (!args.companyId) {
          return {
            success: false,
            message: "Company is compulsory.",
          }
        }

        if (!args.title) {
          return {
            success: false,
            message: "Job Title is compulsory.",
          }
        }
        args.startDate = args["startDate"] ? moment.utc(moment(args["startDate"]).format("YYYY-MM-DD")).valueOf() : null
        args.expectedCompletion = args["expectedCompletion"] ? moment.utc(moment(args["expectedCompletion"]).format("YYYY-MM-DD")).valueOf() : null
        const jobOrder = await mongoCreate('JobOrder', args, context)
        return {
          success: true,
          message: "Job order has been created successfully!",
          jobOrder,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateJobOrder: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const currentJobOrder = await mongo.JobOrder.findOne({ _id: ObjectId(args.id) })
      const jobOfferedCount = await mongo.JobApplicant.find({ jobId: ObjectId(args.id), phase: "Offered", offer: { $ne: null }, deletedAt: null }).count()
      if (args.jobSlot < jobOfferedCount) {
        return {
          success: false,
          message: "No. of Jobs cannot be less than No. of Jobs Required"
        }
      }
      if (args.jobSlot > jobOfferedCount) {
        args.status = "IN_PROGRESS"
      } else if (args.jobSlot == jobOfferedCount) {
        args.status = "COMPLETED"
      }
      if (!!currentUser) {
        if (!currentJobOrder) {
          return {
            success: false,
            message: "Job Order is not existed.",
          }
        }
        if (('title' in args && !args.title)) {
          return {
            success: false,
            message: "Job Title is compulsory.",
          }
        }
        args.startDate = args["startDate"] ? moment.utc(moment(args["startDate"]).format("YYYY-MM-DD")).valueOf() : null
        args.expectedCompletion = args["expectedCompletion"] ? moment.utc(moment(args["expectedCompletion"]).format("YYYY-MM-DD")).valueOf() : null
        args["updatedAt"] = new Date().getTime()
        await mongoUpdate('JobOrder', args, context)
        const jobOrderResponse = await mongo.JobOrder.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Job order has been updated successfully!",
          jobOrder: jobOrderResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteJobOrder: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('JobOrder', args, context)
        return {
          success: true,
          message: "Job order has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteJobOrders: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoMultiDelete('JobOrder', args, context)
        if (args && args.ids && args.ids.length > 0) {
          const jobApplicants = await mongo.JobApplicant.find({ jobId: { $in: args.ids.map(id => ObjectId(id)) }, deletedAt: null }).toArray()
          const jobApplicantIds = jobApplicants.map(jobApplicant => ObjectId(jobApplicant._id))
          if (jobApplicantIds && jobApplicantIds.length > 0) {
            await mongoMultiDelete('JobApplicant', { ids: jobApplicantIds }, context)
          }
        }
        return {
          success: true,
          message: "Job order has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    generateJobSlug: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        const jobs = await mongo.JobOrder.find({
          slug: {
            $in: [null, ""]
          },
          deletedAt: null
        }).project({ id: 1, title: 1 }).toArray()
        if (jobs.length > 0) {
          const updatedArr = addUniqueSlugs(jobs)
          const bulkArgs = updatedArr.map(item => {
            return {
              updateOne: {
                filter: { _id: ObjectId(item._id) },
                update: {
                  $set: {
                    slug: item.slug
                  }
                },
                upsert: true
              }
            }
          })
          await mongo.JobOrder.bulkWrite(bulkArgs, { ordered: true })
        }
        return {
          success: true,
          message: "Done."
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    createJobOrderIndexes: requiresAuth.createResolver(
      async (parent, { }, { mongo, user }) => {
        try {
          await mongo.JobOrder.createIndex(
            { title: "text", jobNo: "text", workType: "text", industry: "text" },
            { name: "jobOrder-jobNo-unique" }
          )
          await mongo.JobOrder.createIndex(
            { status: 1 },
            { name: "jobOrder-status-unique" }
          )
          await mongo.JobOrder.createIndex(
            { ownerId: 1 },
            { name: "jobOrder-ownerId-unique" }
          )
          await mongo.JobOrder.createIndex(
            { consultantIds: 1 },
            { name: "jobOrder-consultantIds-unique" }
          )
          await mongo.JobOrder.createIndex(
            { candidateId: 1 },
            { name: "jobOrder-candidateId-unique" }
          )
          await mongo.JobOrder.createIndex(
            { hideJob: 1 },
            { name: "jobOrder-hideJob-unique" }
          )
          await mongo.JobOrder.createIndex(
            { companyId: 1 },
            { name: "jobOrder-companyId-unique" }
          )
          await mongo.JobOrder.createIndex(
            { salaryMin: 1 },
            { name: "jobOrder-salaryMin-unique" }
          )
          await mongo.JobOrder.createIndex(
            { salaryMax: 1 },
            { name: "jobOrder-salaryMax-unique" }
          )
          await mongo.JobOrder.createIndex(
            { createdAt: 1 },
            { name: "jobOrder-createdAtASC-unique" }
          )
          await mongo.JobOrder.createIndex(
            { createdAt: -1 },
            { name: "jobOrder-createdAt-DESC-unique" }
          )
          return {
            success: true,
            message: "Done."
          }
        } catch (error) {
          return {
            success: false,
            message: error.message
          }
        }
      }),
  }
}
