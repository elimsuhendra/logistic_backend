import { ObjectId } from "mongodb"
import voucherAccounts from "./data/voucherAccounts"

const ACCOUNT_NAME = "perkasajayatransport"
const TYPE = "voucher-account"

// Upserts the voucher accounts into the Category collection.
// accountId is the _id of the Account whose accountName is ACCOUNT_NAME (stored as
// ObjectId, like cashRequests.accountId), so the dashboard can filter by the logged
// accountId. Keyed on accountId + type + name, so re-running the seeder is safe;
// rows seeded earlier with the account name as accountId are converted.
const importCategories = async (context) => {
  const { mongo } = context
  const now = Date.now()

  const account = await mongo.Account.findOne({ accountName: ACCOUNT_NAME })
  if (!account) {
    throw new Error(`Account "${ACCOUNT_NAME}" not found. Seed accounts first.`)
  }
  const accountId = new ObjectId(account._id)

  const bulkArgs = voucherAccounts.map((item) => ({
    updateOne: {
      filter: {
        accountId: { $in: [accountId, String(accountId), ACCOUNT_NAME] },
        type: TYPE,
        name: item.value,
      },
      update: {
        $set: {
          accountId,
          seeder: true,
          type: TYPE,
          name: item.value,
          label: item.label,
          updatedBy: "system",
          updatedAt: now,
        },
        $setOnInsert: {
          inactive: false,
          createdBy: "system",
          createdAt: now,
        },
      },
      upsert: true,
    },
  }))

  await mongo.Category.bulkWrite(bulkArgs, { ordered: true })

  return await mongo.Category.find({ accountId, type: TYPE }).toArray()
}

export default importCategories
