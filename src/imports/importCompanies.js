require("dotenv").config()

import connectMongo from "src/mongoConnector"
import companyData from "./data/companies.json"
import { addNewParameter } from "utils/parameter"
const runImport = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Companies Importing...")
      console.log("\n")

      const { mongo } = context


      const industries = Array.from(new Set(companyData.map(company => company.Industry)))

      await industries.reduce(async (memo, industry) => {
        return [
          ...(await memo),
          await addNewParameter({
            typeLabel: 'Industry',
            typeCode: 'industry',
            valueCode: industry
          }, { mongo })
        ]
      }, [])

      await Promise.all(companyData.map(async (company) => {
        await mongo.Company.updateOne({
          name: String(company['Company Name']).trim()
        }, {
          $set: {
            name: String(company['Company Name']).trim(),
            url: String(company['URL']),
            industry: String(company['Industry']),
            contacts: [{}],
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
