import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import { prepareUpdate, compareObject } from 'utils/model'
import _ from "lodash"

export default {
  ForecastGroup: {
    id: (parent) => parent._id || parent.id,
  },
  ForecastGroupTeam: {
    id: (parent) => new ObjectId(),
  },
  ForecastGroupTeamMember: {
    name: async ({ id }, args, { dataloaders }) => {
      const user = !!id ? await dataloaders.get("userByIdLoader").load(id) : null
      return !!user? user.fullName : null
    },
    user: async ({ id }, args, { dataloaders }) => {
      return !!id ? await dataloaders.get("userByIdLoader").load(id) : null;
    },
  },
  Query: {
    getForecastGroupByYear: requiresAuth.createResolver(async (parent, { year }, { mongo, user }) => {
      return await mongo.ForecastGroup.findOne({ year: year, deletedAt: null })
    }),
  },
  Mutation: {
    saveForecastGroup: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context });

      const { mongo, user } = context
      const { year, ...params } = args

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null });

      if (!!currentUser) {
        await mongo.ForecastGroup.updateOne(
          { year },
          { $set: prepareUpdate(params) },
          { upsert: true }
        )

        return {
          success: true,
          message: "Forecast Group has been updated",
        }
      }

      return {
        success: false,
        message: "User is not authorized."
      }
    }),
  },
};
