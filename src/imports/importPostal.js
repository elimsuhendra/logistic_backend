require("dotenv").config()
import fs from 'fs'
import path from "path"

import connectMongo from "src/mongoConnector"

const importPostalCodes = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Importing postal codes...")
      console.log("\n")

      const { mongo } = context

      try {
        await mongo.PostalCode.drop()
      } catch (err) {
        console.log(err)
      }
      
      try {
        await mongo.PostalCode.createIndex({ code: 1 })
      } catch (err) {
        console.log(err)
      }
 
      const normalizedPath = path.join(__dirname, "./data/postalCodes")
      const files = fs.readdirSync(normalizedPath)

      await Promise.all(files.map(async (file) => {
        const filePath = path.join(normalizedPath, file)
        const rawData = fs.readFileSync(filePath)
        const postalData = JSON.parse(rawData)

        const now = new Date().getTime()
        const bulkWriteArgs = postalData.map((postal, index) => ({
          updateOne: {
            filter: { code: postal['postal'] },
            update: {
              $set: {
                code: postal['postal'],
                address: postal['address'].replaceAll(`SINGAPORE ${postal['postal']}`, "").trim(),
                longitude: parseFloat(postal['longitude']),
                latitude: parseFloat(postal['latitude']),
                createdAt: now + index,
                updatedAt: null,
                deletedAt: null,
              }
            },
            upsert: true
          }
        }))
        await mongo.PostalCode.bulkWrite(bulkWriteArgs, { ordered: false })
      }))

      console.log("\n")
      console.log("Done!")
      process.exit(0)
    })
  } catch (err) {
    console.log(err)
  }

}
importPostalCodes()
