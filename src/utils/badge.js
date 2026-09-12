import { ObjectId } from 'mongodb'
import pubsub from 'src/utils/pubsub'

export async function updateUnreadNotificationCountWhenCreate(args, context) {
  const { mongo } = context
  const { receiverIds } = args

  await Promise.all(receiverIds.map(async (receiverId) => {
    await mongo.Badge.updateOne(
      { userId: ObjectId(receiverId) },
      {
        $inc: {
          unreadNotificationCount: 1
        }
      },
      { upsert: true },
    )
  }))

  pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Badge', {
    Badge: {
      mutation: 'UPDATED',
      receiverIds: receiverIds
    }
  })
}

export async function updateUnreadNotificationCountWhenUpdate(context) {
  const { mongo, user } = context

  const total = await mongo.Notification.count({ receiverIds: ObjectId(user._id) })
  const totalRead = await mongo.ActivityLog.count({
    objectType: "Notification",
    action: "NOTIFICATION_READ",
    userId: ObjectId(user._id)
  })

  const rs = await mongo.Badge.findOneAndUpdate(
    { userId: ObjectId(user._id) },
    {
      $set: {
        unreadNotificationCount: total - totalRead,
      }
    },
    { returnOriginal: false }
  )
  if (rs.value) {
    pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Badge', {
      Badge: {
        mutation: 'UPDATED',
        node: rs.value,
      }
    })
  }
}