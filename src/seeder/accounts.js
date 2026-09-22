import accounts from './data/accounts'

const importAccounts = async (context) => {
  const { mongo } = context

  // Truncate Account & Category Table if needed
  await mongo.Account.deleteMany({ seeder: true, locked: { $ne: true } })
  if (mongo.Category) {
    await mongo.Category.deleteMany({ seeder: true })
  }

  await Promise.all(accounts.map(async (account) => {
    try {
      await mongo.Account.updateOne(
        { accountName: account.accountName },
        { $set: account },
        { upsert: true }
      )
      console.log("Upserted account:", account.accountName)
    } catch (e) {
      console.log("Error inserting account:", account.accountName, e.message)
    }
  }))

  const allAccounts = await mongo.Account.find({ seeder: true }).toArray()

  return allAccounts
}

export default importAccounts
