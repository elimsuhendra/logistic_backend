import { ObjectId } from "mongodb"
import pubsub from 'utils/pubsub'

export async function executeCompanyReport({ report }, { mongo }) {
  await mongo.Report.updateOne({ _id: report._id }, { $set: {
    status: 'READY',
    downloadUrl: 'https://google.com'
  }})
  
  report = await mongo.Report.findOne({ _id: report._id })

  pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-Report', {
    Report: {
      mutation: 'UPDATED',
      previousValues: report,
      node: report
    }
  })
}

export async function executeOtherReport({ report }, { mongo }) {

}

export default async function executeReport({ id }, { mongo }) {
  const report = await mongo.Report.findOne({ _id: ObjectId(id), deletedAt: null })
  if (!report) return false

  switch (report.reportType) {
    case 'COMPANY_REPORT':
      await executeCompanyReport({ report }, { mongo })
      break;
  
    case 'OTHER_REPORT':
      await executeOtherReport({ report }, { mongo })
      break;
    default:
      break;
  }
  return true
}