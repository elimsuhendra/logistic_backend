import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import dayjs from 'dayjs'
import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject } from 'utils/model'
import { sanitizeRegex } from 'utils/common'
import pubsub from 'src/utils/pubsub'
import { withFilter } from 'graphql-subscriptions'
import { sms } from "utils/smsServices"
import moment from 'moment'
import agenda from 'jobs'
import { mongoCreate, mongoUpdate, mongoDelete, mongoMultiDelete, ensureHasTextIndex } from 'utils/crud'
import _ from "lodash"
import path from "path"
import skill from './skill'

export default {
  People: {
    id: parent => parent._id || parent.id,
    photo: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('peoplePhotoByIdLoader').load(_id)
    },
    resumes: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'People', documentType: 'resumes' })
    },
    documents: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'People', documentType: 'documents' })
    },
    notes: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('notesByPeopleIdLoader').load(_id)
    },
    activityLogs: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('activitiesByPeopleIdLoader').load(_id)
    },
    jobOrders: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('jobOrderByCandidateIdLoader').load(_id)
    },
    applications: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('jobApplicantsByCandidateIdLoader').load(_id)
    },
    importedFromUrl: ({ rawCandidateId }, args, { serverUrl }) => {
      if (!rawCandidateId) return null
      return `${serverUrl}/raw-candidates/${rawCandidateId}`
    },
    importedFromFile: async ({ rawCandidateId }, args, { mongo }) => {
      if (!rawCandidateId) return null
      const rawCandidate = await mongo.RawCandidate.findOne({ _id: ObjectId(rawCandidateId) })
      if (!rawCandidate) return null

      return rawCandidate.fileName ? rawCandidate.fileName : path.parse(rawCandidate.filePath).base
    },
    experiences: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('experiencesByCandidateIdLoader').load(_id)
    },
    skills: async ({ _id, computerSkillIds, languageSkillIds }, args, { dataloaders }) => {
      const skillIds = [].concat(computerSkillIds, languageSkillIds)
      return await dataloaders.get('skillsBySkillIdsLoader').load(skillIds)
    },
    jobOrder: async ({ jobOrderId }, args, { dataloaders }) => {
      if (jobOrderId) {
        return await dataloaders.get('jobOrderByJobOrderId').load(jobOrderId)
      }
    },
  },
  Subscription: {
    People: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-People'),
          (payload, args) => {
            return compareObject(payload.People.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getPeople: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentPeople = id ? await mongo.People.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentPeople
      }),
    allPeople: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const { search, salary_lte, salary_gte, showAttachment, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt
        let searchFilter = null

        let showAttachmentFilter = null
        if (showAttachment) {
          const candidateDocuments = await mongo.Document.find({ objectType: "People", documentType: "resumes", deletedAt: null }).toArray()
          let candidateIds = _.uniq(candidateDocuments.map(document => document.objectId.toString()) || [])
          if (candidateIds && candidateIds.length > 0) {
            showAttachmentFilter = {
              "$or": [
                { _id: { $in: candidateIds.map(id => ObjectId(id)) } },
                { rawCandidateId: { $ne: null } }
              ]
            }
          } else {
            showAttachmentFilter = {
              rawCandidateId: { $ne: null }
            }
          }
        }

        let salaryFilter = null
        if (!!salary_lte && !!salary_gte) {
          salaryFilter = {
            idealEmployments: {
              $elemMatch: {
                $or: [
                  { minSalary: { $gt: salary_gte, $lt: salary_lte } },
                  { maxSalary: { $gt: salary_gte, $lt: salary_lte } }
                ]
              }
            }
          }
        }
        const getFilterAge = filters["$and"] && filters["$and"].filter(i => i.age)
        const removeFilterAge = filters["$and"] && filters["$and"].filter(i => !i.age)
        delete filters["$and"]
        if (removeFilterAge && removeFilterAge.length > 0) {
          filters["$and"] = removeFilterAge
        }
        const filterResponse = [filters, searchFilter, salaryFilter, getFilterAge, showAttachmentFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = (filterResponse && filterResponse.length > 0) ? {
          $and: [
            { deletedAt: null },
            Object.keys(filters || []).length && Object.keys(searchFilter || []).length ? {
              $or: [
                filters || {},
                searchFilter || {}
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {}
              ]
            },
            salaryFilter || {},
            getFilterAge && getFilterAge.length > 0 ? {
              $and: getFilterAge
            } : {},
            showAttachmentFilter || {},
          ]
        } : { deletedAt: null }

        if (search && (await ensureHasTextIndex("People", { mongo }))) {
          filterResult['$text'] = { $search: `\"${sanitizeRegex(search).toLowerCase()}\"` }
        }

        const obj = mongo.People.find(filterResult)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        return await obj.toArray()
      }
    ),
    _allPeopleMeta: requiresAuth.createResolver(
      async (parent, { filter, first, skip }, { mongo }) => {
        const limit = 1
        const offset = (first || 10) + (skip || 0)

        const { search, salary_lte, salary_gte, showAttachment, ...rest } = filter || {}
        let filters = buildMongoFilters(rest) || {}
        delete filters.deletedAt
        let searchFilter = null

        let showAttachmentFilter = {}
        if (showAttachment) {
          const candidateDocuments = await mongo.Document.find({ objectType: "People", documentType: "resumes", deletedAt: null }).toArray()
          let candidateIds = _.uniq(candidateDocuments.map(document => document.objectId.toString()) || [])
          if (candidateIds && candidateIds.length > 0) {
            showAttachmentFilter = {
              "$or": [
                { _id: { $in: candidateIds.map(id => ObjectId(id)) } },
                { rawCandidateId: { $ne: null } }
              ]
            }
          } else {
            showAttachmentFilter = {
              rawCandidateId: { $ne: null }
            }
          }
        }

        let salaryFilter = null
        if (!!salary_lte && !!salary_gte) {
          salaryFilter = {
            idealEmployments: {
              $elemMatch: {
                $or: [
                  { minSalary: { $gt: salary_gte, $lt: salary_lte } },
                  { maxSalary: { $gt: salary_gte, $lt: salary_lte } }
                ]
              }
            }
          }
        }
        const getFilterAge = filters["$and"] && filters["$and"].filter(i => i.age)
        const removeFilterAge = filters["$and"] && filters["$and"].filter(i => !i.age)
        delete filters["$and"]
        if (removeFilterAge && removeFilterAge.length > 0) {
          filters["$and"] = removeFilterAge
        }
        const filterResponse = [filters, searchFilter, salaryFilter, getFilterAge, showAttachmentFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = (filterResponse && filterResponse.length > 0) ? {
          $and: [
            { deletedAt: null },
            Object.keys(filters || []).length && Object.keys(searchFilter || []).length ? {
              $or: [
                filters || {},
                searchFilter || {}
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {}
              ]
            },
            salaryFilter || {},
            getFilterAge && getFilterAge.length > 0 ? {
              $and: getFilterAge
            } : {},
            showAttachmentFilter || {},
          ]
        } : { deletedAt: null }

        if (search && (await ensureHasTextIndex("People", { mongo }))) {
          filterResult['$text'] = { $search: `\"${sanitizeRegex(search).toLowerCase()}\"` }
        }

        const people = await mongo.People.find(filterResult).skip(offset).limit(limit).toArray()
        const hasNext = (people || []).length > 0

        return {
          hasPrev: skip > 0,
          hasNext: hasNext
        }
      }
    ),
    allFreelancePeople: requiresAuth.createResolver(
      async (parent, args, context) => {
        const { keyword, filter, first, skip, orderBy, companyFilter } = args
        const { payrollCycleEndDate_lte, payrollCycleEndDate_gte, salary_lte, salary_gte, showAttachment, ...params } = filter || {}
        const { mongo } = context
        const limit = first || 10
        const offset = skip || 0
        const sortBy = !!orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 }

        let pipelines = []

        let distinctTempCandidateIds = []

        let JobApplicantArgs = {}
        let offer = { "offer.workType": "Contract / Temp / Part Time" }

        let payrollCycleEndDate_lte2 = new Date(payrollCycleEndDate_lte).valueOf()
        let payrollCycleEndDate_gte2 = new Date(payrollCycleEndDate_gte).valueOf()

        if (payrollCycleEndDate_lte) {
          let payrollCycleEndDate = { '$lte': payrollCycleEndDate_lte2 }

          offer = {
            ...offer,
            'offer.payrollCycleEndDate': payrollCycleEndDate
          }
        }
        else if (payrollCycleEndDate_lte && payrollCycleEndDate_gte) {
          let payrollCycleEndDate = { '$gte': payrollCycleEndDate_gte2, '$lte': payrollCycleEndDate_lte2 }

          offer = {
            ...offer,
            'offer.payrollCycleEndDate': payrollCycleEndDate
          }
        }

        JobApplicantArgs = {
          ...offer
        }

        if (!_.isEmpty(companyFilter)) {
          let companyId;
          for (var key in companyFilter) {
            if (companyFilter.hasOwnProperty('_id')) {
              companyId = ObjectId(companyFilter[key])
            }
          }

          const jobOrderData = await mongo.JobOrder.distinct("_id", { companyId: companyId }) || []

          JobApplicantArgs.jobId = { $in: jobOrderData }
        }

        distinctTempCandidateIds = await mongo.JobApplicant.distinct('candidateId', JobApplicantArgs)

        pipelines = pipelines.concat({
          $match: {
            _id: { $in: distinctTempCandidateIds }
          }
        })

        if (!!keyword) {
          const phrases = keyword.split(' ').filter(phrase => !!phrase)
          const addFilters = phrases.map(phrase => {
            const str = phrase.trim().toLowerCase()
            const regexStr = `\(\^|\\W\)${str}`

            return {
              $match: {
                $or: [
                  { fullName: { $regex: regexStr, $options: 'i' } },
                  { email: { $regex: str, $options: 'i' } },
                ]
              }
            }
          })

          pipelines = pipelines.concat(addFilters)
        }

        let filters = buildMongoFilters(params) || {}
        delete filters.deletedAt
        let searchFilter = null

        let showAttachmentFilter = null
        if (showAttachment) {
          const candidateDocuments = await mongo.Document.find({ objectType: "People", documentType: "resumes", deletedAt: null }).toArray()
          let candidateIds = _.uniq(candidateDocuments.map(document => document.objectId.toString()) || [])
          if (candidateIds && candidateIds.length > 0) {
            showAttachmentFilter = {
              "$or": [
                { _id: { $in: candidateIds.map(id => ObjectId(id)) } },
                { rawCandidateId: { $ne: null } }
              ]
            }
          } else {
            showAttachmentFilter = {
              rawCandidateId: { $ne: null }
            }
          }
        }

        let salaryFilter = null
        if (!!salary_lte && !!salary_gte) {
          salaryFilter = {
            idealEmployments: {
              $elemMatch: {
                $or: [
                  { minSalary: { $gt: salary_gte, $lt: salary_lte } },
                  { maxSalary: { $gt: salary_gte, $lt: salary_lte } }
                ]
              }
            }
          }
        }

        const getFilterAge = filters["$and"] && filters["$and"].filter(i => i.age)
        const removeFilterAge = filters["$and"] && filters["$and"].filter(i => !i.age)
        delete filters["$and"]
        if (removeFilterAge && removeFilterAge.length > 0) {
          filters["$and"] = removeFilterAge
        }

        const filterResponse = [filters, searchFilter, salaryFilter, getFilterAge, showAttachmentFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = (filterResponse && filterResponse.length > 0) ? {
          $and: [
            { deletedAt: null },
            Object.keys(filters || []).length && Object.keys(searchFilter || []).length ? {
              $or: [
                filters || {},
                searchFilter || {}
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {}
              ]
            },
            salaryFilter || {},
            getFilterAge && getFilterAge.length > 0 ? {
              $and: getFilterAge
            } : {},
            showAttachmentFilter || {},
          ]
        } : { deletedAt: null }

        if (keyword) {
          filterResult['$text'] = { $search: `\"${sanitizeRegex(keyword).toLowerCase()}\"` }
        }

        pipelines = pipelines.concat([
          { $match: filterResult },
          { $sort: sortBy },
          { $skip: offset },
          { $limit: limit }
        ])

        const obj = mongo.People.aggregate(pipelines)
        let candidates = await obj.toArray()

        return candidates
      }
    ),
    _allFreelancePeopleMeta: requiresAuth.createResolver(
      async (parent, args, context) => {
        const { keyword, filter, first, skip, orderBy, companyFilter } = args
        const { payrollCycleEndDate_lte, payrollCycleEndDate_gte, salary_lte, salary_gte, showAttachment, ...params } = filter || {}
        const { mongo } = context
        const limit = first || 10
        const offset = skip || 0
        const sortBy = !!orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 }

        let pipelines = []

        let distinctTempCandidateIds = []

        let JobApplicantArgs = {}
        let offer = { "offer.workType": "Contract / Temp / Part Time" }

        let payrollCycleEndDate_lte2 = new Date(payrollCycleEndDate_lte).valueOf()
        let payrollCycleEndDate_gte2 = new Date(payrollCycleEndDate_gte).valueOf()

        if (payrollCycleEndDate_lte) {
          let payrollCycleEndDate = { '$lte': payrollCycleEndDate_lte2 }

          offer = {
            ...offer,
            'offer.payrollCycleEndDate': payrollCycleEndDate
          }
        }
        else if (payrollCycleEndDate_lte && payrollCycleEndDate_gte) {
          let payrollCycleEndDate = { '$gte': payrollCycleEndDate_gte2, '$lte': payrollCycleEndDate_lte2 }

          offer = {
            ...offer,
            'offer.payrollCycleEndDate': payrollCycleEndDate
          }
        }

        JobApplicantArgs = {
          ...offer
        }

        if (!_.isEmpty(companyFilter)) {
          let companyId;
          for (var key in companyFilter) {
            if (companyFilter.hasOwnProperty('_id')) {
              companyId = ObjectId(companyFilter[key])
            }
          }

          const jobOrderData = await mongo.JobOrder.distinct("_id", { companyId: companyId }) || []

          JobApplicantArgs.jobId = { $in: jobOrderData }
        }

        distinctTempCandidateIds = await mongo.JobApplicant.distinct('candidateId', JobApplicantArgs)

        pipelines = pipelines.concat({
          $match: {
            _id: { $in: distinctTempCandidateIds }
          }
        })

        if (!!keyword) {
          const phrases = keyword.split(' ').filter(phrase => !!phrase)
          const addFilters = phrases.map(phrase => {
            const str = phrase.trim().toLowerCase()
            const regexStr = `\(\^|\\W\)${str}`

            return {
              $match: {
                $or: [
                  { fullName: { $regex: regexStr, $options: 'i' } },
                  { email: { $regex: str, $options: 'i' } },
                ]
              }
            }
          })

          pipelines = pipelines.concat(addFilters)
        }

        let filters = buildMongoFilters(params) || {}
        delete filters.deletedAt
        let searchFilter = null

        let showAttachmentFilter = null
        if (showAttachment) {
          const candidateDocuments = await mongo.Document.find({ objectType: "People", documentType: "resumes", deletedAt: null }).toArray()
          let candidateIds = _.uniq(candidateDocuments.map(document => document.objectId.toString()) || [])
          if (candidateIds && candidateIds.length > 0) {
            showAttachmentFilter = {
              "$or": [
                { _id: { $in: candidateIds.map(id => ObjectId(id)) } },
                { rawCandidateId: { $ne: null } }
              ]
            }
          } else {
            showAttachmentFilter = {
              rawCandidateId: { $ne: null }
            }
          }
        }

        let salaryFilter = null
        if (!!salary_lte && !!salary_gte) {
          salaryFilter = {
            idealEmployments: {
              $elemMatch: {
                $or: [
                  { minSalary: { $gt: salary_gte, $lt: salary_lte } },
                  { maxSalary: { $gt: salary_gte, $lt: salary_lte } }
                ]
              }
            }
          }
        }

        const getFilterAge = filters["$and"] && filters["$and"].filter(i => i.age)
        const removeFilterAge = filters["$and"] && filters["$and"].filter(i => !i.age)
        delete filters["$and"]
        if (removeFilterAge && removeFilterAge.length > 0) {
          filters["$and"] = removeFilterAge
        }

        const filterResponse = [filters, searchFilter, salaryFilter, getFilterAge, showAttachmentFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = (filterResponse && filterResponse.length > 0) ? {
          $and: [
            { deletedAt: null },
            Object.keys(filters || []).length && Object.keys(searchFilter || []).length ? {
              $or: [
                filters || {},
                searchFilter || {}
              ]
            } : {
              $and: [
                filters || {},
                searchFilter || {}
              ]
            },
            salaryFilter || {},
            getFilterAge && getFilterAge.length > 0 ? {
              $and: getFilterAge
            } : {},
            showAttachmentFilter || {},
          ]
        } : { deletedAt: null }

        if (keyword) {
          filterResult['$text'] = { $search: `\"${sanitizeRegex(keyword).toLowerCase()}\"` }
        }

        pipelines = pipelines.concat([
          { $match: filterResult },
          { $skip: offset },
          { $limit: limit }
        ])

        const obj = mongo.People.aggregate(pipelines)
        let candidates = await obj.toArray()
        const hasNext = (candidates || []).length > 0

        return {
          hasPrev: skip > 0,
          hasNext: hasNext
        }
      }
    ),
    countFreelanceEndContractLteThisMonth: requiresAuth.createResolver(
      async (parent, args, context) => {
        const { mongo } = context

        let pipelines = []

        let distinctTempCandidateIds = []

        let JobApplicantArgs = {}
        let offer = { "offer.workType": "Contract / Temp / Part Time" }

        // check filter payrollCycleEndDate_lte payrollCycleEndDate_gte and return param
        let payrollCycleEndDate_lte = dayjs().endOf('month').valueOf()

        let payrollCycleEndDate = { '$lte': payrollCycleEndDate_lte }

        offer = {
          ...offer,
          'offer.payrollCycleEndDate': payrollCycleEndDate
        }

        JobApplicantArgs = {
          ...offer
        }

        distinctTempCandidateIds = await mongo.JobApplicant.distinct('candidateId', JobApplicantArgs)

        pipelines = pipelines.concat({
          $match: {
            _id: { $in: distinctTempCandidateIds }
          }
        })


        const filterResult = { deletedAt: null }

        pipelines = pipelines.concat([
          { $match: filterResult },
        ])

        const obj = mongo.People.aggregate(pipelines)
        let res = await obj.toArray()
        return {
          count: res.length
        }
      }
    )
  },
  Mutation: {
    applyJob: requiresAuth.createResolver(async (parent, args, context) => {
      const { mongo } = context
      const { jobId, candidate } = args || {}
      const currentJob = await mongo.JobOrder.findOne({ _id: ObjectId(jobId), deletedAt: null })
      if (!!currentJob) {
        const peopleObj = { ...candidate }
        peopleObj.status = "ACTIVE"
        peopleObj.birthday = peopleObj["birthday"] ? moment.utc(moment(peopleObj["birthday"]).format("YYYY-MM-DD")).valueOf() : null
        const people = await mongoCreate('People', peopleObj, context)
        const jobApplicantObj = {
          jobId: ObjectId(currentJob._id),
          candidateId: ObjectId(people._id),
          phase: "Applicants",
          workflowId: currentJob.workflowId,
          position: 0
        }
        await mongoCreate('JobApplicant', jobApplicantObj, context)
        if (people.email) {
          agenda.now('user-apply-job', {
            to: people.email,
            subject: '',
            fullName: people.fullName,
          })
        }
        const company = await mongo.Company.findOne({ _id: ObjectId(currentJob.companyId), deletedAt: null })
        const owner = await mongo.User.findOne({ _id: ObjectId(currentJob.ownerId), deletedAt: null })
        if (owner && owner.email) {
          agenda.now('forward-apply-job', {
            forwarder: owner.email,
            candidateName: people.fullName,
            companyName: company.name,
            jobId: ObjectId(currentJob._id),
            jobTitle: currentJob.title
          })
        }
        return { success: true, people }
      }
      return { success: false }
    }),
    createPeople: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        args.status = args.isDraft ? "DRAFT" : "ACTIVE"
        args.birthday = args["birthday"] ? moment.utc(moment(args["birthday"]).format("YYYY-MM-DD")).valueOf() : null
        const people = await mongoCreate('People', args, context)
        return {
          success: true,
          message: "People has been created successfully!",
          people,
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updatePeople: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const currentCandidate = await mongo.People.findOne({ _id: ObjectId(args.id), deletedAt: null })
      if (!!currentUser) {
        args.birthday = args["birthday"] ? moment.utc(moment(args["birthday"]).format("YYYY-MM-DD")).valueOf() : null
        if (args.birthday) {
          const age = Math.floor((new Date() - new Date(args.birthday)) / 1000 / 60 / 60 / 24 / 365)
          args.age = age
        }
        args.status = args.isDraft ? "DRAFT" : "ACTIVE"
        const currentCategory = await mongoUpdate('People', args, context)
        const peopleResponse = await mongo.People.findOne({ _id: ObjectId(args.id), deletedAt: null })

        return {
          success: true,
          message: "People has been updated successfully!",
          people: peopleResponse,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deletePeople: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('People', args, context)
        return {
          success: true,
          message: "People has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    deleteBatchPeople: requiresAuth.createResolver(async (parent, args, context) => {
      const { mongo } = context
      await checkPermissions(checkUserAuth)({ context })
      await mongoMultiDelete('People', args, context)
      const keyObjs = args.ids.map(key => ObjectId(key))
      const jobApplicantsByCandidateId = await mongo.JobApplicant.find({ candidateId: { $in: keyObjs }, deletedAt: null }).toArray()
      const jobApplicantIds = jobApplicantsByCandidateId && jobApplicantsByCandidateId.length > 0 && jobApplicantsByCandidateId.map(jobApplicant => jobApplicant._id) || null
      if (jobApplicantIds && jobApplicantIds.length > 0) {
        await mongoMultiDelete('JobApplicant', { ids: jobApplicantIds }, context)
      }
      return {
        success: true
      }
    }),
    checkCandidateNameExist: requiresAuth.createResolver(
      async (parent, { fullName, ignoreId }, { mongo, user }) => {
        const argName = fullName.trim()
        if (ignoreId) {
          const currentCandidate = await mongo.People.findOne({ _id: ObjectId(ignoreId), deletedAt: null })
          if (currentCandidate && currentCandidate.fullName.toLowerCase() === argName.toLowerCase()) {
            return { existed: false }
          }
        }
        const currentCandidate = await mongo.People.findOne({ fullName: { "$regex": argName, "$options": "i" }, deletedAt: null })
        return {
          existed: !!currentCandidate && currentCandidate.fullName.toLowerCase() === argName.toLowerCase() ? true : false
        }
      }),
    createCandidateIndexes: requiresAuth.createResolver(
      async (parent, args, { mongo, user }) => {
        try {
          await mongo.People.createIndex({
            createdAt: 1
          })
        } catch (_err) { }

        try {
          await mongo.People.createIndex({
            createdAt: -1
          })
        } catch (_err) { }

        try {
          await mongo.People.createIndex({
            email: 1
          })
          await mongo.People.createIndex({
            status: 1
          })
        } catch (_err) { }

        return {
          success: true
        }
      }),
  }
}
