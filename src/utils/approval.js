// approvalEnum value of a stored approval status: Cancelled was renamed to
// Revision (yarn db:migrate:approvalRevision converts the stored documents)
export const toApprovalStatus = status => (status === 'Cancelled' ? 'Revision' : status || null)
