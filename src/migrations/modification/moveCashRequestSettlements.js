require("dotenv").config()

import connectMongo from "src/mongoConnector"
import {
  num,
  normalizeSettlementItem,
  hasDriverSettlementData,
  hasLoloSettlementData,
} from 'utils/settlement'

// Moves settlement data stored on cashRequests into the settlements collection:
//  - jobSettlement / sparePartSettlement / otherSettlement / driverSettlement / loloSettlement
//    become Settlement totals (types Job / SparePart / Other / Driver / Lolo)
//  - per-line Penyelesaian Supir / Lolo fields in jobs[].destinations become Settlement items
// Then removes those fields from the cash request. Idempotent: a type that already has a
// Settlement document is not created again.

const TOTAL_KEYS = {
  Job: 'jobSettlement',
  SparePart: 'sparePartSettlement',
  Other: 'otherSettlement',
  Driver: 'driverSettlement',
  Lolo: 'loloSettlement',
}

const CASH_LINE_KEYS = [
  'jobPlanningId', 'customerId', 'consigneeId', 'destination', 'nominal', 'qty', 'size', 'sizeMeasurement',
]

const pickCashLine = d =>
  d && typeof d === 'object'
    ? CASH_LINE_KEYS.reduce((acc, k) => (k in d ? { ...acc, [k]: d[k] } : acc), {})
    : d

function collectItems(cashRequest, predicate) {
  const items = []
  ;(Array.isArray(cashRequest.jobs) ? cashRequest.jobs : []).forEach(job => {
    ;(Array.isArray(job && job.destinations) ? job.destinations : []).forEach((d, lineIndex) => {
      if (!predicate(d)) return
      items.push(
        normalizeSettlementItem(
          {
            ...d,
            jobPlanningId: d.jobPlanningId || job.jobPlanningId || null,
            customerId: d.customerId || job.customerId || null,
            consigneeId: d.consigneeId || job.consigneeId || null,
          },
          lineIndex
        )
      )
    })
  })
  return items
}

const moveCashRequestSettlements = async context => {
  const { mongo } = context
  const cashRequests = await mongo.CashRequest.find({ deletedAt: null }).toArray()
  let created = 0
  let cleaned = 0

  for (const cr of cashRequests) {
    const crId = String(cr._id)
    const itemsByType = {
      Driver: collectItems(cr, hasDriverSettlementData),
      Lolo: collectItems(cr, hasLoloSettlementData),
    }

    for (const [type, key] of Object.entries(TOTAL_KEYS)) {
      const items = itemsByType[type] || []
      const storedTotal = cr[key]
      if (items.length === 0 && !num(storedTotal)) continue

      const exists = await mongo.Settlement.findOne({ cashRequestId: crId, settlementType: type, deletedAt: null })
      if (exists) continue

      const now = new Date().getTime()
      await mongo.Settlement.insertOne({
        accountId: cr.accountId || null,
        cashRequestId: crId,
        cashNo: cr.cashNo || null,
        settlementType: type,
        items,
        total:
          storedTotal !== undefined && storedTotal !== null
            ? num(storedTotal)
            : type === 'Lolo'
            ? items.reduce((s, i) => s + i.loloTotalCost, 0)
            : items.reduce((s, i) => s + i.totalSettlement, 0),
        note: '',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      created += 1
    }

    // Strip the moved fields from the cash request
    const hasLegacyTotals = Object.values(TOTAL_KEYS).some(k => k in cr)
    const hasLegacyLines = (cr.jobs || []).some(j =>
      (j && j.destinations || []).some(d => hasDriverSettlementData(d) || hasLoloSettlementData(d))
    )
    if (!hasLegacyTotals && !hasLegacyLines) continue

    const update = {
      $unset: Object.values(TOTAL_KEYS).reduce((acc, k) => ({ ...acc, [k]: '' }), {}),
    }
    if (Array.isArray(cr.jobs)) {
      update.$set = {
        jobs: cr.jobs.map(j =>
          j && Array.isArray(j.destinations) ? { ...j, destinations: j.destinations.map(pickCashLine) } : j
        ),
      }
      if (Array.isArray(cr.destinations)) update.$set.destinations = cr.destinations.map(pickCashLine)
    }
    await mongo.CashRequest.updateOne({ _id: cr._id }, update)
    cleaned += 1
  }

  console.log(`moveCashRequestSettlements: ${created} settlement(s) created, ${cleaned} cash request(s) cleaned.`)
}

export default moveCashRequestSettlements

// Run directly: yarn db:migrate:settlements
if (require.main === module) {
  connectMongo().then(async context => {
    try {
      await moveCashRequestSettlements(context)
      process.exit(0)
    } catch (err) {
      console.log(err)
      process.exit(1)
    }
  })
}
