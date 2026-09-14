require('dotenv').config()

import express from 'express'
import basicAuth from 'express-basic-auth'
import _ from 'lodash'
import { ApolloServer } from 'apollo-server-express'
import path from 'path'
import { mergeTypeDefs, mergeResolvers } from '@graphql-tools/merge'
import { loadFilesSync } from '@graphql-tools/load-files'
import { makeExecutableSchema } from '@graphql-tools/schema'
import { execute, subscribe } from 'graphql';
import { SubscriptionServer } from 'subscriptions-transport-ws'
import { ApolloServerPluginLandingPageGraphQLPlayground } from 'apollo-server-core'
import cors from 'cors'
import { createServer } from 'http'
import { ObjectId } from 'mongodb'
import formatError from 'utils/formatErrors'
import mongoConnector from './mongoConnector'
import agenda from './jobs'
import Agendash from 'agendash'
import buildDataloaders from 'utils/dataloaders'
import jwt from 'jsonwebtoken'
import { refreshTokens } from 'utils/auth'
import { routes } from './routes'

const SECRET1 = process.env.SECRET1
const SECRET2 = process.env.SECRET2
const PORT = process.env.PORT

const graphqlEndpoint = '/graphql'
const subscriptionsEndpoint = '/subscriptions'

async function start() {
  console.log('----------------------------')
  console.log('Server started')
  console.log('----------------------------')

  const { mongo, db } = await mongoConnector()
  const typeDefs = mergeTypeDefs(loadFilesSync(path.join(__dirname, './schema')))
  const resolvers = mergeResolvers(loadFilesSync(path.join(__dirname, './resolvers')))
  const executableSchema = makeExecutableSchema({ typeDefs, resolvers })

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use(cors({ credentials: true, origin: '*' }))
  app.use('/public', express.static(path.join(__dirname, '../public')))

  if (process.env.APP_ENV === 'production') {
    app.use(
      '/agendash',
      basicAuth({
        users: {
          [process.env.AGENDASH_USERNAME]: process.env.AGENDASH_PASSWORD
        },
        challenge: true
      }),
      Agendash(agenda)
    )
  } else {
    app.use('/agendash', Agendash(agenda))
  }

  const addUser = async (req, res, next) => {
    const token = req.headers['x-token']
    if (token) {
      try {
        const { user } = jwt.verify(token, SECRET1)
        req.user = user
      } catch (err) {
        const refreshToken = req.headers['x-refresh-token']
        const newTokens = await refreshTokens(token, refreshToken, mongo, SECRET1, SECRET2)
        if (newTokens.token && newTokens.refreshToken) {
          res.set('Access-Control-Expose-Headers', 'x-token, x-refresh-token')
          res.set('x-token', newTokens.token)
          res.set('x-refresh-token', newTokens.refreshToken)
        }
        req.user = newTokens.user
      }
    }

    next()
  }

  app.use(addUser)
  const router = express.Router()
  const theRoutes = async (req, res, next) => {
    const dataloaders = await buildDataloaders(mongo)
    routes(app, { mongo, router, dataloaders })
    next()
  }

  app.use(theRoutes)

  const httpServer = createServer(app)

  const apolloServer = new ApolloServer({
    schema: executableSchema,
    formatError,
    plugins: [
      ApolloServerPluginLandingPageGraphQLPlayground({
        endpoint: graphqlEndpoint,
        subscriptionEndpoint: subscriptionsEndpoint
      }),
    ],
    context: async ({ req }) => {
      const appSetting = await mongo.AppSetting.findOne({ deletedAt: null })

      const { _id: userId } = (req && req.user || {})
      let authorizedUser = userId ? await mongo.User.findOne({ _id: ObjectId(userId) }) : undefined
      if (!authorizedUser || authorizedUser.inactive) {
        authorizedUser = undefined
      }

      return {
        appSetting: appSetting || {},
        mongo,
        db,
        dataloaders: buildDataloaders(mongo),
        user: authorizedUser ? { _id: authorizedUser._id.toString() } : {},
        language: (req && req.headers['x-language']) || '',
        SECRET1,
        SECRET2,
        serverUrl: (req && `${req.protocol}://${req.get('host')}`) || ''
      }
    }
  })

  await apolloServer.start()

  apolloServer.applyMiddleware({
    app,
    path: graphqlEndpoint,
    cors: true
  })

  const subscriptionServer = SubscriptionServer.create({
    schema: executableSchema,
    execute,
    subscribe,
    async onConnect({ token, refreshToken }) {
      let authorizedUser
      if (token && refreshToken) {
        try {
          const { user } = jwt.verify(token, SECRET1)
          authorizedUser = user
        } catch (err) {
          const newTokens = await refreshTokens(token, refreshToken, mongo, SECRET1, SECRET2)
          authorizedUser = newTokens.user
        }
      }

      const appSetting = await mongo.AppSetting.findOne({ deletedAt: null })

      return {
        appSetting: appSetting || {},
        mongo,
        db,
        dataloaders: buildDataloaders(mongo),
        user: authorizedUser ? { _id: authorizedUser._id.toString() } : {},
        SECRET1,
        SECRET2,
      }

    }
  }, {
    server: httpServer,
    path: subscriptionsEndpoint,
  })

  httpServer.listen(PORT, () => {
    console.log(`API is running on localhost:${PORT}`)
  })

  process.on('uncaughtException', function (err) {
    console.log('process.on handler')
    console.log(err)
  })

  process.on('SIGTERM', function () {
    subscriptionServer.close()
  })

  process.on('SIGINT', function () {
    console.log("\nGracefully shutting down from SIGINT (Ctrl-C)")
    subscriptionServer.close()
    process.exit(1)
  })

}

start()