import validate from 'validate.js'
import setErrorInfo from './setErrorInfo'
import { ObjectId } from 'mongodb'

// check https://validatejs.org/
// this validation, I need to assign as async because need to pass to mongo to check username
export default async ({ user, mongo }) => {
  // Note for custom validation
  // I cannot put async inside validate, because it doesn't support

  validate.validators.uniqueDb = function (value, options, key, attributes) {
    return new Promise(async (resolve, reject) => {
      if (!options) return resolve()
      let existed = await mongo.User.findOne({ ...(options.filter || {}), deletedAt: null })
      if (!!existed) {
        resolve(` has already been taken`)
      } else {
        resolve()
      }
    })
  }

  const uniqueCondition = user._id ? { _id: { $ne: ObjectId(user._id) }} : {}

  let constraints = {
    username: function(value, attributes, attributeName, options, constraints) {
      let validationObject = {}
      if (attributes.username) {
        validationObject = { 
          uniqueDb: {
            filter: {
              ...uniqueCondition,
              username: user.username
            }
          }
        }
      }
      if (!attributes.email) validationObject.presence = { allowEmpty: false };
      return validationObject;
    },
    email: function(value, attributes, attributeName, options, constraints) {
      let validationObject = {}
      if (attributes.email) {
        validationObject = {
          uniqueDb: {
            filter: {
              ...uniqueCondition,
              email: user.email
            }
          }
        }
      }
      if (!attributes.username) validationObject.presence = { allowEmpty: false };
      return validationObject;
    }
  }

  try {
    await validate.async(user, constraints)
    return { user }
  } catch (e) {
    let errors = setErrorInfo(e)
    return {
      user,
      errors
    }
  }
}
