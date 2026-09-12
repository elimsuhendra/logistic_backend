export default (agenda, mailer) => {
  try {
    agenda.define('sample-email', (job, done) => {
      const { to, cc, bcc, attachments, ...locals } = job.attrs.data

      mailer
        .send({
          template: 'sample',
          message: {
            to,
            cc,
            bcc,
            attachments
          },
          locals
        })
        .then(rs => {
          console.log('✅ ✅ ✅ Sent mail successfully! - ', rs)
        })
        .catch(err => {
          console.log('⛔️ ⛔️ ⛔️ Failure sending email! - ', err)
        })
      done()
    })
  } catch (err) {
    console.log(err)
  }
}