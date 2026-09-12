import buildIndustries from './industries'
import buildDesignations from './designations'
import buildJobSources from './jobSources'

const parameterValues = [
  {
    "Type": "Gender",
    "code": "Male",
    "label": "Male"
  },
  {
    "Type": "Gender",
    "code": "Female",
    "label": "Female"
  },
  {
    "Type": "Period",
    "code": "Hourly Rate",
    "label": "Hourly Rate"
  },
  {
    "Type": "Period",
    "code": "Daily Rate",
    "label": "Daily Rate"
  },
  {
    "Type": "Period",
    "code": "Weekly Rate",
    "label": "Weekly Rate"
  },
  {
    "Type": "Period",
    "code": "Monthly Rate",
    "label": "Monthly Rate"
  },
  {
    "Type": "Period",
    "code": "Annual Salary",
    "label": "Annual Salary"
  },
  {
    "Type": "Guarantee Period",
    "code": "75 Days",
    "label": "75 Days"
  },
  {
    "Type": "Guarantee Period",
    "code": "90 Days",
    "label": "90 Days"
  },
  {
    "Type": "Work Type",
    "code": "Permanent",
    "label": "Permanent"
  },
  {
    "Type": "Work Type",
    "code": "Contract",
    "label": "Contract"
  },
  {
    "Type": "Work Type",
    "code": "Temp",
    "label": "Temp"
  },
  {
    "Type": "Work Type",
    "code": "Casual",
    "label": "Casual"
  },
  {
    "Type": "Job Type",
    "code": "Retained",
    "label": "Retained"
  },
  {
    "Type": "Job Type",
    "code": "Contingent",
    "label": "Contingent"
  },
  {
    "Type": "Nationality",
    "code": "Singapore Citizen",
    "label": "Singapore Citizen"
  },
  {
    "Type": "Nationality",
    "code": "Singapore PR",
    "label": "Singapore PR"
  },
  {
    "Type": "Nationality",
    "code": "Malaysian",
    "label": "Malaysian"
  },
  {
    "Type": "Nationality",
    "code": "others",
    "label": "Others"
  },
  {
    "Type": "Currency",
    "code": "SGD",
    "label": "SGD"
  },
  {
    "Type": "Currency",
    "code": "USD",
    "label": "USD"
  }, {
    "Type": "Currency",
    "code": "MYR",
    "label": "MYR"
  },
  ...buildIndustries(),
  ...buildDesignations(),
  ...buildJobSources(),
]

export default parameterValues
