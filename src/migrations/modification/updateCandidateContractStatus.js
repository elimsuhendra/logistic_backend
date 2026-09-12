require("dotenv").config()
import moment from 'moment'
import { ObjectId } from 'mongodb'
import { getGroupByUserId } from 'utils/group'

import connectMongo from "src/mongoConnector"

// update candidate contract status, isPermanant
const updateCandidateContractStatus = async (context) => {
  try {
    console.log("updateCandidateContractStatus")
    const { mongo, dataloaders } = context

    // get all candidates active and isPermanent and isTemporary is null
    // find candidate in jobApplicant, if found set isPermanant true
    let candidates = await mongo.People.find({isPermanent: null, isTemporary: null, deleteAt: null}).toArray()
    
    let variables = []
    for(const candidate of candidates){
      const jobApplicants = await mongo.JobApplicant.find({candidateId: candidate._id}).toArray()
     
      // if candiddate not in jobApplicant then isPermanent true
      if(jobApplicants.length == 0){

        variables.push({
          id: candidate._id,
          isPermanent: true
        })
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
                "isPermanent": item.isPermanent,
                "updatedAt": moment().valueOf()
              }
            }
          }
        }
      })
      const bulkWrite = await mongo.People.bulkWrite(bulkArgs, {ordered: true})
      console.log("bulkWrite", bulkWrite)
    }
  } catch (err) {
    console.log(err)
  }
}

// updateCandidateContractStatus()
export default updateCandidateContractStatus;
