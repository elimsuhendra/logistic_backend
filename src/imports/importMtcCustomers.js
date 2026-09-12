require("dotenv").config()

import { ObjectId } from "mongodb"
import connectMongo from "src/mongoConnector"
import companyData from "./data/mtc-customers.json"
const runImport = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Companies Importing...")
      console.log("\n")

      const { mongo } = context

      await Promise.all(companyData.map(async (company) => {
        await mongo.Company.updateOne({
          name: String(company['Customer']).trim()
        }, {
          $set: {
            name: String(company['Customer']).trim(),
            url: 'https://example.com',
            industry: 'Retail/Merchandise',
            contacts: [{
              id: new ObjectId(),
              fullName: String(company['Full Name']).trim(),
              designation: 'Senior HR Executive',
              email: '',
              hpNo: '',
              gender: '',
              isMain: true,
              notes: '',
              position: 0
            }],
            addresses: [{
              id: new ObjectId(),
              country: 'SG',
              address: company['Address'],
              postal: company['Postal Code'],
              position: 0,
            }],
            placementFees: [],
            status: 'ACTIVE'
          }
        }, {
          upsert: true
        })
      }))

      console.log("\n")
      console.log("Done!")
      console.log("\n")
      process.exit(0)
    })
  } catch (err) {
    console.log(err)
  }
}

runImport()
