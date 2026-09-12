import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import moment from 'moment'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate } from 'utils/crud'
import _ from "lodash"

export default {
  Forecast: {
    id: (parent) => parent._id || parent.id,
    user: async ({ userId }, args, { dataloaders }) => {
      return !!userId ? await dataloaders.get("userByIdLoader").load(userId) : null;
    },
    userName: async ({ userName, userId }, args, { dataloaders }) => {
      const user = !!userId ? await dataloaders.get("userByIdLoader").load(userId) : null
      return userName || user && user.fullName || null
    },
    groupName: async ({ groupName, groupId }, args, { dataloaders }) => {
      const group = !!groupId ? await dataloaders.get("groupByIdLoader").load(groupId) : null
      return groupName || group && group.name || null
    },
    type: async ({ type, userName, userId, year }, args, { dataloaders }) => {
      const user = !!userId ? await dataloaders.get("userByIdLoader").load(userId) : null
      const loadedUserName = userName || user && user.fullName || ""

      return type || (loadedUserName.includes(" RC") || (user && user.dateJoin && (user.dateJoin >= year? "GI" : "BAU")))
    },
    q1: async ({ january, february, march }, args, context) => {
      return _.sum([january, february, march].map(x => x || 0))
    },
    q2: async ({ april, may, june }, args, context) => {
      return _.sum([april, may, june].map(x => x || 0))
    },
    q3: async ({ july, august, september }, args, context) => {
      return _.sum([july, august, september].map(x => x || 0))
    },
    q4: async ({ october, november, december }, args, context) => {
      return _.sum([october, november, december].map(x => x || 0))
    },
    total: async ({ january, february, march, april, may, june, july, august, september, october, november, december }, args, context) => {
      return _.sum([january, february, march, april, may, june, july, august, september, october, november, december].map(x => x || 0))
    },
  },
  Subscription: {
    Forecast: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + "-" + process.env.APP_ENV + "-Forecast"),
          (payload, args) => {
            return compareObject(payload.Forecast.node, args.dataFilter);
          },
        ),
      ),
    },
  },
  Query: {
    getForecast: requiresAuth.createResolver(async (parent, { id }, { mongo, user }) => {
      const currentForecast = id ? await mongo.Forecast.findOne({ _id: ObjectId(id), deletedAt: null }) : null;
      return currentForecast;
    }),
    allForecasts: requiresAuth.createResolver(async (parent, { filter, first, skip, orderBy }, { mongo, user }) => {
      const limit = first || 10;
      const offset = skip || 0;

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      
      if (currentUser.role === "TeamLeader") {
        const groups = await mongo.Group.find({ teamLeaderId: ObjectId(currentUser._id), deletedAt: null }).toArray()
        filter.groupId_in = groups.map(group => group._id)
      } else if (currentUser.role === "Staff" || currentUser.role === "Finance") {
        filter.userId = currentUser._id
      }

      const filters = buildMongoFilters(filter)

      const obj = mongo.Forecast.find(filters)
      if (first) obj.limit(limit)
      if (skip) obj.skip(offset)
      if (orderBy) obj.sort(buildMongoOrders(orderBy))
      else obj.sort({ createdAt: -1 }) // -1 = DESC

      return await obj.toArray()
    }),
    _allForecastsMeta: requiresAuth.createResolver(async (parent, { filter }, { mongo, user }) => {
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (currentUser.role === "TeamLeader") {
        const groups = await mongo.Group.find({ teamLeaderId: ObjectId(currentUser._id), deletedAt: null }).toArray()
        filter.groupId_in = groups.map(group => group._id)
      } else if (currentUser.role === "Staff" || currentUser.role === "Finance") {
        filter.userId = currentUser._id
      }

      const filters = buildMongoFilters(filter) || {}
      const obj = mongo.Forecast.find(filters)

      return { count: obj.count() }
    }),
  },
  Mutation: {
    saveForecast: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context });

      const { mongo, user } = context;

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null });

      if (!!currentUser) {
        if (!args.adjusted) {
          const currentForecast = args.id ? await mongo.Forecast.findOne(buildMongoFilters({ _id: args.id })) : null;
          let year = currentForecast && currentForecast.year;
          if (!year) {
            year = args["year"] ? moment.utc(moment(args["year"]).format("YYYY-MM-DD")).valueOf() : null;
          }
          if (year) {
            const momentYear = moment.utc(year).utcOffset(8).year();
            const isValid =
              moment.utc().utcOffset(8).add(1, "y").year() === momentYear && moment.utc().utcOffset(8).month >= 10;
            if (isValid) {
              return {
                success: false,
                message: "Invalid time to update forecast.",
              };
            }
          }

          let findForecast
          if(args.type == "BAU" && args.groupId && args.userName){
            findForecast = await mongo.Forecast.findOne(buildMongoFilters({ type: "BAU", groupId: args.groupId, userName: args.userName, year: args.year, deletedAt: null }));
          }

          if(findForecast){
            return {
              success: false,
              message: "Forecast with same group and staff cannot be created!",
            };
          }
        }
        args.year = args["year"] ? moment.utc(moment(args["year"]).format("YYYY-MM-DD")).valueOf() : null;
        if (!!args.id) {
          delete args.year;
          const forecast = await mongoUpdate("Forecast", args, context);
        } else {
          const forecast = await mongoCreate("Forecast", args, context);
        }
        return {
          success: true,
          message: "Forecast has been created successfully!",
        };
      }

      return {
        success: false,
        message: "User is not authorized.",
      };
    }),
    deleteForecast: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      
      const { mongo, user } = context
      const { id } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongo.Forecast.updateOne(
          { _id: ObjectId(id) },
          { $set: {
            deletedAt: new Date().getTime()
          } }
        )

        return {
          success: true,
          message: "Forecast removed"
        }
      }

      return {
        success: false,
        message: "Failed to remove forecast"
      }
    }),
    saveForecasts: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context });

      const { mongo, user } = context
      const { forecasts } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null });
      console.log('currentUser', currentUser, !!currentUser)
      if (!!currentUser) {
        await Promise.all(forecasts.map(async (forecast) => {
          if (!forecast.adjusted) {
            const currentForecast = forecast.id ? await mongo.Forecast.findOne(buildMongoFilters({ _id: forecast.id })) : null;
            let year = currentForecast && currentForecast.year;
            if (!year) {
              year = forecast["year"] ? moment.utc(moment(forecast["year"]).format("YYYY-MM-DD")).valueOf() : null;
            }
            if (year) {
              const momentYear = moment.utc(year).utcOffset(8).year();
              const isValid =
                moment.utc().utcOffset(8).add(1, "y").year() === momentYear && moment.utc().utcOffset(8).month >= 10;
              if (isValid) {
                return {
                  success: false,
                  message: "Invalid time to update forecast.",
                };
              }
            }
          }

          forecast.year = forecast["year"] ? moment.utc(moment(forecast["year"]).format("YYYY-MM-DD")).valueOf() : null;

          if (!!forecast.id) {
            delete forecast.year;
            await mongoUpdate("Forecast", forecast, context);
          } else {
            await mongoCreate("Forecast", forecast, context);
          }
        }))

        return {
          success: true,
          message: "Forecast has been created successfully!",
        }
      }else{
        return {
          success: false,
          message: "User is not authorized.",
        };
      }
    }),
  },
};
