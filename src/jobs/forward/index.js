import { ObjectId } from 'mongodb'
import mongoConnector from "../../mongoConnector"

async function userIds (mongo, userIds) {
  return await mongo.User.find({ 
    _id: { 
      $in: userIds.map(i => ObjectId(i))
    },
    deletedAt: null
  }).toArray() || null
}

export default agenda => {
  try {
    agenda.define(`contact-us-forward`, async (job) => {
      const { mongo } = await mongoConnector()
      const { emailEnquiryId } = job.attrs.data || {}
      const emailEnquiry = ObjectId.isValid(emailEnquiryId) ? await mongo.EmailEnquiry.findOne({_id: ObjectId(emailEnquiryId)}) : null        
      if (!emailEnquiry) return
      const forwarders = await mongo.EmailForwarder.find({ deletedAt: null }).toArray()
      forwarders.forEach(forwarder => {
        agenda.now('forward-email', {
          to: forwarder.email,
          cc: '',
          bcc: '',
          subject: 'MTC - Contact Us Enquiry',
          emailEnquiry
        })
      })
    })
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error Status: 500 - ', err)
  }
}