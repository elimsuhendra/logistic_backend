
import { mongoBatchPage } from "utils/mongoBatchPage"
import buildMongoFilters from "src/utils/buildMongoFilters"
import { asyncChunk } from "utils/common"
import pubsub from 'utils/pubsub'
import { convert } from 'html-to-text'
import fs from 'fs/promises'

export async function convertRawCandidatesToRealCandidates(bgJob, context) {
  const { mongo } = context
  const { filter } = bgJob.attrs.data || {}
  const filters = buildMongoFilters(filter)
  // try to create text indexes
  try {
    await mongo.People.createIndex({ 
      fullText: "text", 
      email: "text", 
      fullName: "text", 
      email: "text", 
      nationality: "text",
      about: "text",
      gender: "text",
      mobileNumber: "text",
    })
  } catch (error) {
    console.log(error)
  }

  let insertedCount = 0,
    updatedCount = 0,
    upsertedCount
  return new Promise(resolve => {
    mongoBatchPage({ limit: 1000 })
      .preLoad(async () => {
        const count = await mongo.RawCandidate.countDocuments(filters)
        bgJob.attrs.data ={
          ...(bgJob.attrs.data || {}),
          total: count,
        }
        bgJob.save()
        return count
      })
      .load(async (limit, skip) => {
        const cmd = mongo.RawCandidate.find(filters).sort({ _id: 1 }).limit(limit).skip(skip)
        return await cmd.toArray()
      })
      .onended(() => {
        bgJob.attrs.data = {
          ...(bgJob.attrs.data || {}),
          progress: null,
          insertedCount,
          updatedCount,
          upsertedCount,
        }
        bgJob.save()
        updateBackgroundJobStatus({
          jobId: bgJob.attrs._id,
          status: "IDLE",
          progress: null,
        })
        resolve()
      })
      .onAfterRun((progress) => {
        bgJob.attrs.data = {
          ...(bgJob.attrs.data || {}),
          progress,
        }
        bgJob.save()
        updateBackgroundJobStatus({
          jobId: bgJob.attrs._id,
          status: "PROCESSING",
          progress,
        })
      })
      .run(async (rawCandidates) => {
        const candidateArgs = await Promise.all(rawCandidates.map(async rawCandidate => {
          let fullText = rawCandidate.fullText
          if (!fullText) {
            try {
              const htmlData = await fs.readFile(rawCandidate.filePath, { encoding: 'utf-8' })
              fullText = convert(htmlData, { wordwrap: false })
            } catch (err) {
              console.log(err)
            }
            if (!fullText && rawCandidate.htmlData) {
              fullText = convert(rawCandidate.htmlData, { wordwrap: false })
            }
          }
          const args = {
            status: "ACTIVE",
            fullName: rawCandidate.fullName,
            mobileNumber: rawCandidate.phone,
            mobileCode: "65",
            email: rawCandidate.email,
            updatedAt: Date.now(),
            rawCandidateId: rawCandidate._id,
            fullText,
          }

          return {
            updateOne: {
              filter: { email: args.email },
              update: {
                $set: args,
                $setOnInsert: {
                  createdAt: Date.now(),
                  industries: [],
                  addresses: [],
                  idealEmployments: [],
                  importFrom: "PST",
                },
              },
              upsert: true,
            },
          }
        }))
        await asyncChunk(candidateArgs, 40)(async candidates => {
          const rs =  await mongo.People.bulkWrite(candidates)
          insertedCount += rs.insertedCount
          updatedCount += rs.modifiedCount
          upsertedCount += rs.upsertedCount
        })
      })
  })
}

function updateBackgroundJobStatus({ jobId, status, progress, }) {
  pubsub.publish(
    process.env.APP_NAME + "-" + process.env.APP_ENV + "-BackgroundJob",
    {
      BackgroundJob: {
        jobId,
        status,
        progress,
      },
    }
  );
}