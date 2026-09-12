
import { formatSlug } from 'utils/common'

export default function buildIndustries() {
  const dataStr = `
    Accounting/Tax Services
    Advertising/Marketing/PR
    Agriculture/Poultry/Fisheries
    Apparel
    Architecture/Interior Design
    Arts/Design/Fashion
    Automobile/Automotive
    Aviation/Airline
    Banking/Finance
    Beauty/Fitness
    BioTech/Pharmaceutical
    Business/Mgmt Consulting
    Call Center/BPO
    Chemical/Fertilizers
    Construction/Building
    Consumer Products/FMCG
    Education
    Electrical & Electronics
    Engineering/Technical Consulting
    Entertainment/Media
    Environment/Health/Safety
    Exhibitions/Event Mgmt
    Food & Beverage
    Gems/Jewellery
    General & Wholesale Trading
    Government/Defence
    Healthcare/Medical
    Heavy Industrial/Machinery
    Hotel/Hospitality
    HR Mgmt/Consulting
    Insurance
    IT/Hardware
    IT/Software
    Journalism
    Law/Legal
    Library/Museum
    Manufacturing/Production
    Marine/Aquaculture
    Mining
    Oil/Gas/Petroleum
    Polymer/Rubber
    Printing/Publishing
    Property/Real Estate
    R&D
    Repair/Maintenance
    Retail/Merchandise
    Science & Technology
    Security/Law Enforcement
    Semiconductor
    Social Services/NGO
    Sports
    Stockbroking/Securities
    Telecommunication
    Textiles/Garment
    Tobacco
    Transportation/Logistics
    Travel/Tourism
    Utilities/Power
    Wood/Fibre/Paper
    Others
  `

  const dataArr = dataStr.split("\n")
  .map(e => e.trim())
  .filter(e => !!e)

  return dataArr.map(e => ({
    "Type": "Industry",
    "code": e,
    "label": e
  }))
}