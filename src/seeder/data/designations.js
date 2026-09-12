
import { formatSlug } from 'utils/common'

export default function buildDesignations() {
  const dataStr = `
    Director
    CEO
    Senior HR Executive
    Office Manager
    HR Manager
    HR Excutive
    HR Assistant
    Admin Department
  `

  const dataArr = dataStr.split("\n")
  .map(e => e.trim())
  .filter(e => !!e)

  return dataArr.map(e => ({
    "Type": "Designation",
    "code": e,
    "label": e
  }))
}