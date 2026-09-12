require("dotenv").config()

import connectMongo from "src/mongoConnector"
import updateJobApplicantConsultantGroup from 'src/migrations/modification/updateJobApplicantConsultantGroup'
import updateJobOrderGroup from 'src/migrations/modification/updateJobOrderGroup'
import updateExternalSales from 'src/migrations/modification/updateExternalSales'
import updateCandidateContractStatus from 'src/migrations/modification/updateCandidateContractStatus'
import { updateTest } from 'utils/group'

const runIndexing = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Create migration.")
      console.log("\n")

      console.log('init updateJobApplicantConsultantGroup.')
      await updateJobApplicantConsultantGroup(context)
      console.log('init updateJobApplicantConsultantGroup done.')

      console.log('\n')
      console.log('init updateJobOrderGroup.')
      await updateJobOrderGroup(context)
      console.log('init updateJobOrderGroup done.')

      console.log('\n')
      console.log('init updateExternalSales.')
      await updateExternalSales(context)
      console.log('init updateExternalSales done.')

      console.log('\n')
      console.log('init updateCandidateContractStatus.')
      await updateCandidateContractStatus(context)
      console.log('init updateCandidateContractStatus done.')
      
      console.log('\n')
      console.log("Done!")
      console.log("\n")
      process.exit(0)
    })
  } catch (err) {
    console.log(err)
  }
}
runIndexing()