require("dotenv").config()

import connectMongo from "src/mongoConnector"
import { refreshCurrentTurn } from "utils/approval"

// isCurrentTurn for approvals saved before the column existed. For every record
// (reffId) that has approvals, the first active (not deleted, inactive null / false)
// approval in index order that is Pending gets isCurrentTurn = true and every other
// approval of the record false — the same rule the approval mutations apply
// (utils/approval refreshCurrentTurn). updatedAt is not touched. Idempotent.
const setApprovalCurrentTurn = async (context) => {
  const { mongo } = context
  const reffIds = (await mongo.Approval.distinct('reffId'))
    .filter(r => r !== undefined && r !== null && r !== '')
  // reffId may be stored as ObjectId or string: refresh each record once
  const uniqueReffIds = Array.from(new Set(reffIds.map(String)))

  let withTurn = 0
  for (const reffId of uniqueReffIds) {
    const current = await refreshCurrentTurn(mongo, reffId)
    if (current) withTurn += 1
  }

  const turnCount = await mongo.Approval.countDocuments({ isCurrentTurn: true })
  console.log(
    `setApprovalCurrentTurn: ${uniqueReffIds.length} record(s) refreshed, ` +
    `${withTurn} with a current turn (${turnCount} approval(s) with isCurrentTurn = true).`
  )
}

export default setApprovalCurrentTurn

// Run directly: yarn db:migrate:approvalCurrentTurn
if (require.main === module) {
  connectMongo().then(async context => {
    try {
      await setApprovalCurrentTurn(context)
      process.exit(0)
    } catch (err) {
      console.log(err)
      process.exit(1)
    }
  })
}
