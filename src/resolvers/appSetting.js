import requiresAuth, { checkUserAuth, checkPermissions } from 'utils/permissions'
import { ObjectId } from 'mongodb'
import { getRoles } from 'utils/authentication'
import pubsub from 'utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoUpdate } from 'utils/crud'

export default {
  Subscription: {
    AppSetting: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-AppSetting'),
          (payload, args) => {
            return true
          }
        )
      )
    }
  },
  Query: {
    getAppSetting: requiresAuth.createResolver(
      async (parent, args, { mongo, user }) => {
        let appSetting = await mongo.AppSetting.findOne({ deletedAt: null })
        if (!appSetting) {
          await mongo.AppSetting.insertOne({
            appName: 'Jobsify',
            appVersion: '1',
            deletedAt: null,
            createdAt: new Date().getTime(),
            updatedAt: null,
          })

          appSetting = await mongo.AppSetting.findOne({ deletedAt: null })
        }
        return appSetting
      }),
  },
  Mutation: {
    updateAppSetting: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)
      const appSetting = await mongo.AppSetting.findOne({ deletedAt: null })

      if (!!currentUser && rolesObj.isAdmin && !!appSetting) {
        args.id = appSetting._id.toString()

        const updatedAppSetting = await mongoUpdate('AppSetting', args, context)
        return {
          success: true,
          message: 'Update app setting successfully!',
          appSetting: updatedAppSetting,
        }
      } else {
        return {
          success: false,
          message: 'User is not authorized!',
        }
      }
    })
  }
}
