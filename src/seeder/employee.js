import { ObjectId } from 'mongodb'
import employees from './data/employee'

const importEmployee = async (context) => {
  const { mongo } = context

  await Promise.all(employees.map(async (item) => {
    const {
      username,
      accountName,
      roleCode,
      roleName,
      menuPermissions,
      ...employeeData
    } = item

    const user = await mongo.User.findOne({ username, deletedAt: null })
    const account = await mongo.Account.findOne({
      accountName: accountName || username,
      deletedAt: null,
    })

    if (!user || !account) return

    let role = null
    if (roleCode) {
      await mongo.Role.updateOne(
        { code: roleCode, deletedAt: null },
        {
          $set: {
            seeder: true,
            locked: true,
            code: roleCode,
            name: roleName || roleCode,
            accountIds: [new ObjectId(account._id)],
            menuPermissions: Array.isArray(menuPermissions) ? menuPermissions : ['all'],
            inactive: false,
            deletedAt: null,
          },
          $setOnInsert: {
            createdAt: Date.now(),
            updatedAt: null,
          },
        },
        { upsert: true }
      )
      role = await mongo.Role.findOne({ code: roleCode, deletedAt: null })
    }

    const roleId = role ? new ObjectId(role._id) : null

    await mongo.Employee.updateOne(
      {
        userId: new ObjectId(user._id),
        accountId: new ObjectId(account._id),
        deletedAt: null,
      },
      {
        $set: {
          ...employeeData,
          userId: new ObjectId(user._id),
          accountId: new ObjectId(account._id),
          roleId,
        },
      },
      { upsert: true }
    )
  }))

  return await mongo.Employee.find({ seeder: true }).toArray()
}

export default importEmployee
