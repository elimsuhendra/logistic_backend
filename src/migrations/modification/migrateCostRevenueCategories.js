require("dotenv").config()

import connectMongo from "src/mongoConnector"
import costRevenues from "src/migrations/data/costRevenues"

export const COST_REVENUE_TYPE = "cost-revenue"

// Moves the dashboard's COST_REVENUE_DATA constant into the Category collection
// as type "cost-revenue":
//  - name    = the old constant id/value (what vouchers and settlements store as
//              costId), so existing data keeps matching
//  - label   = the text shown in the "Cost / Revenue" select
//  - isCost  = true for Cost, false for Revenue
// Rows are shared (no accountId) and marked seeder. Upserted on type + name, so
// re-running is safe: labels / isCost are refreshed, while inactive and the
// creation fields of rows that already exist are kept.
const migrateCostRevenueCategories = async (context) => {
  const { mongo } = context
  const now = Date.now()

  const bulkArgs = costRevenues.map((item) => ({
    updateOne: {
      filter: { type: COST_REVENUE_TYPE, name: item.value },
      update: {
        $set: {
          seeder: true,
          type: COST_REVENUE_TYPE,
          name: item.value,
          label: item.label,
          additionalInfo: [
            {
              key: "isCost",
              value: Boolean(item.isCost)
            }
          ],
          updatedBy: "system",
          updatedAt: now,
        },
        $unset: { accountId: "" },
        $setOnInsert: {
          inactive: false,
          createdBy: "system",
          createdAt: now,
          deletedAt: null,
        },
      },
      upsert: true,
    },
  }))

  const rs = await mongo.Category.bulkWrite(bulkArgs, { ordered: true })
  const upserted = rs.upsertedCount !== undefined ? rs.upsertedCount : rs.nUpserted || 0
  const modified = rs.modifiedCount !== undefined ? rs.modifiedCount : rs.nModified || 0
  console.log(
    `migrateCostRevenueCategories: ${costRevenues.length} item(s), ${upserted} created, ${modified} updated.`
  )

  return await mongo.Category.find({ type: COST_REVENUE_TYPE }).toArray()
}

export default migrateCostRevenueCategories

// Run directly: yarn db:migrate:costRevenues
if (require.main === module) {
  connectMongo().then(async (context) => {
    try {
      await migrateCostRevenueCategories(context)
      process.exit(0)
    } catch (err) {
      console.log(err)
      process.exit(1)
    }
  })
}
