require("dotenv").config()

import connectMongo from "src/mongoConnector"

// CashRequest field rename: cashNo -> cashRequestNo.
//  - a cash request with cashNo and no cashRequestNo gets cashRequestNo = cashNo
//  - cashNo is removed from every cash request that has cashRequestNo
// Idempotent: running it again changes nothing. Until it runs, the API still reads
// cashNo (CashRequest.cashRequestNo, getCashRequest, getLastCashRequest, search).
const renameCashRequestNo = async (context) => {
  const { mongo } = context

  const renamed = await mongo.CashRequest.updateMany(
    { cashNo: { $exists: true }, cashRequestNo: { $exists: false } },
    { $rename: { cashNo: 'cashRequestNo' } }
  )
  // both set (e.g. updated by the new API before migrating): keep cashRequestNo
  const cleaned = await mongo.CashRequest.updateMany(
    { cashNo: { $exists: true }, cashRequestNo: { $exists: true } },
    { $unset: { cashNo: '' } }
  )

  console.log(
    `renameCashRequestNo: ${renamed.modifiedCount} cash request(s) renamed, ${cleaned.modifiedCount} old cashNo removed.`
  )
}

export default renameCashRequestNo

// Run directly: yarn db:migrate:cashRequestNo
if (require.main === module) {
  connectMongo().then(async context => {
    try {
      await renameCashRequestNo(context)
      process.exit(0)
    } catch (err) {
      console.log(err)
      process.exit(1)
    }
  })
}
