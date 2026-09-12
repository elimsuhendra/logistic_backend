import EmailTemplate from 'email-templates'
import nodemailer from 'nodemailer'
const postmarkTransport = require('nodemailer-postmark-transport')

require('dotenv').config();

var path = require('path')

const transporter = nodemailer.createTransport(postmarkTransport({
  auth: {
    apiKey: process.env.MAIL_PASSWORD
  }
}))

const email = new EmailTemplate({
  message: {
    from: `${process.env.EMAIL_NAME} <${process.env.EMAIL_SUPPORT}>`
  },
  send: true,
  preview: true,
  transport: transporter,
  views: {
    root: path.join(__dirname, './templates'),
    options: {
      extension: 'ejs'
    }
  },
  juice: true,
  juiceResources: {
    preserveImportant: true,
    webResources: {
      relativeTo: path.join(__dirname, './templates')
    }
  }
})

export default email