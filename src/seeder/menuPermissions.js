import menuPermissions from './data/menuPermissions'

const importMenuPermissions = async (context) => {
  const { mongo } = context

  await mongo.MenuPermissions.deleteMany({ seeder: true, locked: { $ne: true } })

  await Promise.all(menuPermissions.map(async (item) => {
    try {
      await mongo.MenuPermissions.updateOne(
        { code: item.code, deletedAt: null },
        { $set: item },
        { upsert: true }
      )
      console.log("Upserted menuPermission:", item.code)
    } catch (e) {
      console.log("Error inserting menuPermission:", item.code, e.message)
    }
  }))

  const allMenuPermissions = await mongo.MenuPermissions.find({ deletedAt: null }).toArray()
  return allMenuPermissions
}

export default importMenuPermissions

