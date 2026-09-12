import { ObjectId } from 'mongodb'
import mongoConnector from "../../mongoConnector"

export default agenda => {
  try {
    agenda.define(`user-apply-job`, async (job) => {
      const { mongo } = await mongoConnector()
      const { to, fullName } = job.attrs.data || {}
      agenda.now('user-apply-job-email', {
        to,
        cc: '',
        bcc: '',
        subject: 'MTC - Job Application Submission',
        fullName
      })
    })
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error Status: 500 - ', err)
  }
}