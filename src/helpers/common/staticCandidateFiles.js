import { ObjectId } from "mongodb"
import fs from "fs"

export async function handleRequestCandidateFiles(req, res, context) {
  const { rawCandidateId } = req.params
  const { mongo } = context
  const rawCandidate = await mongo.RawCandidate.findOne({ _id: ObjectId(rawCandidateId) })
  if (!rawCandidate) {
    return res.status(404).end()
  }
  if (rawCandidate.filePath && fs.existsSync(rawCandidate.filePath)) {
    res.status(200).sendFile(rawCandidate.filePath)
  } else if (rawCandidate.htmlData) {
    res.status(200).send(rawCandidate.htmlData)
  } else {
    return res.status(404).end()
  }
}