import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import moment from 'moment'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import { sanitizeRegex } from 'utils/common'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import _, { add } from "lodash"

export default {
  Company: {
    id: parent => parent._id || parent.id,
    logo: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('companyPhotoByIdLoader').load(_id)
    },
    termsAndConditions: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'Company', documentType: 'terms-and-conditions' })
    },
    documents: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'Company', documentType: 'documents' })
    },
    notes: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('notesByCompanyIdLoader').load(_id)
    },
    activities: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('activitiesByCompanyIdLoader').load(_id)
    },
    jobOrders: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('jobOrdersByCompanyIdLoader').load(_id)
    },
    mainConsultant: async ({ mainConsultantId }, args, { dataloaders }) => {
      return !!mainConsultantId ? await dataloaders.get('userByIdLoader').load(mainConsultantId) : null
    },
    subsidiaryCompanies: async ({ subsidiaryCompanyIds }, args, { dataloaders }) => {
      return subsidiaryCompanyIds && subsidiaryCompanyIds.length > 0 ? await dataloaders.get('companyByIdLoader').loadMany(subsidiaryCompanyIds) : []
    },
    lastActive: async ({ _id }, args, { mongo }) => {
      const jobs = await mongo.JobOrder.find({ companyId: ObjectId(_id), deletedAt: null }).project({ _id: 1, createdAt: 1, updatedAt: 1, status: 1 }).toArray()
      const closedArr = jobs.filter(i => i.status === "CLOSED").map(i => i.updatedAt || i.createdAt)
      const completedArr = jobs.filter(i => i.status === "COMPLETED").map(i => i.updatedAt || i.createdAt)
      const inProgressArr = jobs.filter(i => i.status === "IN_PROGRESS").map(i => i.updatedAt || i.createdAt)
      if (closedArr && closedArr.length > 0) return moment.max(closedArr.map(i => moment(i)))
      if (completedArr && completedArr.length > 0) return moment.max(completedArr.map(i => moment(i)))
      if (inProgressArr && inProgressArr.length > 0) return moment.max(inProgressArr.map(i => moment(i)))
      return null
    },
  },
  Subscription: {
    Company: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Company'),
          (payload, args) => {
            return compareObject(payload.Company.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getCompany: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentCompany = id ? await mongo.Company.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentCompany
      }),
    allCompanies: requiresAuth.createResolver(
      async (parent, { keyword, filter, first, skip, orderBy, jobOrderFilter }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const sortBy = !!orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 }

        const { search, salary_lte, salary_gte, ...rest } = filter || {}

        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt

        let searchFilter = null
        if (!!search) {
          const users = await mongo.User.find({
            fullName: { $regex: `${sanitizeRegex(search)}`, $options: 'i' },
            deletedAt: null
          }).project({ _id: 1 }).toArray()
          const userIds = users.map(user => ObjectId(user._id))
          if (userIds && userIds.length > 0) {
            searchFilter = {
              mainConsultantId: {
                $in: userIds
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
                searchFilter || {}
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {}
              ]
            },
          ]
        } : { deletedAt: null }

        let pipelines = []

        if (!!keyword) {
          const phrases = keyword.split(' ').filter(phrase => !!phrase)
          const addFilters = phrases.map(phrase => {
            const str = phrase.trim().toLowerCase()
            const regexStr = `\(\^|\\W\)${str}`
            let matchCondition = {
              $match: {
                $or: [
                  { name: { $regex: regexStr, $options: 'i' } },
                  { industry: { $regex: regexStr, $options: 'i' } },
                  { url: { $regex: regexStr, $options: 'i' } },
                ]
              }
            }

            return matchCondition
          })

          pipelines = pipelines.concat(addFilters)
        }

        if (!!jobOrderFilter) {
          const jobOrderData = await mongo.JobOrder.find(jobOrderFilter).project({ companyId: 1, workType: 1 }).toArray()

          const companyIds = jobOrderData.map(jobOrder => ObjectId(jobOrder.companyId))
          if (companyIds.length > 0) {
            pipelines = pipelines.concat({
              $match: {
                _id: { $in: companyIds }
              }
            })
          }
        }

        pipelines = pipelines.concat([
          { $match: filterResult },
          { $sort: sortBy },
          { $skip: offset },
          { $limit: limit }
        ])

        const obj = mongo.Company.aggregate(pipelines)

        return await obj.toArray()
      }
    ),
    _allCompaniesMeta: requiresAuth.createResolver(
      async (parent, { keyword, filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)

        const { search, salary_lte, salary_gte, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt

        let searchFilter = null
        if (!!search) {
          const users = await mongo.User.find({
            fullName: { $regex: `${sanitizeRegex(search)}`, $options: 'i' },
            deletedAt: null
          }).project({ _id: 1 }).toArray()
          const userIds = users.map(user => ObjectId(user._id))
          if (userIds && userIds.length > 0) {
            searchFilter = {
              mainConsultantId: {
                $in: userIds
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
                searchFilter || {}
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {}
              ]
            },
          ]
        } : { deletedAt: null }

        let pipelines = []

        if (!!keyword) {
          const phrases = keyword.split(' ').filter(phrase => !!phrase)
          const addFilters = phrases.map(phrase => {
            const str = phrase.trim().toLowerCase()
            const regexStr = `\(\^|\\W\)${str}`
            let matchCondition = {
              $match: {
                $or: [
                  { name: { $regex: regexStr, $options: 'i' } },
                  { industry: { $regex: regexStr, $options: 'i' } },
                  { url: { $regex: regexStr, $options: 'i' } },
                ]
              }
            }

            return matchCondition
          })

          pipelines = pipelines.concat(addFilters)
        }

        pipelines = pipelines.concat([
          { $match: filterResult },
          { $skip: offset },
          { $limit: limit }
        ])

        const obj = mongo.Company.aggregate(pipelines)

        const companies = await obj.toArray()
        const hasNext = (companies || []).length > 0

        return {
          hasPrev: skip > 0,
          hasNext: hasNext
        }
      }
    ),
  },
  Mutation: {
    createCompany: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if ('contacts' in args) {
          const contactResponse = args.contacts.map((contact) => {
            return {
              ...contact,
              id: contact.id ? ObjectId(contact.id) : new ObjectId(),
            }
          })
          args.contacts = contactResponse
        }
        args["status"] = !!args.mainConsultantId ? "ACTIVE" : "INACTIVE"
        const company = await mongoCreate('Company', args, context)
        return {
          success: true,
          message: "Company has been created successfully!",
          company,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateCompany: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if ('contacts' in args) {
          const contactResponse = args.contacts.map((contact) => {
            return {
              ...contact,
              id: contact.id ? ObjectId(contact.id) : new ObjectId(),
            }
          })
          args.contacts = contactResponse
        }
        args["status"] = !!args.mainConsultantId ? "ACTIVE" : "INACTIVE"
        const currentCategory = await mongoUpdate('Company', args, context)
        const companyResponse = await mongo.Company.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Company has been updated successfully!",
          company: companyResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteCompany: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Company', args, context)
        return {
          success: true,
          message: "Company has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteCompanies: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoMultiDelete('Company', args, context)
    }),
    makeCompanyReport: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        // Build file here
        return {
          success: true,
          message: "Make Company Report successfully!",
          downloadUrl: "fake url"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    checkCompanyNameExist: requiresAuth.createResolver(
      async (parent, { name, ignoreId }, { mongo, user }) => {
        const argName = name.trim()
        if (ignoreId) {
          const currentCompany = await mongo.Company.findOne({ _id: ObjectId(ignoreId), deletedAt: null })
          if (currentCompany && currentCompany.name.toLowerCase() === argName.toLowerCase()) {
            return { existed: false }
          }
        }
        const currentCompany = await mongo.Company.findOne({ name: { "$regex": argName, "$options": "i" }, deletedAt: null })
        return {
          existed: !!currentCompany && currentCompany.name.toLowerCase() === argName.toLowerCase() ? true : false
        }
      }),
    createCompanyIndexes: requiresAuth.createResolver(
      async (parent, { }, { mongo, user }) => {
        try {
          await mongo.Company.dropIndexes()
          await mongo.Company.createIndex(
            { mainConsultantId: 1 },
            { name: "company-mainConsultantId-unique" }
          )
          await mongo.Company.createIndex(
            { subsidiaryCompanyIds: 1 },
            { name: "company-subsidiaryCompanyIds-unique" }
          )
          await mongo.Company.createIndex(
            { name: 1, url: 1, industry: 1 },
            { name: "company-name-url-industry-index" }
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
