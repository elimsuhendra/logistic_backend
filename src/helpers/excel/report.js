import moment from 'moment'
import _ from "lodash"
import { uploadToS3 } from 'helpers/s3'

export async function buildExcelReport(name, stream) {
  try {
    let error = null

    if (error) {
      return { success: false, error }
    }

    if (!stream) {
      return {
        success: false,
        error: `Can not generate file`,
      }
    }
    const date = moment.utc().format("YYYYMMDD")
    const key = `crm/excel/${date}-${name}.xlsx`
    let ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    const url = await uploadToS3({ key, body: stream, contentType: ContentType })

    return {
      success: true,
      error: null,
      url,
    }
  } catch (error) {
    console.log("error :>> ", error)

    return {
      success: false,
      error: JSON.stringify(error),
    }
  }
}