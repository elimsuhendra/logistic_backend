import { GraphQLScalarType } from 'graphql'
import { Kind } from 'graphql/language'
import GraphQLJSON, { GraphQLJSONObject } from 'graphql-type-json'
import { getSignedPutUrl, getSignedGetUrl, getS3PublicUrl } from 'helpers/s3'

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
      // Credentials are read from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
      // (or the default AWS credential provider chain). Never hard-code them.
      const signedRequestURL = await getSignedPutUrl(filename, filetype, 300)
      const signedDownloadURL = await getSignedGetUrl(filename, filetype, 300)
      const url = getS3PublicUrl(filename)

      return {
        signedRequestURL,
        signedDownloadURL,
        url
      }
    }
  }
}