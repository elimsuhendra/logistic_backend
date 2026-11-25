import { ObjectId } from 'mongodb'
import _ from 'lodash'

// approvalEnum value of a stored approval status: Cancelled was renamed to
// Revision (yarn db:migrate:approvalRevision converts the stored documents)
export const toApprovalStatus = status => (status === 'Cancelled' ? 'Revision' : status || null)

// isCurrentTurn: the approver whose turn it is to act on a record. Among the record's
// active approvals (reffId, not deleted, inactive null / false) in approval order
// (index, then createdAt), the first one that is Pending is the current turn; every
// other approval of the record (old / deleted ones included) is set to false. No
// Pending approval (draft, Revision, all approved) → nobody's turn.
// updatedAt is not touched (updateStatusOperation reads the Approved approval's updatedAt).
// Returns the current-turn approval, or null.
export async function refreshCurrentTurn(mongo, reffId) {
  if (reffId === undefined || reffId === null || reffId === '') return null
  const id = String(reffId)
  const reffMatch = ObjectId.isValid(id) ? { $in: [ObjectId(id), id] } : id
  const active = await mongo.Approval.find(
    { reffId: reffMatch, deletedAt: null, inactive: { $ne: true } },
    { projection: { approval: 1, index: 1, createdAt: 1 } }
  ).toArray()
  const ordered = _.sortBy(active, [
    a => (a.index === undefined || a.index === null ? Number.MAX_SAFE_INTEGER : a.index),
    a => new Date(a.createdAt || 0).getTime(),
  ])
  const current = ordered.find(a => toApprovalStatus(a.approval) === 'Pending') || null

  await mongo.Approval.updateMany(
    { reffId: reffMatch, ...(current ? { _id: { $ne: current._id } } : {}) },
    { $set: { isCurrentTurn: false } }
  )
  if (current) {
    await mongo.Approval.updateOne({ _id: current._id }, { $set: { isCurrentTurn: true } })
  }
  return current
}
