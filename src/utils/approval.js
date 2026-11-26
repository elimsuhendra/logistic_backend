import { ObjectId } from 'mongodb'
import _ from 'lodash'

// approvalEnum value of a stored approval status: Cancelled was renamed to
// Revision (yarn db:migrate:approvalRevision converts the stored documents)
export const toApprovalStatus = status => (status === 'Cancelled' ? 'Revision' : status || null)

const reffMatchOf = reffId => {
  const id = String(reffId)
  return ObjectId.isValid(id) ? { $in: [ObjectId(id), id] } : id
}

// A record's active approvals (reffId, not deleted, inactive null / false) in approval
// order: index, then createdAt
async function orderedActiveApprovals(mongo, reffId) {
  const active = await mongo.Approval.find(
    { reffId: reffMatchOf(reffId), deletedAt: null, inactive: { $ne: true } },
    { projection: { approval: 1, index: 1, createdAt: 1 } }
  ).toArray()
  return _.sortBy(active, [
    a => (a.index === undefined || a.index === null ? Number.MAX_SAFE_INTEGER : a.index),
    a => new Date(a.createdAt || 0).getTime(),
  ])
}

// Statuses of an approver who has already decided; such an approval is never reset
const DECIDED_STATUSES = ['Approve', 'Approved', 'Rejected', 'Revision']

// After an approver chose "Approve" (passes it on): the next active approver of the
// record in approval order becomes Pending, unless that approver has already decided.
// Returns the approval set to Pending, or null (last approver / already decided).
export async function setNextApproverPending(mongo, approval) {
  if (!approval || approval.reffId === undefined || approval.reffId === null) return null
  const ordered = await orderedActiveApprovals(mongo, approval.reffId)
  const position = ordered.findIndex(a => String(a._id) === String(approval._id))
  const next = position >= 0 ? ordered[position + 1] : null
  if (!next || DECIDED_STATUSES.includes(toApprovalStatus(next.approval))) return null
  await mongo.Approval.updateOne(
    { _id: next._id },
    { $set: { approval: 'Pending', updatedAt: new Date().getTime() } }
  )
  return next
}

// isCurrentTurn: the approver whose turn it is to act on a record. Among the record's
// active approvals (reffId, not deleted, inactive null / false) in approval order
// (index, then createdAt), the first one that is Pending is the current turn; every
// other approval of the record (old / deleted ones included) is set to false. No
// Pending approval (draft, Revision, all approved) → nobody's turn.
// updatedAt is not touched (updateStatusOperation reads the Approved approval's updatedAt).
// Returns the current-turn approval, or null.
export async function refreshCurrentTurn(mongo, reffId) {
  if (reffId === undefined || reffId === null || reffId === '') return null
  const reffMatch = reffMatchOf(reffId)
  const ordered = await orderedActiveApprovals(mongo, reffId)
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
