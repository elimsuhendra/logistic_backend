// Shared normalizers for Settlement documents (used by the Settlement resolver
// and the cash request -> settlement migration).

export const num = (v, fallback = 0) => {
  if (v === undefined || v === null || v === '') return fallback
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

export function normalizeUjlDetails(list) {
  if (!Array.isArray(list)) return []
  return list.map(u => ({
    costId: (u && u.costId) || '',
    biaya: (u && u.biaya) || '',
    isCost: u && u.isCost !== undefined && u.isCost !== null ? Boolean(u.isCost) : true,
    nominal: num(u && u.nominal),
    uploadUrl: (u && u.uploadUrl) || '',
    isUploaded: Boolean((u && u.isUploaded) || (u && u.uploadUrl)),
    paymentDate: (u && u.paymentDate) || null,
    account: (u && u.account) || '',
    memo: (u && u.memo) || '',
  }))
}

// Signed sum of the Add Cost Peny. lines (cost adds, non-cost subtracts)
const sumUjl = list =>
  list.reduce((sum, u) => (u.isCost !== false ? sum + u.nominal : sum - u.nominal), 0)

export function normalizeSettlementItem(item, lineIndex) {
  const it = item || {}
  const ujlDetails = normalizeUjlDetails(it.ujlDetails)
  const kasbon = num(it.kasbon)
  const totalSettlement = ujlDetails.length > 0 ? sumUjl(ujlDetails) : num(it.totalSettlement)
  const loloRepairAdm = num(it.loloRepairAdm)
  const adminDepoTrf = num(it.adminDepoTrf)
  const loloRounding = num(it.loloRounding)
  return {
    jobPlanningId: it.jobPlanningId || null,
    lineIndex: Number.isInteger(it.lineIndex) ? it.lineIndex : lineIndex,
    customerId: it.customerId || null,
    consigneeId: it.consigneeId || null,
    destination: it.destination || it.daerah || '',
    qty: it.qty !== undefined && it.qty !== null && it.qty !== '' ? parseInt(it.qty, 10) || null : null,
    size: it.size !== undefined && it.size !== null && it.size !== '' ? num(it.size, null) : null,
    sizeMeasurement: it.sizeMeasurement || '',
    vehicleId: it.vehicleId || null,
    driverId: it.driverId || null,
    policeNo: it.policeNo || '',
    driver: it.driver || '',
    departureDate: it.departureDate || null,
    transferDate: it.transferDate || null,
    kasbon,
    settlementDate: it.settlementDate || null,
    voucherId: it.voucherId || null,
    voucherNo: it.voucherNo || '',
    addCostSettlement: ujlDetails.length > 0 ? totalSettlement : num(it.addCostSettlement),
    totalSettlement,
    ujlNote: it.ujlNote || '',
    ujlDetails,
    kasbonDiff: kasbon - totalSettlement,
    kasbonDiffNote: it.kasbonDiffNote || '',
    uploadUrl: it.uploadUrl || '',
    isUploaded: Boolean(it.isUploaded || it.uploadUrl),
    aju: it.aju || '',
    containerNo: it.containerNo || '',
    loloRepairAdm,
    adminDepoTrf,
    loloRounding,
    loloTotalCost: loloRepairAdm + adminDepoTrf + loloRounding,
  }
}

// Vouchers of a cash request settlement row: [{ voucherId, voucherNo, voucherTotal }]
export function normalizeSettlementVouchers(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(v => v && (v.voucherId || v.voucherNo))
    .map(v => ({
      voucherId: v.voucherId ? String(v.voucherId) : null,
      voucherNo: v.voucherNo || '',
      voucherTotal: num(v.voucherTotal),
    }))
}

// Row of a CashRequestSettlement: the Settlement row without ujlNote / ujlDetails,
// with vouchers. The row's total is the sum of its vouchers' voucherTotal (the
// row's own totalSettlement when it has no vouchers); kasbonDiff = kasbon - total.
export function normalizeCashRequestSettlementItem(item, lineIndex) {
  const it = item || {}
  // eslint-disable-next-line no-unused-vars
  const { ujlNote, ujlDetails, ...base } = normalizeSettlementItem(
    { ...it, ujlNote: undefined, ujlDetails: undefined },
    lineIndex
  )
  const vouchers = normalizeSettlementVouchers(it.vouchers)
  const totalSettlement =
    vouchers.length > 0 ? vouchers.reduce((sum, v) => sum + v.voucherTotal, 0) : base.totalSettlement
  return {
    ...base,
    vouchers,
    addCostSettlement: vouchers.length > 0 ? totalSettlement : base.addCostSettlement,
    totalSettlement,
    kasbonDiff: base.kasbon - totalSettlement,
  }
}

// True when a cash request line carries any Penyelesaian Supir data
export function hasDriverSettlementData(d) {
  if (!d || typeof d !== 'object') return false
  return Boolean(
    d.vehicleId || d.driverId || d.policeNo || d.driver || d.departureDate || d.transferDate ||
      d.settlementDate || d.ujlNote || d.kasbonDiffNote || d.uploadUrl ||
      num(d.kasbon) || num(d.totalSettlement) || num(d.addCostSettlement) ||
      (Array.isArray(d.ujlDetails) && d.ujlDetails.length > 0)
  )
}

// True when a cash request line carries any Penyelesaian Lolo data
export function hasLoloSettlementData(d) {
  if (!d || typeof d !== 'object') return false
  return Boolean(
    d.aju || d.containerNo || num(d.loloRepairAdm) || num(d.adminDepoTrf) || num(d.loloRounding)
  )
}
