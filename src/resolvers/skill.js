import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject, prepareUpdate } from 'utils/model'
import { sanitizeRegex } from 'utils/common'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { sms } from "utils/smsServices"
import moment from 'moment'
import agenda from 'jobs'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete, ensureHasTextIndex} from 'utils/crud'
import _ from "lodash"
import path from "path"

export default {
  Skill: {
    id: parent => parent._id || parent.id
  },
  Subscription: {
    Skill: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Skill'),
          (payload, args) => {
            return compareObject(payload.Skill.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getSkill: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentSkill = id ? await mongo.Skill.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentSkill
    }),
    allSkills: requiresAuth.createResolver(
      async (parent, { keyword, filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const sortBy = !!orderBy? buildMongoOrders(orderBy) : { createdAt: -1 }

        const { search, ...rest } = filter || {}

        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt

        let searchFilter = null
        // if (!!search) {
        //   const users = await mongo.User.find({
        //     fullName: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
        //     deletedAt: null 
        //   }).project({ _id: 1 }).toArray()
        //   const userIds = users.map(user => ObjectId(user._id))
        //   if (userIds && userIds.length > 0) {
        //     searchFilter = {
        //       mainConsultantId: {
        //         $in: userIds
        //       }
        //     }
        //   }
        // }
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

        let obj = await mongo.Skill.aggregate(pipelines).toArray()
        const inst = await mongo.Skill.find({
          status: "ACTIVE"
        }).toArray()
 
        return await obj
      }
    ),
    _allSkillsMeta: requiresAuth.createResolver(
      async (parent, { keyword, filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)

        const { search, salary_lte, salary_gte, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt

        let searchFilter = null
        // if (!!search) {
        //   const users = await mongo.User.find({ 
        //     fullName: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
        //     deletedAt: null 
        //   }).project({ _id: 1 }).toArray()
        //   const userIds = users.map(user => ObjectId(user._id))
        //   if (userIds && userIds.length > 0) {
        //     searchFilter = {
        //       mainConsultantId: {
        //         $in: userIds
        //       }
        //     }
        //   }
        // }
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

        const obj = mongo.Skill.aggregate(pipelines)

        const Skills = await obj.toArray()
        const hasNext = (Skills || []).length > 0

        return {
          hasPrev: skip > 0,
          hasNext: hasNext
        }
      }
    ),
  },
  Mutation: {
    createSkill: requiresAuth.createResolver(async (parent, args, context) => {
      const { skills } = args
      const { mongo, user, dataloaders } = context

      try {
        let insertSkills = []
       
        for (let i = 0; i < skills.length; i++) {
          const {...params } = skills[i]
          let newSkillId = (params.id == 'new' ? new ObjectId() : new ObjectId(params.id) )
          const skill = await mongo.Skill.findOne( { $or: [ { _id: newSkillId }, { name: params.name } ] } )

          const newSKill = {
            _id: newSkillId,
            name: params.name,
            status: 'ACTIVE',
            type: params.type,
            createdAt: new Date().getTime()
          }

          skills[i]['id'] = newSkillId.toString()

          if (!skill) {
           
            await mongo.Skill.insertOne(newSKill)
            insertSkills.push(newSKill)
          }

        }

        return {
          success: true,
          message: "Skills have been created.",
          skills: skills
        }
      } catch (e) {
        console.log(`[ERROR] Failed to create skills.`, e)
      }

      return {
        success: false,
        message: "Failed to create skills"
      }
    }),
  }
}
