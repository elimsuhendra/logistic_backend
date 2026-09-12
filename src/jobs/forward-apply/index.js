import { ObjectId } from 'mongodb'
import mongoConnector from "../../mongoConnector"

export default agenda => {
  try {
    agenda.define(`forward-apply-job`, async (job) => {
      const { mongo } = await mongoConnector()
      const { forwarder, candidateName, companyName, jobId, jobTitle } = job.attrs.data || {}
      agenda.now('forward-apply-job-email', {
        to: forwarder,
        subject: 'MTC - Job Application Submission',
        candidateName,
        companyName,
        jobTitle,
        jobId,
      })
    })
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error Status: 500 - ', err)
  }
}