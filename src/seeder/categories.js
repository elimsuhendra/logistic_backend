import voucherAccounts from "./data/voucherAccounts"

const TYPE = "voucher-account"

// Upserts the voucher accounts into the Category collection.
// Seeded rows are shared (no accountId). Keyed on type + name, so re-running
// the seeder is safe; accountId left by earlier runs is removed.
const importCategories = async (context) => {
  const { mongo } = context
  const now = Date.now()

  const bulkArgs = voucherAccounts.map((item) => ({
    updateOne: {
      filter: { type: TYPE, name: item.value },
      update: {
        $set: {
          seeder: true,
          type: TYPE,
          name: item.value,
          label: item.label,
          updatedBy: "system",
          updatedAt: now,
        },
        $unset: { accountId: "" },
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

  return await mongo.Category.find({ type: TYPE }).toArray()
}

export default importCategories
