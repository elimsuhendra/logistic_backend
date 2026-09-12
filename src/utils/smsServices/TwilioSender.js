
import MessageSender from "./MessageSender"
import twilio from "twilio"

export default class TwilioSender extends MessageSender {
  constructor() {
    super()
    this.config({
      accountSid: process.env.TWILIO_ACCOUNT_ID,
      authToken: process.env.TWILIO_AUTH_TOKEN,
      serviceId: process.env.TWILIO_SERVICE_ID,
    })
    this.client = twilio(this.configuration.accountSid, this.configuration.authToken)
  }

  async send(args) {
    const { to, text } = args
    try {
      await this.client.messages
        .create({
          body: text,
          messagingServiceSid: this.configuration.serviceId,
          to: `+${to}`
        })

      console.log(`\nSent sms to +${to} with content:\n${text}\n`)
      return {
        success: true
      }
    } catch (e) {
      console.log("[ERROR] Failed to send sms. ", e)
      return {
        success: false
      }
    }
  }
}


