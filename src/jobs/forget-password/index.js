import { ObjectId } from 'mongodb'
import mongoConnector from "../../mongoConnector"

export default agenda => {
  try {
    agenda.define(`forget-password`, async (job) => {
      const { mongo } = await mongoConnector()
      const { to, email, fullName, token, } = job.attrs.data || {}
      agenda.now('forget-password-email', {
        to, email, fullName, token,
        cc: '',
        bcc: '',
        subject: 'MTC - Forget Password',
      })
    })
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error Status: 500 - ', err)
  }
}