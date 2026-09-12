require("dotenv").config()

import connectMongo from "src/mongoConnector"
import importUsers from "./users"
import importParameterTypes from './parameterTypes'
import importTenant from './tenant'

const loadSeeds = async () => {
  try {
    connectMongo().then(async (context) => {
      console.log("\n")
      console.log("Loading seeds.")
      console.log("\n")

      
      console.log('Importing Tenant.')
      const tenant = await importTenant(context)
      console.log('Tenant Imported')

      console.log('Importing Parameter Types.')
      const parameterTypes = await importParameterTypes(context)
      console.log('Parameter Types Imported')

      console.log("Importing Users.")
      const users = await importUsers(context)
      console.log("Users Imported.")
      console.log("\n")
      console.log("Done!")
      console.log("\n")
      process.exit(0)
    })
  } catch (err) {
    console.log(err)
  }
  
}
loadSeeds()
