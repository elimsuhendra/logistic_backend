require("dotenv").config()

import { ObjectId } from "mongodb"
import connectMongo from "src/mongoConnector"
import XLSX from "xlsx"
import _ from "lodash"
import { resolve } from "path"

async function getDataFromFile(filePath) {
  let workbook = XLSX.readFile(filePath.toString(), {
    sheetStubs: true,
    raw: true,
    type: "string"
  })
  let firstSheetName = workbook.SheetNames[0]
  let worksheet = workbook.Sheets[firstSheetName]
  const worksheetJson = XLSX.utils.sheet_to_json(worksheet, { defval: null })
  return worksheetJson
}

const runImport = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Customers Importing...")
      console.log("\n")
      const companyData = await getDataFromFile(resolve(__dirname, "./data/customers.xlsx"))
      const { mongo } = context

      await Promise.all(companyData.map(async (company) => {
        await mongo.Company.updateOne({
          name: String(company['Customer']).trim()
        }, {
          $set: {
            deletedAt: null,
          },
          $setOnInsert: {
            name: String(company['Customer']).trim(),
            url: '',
            industry: '',
            contacts: [{
              id: new ObjectId(),
              fullName: '',
              designation: '',
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
              address: '',
              postal: '',
              position: 0,
            }],
            placementFees: [],
            status: 'INACTIVE',
            createdAt: Date.now(),
          },
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
