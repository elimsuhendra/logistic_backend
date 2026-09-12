import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject, prepareUpdate } from 'utils/model'
import { sanitizeRegex } from 'utils/common'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { sms } from "utils/smsServices"
import moment from 'moment'
import agenda from 'jobs'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete, ensureHasTextIndex} from 'utils/crud'
import _ from "lodash"
import path from "path"

export default {
  Experience: {
    id: parent => parent._id || parent.id
  },
  Subscription: {
    Experience: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-Experience'),
          (payload, args) => {
            return compareObject(payload.Experience.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getExperience: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentExperience = id ? await mongo.Experience.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentExperience
    })
  },
  Mutation: {
    updateExperience: requiresAuth.createResolver(async (parent, args, context) => {
      const { candidateId, experiences } = args
      const { mongo, user, dataloaders } = context

      try {
        let expId = []
       
        for (let i = 0; i < experiences.length; i++) {
          const {id, institutionId, ...params } = experiences[i]
          
          let newInstitutionId = (institutionId == 'new' ? new ObjectId() : new ObjectId(institutionId) )
          const institution = await mongo.Institution.findOne( { $or: [ { _id: newInstitutionId }, { name: params.institutionName } ] } )

          if (!institution) {
            const newInstitution = {
              _id: newInstitutionId,
              name: params.institutionName,
              status: 'ACTIVE',
              type: params.type,
              createdAt: new Date().getTime()
            }
            await mongo.Institution.insertOne(newInstitution)
          }else{
            newInstitutionId = new ObjectId(institution._id.toString())
          }

          experiences[i]['institutionId'] = newInstitutionId.toString()
          
          if(id){
            expId.push(new ObjectId(id))
          }
        }

        // if(expId.length > 0){
          let updateExp = await mongo.Experience.update({_id: {$nin : expId}, candidateId: new ObjectId(candidateId)}, {$set : {"deletedAt" : new Date().valueOf()}})
        // }

        const experienceObjs = (await Promise.all(experiences.map(async (experience, index) => {
          const {id, institutionId, ...params } = experience

          const updates = prepareUpdate({ ...experience })

          if(id){
            return {
              updateOne: {
                filter: {
                  _id: new ObjectId(id)
                },
                update: { $set: updates },
                upsert: true
              }
            }
          }else{
            return {
              insertOne: updates
            }
          }
          
        }))).filter(experienceObj => !!experienceObj)

        if (experienceObjs.length > 0) {
          await mongo.Experience.bulkWrite(experienceObjs)
        }

        const updatedExperiences = await mongo.Experience
          .find({
            candidateId: new ObjectId(candidateId),
            deletedAt: null
          })
          .sort({ position: 1 })
          .toArray()

        return {
          success: true,
          message: "Experiences have been updated.",
          experiences: updatedExperiences
        }
      } catch (e) {
        console.log(`[ERROR] Failed to update experiences.`, e)
      }

      return {
        success: false,
        message: "Failed to update experiences"
      }
    }),
  }
}
