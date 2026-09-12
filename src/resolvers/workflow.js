import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import _ from "lodash"


export async function numberOfJobsFromWorkflow({ id }, { mongo }) {
  return await mongo.JobOrder.find({ workflowId: ObjectId(id), deletedAt: null }).count()
}

export default {
  Workflow: {
    id: parent => parent._id || parent.id,
    numberOfJobs: async ({ _id } , args, { mongo }) => {
      return _id ? await numberOfJobsFromWorkflow({ id: _id }, { mongo }) : 0
    },
  },
  WorkflowPhase: {
    id: parent => parent._id || parent.id,
  },
  Subscription: {
    Workflow: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Workflow'),
          (payload, args) => {
            return compareObject(payload.Workflow.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getWorkflow: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentWorkflow = id ? await mongo.Workflow.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentWorkflow
    }),
    allWorkflows: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const filters = buildMongoFilters(filter)
        const obj = mongo.Workflow.find(filters)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC

        return await obj.toArray()
      }
    ),
    _allWorkflowsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const filters = buildMongoFilters(filter) || {}
        const obj = mongo.Workflow.find(filters)

        return { count: obj.count() }
      }
    ),
  },
  Mutation: {
    createWorkflow: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if ('workflowPhases' in args) {
          const workflowPhases = args.workflowPhases.map((phase) => {
            return {
              ...phase,
              id: phase.id ? ObjectId(phase.id) : new ObjectId(),
            }
          })

          const defaultPhase = workflowPhases.find(phase => phase.isDefault)
          if (!defaultPhase) {
            return {
              success: false,
              message: `Must have at least one default phase!`
            }
          }

          const voidPhase = workflowPhases.find(phase => phase.isVoid)
          if (!voidPhase) {
            return {
              success: false,
              message: `Must have at least one void phase!`
            }
          }

          args.workflowPhases = workflowPhases
        }

        args.numberOfJobs = 0
        const workflow = await mongoCreate('Workflow', args, context)
        return {
          success: true,
          message: "Workflow has been created successfully!",
          workflow,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateWorkflow: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        if ('workflowPhases' in args) {
          const numberOfJobs = await numberOfJobsFromWorkflow({ id: args.id }, { mongo })
          // if (numberOfJobs > 0) {
          //   return {
          //     success: false,
          //     message: `This workflow has ${numberOfJobs} jobs and can not be updated!`
          //   }
          // }

          const workflowPhases = args.workflowPhases.map((phase) => {
            return {
              ...phase,
              id: phase.id ? ObjectId(phase.id) : new ObjectId(),
            }
          })

          const defaultPhase = workflowPhases.find(phase => phase.isDefault)
          if (!defaultPhase) {
            return {
              success: false,
              message: `Must have at least one default phase!`
            }
          }

          const voidPhase = workflowPhases.find(phase => phase.isVoid)
          if (!voidPhase) {
            return {
              success: false,
              message: `Must have at least one void phase!`
            }
          }

          args.workflowPhases = workflowPhases
        }

        await mongoUpdate('Workflow', args, context)
        const updatedWorkflow = await mongo.Workflow.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "Workflow has been updated successfully!",
          workflow: updatedWorkflow,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    updateWorkflowDefault: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const {workflows} = args || {}
        const bulkArgs = workflows.map((workflow, index) => {
          return {
            updateOne: {
              filter: { _id: ObjectId(workflow.id) },
              update: {
                $set: {
                  isDefault: workflow.isDefault
                }
              },
              upsert: true
            }
          }
        })
        await mongo.Workflow.bulkWrite(bulkArgs, { ordered: true })
        return {
          success: true,
          message: "Workflow has been updated successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteWorkflow: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const numberOfJobs = await numberOfJobsFromWorkflow({ id: args.id }, { mongo })
        if (numberOfJobs > 0) {
          return {
            success: false,
            message: `This workflow has ${numberOfJobs} jobs and can not be deleted!`
          }
        }

        await mongoDelete('Workflow', args, context)
        return {
          success: true,
          message: "Workflow has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    })
  }
}
