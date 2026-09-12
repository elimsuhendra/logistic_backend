import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import agenda from 'jobs'
import _ from "lodash"
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'

export default {
  Subscription: {
    BackgroundJob: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-BackgroundJob'),
          (payload, args) => {
            return _.get(payload, "BackgroundJob.jobId") && _.get(payload, "BackgroundJob.jobId") === _.get(args, "jobId")
          }
        )
      )
    }
  },
  Query: {
    getConvertCandidatesStatus: requiresAuth.createResolver(
      async (parent, { id }, { mongo }) => {
        const jobs = await agenda.jobs({ name: "convert-raw-candidates", lockedAt: { $ne: null }, running: true }, { lockedAt: -1 }, 1, 0)
        let [job,] = jobs
        if (!!job) {
          return {
            status: "PROCESSING",
            progress: _.get(job, "attrs.data.progress"),
            jobId: job.attrs._id,
          }
        } else {
          return {
            status: "IDLE",
            progress: 0,
            jobId: null,
          }
        }
      }),
  },
  Mutation: {
    importRawCandidatesFromPstFiles: requiresAuth.createResolver(async (parent, args, context) => {
      const jobs = await agenda.jobs({ name: 'import-raw-candidates-from-pst-files', lockedAt: { $ne: null }, running: true }, { lockedAt: -1 }, 1, 0)
      let [job,] = jobs
      if (!!job) {
        return {
          success: false,
          message: "Job is running",
          jobId: job.attrs._id,
        }
      }

      job = await agenda.now('import-raw-candidates-from-pst-files')
      return {
        success: true,
        message: "Enqueue job successfully!",
        jobId: job.attrs._id,
      }
    }),

    convertRawCandidates: requiresAuth.createResolver(async (parent, args, context) => {
      const jobs = await agenda.jobs({ name: "convert-raw-candidates", lockedAt: { $ne: null }, running: true }, { lockedAt: -1 }, 1, 0)
      let [job,] = jobs
      if (!!job) {
        return {
          success: false,
          message: "Job is running",
          jobId: job.attrs._id,
        }
      }

      job = await agenda.now('convert-raw-candidates', args)

      return {
        success: true,
        message: "Enqueue job successfully!",
        jobId: job.attrs._id,
      }
    }),
  }
}
