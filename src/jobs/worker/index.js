import { ObjectId } from 'mongodb'
import mongoConnector from "src/mongoConnector"
import path from "path"
import { extractPstFiles } from "utils/PstConverter"
import { convertRawCandidatesToRealCandidates } from "utils/candidates"
import appRoot from 'app-root-path'
import { cloneForecastsByYear } from 'utils/forecast'
import moment from "moment"

async function userIds(mongo, userIds) {
  return await mongo.User.find({
    _id: {
      $in: userIds.map(i => ObjectId(i))
    },
    deletedAt: null
  }).toArray() || null
}

export default async agenda => {
  const { mongo } = await mongoConnector()

  try {
    agenda.define(`people-email-worker`, async (job) => {
      const { to, peopleEmailId, candidateName } = job.attrs.data || {}
      const currentPeopleEmail = peopleEmailId ? await mongo.PeopleEmail.findOne({ _id: ObjectId(peopleEmailId), deletedAt: null }) : null
      if (currentPeopleEmail) {
        const { ccIds, bccIds, subject, content, attachments } = currentPeopleEmail
        const ccUsers = ccIds && ccIds.length > 0 && await userIds(mongo, ccIds) || null
        const bccUsers = bccIds && bccIds.length > 0 && await userIds(mongo, bccIds) || null
        let emailVariables = {
          to,
          subject,
          body: content,
          candidateName
        }
        if (ccUsers && ccUsers.length > 0) {
          emailVariables["cc"] = ccUsers.map(i => i.email)
        }
        if (bccUsers && bccUsers.length > 0) {
          emailVariables["bcc"] = bccUsers.map(i => i.email)
        }
        if (attachments && attachments.length > 0) {
          emailVariables["attachments"] = attachments.map(i => ({
            filename: i.documentName,
            path: i.documentUrl
          }))
        }
        agenda.now("people-send-email", emailVariables)
      }
    })

    agenda.define(`import-raw-candidates-from-pst-files`,
      { priority: "high", concurrency: 1, lockLifetime: 24 * 3600 * 1000 },
      async (job) => {
        // try to create index first
        try {
          await mongo.RawCandidate.createIndex({
            email: 1
          }, {
            unique: true
          })
        } catch (err) {
          console.log("[ERROR] Error when create index RawCandidate ", err)
        }
        // Run extracting files
        await extractPstFiles(
          path.resolve(appRoot.path, "pst_data"),
          path.resolve(appRoot.path, "pst_out"), async function (json) {
            if (json && json.email) {
              const timestamp = Date.now()
              await mongo.RawCandidate.updateOne(
                { email: json.email },
                {
                  $set: {
                    ...json,
                    updatedAt: timestamp,
                  },
                  $setOnInsert: {
                    createdAt: timestamp,
                  }
                },
                { upsert: true }
              )
            }
          })
      })

    agenda.define(`convert-raw-candidates`,
      { priority: "high", concurrency: 1, lockLifetime: 24 * 3600 * 1000 },
      async (job) => {
        await convertRawCandidatesToRealCandidates(job, { mongo })
      })
  } catch (err) {
    console.log('⛔️ ⛔️ ⛔️ Error when run job import-raw-candidates-from-pst-files Status: 500 - ', err)
  }

  agenda.define(
    `clone-adjusted-forecasts-by-year`,
    { priority: "high", concurrency: 1, lockLifetime: 1 * 3600 * 1000 },
    async (job) => {
      const now = moment.utc().utcOffset(8);
      let year = now.year();
      await cloneForecastsByYear({ year }, { mongo });
    },
  );
}