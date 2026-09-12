import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete } from 'utils/crud'
import _ from "lodash"

export default {
  Team: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    Team: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Team'),
          (payload, args) => {
            return compareObject(payload.Team.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getTeam: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentTeam = id ? await mongo.Team.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentTeam
    }),
    allTeams: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Team.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allTeamsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.Team.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createTeam: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const team = await mongoCreate('Team', args, context)
        return {
          success: true,
          message: "Team has been created successfully!",
          team,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateTeam: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoUpdate('Team', args, context)
        const teamResponse = await mongo.Team.findOne({ _id: ObjectId(args.id), deletedAt: null })
        const teams = await mongo.Team.find({ _id: {$ne: ObjectId(args.id)}, isInitial: {$eq: true}, deletedAt: null}).toArray()
        const teamIds = teams.map(i => ObjectId(i._id))
        if (teamIds && teamIds.length > 0) {
          await mongo.Team.updateMany({_id: {$in: teamIds}}, {$set:{isInitial: false}})
        }
        return {
          success: true,
          message: "Team has been updated successfully!",
          team: teamResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    updateTeamPosition: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context
      const { teams } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        return await Promise.all(
          teams.map(obj => {
            return new Promise((resolve, reject) => {
              mongo.Team.findOneAndUpdate(
                {
                  _id: ObjectId(obj.id)
                },
                {
                  $set: {
                    position: obj.position
                  }
                },
                {
                  returnOriginal: false
                },
                (err, doc) => {
                  resolve(doc.value)
                }
              )
            })
          })
        ).then(docs => docs)
      }

      return null
    }),
    deleteTeam: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Team', args, context)
        return {
          success: true,
          message: "Team has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteTeams: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      return await mongoMultiDelete('Team', args, context)
    }),
  }
}
