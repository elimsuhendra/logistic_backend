require("dotenv").config()
import moment from 'moment'
import { ObjectId } from 'mongodb'
import { getGroupByUserId } from 'utils/group'

import connectMongo from "src/mongoConnector"

const updateExternalSales = async (context) => {
  try {
    console.log("updateExternalSales")
    const { mongo, dataloaders } = context

    // moment.tz.setDefault("Asia/Singapore");
    const formatStartDate = moment().startOf('year').valueOf("YYYY/MM/DD")
    const formatEndDate = moment().endOf('year').valueOf("YYYY/MM/DD")

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

    let externalSales = await mongo.ExternalSale.find(filter).toArray()
    let variables = []
    let externalSalesIds = []

    for (const externalSale of externalSales) {      
      let ownerGroupIdArr = await getGroupByUserId({mongo, userId: externalSale.ownerId.toString()})

      if(!!ownerGroupIdArr /*&& !externalSale.ownerGroupId*/){
        variables.push({
          id: ObjectId(externalSale._id),
          ownerGroupId: ownerGroupIdArr && ownerGroupIdArr._id.toString()
        })

        externalSalesIds.push(externalSale._id)
      }
    }

    // bulk update if data found
    if(variables && variables.length > 0){
      const bulkArgs = variables.map(item => {
        return {
          updateOne: {
            filter: {_id: item.id},
            update: {
              $set: {
                "ownerGroupId": ObjectId(item.ownerGroupId),
                "updatedAt": moment().valueOf()
              }
            }
          }
        }
      })
      const bulkWrite = await mongo.ExternalSale.bulkWrite(bulkArgs, {ordered: true})
      console.log("bulkWrite", bulkWrite)
    }
  } catch (err) {
    console.log(err)
  }
}

// updateExternalSales()
export default updateExternalSales;
