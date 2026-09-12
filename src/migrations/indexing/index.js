require("dotenv").config()

import connectMongo from "src/mongoConnector"

const runIndexing = async () => {
  try {
    connectMongo().then(async (context) => {
      const { mongo } = context
      console.log("\n")
      console.log("Create index.")
      console.log("\n")

      console.log("Init create index jobApplicant.")
      await mongo.JobApplicant.createIndex(
        { 'offer.startDate': 1, 'offer.replacementCandidateStartDate': 1, 'offer.workType': 1, 'offer.payrollCycleStartDate': 1, 'offer.payrollCycleEndDate': 1, 'offer.workType': 1, 'consultantGroupId': 1, 'coBrokeConsultantGroupId': 1},
        { name: "migration-updateJobApplicantConsultantGroup-index" }
      )
      console.log("Init create index jobApplicant done.")

      console.log("Init create index externalSale.")
      await mongo.ExternalSale.createIndex(
        { ownerGroupId: 1, updatedAt: 1, createdAt: 1},
        { name: "migration-updateExternalSales-index" }
      )
      console.log("Init create index externalSale done.")

      console.log("Init create index jobOrder.")
      await mongo.JobOrder.createIndex(
        { ownerGroupId: 1, updatedAt: 1, createdAt: 1},
        { name: "migration-updateJobOrderGroup-index" }
      )
      console.log("Init create index jobOrder done.")

     
      console.log("Done!")
      console.log("\n")
      process.exit(0)
    })
  } catch (err) {
    console.log(err)
  }
}
runIndexing()
