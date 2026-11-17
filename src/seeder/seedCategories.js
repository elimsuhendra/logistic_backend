require("dotenv").config()

import connectMongo from "src/mongoConnector"
import importCategories from "./categories"

// Seeds only the Category collection: yarn db:seed:categories
const seedCategories = async () => {
  try {
    const context = await connectMongo()
    console.log("Importing Categories.")
    const categories = await importCategories(context)
    console.log(`Categories Imported (${categories.length} voucher accounts).`)
    process.exit(0)
  } catch (err) {
    console.log(err)
    process.exit(1)
  }
}

seedCategories()
