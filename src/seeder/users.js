import users from './data/users'

const importUsers = async (context) => {
  const { mongo } = context

  await Promise.all(users.map(async (user) => {
    await mongo.User.updateOne(
      { username: user.username, deletedAt: null },
      { $set: user },
      { upsert: true }
    )
  }))

  return await mongo.User.find().toArray()
}

export default importUsers
