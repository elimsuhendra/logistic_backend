require("dotenv").config()

import connectMongo from "src/mongoConnector"

const runIndexing = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Reset index.")
      console.log("\n")

      const { mongo } = context

      // await mongo.Vehicle.dropIndexes()
      // await mongo.VehicleTracking.dropIndexes()

     
      console.log("Done!")
      console.log("\n")
      process.exit(0)
    })
  } catch (err) {
    console.log(err)
  }
}
runIndexing()
