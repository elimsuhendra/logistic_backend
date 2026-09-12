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
  Institution: {
    id: parent => parent._id || parent.id
  },
  Subscription: {
    Institution: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Institution'),
          (payload, args) => {
            return compareObject(payload.Institution.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getInstitution: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentInstitution = id ? await mongo.Institution.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentInstitution
    }),
    allInstitutions: requiresAuth.createResolver(
      async (parent, { keyword, filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const sortBy = !!orderBy? buildMongoOrders(orderBy) : { createdAt: -1 }

        const { search, salary_lte, salary_gte, ...rest } = filter || {}

        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt

        let searchFilter = null
        if (!!search) {
          const users = await mongo.User.find({
            fullName: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
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
            {deletedAt: null},
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
              $match: { $or: [
                { name: { $regex: regexStr, $options: 'i' } },
                // { industry: { $regex: regexStr, $options: 'i' } },
                // { url: { $regex: regexStr, $options: 'i' } },
              ] }
            }

            return matchCondition
          })

          pipelines = pipelines.concat(addFilters)
        }

        pipelines = pipelines.concat([
          { $match: filterResult },
          { $sort: sortBy },
          { $skip: offset },
          { $limit: limit }
        ])

        let obj = await mongo.Institution.aggregate(pipelines).toArray()
        const inst = await mongo.Institution.find({
          status: "ACTIVE"
        }).toArray()

        if ('type' in filters) {
          if(filter.type == 'COMPANY'){
            const companies = await mongo.Company.find({
              status: "ACTIVE",
              deletedAt: null 
            }).toArray()

            obj = obj.concat(companies);
          }
        }

        return await obj
      }
    ),
    _allInstitutionsMeta: requiresAuth.createResolver(
      async (parent, { keyword, filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)

        const { search, salary_lte, salary_gte, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt

        let searchFilter = null
        if (!!search) {
          const users = await mongo.User.find({ 
            fullName: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
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
            {deletedAt: null},
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
        }: { deletedAt: null }

        let pipelines = []

        if (!!keyword) {
          const phrases = keyword.split(' ').filter(phrase => !!phrase)
          const addFilters = phrases.map(phrase => {
            const str = phrase.trim().toLowerCase()
            const regexStr = `\(\^|\\W\)${str}`
            let matchCondition = {
              $match: { $or: [
                { name: { $regex: regexStr, $options: 'i' } },
                { industry: { $regex: regexStr, $options: 'i' } },
                { url: { $regex: regexStr, $options: 'i' } },
              ] }
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

        const obj = mongo.Institution.aggregate(pipelines)

        const Institutions = await obj.toArray()
        const hasNext = (Institutions || []).length > 0

        return {
          hasPrev: skip > 0,
          hasNext: hasNext
        }
      }
    ),
  },
  Mutation: {
    createInstitution: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args["status"] = "ACTIVE"
        const institution = await mongoCreate('Institution', args, context)
        return {
          success: true,
          message: "Institution has been created successfully!",
          institution,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    })
  }
}
