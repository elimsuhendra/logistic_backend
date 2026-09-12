
// import SpryngSender from "./SpryngSender"
import TwilioSender from "./TwilioSender"

export async function sms(args = {}) {
  // const sender = new SpryngSender()
  const sender = new TwilioSender()
  await sender.send(args)
}