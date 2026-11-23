require("dotenv").config()

import connectMongo from "src/mongoConnector"

// approvalEnum rename: Cancelled -> Revision. Sets approval = "Revision" on every
// Approval stored as "Cancelled". Idempotent. Until it runs, the API returns
// stored "Cancelled" values as Revision (utils/approval toApprovalStatus).
const renameApprovalCancelledToRevision = async (context) => {
  const { mongo } = context
  const res = await mongo.Approval.updateMany(
    { approval: 'Cancelled' },
    { $set: { approval: 'Revision' } }
  )
  console.log(`renameApprovalCancelledToRevision: ${res.modifiedCount} approval(s) updated.`)
}

export default renameApprovalCancelledToRevision

// Run directly: yarn db:migrate:approvalRevision
if (require.main === module) {
  connectMongo().then(async context => {
    try {
      await renameApprovalCancelledToRevision(context)
      process.exit(0)
    } catch (err) {
      console.log(err)
      process.exit(1)
    }
  })
}
