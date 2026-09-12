import jwt from 'jsonwebtoken'
import _ from 'lodash'
import bcrypt from 'bcryptjs'
import { ObjectId } from 'mongodb'

export const createTokens = async (user, secret1, secret2) => {
  const createToken = jwt.sign(
    {
      user: _.pick(user, ['_id', 'username'])
    },
    secret1,
    {
      expiresIn: '4d'
    }
  )

  const createRefreshToken = jwt.sign(
    {
      user: _.pick(user, 'id')
    },
    secret2,
    {
      expiresIn: '7d'
    }
  )

  return [createToken, createRefreshToken]
}

export const refreshTokens = async (token, refreshToken, mongo, SECRET1, SECRET2) => {
  try {
    const _user = jwt.decode(refreshToken)
    if (!_user) return {}

    const user = await mongo.User.findOne({ _id: ObjectId(_user.id) })
    if (!user) return {}

    const refreshSecret = user.password + SECRET2
    const [newToken, newRefreshToken] = await createTokens(user, SECRET1, refreshSecret)
    return {
      token: newToken,
      refreshToken: newRefreshToken,
      user
    }
  } catch (err) {
    return {}
  }
}

export const tryLogin = async (args, context) => {
  const { username, password } = args || {}
  const { mongo, SECRET1, SECRET2 } = context || {}

  const NOW = new Date().getTime()
  const user =
    !!username && await mongo.User.findOne({ $or: [{ username: username }, { email: username }], deletedAt: null })

  if (!user) {
    return {
      success: false,
      message: 'Wrong username or password',
    }
  }
  if (!!user.inactive) {
    return {
      success: false,
      message: 'User is no longer active',
    }
  }

  const valid = await bcrypt.compareSync(password, user.password)
  if (!valid) {
    // bad password
    return {
      success: false,
      message: 'Wrong username or password',
    }
  }

  const refreshTokenSecret = user.password + SECRET2

  const [token, refreshToken] = await createTokens(user, SECRET1, refreshTokenSecret)

  await mongo.User.updateOne(
    { _id: ObjectId(user._id) },
    { $set: {
      lastLoggedInAt: new Date().getTime()
    } }
  )

  return {
    success: true,
    user,
    token,
    refreshToken
  }
}

export const hashPassword = (password) => {
  return bcrypt.hashSync(password, 12)
}
