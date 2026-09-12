import aws from 'aws-sdk'
import moment from 'moment'
import _ from "lodash"
const s3Bucket = process.env.S3_BUCKET
const s3Region = process.env.S3_REGION
const AWSAccessKeyId = process.env.AWS_ACCESS_KEY_ID
const AWSSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

export async function buildExcelReport(name, stream) {
  try {
    aws.config.update({ region: s3Region })
    const s3 = new aws.S3({
      signatureVersion: "v4",
      region: s3Region,
      accessKeyId: AWSAccessKeyId,
      secretAccessKey: AWSSecretAccessKey,
    })

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
    const objectParams = {
      Bucket: s3Bucket,
      Key: key,
      ContentType: ContentType,
      Body: stream,
      ACL: "public-read",
    }

    // Create object upload promise
    const resp = await s3.upload(objectParams).promise()

    if (resp && resp.Location) {
      return {
        success: true,
        error: null,
        url: resp.Location,
      }
    }

    return {
      success: false,
      error: JSON.stringify(resp),
    }
  } catch (error) {
    console.log("error :>> ", error)

    return {
      success: false,
      error: JSON.stringify(error),
    }
  }
}