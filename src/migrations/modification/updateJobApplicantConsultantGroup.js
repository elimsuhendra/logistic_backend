require("dotenv").config()
import moment from 'moment'
import { ObjectId } from 'mongodb'
import { getGroupByUserId } from 'utils/group'

import connectMongo from "src/mongoConnector"

const updateJobApplicantConsultantGroup = async (context) => {
  try {
    console.log("updateJobApplicantConsultantGroup")
    const { mongo, dataloaders } = context

    // moment.tz.setDefault("Asia/Singapore");
    const formatStartDate = moment().startOf('year').valueOf("YYYY/MM/DD")
    const formatEndDate = moment().endOf('year').valueOf("YYYY/MM/DD")

    // found data where const
    let jobApplicantFilters = {
      $and: [
        // {"offer.consultantGroupId": null},
        {$or: [
            {
              "$or": [
                {'offer.startDate': {
                  $gte: formatStartDate,
                  $lte: formatEndDate
                }},
                {'offer.replacementCandidateStartDate': {
                  $gte: formatStartDate,
                  $lte: formatEndDate
                }},
              ],
              "offer.workType": {$eq: "Permanent"}
            },
            {
              "$and": [
                {
                  'offer.payrollCycleStartDate': {
                    $lte: formatEndDate,
                  }
                },
                {
                  'offer.payrollCycleEndDate': {
                    $gte: formatStartDate
                  }
                },
                {"offer.workType": {$ne: "Permanent"}}
              ]
            }
        ]}
      ]
    }

    let jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).toArray()
    let variables = []
    let jobApplicantIds = []

    for (const jobApplicant of jobApplicants) {
      let consultantGroupIdArr = await getGroupByUserId({mongo, userId: jobApplicant.offer.consultantId.toString()})
      let coBrokeConsultantGroupIdArr = jobApplicant.offer.coBrokeConsultantId ? await getGroupByUserId({mongo, userId: jobApplicant.offer.coBrokeConsultantId.toString()}) : null

      if(!!consultantGroupIdArr /*&& !jobApplicant.consultantGroupId*/){
        variables.push({
          id: ObjectId(jobApplicant._id),
          consultantGroupId: consultantGroupIdArr && consultantGroupIdArr._id.toString(),
          coBrokeConsultantGroupId: coBrokeConsultantGroupIdArr && coBrokeConsultantGroupIdArr._id.toString()
        })
      }

      jobApplicantIds.push(jobApplicant._id)
    }

    // bulk update if data found
    if(variables && variables.length > 0){
      const bulkArgs = variables.map(item => {
        return {
          updateOne: {
            filter: {_id: item.id},
            update: {
              $set: {
                "offer.consultantGroupId": item.consultantGroupId,
                "offer.coBrokeConsultantGroupId": item.coBrokeConsultantGroupId,
                "updatedAt": moment().valueOf()
              }
            }
          }
        }
      })
      const bulkWrite = await mongo.JobApplicant.bulkWrite(bulkArgs, {ordered: true})
      console.log("bulkWrite", bulkWrite)
    }
  } catch (err) {
    console.log(err)
  }
}

// updateJobApplicantConsultantGroup()
export default updateJobApplicantConsultantGroup;
