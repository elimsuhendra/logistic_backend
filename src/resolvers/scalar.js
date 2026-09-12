import { GraphQLScalarType } from 'graphql'
import { Kind } from 'graphql/language'
import GraphQLJSON, { GraphQLJSONObject } from 'graphql-type-json'
import aws from 'aws-sdk'

const s3Bucket = process.env.S3_BUCKET
const s3Region = process.env.S3_REGION
const AWSAccessKeyId = process.env.AWS_ACCESS_KEY_ID
const AWSSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY

export default {
  JSON: GraphQLJSON,
  JSONObject: GraphQLJSONObject,
  Date: new GraphQLScalarType({
    name: 'Date',
    description: 'Date format must return timestamp',
    parseValue(value) {
      return new Date(value) // value from the client
    },
    serialize(value) {
      return new Date(value).getTime() // value sent to the client
    },
    parseLiteral(ast) {
      if (ast.kind === Kind.INT) {
        return parseInt(ast.value, 10) // ast value is always in string format
      }
      return null
    }
  }),
  Mutation: {
    signS3: async (parent, { filename, filetype }) => {
      // http://docs.amazonaws.cn/en_us/AWSJavaScriptSDK/guide/node-examples.html
      // We cannot hard code the credentials, must be EXPORT...

      /**
       * Don't hard-code your credentials!
       * Export the following environment variables instead:
       *
       * export AWS_ACCESS_KEY_ID='AKID'
       * export AWS_SECRET_ACCESS_KEY='SECRET'
       */

      // aws.config.update({ accessKeyId: AWSAccessKeyId, secretAccessKey: AWSSecretAccessKey })
      aws.config.update({ region: s3Region })

      console.log('s3Region: ', s3Region)

      // AWS_ACCESS_KEY_ID
      // AWS_SECRET_ACCESS_KEY
      const s3 = new aws.S3({
        signatureVersion: 'v4',
        region: s3Region,
        accessKeyId: AWSAccessKeyId,
        secretAccessKey: AWSSecretAccessKey
  })

      const s3PutParams = {
        Bucket: s3Bucket,
        Key: filename,
        Expires: 300,
        ContentType: filetype,
        ACL: 'public-read'
      }

      const s3GetParams = {
        Bucket: s3Bucket,
        Key: filename,
        Expires: 300,
        ResponseContentType: filetype
      }
      let signedRequestURL = await s3.getSignedUrl('putObject', s3PutParams)
      let signedDownloadURL = await s3.getSignedUrl('getObject', s3GetParams)

      let url = `https://${s3Bucket}.s3.amazonaws.com/${filename}`

      // s3.getSignedUrl('putObject', s3PutParams, (err, url) => {
      //   console.log('error:', err)
      //   console.log('signedRequestURL: ' + url)
      // })

      return {
        signedRequestURL,
        signedDownloadURL,
        url
      }
    }
  }
}