
import axios from "axios"
import MessageSender from "./MessageSender"

const API_BASE_URL = "https://rest.spryngsms.com/v1"
const VERSION = "0.1.0"
export default class SpryngSender extends MessageSender {
  constructor() {
    super({
      apiKey: process.env.SPRYNG_API_KEY,
      originator: process.env.SPRYNG_ORIGINATOR || "SPRYNG",
    })
  }

  config(options = {}) {
    this.baseURL = API_BASE_URL
    this.version = VERSION
    this.apiKey = options["apiKey"]
    this.originator = options["originator"]
    this.http = axios.create({ baseURL: this.baseURL })
  }

  async send(args) {
    const { to, text, reference } = args
    try {
      const body = {
        "encoding": "auto",
        "body": text,
        "route": "business",
        "originator": this.originator,
        "recipients": [to],
        "reference": reference
      }

      await this.http.request({
        url: `${this.baseURL}/messages`,
        method: 'POST',
        data: body,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "User-Agent": `spryng-node/${this.version}`
        }
      })

      console.log(`\nSent sms to ${to} with content:\n${text}\n`)
      return {
        success: true
      }
    } catch (e) {
      console.log("[ERROR] Failed to send sms.", e)
      return {
        success: false
      }
    }
  }
}