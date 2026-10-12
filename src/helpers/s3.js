import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Bucket = process.env.S3_BUCKET
const s3Region = process.env.S3_REGION
// Optional. Leave empty when the bucket has ACLs disabled (Bucket owner enforced).
const s3Acl = process.env.S3_ACL

let client = null

export const getS3Client = () => {
  if (!client) {
    // Only compute checksums when an operation requires it. Otherwise SDK v3 adds a
    // CRC32 of an empty body to presigned PUT URLs and browser uploads get rejected.
    const config = {
      region: s3Region,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED'
    }
    // Fall back to the default AWS credential provider chain when keys are not set
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    }
    client = new S3Client(config)
  }
  return client
}

export const getS3PublicUrl = key => {
  const domain = process.env.S3_DOMAIN
    ? process.env.S3_DOMAIN.replace(/\/+$/, '')
    : (s3Region
      ? `https://${s3Bucket}.s3.${s3Region}.amazonaws.com`
      : `https://${s3Bucket}.s3.amazonaws.com`)
  const base = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
}

const withAcl = params => (s3Acl ? { ...params, ACL: s3Acl } : params)

/**
 * Upload a Buffer or a readable stream to S3 and return its public URL.
 */
export const uploadToS3 = async ({ key, body, contentType }) => {
  const upload = new Upload({
    client: getS3Client(),
    params: withAcl({
      Bucket: s3Bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    })
  })
  await upload.done()
  return getS3PublicUrl(key)
}

export const getSignedPutUrl = (key, contentType, expiresIn = 300) =>
  getSignedUrl(
    getS3Client(),
    new PutObjectCommand(withAcl({ Bucket: s3Bucket, Key: key, ContentType: contentType })),
    { expiresIn }
  )

export const getSignedGetUrl = (key, contentType, expiresIn = 300) =>
  getSignedUrl(
    getS3Client(),
    new GetObjectCommand({ Bucket: s3Bucket, Key: key, ResponseContentType: contentType }),
    { expiresIn }
  )
