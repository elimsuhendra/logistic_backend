import voucherAccounts from "./data/voucherAccounts"

const ACCOUNT_ID = "perkasajayatransport"
const TYPE = "voucher-account"

// Upserts the voucher accounts into the Category collection.
// Keyed on accountId + type + name, so re-running the seeder is safe.
const importCategories = async (context) => {
  const { mongo } = context
  const now = Date.now()

  const bulkArgs = voucherAccounts.map((item) => ({
    updateOne: {
      filter: { accountId: ACCOUNT_ID, type: TYPE, name: item.value },
      update: {
        $set: {
          accountId: ACCOUNT_ID,
          seeder: true,
          type: TYPE,
          name: item.value,
          label: item.label,
          updatedBy: "system",
          updatedAt: now,
        },
        $setOnInsert: {
          createdBy: "system",
          createdAt: now,
        },
      },
      upsert: true,
    },
  }))

  await mongo.Category.bulkWrite(bulkArgs, { ordered: true })

  return await mongo.Category.find({ accountId: ACCOUNT_ID, type: TYPE }).toArray()
}

export default importCategories
