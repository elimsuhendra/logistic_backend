import requiresAuth from 'src/utils/permissions'
import { generateVoucherNo } from 'src/utils/voucher'

export default {
  Query: {
    // Preview of the number the next voucher of the account gets; createVoucher
    // must call generateVoucherNo again when saving, in case another voucher took it.
    getNextVoucherNo: requiresAuth.createResolver(
      async (parent, { accountId, paymentDate }, { mongo }) => {
        return await generateVoucherNo(mongo, { accountId, date: paymentDate })
      }
    ),
  },
}
