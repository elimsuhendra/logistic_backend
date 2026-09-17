/* es-lint disable */
require('dotenv').config()
import { Logger, MongoClient } from "mongodb"
import { mongoURI } from "utils"
import Utils from "utils/index"
/**
 * Export a function that connects to the db and returns the collections
 * your resolvers will use.
 */
export default async () => {
  /**
   * Specify the url for connecting to the desired MongoDB instance.
   * This is the default url usually available, but feel free to replace
   * it with your own if different.
   */
  Utils() // load String prototypes
  // Connecting to MongoDB is an async operation, so we need to wait here.
  const mongoClient = await MongoClient.connect(
    mongoURI({
      protocol: process.env.MONGO_DB_PROTOCOL,
      name: process.env.MONGO_DB_NAME,
      host: process.env.MONGO_DB_HOST,
      username: process.env.MONGO_DB_USERNAME,
      password: process.env.MONGO_DB_PASSWORD,
      params: process.env.MONGO_DB_PARAMS,
    }),
    {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  )
  const db = mongoClient.db(process.env.MONGO_DB_NAME)

  if (process.env.MONGO_DB_DEBUG_LOG === "VERBOSE") {
    let logCount = 0
    Logger.setCurrentLogger((msg, state) => {
      console.log(`REQUEST ${++logCount}: ${msg}`)
    })
    Logger.setLevel("debug")
    Logger.filter("class", ["Cursor", "Server"])
    // Logger.filter('class', ['Cursor'])
  }

  return {
    mongo: {
      AppSetting: db.collection("appSettings"),
      User: db.collection("users"),
      Account: db.collection("accounts"),
      Company: db.collection("companies"),
      People: db.collection("candidates"),
      Photo: db.collection("photos"),
      ParameterType: db.collection("parameterTypes"),
      Document: db.collection("documents"),
      Note: db.collection("notes"),
      Activity: db.collection("activities"),
      Tenant: db.collection("tenants"),
      PeopleMessage: db.collection("peopleMessages"),
      PeopleEmail: db.collection("peopleEmails"),
      JobOrder: db.collection("jobOrders"),
      JobPlanning: db.collection("jobPlannings"),
      Workflow: db.collection("workflows"),
      JobApplicant: db.collection("jobApplicants"),
      Report: db.collection("reports"),
      EmailEnquiry: db.collection("emailEnquiries"),
      EmailForwarder: db.collection("emailForwarders"),
      Group: db.collection("groups"),
      Team: db.collection("teams"),
      Library: db.collection("libraries"),
      RawCandidate: db.collection("rawCandidates"),
      PersonNote: db.collection("personNotes"),
      ExternalSale: db.collection("externalSales"),
      Article: db.collection("articles"),
      PostalCode: db.collection("postalCodes"),
      Forecast: db.collection("forecasts"),
      ForecastRequest: db.collection("forecastRequests"),
      ForecastGroup: db.collection("forecastGroups"),
      UserSalary: db.collection("userSalaries"),
      Experience: db.collection("experiences"),
      Skill: db.collection("skills"),
      Institution: db.collection("institutions"),
      SalesLog: db.collection("salesLogs"),
      SalesLogDetail: db.collection("salesLogDetails")
    },
    db,
  }
}
