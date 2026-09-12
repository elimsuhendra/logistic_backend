import axios from 'axios'

// send sms to phone number
export async function sms(args = {}, context) {
  const { from, to, text } = args
  console.log(`\nSending sms to ${to} with content:\n${text}\n`)
  try {
    const { status } = await axios({
      url: 'https://rest.nexmo.com/sms/json',
      method: 'post',
      params: {
        api_key: process.env.VONAGE_API_KEY,
        api_secret: process.env.VONAGE_API_SECRET,
        from: from,
        to: to,
        text: text
      },
      responseType: 'json'
    })

    if (status == 200) {
      return {
        success: true
      }
    } else {
      return {
        success: false
      }
    }
  } catch (e) {
    console.log("[ERROR] Failed to send sms. ", e)
    return {
      success: false
    }
  }
}
