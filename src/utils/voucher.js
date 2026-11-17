import moment from 'moment'
import { ObjectId } from 'mongodb'
import { sanitizeRegex } from 'src/utils/common'

// Voucher Kas Keluar code inside the voucher number
export const VOUCHER_CODE = 'VKK-K'
// Year/month of the number follows Indonesian time (WIB)
const VOUCHER_UTC_OFFSET = '+07:00'

// [account.initial]/VKK-K/[yy][mm], e.g. PJT/VKK-K/2611
export function buildVoucherPrefix(initial, date) {
  const yymm = moment(date || Date.now()).utcOffset(VOUCHER_UTC_OFFSET).format('YYMM')
  return `${initial}/${VOUCHER_CODE}/${yymm}`
}

// Next voucher number of the account for the month of `date`:
// [account.initial]/VKK-K/[yy][mm]/[0001..]. The 4-digit number increments from
// the last voucherNo with the same prefix, so it starts again at 0001 each month.
export async function generateVoucherNo(mongo, { accountId, date } = {}) {
  if (!accountId || !ObjectId.isValid(String(accountId))) {
    throw new Error('A valid accountId is required to generate the voucher number.')
  }
  const account = await mongo.Account.findOne({ _id: ObjectId(String(accountId)) })
  const initial = account && account.initial ? String(account.initial).trim().toUpperCase() : ''
  if (!initial) {
    throw new Error('The account has no initial set; it is needed for the voucher number.')
  }

  const prefix = buildVoucherPrefix(initial, date)
  const [last] = await mongo.Voucher.find(
    { voucherNo: { $regex: `^${sanitizeRegex(prefix)}/[0-9]+$`, $options: 'i' }, deletedAt: null },
    { projection: { voucherNo: 1 } }
  )
    // numeric ordering so 10000 sorts after 9999
    .collation({ locale: 'en', numericOrdering: true })
    .sort({ voucherNo: -1 })
    .limit(1)
    .toArray()

  const lastNumber = last ? parseInt(String(last.voucherNo).split('/').pop(), 10) || 0 : 0
  return `${prefix}/${String(lastNumber + 1).padStart(4, '0')}`
}
