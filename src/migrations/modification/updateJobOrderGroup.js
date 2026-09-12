require("dotenv").config()
import moment from 'moment'
import { ObjectId } from 'mongodb'
import { getGroupByUserId } from 'utils/group'

import connectMongo from "src/mongoConnector"

const updateJobOrderGroup = async (context) => {
  try {
    console.log("updateJobOrderGroup")
    const { mongo, dataloaders } = context

    // moment.tz.setDefault("Asia/Singapore");
    const formatStartDate = moment().startOf('year').valueOf()
    const formatEndDate = moment().endOf('year').valueOf()

    // found data where const
    let filter = {
        // ownerGroupId: null,
        $or: [
          {'updatedAt': {
              $gte: formatStartDate,
              $lte: formatEndDate
          }},
          {'createdAt': {
              $gte: formatStartDate,
              $lte: formatEndDate
          }}
        ]          
    }

    let jobOrders = await mongo.JobOrder.find(filter).toArray()
    let variables = []
    let jobOrderIds = []

    for (const jobOrder of jobOrders) {      
      let ownerGroupIdArr = await getGroupByUserId({mongo, userId: jobOrder.ownerId.toString()})
      if(!!ownerGroupIdArr /*&& !jobOrder.ownerGroupId*/){
        variables.push({
          id: ObjectId(jobOrder._id),
          ownerGroupId: ownerGroupIdArr && ownerGroupIdArr._id.toString()
        })

        jobOrderIds.push(jobOrder._id)
      }
    }
    // bulk update if data found
    if(variables && variables.length > 0){
      const bulkArgs = variables.map(item => {
        return {
          updateOne: {
            filter: {
              _id: item.id},
            update: {
              $set: {
                "ownerGroupId": ObjectId(item.ownerGroupId),
                "updatedAt": moment().valueOf()
              }
            }
          }
        }
      })
      const bulkWrite = await mongo.JobOrder.bulkWrite(bulkArgs, {ordered: true})
      console.log("bulkWrite", bulkWrite)
    }
  } catch (err) {
    console.log(err)
  }
}


// updateJobOrderGroup()
export default updateJobOrderGroup;
