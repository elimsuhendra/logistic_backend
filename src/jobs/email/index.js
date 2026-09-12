import fs from 'fs'
import path from 'path'
import mailer from './mailer'
import sample from './sample'

const basename = path.basename(__filename)
const getTemplateFiles = () => {
  return fs.readdirSync(path.join(__dirname, 'templates')).map(file => {
    if (fs.lstatSync(path.join(__dirname, 'templates', file)).isDirectory()) return file
  })
}

const getEjectFiles = () => {
  return fs
    .readdirSync(__dirname)
    .filter(file => {
      return file.indexOf('.') !== 0 && file !== basename && file.slice(-3) === '.js'
    })
    .map(file => file.slice(0, -3))
}

const defineSendMailJob = (agenda, file) => {
  try {
    agenda.define(`${file}-email`, (job, done) => {
      const { to, cc, bcc, attachments, ...locals } = job.attrs.data || {}
      mailer
        .send({
          template: file,
          message: {
            to,
            cc,
            bcc,
            attachments
          },
          locals
        })
        .then(rs => {
          // console.log('✅ ✅ ✅ Sent mail successfully! - ')
          // console.log(rs)
          // console.log('res.originalMessage', res.originalMessage)
        })
        .catch(err => {
          console.log('⛔️ ⛔️ ⛔️ Failure sending email! - ', err)
        })
      done()
    })
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error Status: 500 - ', err)
  }
}

export default agenda => {
  try {
    // Define all templates for Agenda exclude exject files
    const files = getTemplateFiles()
    const ejectFiles = getEjectFiles()
    files.forEach(file => {
      if (ejectFiles.includes(file)) return
      defineSendMailJob(agenda, file)
    })
    // Eject file must be pass 2 agrs are Agenda and Mailer
    sample(agenda, mailer)
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error Status: 500 - ', err)
  }
}