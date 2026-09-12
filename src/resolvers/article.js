import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import moment from 'moment'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"

export default {
  Article: {
    id: parent => parent._id || parent.id,
    author: async ({ authorId }, args, { dataloaders }) => {
      return !!authorId ? await dataloaders.get('userByIdLoader').load(authorId) : null
    },
    relatedArticles: async ({ authorId }, args, { dataloaders }) => {
      return !!authorId ? await dataloaders.get('userByIdLoader').load(authorId) : null
    },
    relatedArticles: async ({ relatedArticleIds }, args, { dataloaders }) => {
      return relatedArticleIds && relatedArticleIds.length > 0 ? await dataloaders.get('articleByIdLoader').loadMany(relatedArticleIds) : []
    },
  },
  Subscription: {
    Article: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Article'),
          (payload, args) => {
            return compareObject(payload.Article.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getArticle: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentArticle = id ? await mongo.Article.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentArticle
    }),
    getArticleBySlug: requiresAuth.createResolver(
      async (parent, { slug }, { mongo, user }) => {
        const currentArticle = slug ? await mongo.Article.findOne({ slug: slug, deletedAt: null }) : null
        return currentArticle
    }),
    allArticles: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Article.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allArticlesMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.Article.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createArticle: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.publishedDate = args["publishedDate"] ? moment.utc(moment(args["publishedDate"]).format("YYYY-MM-DD")).valueOf() : null
        const article = await mongoCreate('Article', args, context)
        return {
          success: true,
          message: "Article has been created successfully!",
          article,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateArticle: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.publishedDate = args["publishedDate"] ? moment.utc(moment(args["publishedDate"]).format("YYYY-MM-DD")).valueOf() : null
        const currentArticle = await mongoUpdate('Article', args, context)
        const articleResponse = await mongo.Article.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Article has been updated successfully!",
          article: articleResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteArticle: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('Article', args, context)
        return {
          success: true,
          message: "Article has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
