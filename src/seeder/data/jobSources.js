
import { formatSlug } from 'utils/common'

export default function buildJobSources() {
  const dataStr = `
    Existing client
    Client referral
    Staff referral
    Job ad
    Business Development
    Marketing
    Candidate referral
  `

  const dataArr = dataStr.split("\n")
  .map(e => e.trim())
  .filter(e => !!e)

  return dataArr.map(e => ({
    "Type": "Job Source",
    "code": e,
    "label": e
  }))
}