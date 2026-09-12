import { ObjectId } from 'mongodb'

import buildMongoFilters from 'src/utils/buildMongoFilters.js'
import buildMongoOrders from 'src/utils/buildMongoOrders.js'
import { compareObject, prepareCreate } from 'utils/model'
import { addSalesLog } from 'utils/jobApplicant'
import pubsub from 'src/utils/pubsub'
import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import {isJobOfferCompleted, sanitizeRegex, twoDecimalMaxLength} from "utils/common"
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import {jobApplicantFormatTotalFeeV3, getJobApplicantByFilter, jobApplicantFormatHelper  } from 'utils/jobApplicant'
import { getGroupByUserId } from 'utils/group'

import updateJobApplicantConsultantGroup from 'src/migrations/modification/updateJobApplicantConsultantGroup'
import updateJobOrderGroup from 'src/migrations/modification/updateJobOrderGroup'
import updateExternalSales from 'src/migrations/modification/updateExternalSales'
import updateCandidateContractStatus from 'src/migrations/modification/updateCandidateContractStatus'

import moment from 'moment'
import { withFilter } from 'graphql-subscriptions'
import _, { sum, uniqBy, cloneDeep } from "lodash"
import { buildExcelReport } from "src/helpers/excel/report"
import exportReport from "src/helpers/excel/exportReport"
import exportClientReport from "src/helpers/excel/exportClientReport"

const MONTH = 12
const SALARY_3X = 3

function formatPermanentFee({
  isAnnualSalary = false, salary = 0, allowanceFee = 0, isAWS = false, awsNumber = 0, 
  fee = 0, oneTimeFee = 0, percent = 0, isCoBroke = false
}) {
  if (isAnnualSalary) {
    if (isAWS) {
      const base = ((((salary * (MONTH + (awsNumber || 1))) + (allowanceFee * MONTH)) + oneTimeFee) * percent) + fee
      return parseFloat(base / (isCoBroke ? 2 : 1))
    } else {
      const base = ((((salary + allowanceFee) * MONTH) + oneTimeFee) * percent) + fee
      return parseFloat(base / (isCoBroke ? 2 : 1))
    }
  } else {
    const base = ((salary + allowanceFee + oneTimeFee) * percent) + fee
    return parseFloat(base / (isCoBroke ? 2 : 1))
  }
}
function formatContractFee({ salary = 0, fee = 0, oneTimeFee = 0, isCoBroke = false }) {
  const base = salary + fee + oneTimeFee
  return parseFloat(base / (isCoBroke ? 2 : 1))
}

function getMonths(start, end, format = 'MMM YYYY') {
  let startDate = moment(start);
  let endDate = moment(end);
  if (moment(moment(start).format("YYYY-MM-DD")).isSame(moment(end).format("YYYY-MM-DD"))) {
    return [startDate.format(format)]
  }
  let betweenMonths = []
  if (startDate < endDate){
    let date = startDate.startOf('month');
    while (date < endDate.endOf('month')) {
      betweenMonths.push(date.format(format));
      date.add(1,'month');
    }
  }
  return betweenMonths
}

function getYears(start, end) {
  let startDate = moment(start);
  let endDate = moment(end);
  if (moment(moment(start).format("YYYY-MM-DD")).isSame(moment(end).format("YYYY-MM-DD"))) {
    return [startDate.format("YYYY")]
  }
  let betweenYears = []
  if (startDate < endDate){
    let date = startDate.startOf('year');
    while (date < endDate.endOf('year')) {
      betweenYears.push(date.format("YYYY"));
      date.add(1,'year');
    }
  }
  return betweenYears
}

function jobApplicantFormatTotalFee({
  jobApplicant, jobApplicantReplacementSuccessList, jobApplicantsOffered, coBrokeConsultant, replacedCoBroke
}) {

  const offer = jobApplicant.offer || {}
  const jobApplicantsReplacementSuccess = (jobApplicantReplacementSuccessList || []).filter(i => i.jobId.toString() === jobApplicant.jobId.toString()).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
  const offerCandidate = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId == jobApplicant.candidateId.toString())
  const replacementSuccessCandidate = jobApplicantsReplacementSuccess.find(i => i.id.toString() === offer.replacementCandidateId)
  const isReplacement = offer.replacementCandidateId
  let totalFee = 0
  
  if (offer.workType === "Permanent") {
    if (!isReplacement) {
      totalFee = formatPermanentFee({
        isAnnualSalary: offer.period === "Annual Salary",
        salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
        isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
        awsNumber: offer.awsNumber,
        isCoBroke: offer.coBrokeConsultantId,
        percent: (offer.customerBillingPercentage || 0) / 100
      })
    } else {
      const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
      if (offer.chargeDifference && (chargeSalary > 0)) {
        totalFee = formatPermanentFee({
          isAnnualSalary: offer.period === "Annual Salary",
          salary: chargeSalary, allowanceFee: offer.allowanceFee, fee: offer.fee,
          isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
          awsNumber: offer.awsNumber,
          isCoBroke: offer.coBrokeConsultantId,
          percent: (offer.customerBillingPercentage || 0) / 100
        })
      }
    }
  } else {
    if (!isReplacement) {
      totalFee = formatContractFee({
        salary: offer.salary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
        isCoBroke: offer.coBrokeConsultantId,
      })
    }
  }
  if (offer.referred === "SHARED_WITH_OTHER") {
    if (jobApplicant.phase === "Successful Replacement") {
      const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (offerCandidate && offerCandidate.offer && offerCandidate.offer.coBrokeConsultantId)
      if (offer.isCoBrokeConsultant) { 
        if (isSameCoBroke) {
          totalFee = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: offer.salary, allowanceFee: offer.allowanceFee,
            isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
            isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
            percent: (offer.customerBillingPercentage || 0) / 100
          })
        } else {
          totalFee = 0
        }
      } else {
        if (offer.workType === "Permanent") {
          if (!isReplacement) {
            if (Object.keys(replacedCoBroke || {}).length > 0) {
              totalFee = formatPermanentFee({
                isAnnualSalary: offer.period === "Annual Salary",
                salary: offer.salary, allowanceFee: offer.allowanceFee,
                isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                percent: (offer.customerBillingPercentage || 0) / 100
              })
            } else {
              const percentResult = offer.customerBillingPercentage * (isSameCoBroke ? 1 : 2)
              totalFee = formatPermanentFee({
                isAnnualSalary: offer.period === "Annual Salary",
                salary: offer.salary, allowanceFee: offer.allowanceFee,
                isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                percent: percentResult / 100
              })
            }
          }
        }
      }
    } else if (jobApplicant.phase === "Offered") {
      const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.coBrokeConsultantId)
      if (offer.isCoBrokeConsultant) {
        if (!isSameCoBroke) {
          if (offer.workType === "Permanent") {
            totalFee = formatPermanentFee({
              isAnnualSalary: offer.period === "Annual Salary",
              salary: offer.salary, allowanceFee: offer.allowanceFee,
              isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
              isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
              percent: (offer.customerBillingPercentage || 0) / 100
            })
          } else {
            totalFee = formatContractFee({
              salary: offer.salary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
              isCoBroke: offer.coBrokeConsultantId,
            })
          }
        }
      } else {
        const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
        if (offer.workType === "Permanent" && isReplacement && offer.chargeDifference && (chargeSalary > 0)) {
          totalFee = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: chargeSalary, allowanceFee: offer.allowanceFee,
            isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
            isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
            percent: (offer.customerBillingPercentage || 0) / 100
          })
        }
      }
    }
    if (!!isReplacement) {
      if (!!offer.chargeDifference) {
        const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
        totalFee = formatPermanentFee({
          isAnnualSalary: offer.period === "Annual Salary",
          salary: chargeSalary, allowanceFee: offer.allowanceFee,
          isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
          isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
          percent: (offer.customerBillingPercentage || 0) / 100
        })
      } else {
        totalFee = 0
      }
    }
  }
  if (jobApplicant.phase === "Unsuccessful Sales") {
    if (jobApplicant.caseClose === "Cancel Invoice") {
      totalFee = 0
    } else if (jobApplicant.caseClose === "Refund 50%") {
      totalFee = totalFee / 2
    }
  }
  if (jobApplicant.phase === "Successful Replacement") { 
    if (offer.replacementReferred === "SHARED_WITH_OTHER") {
      if (offer.workType === "Permanent") {
        totalFee = formatPermanentFee({
          isAnnualSalary: offer.period === "Annual Salary",
          salary: offer.salary, allowanceFee: offer.allowanceFee,
          isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
          isCoBroke: true, oneTimeFee: offer.oneTimeFee,
          percent: (offer.customerBillingPercentage || 0) / 100
        })
      } else {
        totalFee = formatContractFee({
          salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
          isCoBroke: true,
        })
      }
    }
  }
  if (offer.isClone) {
    totalFee = 0
  }
  return totalFee
}

function jobApplicantFormatFiltered(jobApplicantOfferFilter) {
  const dateFormat = moment().valueOf("YYYY/MM/DD")

  let jobApplicantResponse = []
  jobApplicantOfferFilter.forEach(jobApplicant => {
    const offer = jobApplicant.offer || {}
    if (offer.workType != "Permanent" && !!offer.payrollCycleStartDate && !!offer.payrollCycleEndDate) {
      const contractMonthSalaries = offer.contractMonthSalaries || []
      const payrollCycleStartDate = moment(offer.payrollCycleStartDate).format("YYYY-MM-DD")
      const payrollCycleEndDate = moment(offer.payrollCycleEndDate).format("YYYY-MM-DD")
      let dates = []
      for (var m = moment(payrollCycleStartDate); m.isSameOrBefore(payrollCycleEndDate); m.add(1, "month")) {
        dates.push(moment(m).valueOf())
      }
      if (dates.length > 0) {
        dates.forEach(dateItem => {
          const isSameYear = moment(dateItem).isSame(dateFormat, 'year')
          if (isSameYear) {
            const currentMonthSalary = contractMonthSalaries.find(i => moment(i.month).isSame(dateItem, "month"))
            jobApplicantResponse.push({
              ...jobApplicant,
              offer: {
                ...jobApplicant.offer,
                payrollCycleEndDate: dateItem,
                salary: currentMonthSalary && currentMonthSalary.salary || 0
              }
            })
          }
        })
      } else {
        jobApplicantResponse.push(jobApplicant)
      }
    } else {
      jobApplicantResponse.push(jobApplicant)
    }
  })
  return jobApplicantResponse
}

function jobApplicantFormatFilteredV2(jobApplicantOfferFilter, startDate, endDate) {
  const dateFormat = moment().valueOf("YYYY/MM/DD")

  let jobApplicantResponse = []
  jobApplicantOfferFilter.forEach(jobApplicant => {
    const offer = jobApplicant.offer || {}
    if (offer.workType != "Permanent" && !!offer.payrollCycleStartDate && !!offer.payrollCycleEndDate) {
      const contractMonthSalaries = offer.contractMonthSalaries || []
      const payrollCycleStartDate = moment(offer.payrollCycleStartDate).format("YYYY-MM-DD")
      const payrollCycleEndDate = moment(offer.payrollCycleEndDate).format("YYYY-MM-DD")
      let dates = []
      for (var m = moment(payrollCycleStartDate); m.isSameOrBefore(payrollCycleEndDate); m.add(1, "month")) {
        dates.push(moment(m).valueOf())
      }
      if (dates.length > 0) {
        let salaryFilterDates = []
        dates.forEach(dateItem => {
          const isIn = moment(moment(dateItem).format("YYYY-MM-DD")).isBetween(moment(startDate).format("YYYY-MM-DD"), moment(endDate).format("YYYY-MM-DD"), null, '[]')
          if (isIn) salaryFilterDates.push(dateItem)
        })
        if (salaryFilterDates.length > 0){
          salaryFilterDates.forEach(dateItem => {
            const isSameYear = moment(dateItem).isSame(dateFormat, 'year')
            if (isSameYear) {
              const currentMonthSalary = contractMonthSalaries.find(i => moment(i.month).isSame(dateItem, "month"))
              jobApplicantResponse.push({
                ...jobApplicant,
                offer: {
                  ...jobApplicant.offer,
                  payrollCycleEndDate: dateItem,
                  salary: currentMonthSalary && currentMonthSalary.salary || 0
                }
              })
            }
          })
        }
      } else {
        jobApplicantResponse.push(jobApplicant)
      }
    } else {
      jobApplicantResponse.push(jobApplicant)
    }
  })
  return jobApplicantResponse
}

async function SalesSummaryByTime({mongo, dataloaders, phase, start, end, userIds}) {
  const startDate = moment.utc(moment(moment(start).startOf("M")).format("YYYY-MM-DD")).valueOf()
  const endDate = moment.utc(moment(moment(end).endOf("M")).format("YYYY-MM-DD")).valueOf()
  const months = getMonths(startDate, endDate, "MMMM YYYY")

  let dataMapped = await ActualSales({
    mongo, startDate, endDate, userIds
  })

  let jobSaleGroupByMonth = []
  let jobFalloutSaleGroupByMonth = []

  for (const dm of dataMapped) {
    jobSaleGroupByMonth.push(dm.value)
    let currentFallout = Number.isNaN(dm.valueFallout) ? 0 : dm.valueFallout
    jobFalloutSaleGroupByMonth.push(currentFallout)
  }

  // const currentMonthName = moment().format("MMMM")
  const totalSaleByMonth = _.sum(jobSaleGroupByMonth)
  const totalFalloutByMonth = _.sum(jobFalloutSaleGroupByMonth)
  const years = getYears(startDate, endDate)
  const users = await mongo.User.find({
    _id: {$in: userIds.map(id => ObjectId(id))},
    dateJoin: {$ne: null}, deletedAt: null
  }).toArray()

  const usersActive = users.filter(user => !!user)
  const salaryResult = []
  for (const user of usersActive) {
    const userSalaries = await mongo.UserSalary.find({
      userId: ObjectId(user._id),
      year: {
        $in: years.map(year => parseInt(year))
      },
      deletedAt: null
    }).toArray()
    const uniqUserSalaries = uniqBy(userSalaries, (e) => e.userId.toString() && e.year)
    let monthsByYear = []
    uniqUserSalaries.forEach(i => {
      monthsByYear.push(
        {month: `January ${i.year}`, salary: i.january}, {month: `February ${i.year}`, salary: i.february},
        {month: `March ${i.year}`, salary: i.march}, {month: `April ${i.year}`, salary: i.april},
        {month: `May ${i.year}`, salary: i.may}, {month: `June ${i.year}`, salary: i.june},
        {month: `July ${i.year}`, salary: i.july}, {month: `August ${i.year}`, salary: i.august},
        {month: `September ${i.year}`, salary: i.september}, {month: `October ${i.year}`, salary: i.october},
        {month: `November ${i.year}`, salary: i.november}, {month: `December ${i.year}`, salary: i.december},
      )
    })
    const dateJoin = user.dateJoin
    let monthNumbers = []
    months.forEach(month => {
      let monthItem = monthsByYear.find(i => i.month === month)
      if (!!monthItem) {
        let times = 0
        const formatMonth = moment(`${month.toLowerCase()} ${moment().format("YYYY")}`, "MMMM YYYY").valueOf()
        let dateType = moment(dateJoin).format("D") > 14 ? 2 : 1
        const monthDiff = moment(moment(formatMonth).format("YYYY-MM")).diff(moment(dateJoin).format("YYYY-MM"), "M")
        if (monthDiff < 0) times = 0
        else if (monthDiff === 0) times = dateType === 2 ? .5 : 1
        else if (monthDiff === 1) times = dateType === 2 ? 1 : 2
        else if (monthDiff === 2) times = dateType === 2 ? 2 : 3
        else if (monthDiff === 3) times = dateType === 2 ? 3 : 3
        else times = 3
        monthNumbers.push((monthItem.salary || 0) * times)
      }
    })
    salaryResult.push(monthNumbers)
  }
  const salary3xMonth = sum(salaryResult.flat())
  const target3xMonthAchieved = salary3xMonth <= 0 ? 0 : totalSaleByMonth / salary3xMonth * 100

  const userSaleForecasts = await mongo.Forecast.find(buildMongoFilters({
    adjusted_in: [null, false],
    userId_in: userIds,
    year: {
      $gte: moment.utc(moment(moment().startOf("y")).format("YYYY-MM-DD")).valueOf(),
      $lte: moment.utc(moment(moment().endOf("y")).format("YYYY-MM-DD")).valueOf()
    },
  })).sort({updatedAt: -1}).toArray()
  const uniqUserSaleForecasts = uniqBy(userSaleForecasts, (e) => e.userId.toString())
  const userAdjustedSaleForecasts = await mongo.Forecast.find(buildMongoFilters({
    adjusted: true,
    userId_in: userIds,
    year: {
      $gte: moment.utc(moment(moment().startOf("y")).format("YYYY-MM-DD")).valueOf(),
      $lte: moment.utc(moment(moment().endOf("y")).format("YYYY-MM-DD")).valueOf()
    },
  })).sort({updatedAt: -1}).toArray()
  const uniqUserAdjustedSaleForecasts = uniqBy(userAdjustedSaleForecasts, (e) => e.userId.toString())
  let userSaleForecastMonthArr = []
  let userAdjustedSaleForecastMonthArr = []
  months.forEach(month => {
    const splitMonth = month.split(" ")
    const itemSaleForecast = uniqUserSaleForecasts.map(i => i[splitMonth[0].toLowerCase()] || 0)
    const itemAdjustedSaleForecast = uniqUserAdjustedSaleForecasts.map(i => i[splitMonth[0].toLowerCase()] || 0)
    userSaleForecastMonthArr.push(itemSaleForecast)
    userAdjustedSaleForecastMonthArr.push(itemAdjustedSaleForecast)
  })
  const forecast3xMonth = sum(userSaleForecastMonthArr.flat())
  const forecast3xMonthAchieved = forecast3xMonth <= 0 ? 0 : totalSaleByMonth / forecast3xMonth * 100
  const adjustedForecast3xMonth = sum(userAdjustedSaleForecastMonthArr.flat())
  const adjustedForecast3xMonthAchieved = adjustedForecast3xMonth <= 0 ? 0 : totalSaleByMonth / adjustedForecast3xMonth * 100

  return {
    totalSale: totalSaleByMonth,
    falloutSale: totalFalloutByMonth,
    target3x: salary3xMonth,
    forecast3x: forecast3xMonth,
    adjustedForecast3x: adjustedForecast3xMonth,
    target3xAchieved: target3xMonthAchieved,
    forecast3xAchieved: forecast3xMonthAchieved,
    adjustedForecast3xAchieved: adjustedForecast3xMonthAchieved,
  }
}


async function ActualSales({mongo, startDate, endDate, userIds}){
  let jobApplicants = []
  let externalSales = []

  const months = getMonths(startDate, endDate, "MMMM YYYY")
  const months2 = getMonths(startDate, endDate, "MMMM")
  const year = moment(startDate).year()
  let phase_in = ["Offered", "Successful Replacement", "Unsuccessful Sales", "Void"]

  for (const month of months) {
    const start2 = moment(moment(month, 'MMMM YYYY').startOf("M")).format("YYYY-MM-DD")
    const end2 = moment(moment(month, 'MMMM YYYY').endOf("M")).format("YYYY-MM-DD")
    const startDate2 = moment.utc(start2).valueOf()
    const endDate2 = moment.utc(end2).valueOf()
    const monthName = moment(moment(month, 'MMMM YYYY').startOf("M")).format("MMM")
    const year = moment(moment(month, 'MMMM YYYY').startOf("M")).format("YYYY")
    let jobApplicantByFilter = await getJobApplicantByFilter({mongo, userIds, phase_in, formatStartDate : startDate2, formatEndDate : endDate2, monthName, year})

    jobApplicants.push(...jobApplicantByFilter.jobApplicants)
    externalSales.push(...jobApplicantByFilter.externalSales)
  }

  jobApplicants.filter(jobApplicant => {
      const offer = jobApplicant.offer || {}
      if (offer.workType != "Permanent") return jobApplicant
      const date = offer && (offer.replacementCandidateStartDate || offer.startDate)
      const dateEnd = offer && (offer.replacementCandidateEndDate || offer.endDate)
      const isSameDay = moment(date).isSame(startDate, "month")
      if(endDate){
        const isSameDayEnd = moment(dateEnd).isSame(endDate, "month")
        if (isSameDay || isSameDayEnd) return jobApplicant
      }else{
        if (isSameDay) return jobApplicant
      }
      return null
  })

  if (phase_in.length === 1 && phase_in.includes("Unsuccessful Sales")) {
    jobApplicants = jobApplicants.filter(i => i.caseClose !== "Refund 50%")
  } else {
    // TODO - Cancel Invoice case
    // jobApplicants = jobApplicants.filter(i => i.caseClose !== "Cancel Invoice")
  }

  let result = jobApplicantFormatHelper({jobApplicants})

  let jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
    const offer = i.offer || {}
    return offer.isCoBrokeConsultant 
      ? userIds.includes(offer.coBrokeConsultantId) 
      : userIds.includes(offer.consultantId)
  }) : result

  const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
    phase: {$in: ["Successful Replacement"]}, 
    jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
    offer: {$ne: null}, 
    deletedAt: null
  }).toArray()

  const jobApplicantsOfferedList = await mongo.JobApplicant.find({
    phase: {$in: ["Offered"]}, 
    jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
    offer: {$ne: null}, 
    inheritMTCMarketing: {$ne: true},
    deletedAt: null
  }).toArray()

  let jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))

  let jobSaleGrouped = []
  let jobApplicantResponse = jobApplicantFormatFilteredV2(jobApplicantOfferFilter, startDate, endDate)
  let jobApplicantIds = []
  let jobApplicantAmount = []
  
  for (const jobApplicant of jobApplicantOfferFilter) {
    const offer = jobApplicant.offer || {}
    const job = await mongo.JobOrder.findOne({_id: ObjectId(jobApplicant.jobId), deletedAt: null}) || {}
    const selectConsultant = await mongo.User.findOne({_id: ObjectId(offer.consultantId), deletedAt: null}) || {}
    const mainConsultant = await mongo.User.findOne({_id: ObjectId(job.ownerId), deletedAt: null}) || {}
    const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
    const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
    const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null

    let createdAtFormatDate = offer.startDate && moment(offer.startDate).valueOf("YYYY/MM/DD")
    if (!!offer.payrollCycleEndDate) {
      createdAtFormatDate = moment(offer.payrollCycleEndDate).valueOf("YYYY/MM/DD")
    }

    let consultantResult = null
    let groupId = null
    if (offer.referred === "SHARED_WITH_OTHER") {
      if (offer.isCoBrokeConsultant) {
        consultantResult = coBrokeConsultant
      } else {
        consultantResult = mainConsultant
      }
    } else {
      if (offer.referred === "CLOSED_MYSELF") {
        consultantResult = mainConsultant
      } else {
        consultantResult = selectConsultant
      }
    }

    let consultantResultId = consultantResult._id
    const group = await getGroupByUserId({mongo, userId: consultantResultId.toString()})

    if(!!group){
      groupId = group._id.toString()
    }

    let jobApplicantFormatTotalFee = jobApplicantFormatTotalFeeV3({
      jobApplicant,
      jobApplicantReplacementSuccessList,
      jobApplicantsOffered,
      coBrokeConsultant,
      replacedCoBroke,
      userIds,
      startDate,
      MONTH
    })

    let totalFee = jobApplicantFormatTotalFee.totalFee
    let totalFallout = jobApplicantFormatTotalFee.totalFallout

    jobSaleGrouped.push({
      userId: consultantResultId,
      userFullName: consultantResult.fullName,
      value: totalFee || 0,
      valueFallout: totalFallout || 0,
      groupId: groupId,
      monthName: jobApplicant.monthName,
      year: jobApplicant.year,
      dateJoin: consultantResult.dateJoin,
      jobApplicantId: jobApplicant._id.toString(),
      jobOrderId: jobApplicant.jobId.toString()
    })

    jobApplicantIds.push(jobApplicant._id.toString()+"-"+offer.salary+"-"+totalFee)
    jobApplicantAmount.push(totalFee)
  }

  let externalSaleGrouped = []
  let externalSaleGrouped2 = []

  for (const externalSale of externalSales) {
    externalSaleGrouped.push({
      userId: externalSale && externalSale.ownerId,
      value: externalSale.amount || 0,
      groupId: externalSale.groupId,
      monthName: externalSale.monthName,
      year: externalSale.year
    })

    jobApplicantIds.push(externalSale._id.toString()+"-"+externalSale.amount)
    jobApplicantAmount.push(externalSale.amount)
  }

  const dataMapped = [...jobSaleGrouped, ...externalSaleGrouped]

  return dataMapped
}

export default {
  JobApplicant: {
    id: parent => parent._id || parent.id,
    jobOrder: async ({ jobId }, args, { dataloaders }) => {
      return !!jobId ? await dataloaders.get('jobOrderByIdLoader').load(jobId) : null
    },
    candidate: async ({ candidateId }, args, { dataloaders }) => {
      return !!candidateId ? await dataloaders.get('peopleByIdLoader').load(candidateId) : null
    },
    workflow: async ({ workflowId }, args, { dataloaders }) => {
      return !!workflowId ? await dataloaders.get('workflowByIdLoader').load(workflowId) : null
    },
    documents: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('documentsByObject').load({ objectId: _id.toString(), objectType: 'JobApplicant', documentType: 'documents' })
    },
    notes: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('notesByJobApplicantIdLoader').load(_id)
    },
    activities: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('activitiesByJobApplicantIdLoader').load(_id)
    },
    inheritFromUser: async ({ inheritFromUserId }, args, { dataloaders }) => {
      return !!inheritFromUserId ? await dataloaders.get('userByIdLoader').load(inheritFromUserId) : null
    },
  },
  JobOffer: {
    consultant: async ({ consultantId }, args, { dataloaders }) => {
      return !!consultantId ? await dataloaders.get('userByIdLoader').load(consultantId) : null
    },
    coBrokeConsultant: async ({ coBrokeConsultantId }, args, { dataloaders }) => {
      return !!coBrokeConsultantId ? await dataloaders.get('userByIdLoader').load(coBrokeConsultantId) : null
    },
    replacementCandidate: async ({ replacementCandidateId }, args, { dataloaders }) => {
      return !!replacementCandidateId ? await dataloaders.get('peopleByIdLoader').load(replacementCandidateId) : null
    },
    replacementJob: async ({ replacementJobId }, args, { dataloaders }) => {
      return !!replacementJobId ? await dataloaders.get('jobOrderByIdLoader').load(replacementJobId) : null
    },
    replacementCoBrokeConsultant: async ({ replacementCoBrokeConsultantId }, args, { dataloaders }) => {
      return !!replacementCoBrokeConsultantId ? await dataloaders.get('userByIdLoader').load(replacementCoBrokeConsultantId) : null
    },
  },
  AnalyticsChartByType: {
    user: async ({ userId }, args, { dataloaders }) => {
      return !!userId ? await dataloaders.get('userByIdLoader').load(userId) : null
    },
  },
  Subscription: {
    JobApplicant: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV +'-JobApplicant'),
          (payload, args) => {
            return compareObject(payload.JobApplicant.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getJobApplicant: requiresAuth.createResolver(
      async (parent, { id }, { mongo, user }) => {
        const currentJobApplicant = id ? await mongo.JobApplicant.findOne({ _id: ObjectId(id), deletedAt: null }) : null
        return currentJobApplicant
    }),
    allJobApplicants: requiresAuth.createResolver(
      async (parent, { filter, first, skip, orderBy }, { mongo }) => {
        const limit = first || 10
        const offset = skip || 0
        const { mainConsultantIds, coBrokeConsultantIds, startDate_gte, startDate_lte, candidateStatus, search, ...params } = filter || {}
        const filters = buildMongoFilters(params)
        delete filters.deletedAt

        let searchFilter = null
        if (!!search) {
          let searchArr = {}
          const candidates = await mongo.People.find({ 
            fullName: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const candidateIds = candidates.map(candidate => ObjectId(candidate._id))
          const jobOrder = await mongo.JobOrder.find({ 
            title: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const jobOrderIds = jobOrder.map(jobOrder => ObjectId(jobOrder._id))

          const company = await mongo.Company.find({ 
            name: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const companyIds = company.map(company => ObjectId(company._id))
          const companyJobOrder = await mongo.JobOrder.find({ 
            companyId: {$in: companyIds},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const companyJobOrderIds = companyJobOrder.map(jobOrder => ObjectId(jobOrder._id))

          if (candidateIds && candidateIds.length > 0) {
            searchArr = {
              candidateId: {
                $in: candidateIds
              }
            }
          }
          if (jobOrderIds && jobOrderIds.length > 0) {
            searchArr = {
              ...searchArr,
              jobId: {
                $in: jobOrderIds
              }
            }
          }
          if (companyJobOrderIds && companyJobOrderIds.length > 0) {
            searchArr = {
              ...searchArr,
              jobId: {
                $in: [ ...searchArr.jobId.$in || [], companyJobOrderIds]
              }
            }
          }
          if (Object.keys(searchArr).length > 1) {
            const formatSearch = Object.keys(searchArr).map(i => ({[i]: searchArr[i]}))
            searchFilter = {"$or": formatSearch}
          } else if (Object.keys(searchArr).length === 1) {
            searchFilter = searchArr
          } else {
            searchFilter = {candidateId: search}
          }
        }

        let mainConsultantFilter = null
        if (!!mainConsultantIds && mainConsultantIds.length > 0) {
          const orders = await mongo.JobOrder.find({ 
            ownerId: {$in: mainConsultantIds.map(id => ObjectId(id))}, deletedAt: null 
          }).project({ _id: 1 }).toArray()
          const orderIds = orders.map(order => ObjectId(order._id))
          if (orderIds && orderIds.length > 0) {
            mainConsultantFilter = {
              jobId: {
                $in: orderIds
              }
            }
          }
        }
        
        let coBrokeConsultantFilter = null
        if (!!coBrokeConsultantIds && coBrokeConsultantIds.length > 0) {
          coBrokeConsultantFilter = {
            "$or": [
              {
                'offer.consultantId': {
                  $in: coBrokeConsultantIds
                }
              },
              {
                'offer.coBrokeConsultantId': {
                  $in: coBrokeConsultantIds
                }
              },
              {
                'offer.replacementCoBrokeConsultantId': {
                  $in: coBrokeConsultantIds
                }
              },
            ]
          }
        }

        let startDateFilter = null
        if (!!startDate_gte && !!startDate_lte) {
          startDateFilter = {
            "$or": [
              {
                "$or": [
                  {'offer.startDate': {
                    $gte: moment.utc(moment(startDate_gte).format("YYYY-MM-DD")).valueOf(),
                    $lte: moment.utc(moment(startDate_lte).format("YYYY-MM-DD")).valueOf()
                  }},
                  {'offer.replacementCandidateStartDate': {
                    $gte: moment.utc(moment(startDate_gte).format("YYYY-MM-DD")).valueOf(),
                    $lte: moment.utc(moment(startDate_lte).format("YYYY-MM-DD")).valueOf()
                  }},
                ],
                "offer.workType": {$eq: "Permanent"}
              },
              {
                "$and": [
                  {
                    'offer.payrollCycleStartDate': {
                      $lte: moment.utc(moment(startDate_lte).format("YYYY-MM-DD")).valueOf(),
                    }
                  },
                  {
                    'offer.payrollCycleEndDate': {
                      $gte: moment.utc(moment(startDate_gte).format("YYYY-MM-DD")).valueOf()
                    }
                  },
                  {"offer.workType": {$ne: "Permanent"}}
                ]
              }
            ]
          }
        }

        let candidateFilter = null
        if (!!candidateStatus) {
          const candidates = await mongo.People.find({ status: candidateStatus, deletedAt: null }).project({ _id: 1 }).toArray()
          const candidateIds = candidates.map(candidate => ObjectId(candidate._id))
          if (candidateIds && candidateIds.length > 0) {
            candidateFilter = {
              candidateId: {
                $in: candidateIds
              }
            }
          }
        }
        const filterResponse = [filters, searchFilter, startDateFilter, mainConsultantFilter, coBrokeConsultantFilter, candidateFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = filterResponse && filterResponse.length > 0 ? {
          $and: [
            {deletedAt: null},
            filters || {}, 
            searchFilter || {},
            startDateFilter || {},
            mainConsultantFilter || {mainConsultantIds},
            coBrokeConsultantFilter || {coBrokeConsultantIds},
            candidateFilter || {candidateStatus}
          ]
        }: {deletedAt: null}

        const obj = mongo.JobApplicant.find(filterResult)
        if (first) obj.limit(limit)
        if (skip) obj.skip(offset)
        if (orderBy) obj.sort(buildMongoOrders(orderBy))
        else obj.sort({ createdAt: -1 }) // -1 = DESC
        return await obj.toArray()
      }
    ),
    _allJobApplicantsMeta: requiresAuth.createResolver(
      async (parent, { filter }, { mongo }) => {
        const {mainConsultantIds, coBrokeConsultantIds, startDate_gte, startDate_lte, candidateStatus, search, ...rest} = filter || {}
        const filters = buildMongoFilters(rest)
        delete filters.deletedAt

        let searchFilter = null
        if (!!search) {
          let searchArr = {}
          const candidates = await mongo.People.find({ 
            fullName: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const candidateIds = candidates.map(candidate => ObjectId(candidate._id))
          const jobOrder = await mongo.JobOrder.find({ 
            title: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const jobOrderIds = jobOrder.map(jobOrder => ObjectId(jobOrder._id))

          const company = await mongo.Company.find({ 
            name: {$regex: `${sanitizeRegex(search)}`, $options: 'i'},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const companyIds = company.map(company => ObjectId(company._id))
          const companyJobOrder = await mongo.JobOrder.find({ 
            companyId: {$in: companyIds},
            deletedAt: null }).project({ _id: 1 }).toArray()
          const companyJobOrderIds = companyJobOrder.map(jobOrder => ObjectId(jobOrder._id))

          if (candidateIds && candidateIds.length > 0) {
            searchArr = {
              candidateId: {
                $in: candidateIds
              }
            }
          }
          if (jobOrderIds && jobOrderIds.length > 0) {
            searchArr = {
              ...searchArr,
              jobId: {
                $in: jobOrderIds
              }
            }
          }
          if (companyJobOrderIds && companyJobOrderIds.length > 0) {
            searchArr = {
              ...searchArr,
              jobId: {
                $in: [ ...searchArr.jobId.$in || [], companyJobOrderIds]
              }
            }
          }
          if (Object.keys(searchArr).length > 1) {
            const formatSearch = Object.keys(searchArr).map(i => ({[i]: searchArr[i]}))
            searchFilter = {"$or": formatSearch}
          } else if (Object.keys(searchArr).length === 1) {
            searchFilter = searchArr
          } else {
            searchFilter = {candidateId: search}
          }
        }

        let mainConsultantFilter = null
        if (!!mainConsultantIds && mainConsultantIds.length > 0) {
          const orders = await mongo.JobOrder.find({ 
            ownerId: {$in: mainConsultantIds.map(id => ObjectId(id))}, deletedAt: null 
          }).project({ _id: 1 }).toArray()
          const orderIds = orders.map(order => ObjectId(order._id))
          if (orderIds && orderIds.length > 0) {
            mainConsultantFilter = {
              jobId: {
                $in: orderIds
              }
            }
          }
        }
        let coBrokeConsultantFilter = null
        if (!!coBrokeConsultantIds && coBrokeConsultantIds.length > 0) {
          coBrokeConsultantFilter = {
            "$or": [
              {
                'offer.consultantId': {
                  $in: coBrokeConsultantIds
                }
              },
              {
                'offer.coBrokeConsultantId': {
                  $in: coBrokeConsultantIds
                }
              },
              {
                'offer.replacementCoBrokeConsultantId': {
                  $in: coBrokeConsultantIds
                }
              },
            ]
          }
        }
        let startDateFilter = null
        if (!!startDate_gte && !!startDate_lte) {
          startDateFilter = {
            "$or": [
              {
                "$or": [
                  {'offer.startDate': {
                    $gte: moment.utc(moment(startDate_gte).format("YYYY-MM-DD")).valueOf(),
                    $lte: moment.utc(moment(startDate_lte).format("YYYY-MM-DD")).valueOf()
                  }},
                  {'offer.replacementCandidateStartDate': {
                    $gte: moment.utc(moment(startDate_gte).format("YYYY-MM-DD")).valueOf(),
                    $lte: moment.utc(moment(startDate_lte).format("YYYY-MM-DD")).valueOf()
                  }},
                ],
                "offer.workType": {$eq: "Permanent"}
              },
              {
                "$and": [
                  {
                    'offer.payrollCycleStartDate': {
                      $lte: moment.utc(moment(startDate_lte).format("YYYY-MM-DD")).valueOf(),
                    }
                  },
                  {
                    'offer.payrollCycleEndDate': {
                      $gte: moment.utc(moment(startDate_gte).format("YYYY-MM-DD")).valueOf()
                    }
                  },
                  {"offer.workType": {$ne: "Permanent"}}
                ]
              }
            ]
          }
        }
        let candidateFilter = null
        if (!!candidateStatus) {
          const candidates = await mongo.People.find({ status: candidateStatus, deletedAt: null }).project({ _id: 1 }).toArray()
          const candidateIds = candidates.map(candidate => ObjectId(candidate._id))
          if (candidateIds && candidateIds.length > 0) {
            candidateFilter = {
              candidateId: {
                $in: candidateIds
              }
            }
          }
        }

        const filterResponse = [filters, searchFilter, startDateFilter, mainConsultantFilter, coBrokeConsultantFilter, candidateFilter].filter(i => !!i && Object.keys(i).length > 0)
        const filterResult = filterResponse && filterResponse.length > 0 ? {
          $and: [
            {deletedAt: null},
            filters || {},
            searchFilter || {},
            startDateFilter || {},
            mainConsultantFilter || {mainConsultantIds},
            coBrokeConsultantFilter || {coBrokeConsultantIds},
            candidateFilter || {candidateStatus}
          ]
        }: {deletedAt: null}

        const obj = mongo.JobApplicant.find(filterResult)

        return { count: obj.count() }
      }
    ),
    getSalesSummaryByYear: requiresAuth.createResolver(
      async (parent, { userIds }, { mongo }) => {
        const startDate = moment().startOf("y").valueOf()
        const endDate = moment().endOf("y").valueOf()

        const data = await SalesSummaryByTime({
          phase: ["Offered", "Successful Replacement", "Unsuccessful Sales", "Void"],
          mongo, start: startDate, end: endDate, userIds
        })
        return data
      }
    ),
    getSalesSummaryByTime: requiresAuth.createResolver(
      async (parent, { startDate: defaultStartDate, endDate: defaultEndDate, userIds }, { mongo }) => {
        const data = await SalesSummaryByTime({
          phase: ["Offered", "Successful Replacement", "Unsuccessful Sales", "Void"],
          mongo, start: defaultStartDate, end: defaultEndDate, userIds
        })
        return data
      }
    ),
    getCalendarInterview: requiresAuth.createResolver(
      async (parent, { startDate, endDate, userIds }, { mongo, user }) => {
        if (startDate && endDate) {
          const start = moment.utc(moment(startDate).format("YYYY-MM-DD")).valueOf()
          const end = moment.utc(moment(endDate).format("YYYY-MM-DD")).valueOf()
          const jobIdByUser = await mongo.JobOrder.find({ ownerId: {$in: userIds.map(id => ObjectId(id))}, deletedAt: null}).project({_id: 1}).map(x => x._id).toArray()
          let jobApplicants = []
          if (jobIdByUser && jobIdByUser.length > 0) {
            jobApplicants = await mongo.JobApplicant.find({
              jobId: {$in: jobIdByUser},
              phase: "Interview", 
              interviewDate: { $gte: start, $lte: end }, 
              deletedAt: null
            }).toArray()
          }
          if (jobApplicants && jobApplicants.length > 0) {
            const data = _(jobApplicants).groupBy(item => item.interviewDate)
                        .map((value, key) => ({ 
                          date: parseInt(key), 
                          interviewCount: value.length || 0,
                          listing: value
                        })).value()
            return data
          }
          return []
        }
        return []
    }),
    getJobOrderSales: requiresAuth.createResolver(
      async (parent, { date, userIds, phase_in }, { mongo }) => {
        const dateFormat = moment().valueOf("YYYY/MM/DD")
        const startDate = moment(date).startOf("M")
        const endDate = moment(date).endOf("M")
        const formatStartDate = moment.utc(moment(startDate).format("YYYY-MM-DD")).valueOf()
        const formatEndDate = moment.utc(moment(endDate).format("YYYY-MM-DD")).valueOf()
        let JobApplicantByFilter = await getJobApplicantByFilter({mongo, userIds, phase_in, formatStartDate, formatEndDate})
        let jobApplicants = JobApplicantByFilter.jobApplicants 
        jobApplicants.filter(jobApplicant => {
            const offer = jobApplicant.offer || {}
            if (offer.workType != "Permanent") return jobApplicant
            const date = offer && (offer.replacementCandidateStartDate || offer.startDate)
            const dateEnd = offer && (offer.replacementCandidateEndDate || offer.endDate)
            const isSameDay = moment(date).isSame(formatStartDate, "month")
            if(formatEndDate){
              const isSameDayEnd = moment(dateEnd).isSame(formatEndDate, "month")
              if (isSameDay || isSameDayEnd) return jobApplicant
            }else{
              if (isSameDay) return jobApplicant
            }
            return null
        })
        
        if (phase_in.length === 1 && phase_in.includes("Unsuccessful Sales")) {
          jobApplicants = jobApplicants.filter(i => i.caseClose !== "Refund 50%")
        } else {
          // TODO - Cancel Invoice case
          // jobApplicants = jobApplicants.filter(i => i.caseClose !== "Cancel Invoice")
        }
        
        let result = jobApplicantFormatHelper({jobApplicants})
        
        let jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
          const offer = i.offer || {}
          let flagReturn = true
          flagReturn = (offer.isCoBrokeConsultant ? userIds.includes(offer.coBrokeConsultantId) : userIds.includes(offer.consultantId))
          return flagReturn
        }) : result

        const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
          phase: {$in: ["Successful Replacement"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
          offer: {$ne: null}, 
          deletedAt: null
        }).toArray()

        const jobApplicantsOfferedList = await mongo.JobApplicant.find({
          phase: {$in: ["Offered"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null
        }).toArray()

        let jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
        
        let totalSaleNumbers = []
        let arrJobApplicants = []
        let arrJobApplicantsIds = []
        
        for (let jobApplicant of jobApplicantOfferFilter) {
          const offer = jobApplicant.offer || {}
          const jobApplicantsReplacementSuccess = (jobApplicantReplacementSuccessList || []).filter(i => i.jobId.toString() === jobApplicant.jobId.toString()).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
          const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
          const offerCandidate = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId == jobApplicant.candidateId.toString())
          const replacementSuccessCandidate = jobApplicantsReplacementSuccess.find(i => i.id.toString() === offer.replacementCandidateId)
          const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
          const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null
          
          const job = await mongo.JobOrder.findOne({_id: ObjectId(jobApplicant.jobId), deletedAt: null}) || {}
          const mainConsultant = await mongo.User.findOne({_id: ObjectId(job.ownerId), deletedAt: null}) || {}
          const selectConsultant = await mongo.User.findOne({_id: ObjectId(offer.consultantId), deletedAt: null}) || {}

          let jobApplicantFormatTotalFee = jobApplicantFormatTotalFeeV3({
            jobApplicant,
            jobApplicantReplacementSuccessList,
            jobApplicantsOffered,
            coBrokeConsultant,
            replacedCoBroke,
            userIds,
            startDate:formatStartDate,
            MONTH
          })
      
          let totalFee = jobApplicantFormatTotalFee.totalFee

          totalFee = totalFee + (jobApplicant.inheritSalary || 0)

          totalSaleNumbers.push(totalFee)
          jobApplicant.totalFee = Math.round(totalFee)
         
          arrJobApplicants.push(jobApplicant)
        }

        return {
          value: _.sum(totalSaleNumbers) || 0,
          list: arrJobApplicants
        }
      }
    ),
    getAnalyticsChart: requiresAuth.createResolver(
      async (parent, { startDate: defaultStartDate, endDate: defaultEndDate, userIds }, { mongo }) => {
        const dateFormat = moment().valueOf("YYYY/MM/DD")
        const months = getMonths(defaultStartDate, defaultEndDate)
        const startDate = moment.utc(moment(moment(defaultStartDate).startOf("M")).format("YYYY-MM-DD")).valueOf()
        const endDate = moment.utc(moment(moment(defaultEndDate).endOf("M")).format("YYYY-MM-DD")).valueOf()

        let jobApplicants = []
        let externalSales = []
        if (userIds && userIds.length > 0) {
          let jobApplicantFilters = {
            phase: {$in: ["Offered", "Successful Replacement", "Unsuccessful Sales"]}, 
            offer: {$ne: null}, 
            inheritMTCMarketing: {$ne: true},
            deletedAt: null,
            $and: [
              {$or: [
                {
                  'offer.consultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.coBrokeConsultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.replacementCoBrokeConsultantId': {
                    $in: userIds
                  }
                },
              ]},
              {$or: [
                {
                  "$or": [
                    {'offer.startDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                    {'offer.replacementCandidateStartDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                  ],
                  "offer.workType": {$eq: "Permanent"}
                },
                {
                  "$and": [
                    {
                      'offer.payrollCycleStartDate': {
                        $lte: endDate,
                      }
                    },
                    {
                      'offer.payrollCycleEndDate': {
                        $gte: startDate
                      }
                    },
                    {"offer.workType": {$ne: "Permanent"}}
                  ]
                }
              ]
            }]
          }
          jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).toArray()
          jobApplicants = jobApplicants.filter(i => i.caseClose !== "Cancel Invoice")
          let externalSaleFilters = {
            deletedAt: null,
            ownerId: {
              $in: userIds.map(id => ObjectId(id))
            },
            month: {
              $gte: startDate,
              $lte: endDate
            }
          }
          externalSales = await mongo.ExternalSale.find(externalSaleFilters).toArray()
        }
        
        let jobApplicantOfferFilter = []
        let result = jobApplicantFormatHelper({jobApplicants})
        jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
          const offer = i.offer || {}
          return offer.isCoBrokeConsultant 
            ? userIds.includes(offer.coBrokeConsultantId) 
            : userIds.includes(offer.consultantId)
        }) : result

        const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
          phase: {$in: ["Successful Replacement"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
          offer: {$ne: null}, 
          deletedAt: null
        }).toArray()

        const jobApplicantsOfferedList = await mongo.JobApplicant.find({
          phase: {$in: ["Offered"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null
        }).toArray()

        const jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
        
        let jobSaleGrouped = []
        let jobApplicantResponse = jobApplicantFormatFiltered(jobApplicantOfferFilter)

        for (const jobApplicant of jobApplicantResponse) {
          const offer = jobApplicant.offer || {}
          const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
          const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
          const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null

          let createdAtFormatDate = offer.startDate && moment(offer.startDate).valueOf("YYYY/MM/DD")
          if (!!offer.payrollCycleEndDate) {
            createdAtFormatDate = moment(offer.payrollCycleEndDate).valueOf("YYYY/MM/DD")
          }
          const isSameYear = moment(createdAtFormatDate).isSame(dateFormat, 'year')
          let totalFee = jobApplicantFormatTotalFee({
            jobApplicant, 
            jobApplicantReplacementSuccessList, 
            jobApplicantsOffered, 
            coBrokeConsultant, 
            replacedCoBroke
          })
          jobSaleGrouped.push({
            date: moment(createdAtFormatDate).format("MMM YYYY"),
            value: totalFee
          })
        }

        let externalSaleGrouped = []
        externalSales.forEach(externalSale => {
          let createdAtFormatDate = moment(externalSale.month || externalSale.createdAt).valueOf("YYYY/MM/DD")
          externalSaleGrouped.push({
            date: moment(createdAtFormatDate).format("MMM YYYY"),
            value: externalSale.amount || 0
          })
        })

        const dataMapped = [...jobSaleGrouped, ...externalSaleGrouped]
        const jobApplicantDataMapped = _.chain(dataMapped).groupBy("date").map((value, key) => ({ date: key, value: _.sum(value.map(i => i.value)) })).value()
        const data = months.map(month => {
          const dateItem = jobApplicantDataMapped.find(item => item.date === month)
          return ({
            date: month, value: dateItem && dateItem.value || 0
          })
        })
        return data
      }
    ),
    getAnalyticsByType: requiresAuth.createResolver(
      async (parent, { startDate: defaultStartDate, endDate: defaultEndDate, userIds }, { mongo, dataloaders }) => {
        const dateFormat = moment().valueOf("YYYY/MM/DD")
        const months = getMonths(defaultStartDate, defaultEndDate, "MMMM YYYY")
        const startDate = moment.utc(moment(moment(defaultStartDate).startOf("M")).format("YYYY-MM-DD")).valueOf()
        const endDate = moment.utc(moment(moment(defaultEndDate).endOf("M")).format("YYYY-MM-DD")).valueOf()
        const months2 = getMonths(defaultStartDate, defaultEndDate, "MMMM")

        let jobApplicants = []
        let externalSales = []
        if (userIds && userIds.length > 0) {
          let jobApplicantFilters = {
            phase: {$in: ["Offered", "Successful Replacement", "Unsuccessful Sales", "Void"]}, 
            offer: {$ne: null}, 
            inheritMTCMarketing: {$ne: true},
            deletedAt: null,
            $and: [
              {$or: [
                {
                  'offer.consultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.coBrokeConsultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.replacementCoBrokeConsultantId': {
                    $in: userIds
                  }
                },
              ]},
              {$or: [
                {
                  "$or": [
                    {'offer.startDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                    {'offer.replacementCandidateStartDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                  ],
                  "offer.workType": {$eq: "Permanent"}
                },
                {
                  "$and": [
                    {
                      'offer.payrollCycleStartDate': {
                        $lte: endDate,
                      }
                    },
                    {
                      'offer.payrollCycleEndDate': {
                        $gte: startDate
                      }
                    },
                    {"offer.workType": {$ne: "Permanent"}}
                  ]
                }
              ]
            }]
          }
          jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).toArray()
      
          let externalSaleFilters = {
            deletedAt: null,
            ownerId: {
              $in: userIds.map(id => ObjectId(id))
            },
            month: {
              $gte: startDate,
              $lte: endDate
            }
          }
          externalSales = await mongo.ExternalSale.find(externalSaleFilters).toArray()
        }
        
        let jobApplicantOfferFilter = []
        let result = jobApplicantFormatHelper({ jobApplicants })
        
        jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
          const offer = i.offer || {}
          return offer.isCoBrokeConsultant 
            ? userIds.includes(offer.coBrokeConsultantId) 
            : userIds.includes(offer.consultantId)
        }) : result

        const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
          phase: {$in: ["Successful Replacement"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
          offer: {$ne: null}, 
          deletedAt: null
        }).toArray()

        const jobApplicantsOfferedList = await mongo.JobApplicant.find({
          phase: {$in: ["Offered"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null
        }).toArray()

        const jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
        
        let jobSaleGrouped = []
        let jobApplicantResponse = jobApplicantFormatFilteredV2(jobApplicantOfferFilter, startDate, endDate)
       
        for (const jobApplicant of jobApplicantResponse) {
          const offer = jobApplicant.offer || {}
          const job = await mongo.JobOrder.findOne({_id: ObjectId(jobApplicant.jobId), deletedAt: null}) || {}
          const selectConsultant = await mongo.User.findOne({_id: ObjectId(offer.consultantId), deletedAt: null}) || {}
          const mainConsultant = await mongo.User.findOne({_id: ObjectId(job.ownerId), deletedAt: null}) || {}
          const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
          const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
          const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null

          let createdAtFormatDate = offer.startDate && moment(offer.startDate).valueOf("YYYY/MM/DD")
          if (!!offer.payrollCycleEndDate) {
            createdAtFormatDate = moment(offer.payrollCycleEndDate).valueOf("YYYY/MM/DD")
          }
          const isSameYear = moment(createdAtFormatDate).isSame(dateFormat, 'year')

          let consultantResult = null
          if (offer.referred === "SHARED_WITH_OTHER") {
            if (offer.isCoBrokeConsultant) {
              consultantResult = coBrokeConsultant
            } else {
              consultantResult = mainConsultant
            }
          } else {
            if (offer.referred === "CLOSED_MYSELF") {
              consultantResult = mainConsultant
            } else {
              consultantResult = selectConsultant
            }
          }

          let consultantResultId = consultantResult._id

          let jobApplicantFormatTotalFee = jobApplicantFormatTotalFeeV3({
            jobApplicant,
            jobApplicantReplacementSuccessList,
            jobApplicantsOffered,
            coBrokeConsultant,
            replacedCoBroke,
            userIds,
            startDate,
            MONTH
          })
      
          let totalFee = jobApplicantFormatTotalFee.totalFee

          jobSaleGrouped.push({
            userId: consultantResultId,
            userFullName: consultantResult.fullName,
            value: totalFee
          })
        }

        let externalSaleGrouped = []
        let externalSaleGrouped2 = []
        for (const externalSale of externalSales) {
          externalSaleGrouped.push({
            userId: externalSale && externalSale.ownerId,
            value: externalSale.amount || 0
          })
        }

        const dataMapped = [...jobSaleGrouped, ...externalSaleGrouped]
        const jobApplicantDataMapped = _.chain(dataMapped).groupBy("userId").map((value, key) => {
          return ({ userId: key, value: _.sum(value.map(i => i.value)) })
        }).value()
       
        const data = userIds.map(async userId => {
          const user = await mongo.User.findOne({_id: ObjectId(userId), deletedAt: null}) || {}
          const item = jobApplicantDataMapped.find(item => item.userId === userId)
          const userAvatar = await dataloaders.get('photoByObjectLoader').load({ objectId: ObjectId(userId), objectType: 'User' })
          const userSalary = await mongo.UserSalary.find({
            userId: ObjectId(userId), 
            year: {$in: [parseInt(moment(defaultStartDate).format("YYYY")), parseInt(moment(defaultEndDate).format("YYYY"))]}, 
            deletedAt: null
          }).toArray()
          let userSalaryArr = []
          const dateJoin = user.dateJoin
          let monthNumbers = []
          const salaryResult = []

          if (userSalary.length > 0) {
            userSalary.forEach(item => {
              let itemArr = [
                {label: `January ${item.year}`, value: item.january},
                {label: `February ${item.year}`, value: item.february},
                {label: `March ${item.year}`, value: item.march},
                {label: `April ${item.year}`, value: item.april},
                {label: `May ${item.year}`, value: item.may},
                {label: `June ${item.year}`, value: item.june},
                {label: `July ${item.year}`, value: item.july},
                {label: `August ${item.year}`, value: item.august},
                {label: `September ${item.year}`, value: item.september},
                {label: `October ${item.year}`, value: item.october},
                {label: `November ${item.year}`, value: item.november},
                {label: `December ${item.year}`, value: item.december},
              ]
              itemArr = itemArr.filter(i => months.includes(i.label))
              userSalaryArr.push(itemArr)
            })

            //get salaryResult
            const dateJoin = user.dateJoin
            let monthNumbers = []
            
            months2.forEach(month => {
              let times = 0
              let salary = userSalary[0][month.toLowerCase()] || 0
             
              const formatMonth = moment(`${month.toLowerCase()} ${moment().format("YYYY")}`, "MMMM YYYY").valueOf()
              const isDateJoinAfter = (dateJoin ? moment(moment(dateJoin).format("YYYY-MM")).isAfter(moment(formatMonth).format("YYYY-MM"), "M") : "")
             
              if (isDateJoinAfter) {
                times = 0
                salary = 0
              } else {
                let dateType = moment(dateJoin).format("D") > 14 ? 2 : 1
                const monthDiff = (dateJoin ? moment(moment(formatMonth).format("YYYY-MM")).diff(moment(dateJoin).format("YYYY-MM"), "M") : "")
               
                if (monthDiff < 0) times = 0
                  else if (monthDiff === 0) times = dateType === 2 ? .5 : 1
                  else if (monthDiff === 1) times = dateType === 2 ? 1 : 2
                  else if (monthDiff === 2) times = dateType === 2 ? 2 : 3
                  else if (monthDiff === 3) times = dateType === 2 ? 3 : 3
                  else times = 3
                }
             
              monthNumbers.push(salary * times)
            })
            salaryResult.push(monthNumbers)
          }
          const myArr = userSalaryArr.flat()
          const value = item && item.value || 0

          const salary3xYear = sum(salaryResult.flat())

          return ({
            userId, 
            userFullName: user && user.fullName, 
            userAvatar: userAvatar && userAvatar.imageUrl, 
            salary: _.sumBy(myArr, "value") * SALARY_3X,
            salary3xYear: salary3xYear,
            target3xYearAchieved: salary3xYear <= 0 ? 0 : value / salary3xYear * 100,
            value: value
          })
        })

        return data
      }
    ),
    getAnalyticsClient: requiresAuth.createResolver(
      async (parent, { startDate: defaultStartDate, endDate: defaultEndDate, userIds }, { mongo }) => {
        const dateFormat = moment().valueOf("YYYY/MM/DD")
        const months = getMonths(defaultStartDate, defaultEndDate)
        const startDate = moment.utc(moment(moment(defaultStartDate).startOf("D")).format("YYYY-MM-DD")).valueOf()
        const endDate = moment.utc(moment(moment(defaultEndDate).endOf("D")).format("YYYY-MM-DD")).valueOf()
        let jobApplicants = []
        let externalSales = []
        if (userIds && userIds.length > 0) {
          let jobApplicantFilters = {
            phase: {$in: ["Offered", "Successful Replacement", "Unsuccessful Sales"]}, 
            offer: {$ne: null}, 
            inheritMTCMarketing: {$ne: true},
            deletedAt: null,
            $and: [
              {$or: [
                {
                  'offer.consultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.coBrokeConsultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.replacementCoBrokeConsultantId': {
                    $in: userIds
                  }
                },
              ]},
              {$or: [
                {
                  "$or": [
                    {'offer.startDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                    {'offer.replacementCandidateStartDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                  ],
                  "offer.workType": {$eq: "Permanent"}
                },
                {
                  "$and": [
                    {
                      'offer.payrollCycleStartDate': {
                        $lte: endDate,
                      }
                    },
                    {
                      'offer.payrollCycleEndDate': {
                        $gte: startDate
                      }
                    },
                    {"offer.workType": {$ne: "Permanent"}}
                  ]
                }
              ]
            }]
          }
          jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).toArray()
          jobApplicants = jobApplicants.filter(i => i.caseClose !== "Cancel Invoice")
          let externalSaleFilters = {
            deletedAt: null,
            ownerId: {
              $in: userIds.map(id => ObjectId(id))
            },
            month: {
              $gte: startDate,
              $lte: endDate
            }
          }
          externalSales = await mongo.ExternalSale.find(externalSaleFilters).toArray()
        }

        let jobApplicantOfferFilter = []
        let result = jobApplicantFormatHelper({jobApplicants})
        jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
          const offer = i.offer || {}
          return offer.isCoBrokeConsultant 
            ? userIds.includes(offer.coBrokeConsultantId) 
            : userIds.includes(offer.consultantId)
        }) : result
        const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
          phase: {$in: ["Successful Replacement"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
          offer: {$ne: null}, 
          deletedAt: null
        }).toArray()

        const jobApplicantsOfferedList = await mongo.JobApplicant.find({
          phase: {$in: ["Offered"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null
        }).toArray()

        const jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
        
        let jobSaleGrouped = []
        let jobApplicantResponse = jobApplicantFormatFiltered(jobApplicantOfferFilter)

        for (const jobApplicant of jobApplicantResponse) {
          const offer = jobApplicant.offer || {}
          const jobOrder = jobApplicant.jobId && await mongo.JobOrder.findOne({_id: ObjectId(jobApplicant.jobId), deletedAt: null}) || null
          const company = jobOrder && jobOrder.companyId && await mongo.Company.findOne({_id: ObjectId(jobOrder.companyId), deletedAt: null}) || null
          const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
          const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
          const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null

          let createdAtFormatDate = offer.startDate && moment(offer.startDate).valueOf("YYYY/MM/DD")
          if (!!offer.payrollCycleEndDate) {
            createdAtFormatDate = moment(offer.payrollCycleEndDate).valueOf("YYYY/MM/DD")
          }
          
          let totalFee = jobApplicantFormatTotalFee({
            jobApplicant,
            jobApplicantReplacementSuccessList,
            jobApplicantsOffered,
            coBrokeConsultant,
            replacedCoBroke,
          })

          if (company && totalFee > 0) {
            jobSaleGrouped.push({
              companyId: company && company._id,
              companyName: company && company.name,
              value: totalFee
            })
          }
        }
        const jobApplicantDataMapped = _.chain(jobSaleGrouped).groupBy("companyId").map((value, key) => ({ 
          id: key, 
          name: value[0].companyName, 
          value: _.sum(value.map(i => i.value)) 
        })).value()
        return _.orderBy(jobApplicantDataMapped, ["name", "asc"])
      }
    ),
    getTeamReport: requiresAuth.createResolver(
      async (parent, { year }, { mongo }) => {
        const currentYear = year || moment()
        const groups = await mongo.Group.find({
          active: true,
          teamLeaderId: {$ne: null},
          staffIds: {$ne: null},
          deletedAt: null
        }).toArray()
        const startDate = moment(currentYear).startOf("y").valueOf()
        const endDate = moment(currentYear).endOf("y").valueOf()
        const months = getMonths(startDate, endDate, "YYYY-MM-DD")
        if (groups && groups.length > 0) {
          let groupResponse = []
          for (const group of groups) {
            const teamMemberIds = [group.teamLeaderId.toString(), ...group.staffIds].flat()
            const userIds = uniqBy(teamMemberIds)
            let monthResponse = []
            for (const month of months) {
              const formatMonth = moment(month).startOf("D").valueOf()
              const data = await SalesSummaryByTime({
                mongo, start: formatMonth, end: formatMonth, userIds,
                phase: ["Offered", "Successful Replacement", "Unsuccessful Sales"],
              })
              monthResponse.push({
                month: formatMonth,
                ...data
              })
            }
            groupResponse.push({
              id: group._id,
              name: group.name,
              data: monthResponse
            })
          }
          return groupResponse
        }
        return null
      }
    ),
    getIndividualReport: requiresAuth.createResolver(
      async (parent, { year }, { mongo }) => {
        const currentYear = year || moment()
        const groups = await mongo.Group.find({
          active: true,
          teamLeaderId: {$ne: null},
          staffIds: {$ne: null},
          deletedAt: null
        }).toArray()
        const users = await mongo.User.find({deletedAt: null, inactive: {$ne: true}, excludeIndividualReport: {$ne: true}}).toArray()
        const startDate = moment(currentYear).startOf("y").valueOf()
        const endDate = moment(currentYear).endOf("y").valueOf()
        const months = getMonths(startDate, endDate, "YYYY-MM-DD")

        let userResponse = []
        for (const user of users) {
          let monthResponse = []
          for (const month of months) {
            const formatMonth = moment(month).startOf("D").valueOf()
            const data = await SalesSummaryByTime({
              mongo, start: formatMonth, end: formatMonth, userIds: [user._id.toString()],
              phase: ["Offered", "Successful Replacement", "Unsuccessful Sales"],
            })
            monthResponse.push({
              month: formatMonth,
              ...data
            })
          }
          userResponse.push({
            id: user._id,
            name: user.fullName || user.email,
            data: monthResponse
          })
        }
        return userResponse
      }
    ),
    getActualSales: requiresAuth.createResolver(
      async (parent, { filter }, { mongo, dataloaders }) => {
        const {startDate, endDate, groupIds} = filter
        let userIds = []
        let groupUsers = []

        let groupFilter = {
          deletedAt: null
        }

        if(groupIds.indexOf("all") == -1){
          let groupIds2 = groupIds.map(groupId => {
            return ObjectId(groupId)
          })
          groupFilter = {
            deletedAt: null,
            _id: {$in: groupIds2}
          }
        }
        const groups = await mongo.Group.find(groupFilter).project({ _id: 1, staffIds: 1, teamLeaderId: 1, name: 1, createdAt: 1, updatedAt: 1 }).toArray()
        for (let i = 0; i < groups.length; i++) {
          let currGroup = groups[i]
          let currUsers = groups[i].staffIds || []
          currUsers.push(groups[i].teamLeaderId.toString())

          for (let j = 0; j < currUsers.length; j++) {
            let arr = {
              groupId: currGroup._id.toString(),
              userId: currUsers[j],
              userName: "",
              apr: 0,
              april: 0,
              aug: 0,
              august: 0,
              dec: 0,
              december: 0,
              editable: null,
              feb: 0,
              february: 0,
              groupId: currGroup._id.toString(),
              groupName: currGroup.name,
              jan: 0,
              january: 0,
              jul: 0,
              july: 0,
              jun: 0,
              june: 0,
              mar: 0,
              march: 0,
              may: 0,
              name: "",
              nov: 0,
              november: 0,
              oct: 0,
              october: 0,
              position: 0,
              q1: 0,
              q2: 0,
              q3: 0,
              q4: 0 ,
              sep: 0,
              september: 0,
              total: 0,
              type: "BAU",
              createdAt: currGroup.createdAt,
              updatedAt: currGroup.updatedAt,
              year: startDate
            }
            
            const indexUserId = userIds.indexOf(currUsers[j])
            if(indexUserId == -1){
              userIds.push(currUsers[j])
            }
            
            groupUsers.push(arr)
          }
        }

        let dataMapped = await ActualSales({
          mongo, startDate, endDate, userIds
        })

        if(groupUsers.length > 0){
          for (let i = 0; i < groupUsers.length; i++) {
            const currGroupUser = groupUsers[i]
            const lastGroupUser = groupUsers.find(groupUser => groupUser.userId == currGroupUser.userId && groupUser.updatedAt >= currGroupUser.updatedAt)
            const currDataMapped = dataMapped.filter(dm => currGroupUser.userId == dm.userId.toString() && currGroupUser.groupId == (!!dm.groupId ? dm.groupId.toString() : lastGroupUser.groupId))
            let userFullName
            if(!userFullName){
              const user = await mongo.User.findOne({_id: ObjectId(currGroupUser.userId)}) || null
              userFullName = user ? user.fullName : "" 
            }

            groupUsers[i]["userName"] = userFullName
            groupUsers[i]["name"] = userFullName

            if(currDataMapped && currDataMapped.length > 0){

              for (let j = 0; j < currDataMapped.length; j++) {
                const currDataMapped2 = currDataMapped[j]
                const userYearJoin = moment(currDataMapped2.dateJoin).format("YYYY")
                const selectedYear = moment(startDate).format("YYYY")
                const monthNameFull = moment(currDataMapped2.monthName, "MMM").format("MMMM").toLowerCase()
                const quarter = moment(currDataMapped2.monthName, "MMM").quarter()

                groupUsers[i][currDataMapped2.monthName.toLowerCase()] += currDataMapped2.value
                groupUsers[i][monthNameFull] += currDataMapped2.value
                groupUsers[i]["q"+quarter] += currDataMapped2.value
                groupUsers[i]["total"] += currDataMapped2.value
                if(userYearJoin == selectedYear){
                  groupUsers[i]["type"] = "GI"
                }
                
              }
            }
          }
        }

        return groupUsers
      }
    )
  },
  Mutation: {
    createJobApplicant: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const {candidateIds, jobId} = args
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        const currentJobOrder = await mongo.JobOrder.findOne({ _id: ObjectId(jobId), deletedAt: null })
        if (currentJobOrder && currentJobOrder.workflowId) {
          const newObjs = candidateIds.map((id, index) => prepareCreate({
            jobId, candidateId: ObjectId(id),
            phase: "Applicants", 
            workflowId: currentJobOrder.workflowId,
            position: index
          }))
          await mongo.JobApplicant.insertMany(newObjs)
          return {
            success: true,
            message: "Job applicant has been created successfully!",
          } 
        } else {
          return {
            success: false,
            message: "Job order can not find workflow.",
          }
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    updateJobApplicant: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { candidate } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        if(candidate){
          const updateCandidate = await mongoUpdate('People', candidate, context)
        }

        const jobApplicantId = new ObjectId(args.id)
        const getJobApplicant = await mongo.JobApplicant.findOne({_id: jobApplicantId})

        args.interviewDate = args["interviewDate"] ? moment.utc(moment(args["interviewDate"]).format("YYYY-MM-DD")).valueOf() : null
        args.interviewTime = args["interviewTime"] || null
        args.submittedDate = args["submittedDate"] ? moment.utc(moment(args["submittedDate"])).valueOf() : null
        if (args.offer && args.offer.startDate) {
          args.offer.startDate = moment.utc(moment(args["offer"]["startDate"]).format("YYYY-MM-DD")).valueOf()
        }
        if (args.offer && args.offer.endDate) {
          args.offer.endDate = moment.utc(moment(args["offer"]["endDate"]).format("YYYY-MM-DD")).valueOf()
        }
        if (args.offer && args.offer.replacementCandidateStartDate) {
          args.offer.replacementCandidateStartDate = moment.utc(moment(args["offer"]["replacementCandidateStartDate"]).format("YYYY-MM-DD")).valueOf()
        }
        if (args.offer && args.offer.payrollCycleStartDate) {
          args.offer.payrollCycleStartDate = moment.utc(moment(args["offer"]["payrollCycleStartDate"]).format("YYYY-MM-DD")).valueOf()
        }
        if (args.offer && args.offer.payrollCycleEndDate) {
          args.offer.payrollCycleEndDate = moment.utc(moment(args["offer"]["payrollCycleEndDate"]).format("YYYY-MM-DD")).valueOf()
        }
        if (args.offer && args.offer.contractMonthSalaries && args.offer.contractMonthSalaries.length) {
          args.offer.contractMonthSalaries = args.offer.contractMonthSalaries.map(i => ({
            month: moment.utc(moment(i.month).format("YYYY-MM-DD")).valueOf(), salary: i.salary, fee: i.fee
          }))
          
          args.contractInvoices = []
          if(args 
              && args.offer
              && args.offer.contractMonthSalaries 
              && getJobApplicant
              && getJobApplicant.contractInvoices ){
            for (let i = 0; i < args.offer.contractMonthSalaries.length; i++) {
              const currContractMonthSalary = args.offer.contractMonthSalaries[i]
              const currContractInvoice = getJobApplicant.contractInvoices[i]
              const sameMonth = (getJobApplicant.contractInvoices || []).find(contractInvoice => contractInvoice.month === currContractMonthSalary.month)
              
              let arrContractInvoice = {
                month: currContractMonthSalary.month,
                invoiceNo: null,
                invoiceAmount: null
              }

              if(sameMonth){
                arrContractInvoice.invoiceNo = currContractInvoice.invoiceNo
                arrContractInvoice.invoiceAmount = currContractInvoice.invoiceAmount
              }

              args.contractInvoices.push(arrContractInvoice)
            }
          }
        }
        
        let defaultArgs = cloneDeep(args)
        let jobApplicantArgs = cloneDeep(args)
        if (!!args.inheritFromUserId) {
          jobApplicantArgs.inheritSalary = parseFloat(defaultArgs.offer.salary / 2)
          if (defaultArgs.inheritFromConsultant === "Co-Broke Consultant") {
            if (args.phase === "Successful Replacement") {
              jobApplicantArgs["inheritFromUserId"] = args.inheritFromUserId
              if (args.offer.coBrokeConsultantId === args.inheritFromUserId) {
                jobApplicantArgs.offer["coBrokeConsultantId"] = args.offer.replacementCoBrokeConsultantId
              }
            } else {
              jobApplicantArgs.offer["coBrokeConsultantId"] = defaultArgs.inheritFromUserId
              jobApplicantArgs["inheritFromUserId"] = defaultArgs.offer["coBrokeConsultantId"]
            }
          } else {
            if (args.phase === "Successful Replacement") {
              jobApplicantArgs["inheritFromUserId"] = args.inheritFromUserId
            } else {
              jobApplicantArgs.offer["consultantId"] = defaultArgs.inheritFromUserId
              jobApplicantArgs["inheritFromUserId"] = defaultArgs.offer["consultantId"]
            }
          }
        }
        const currentJobApplicant = await mongoUpdate('JobApplicant', jobApplicantArgs, context)

        if(args){
          const phase = jobApplicantArgs.phase
          const newJobApplicant = await mongo.JobApplicant.findOne({_id: new ObjectId(jobApplicantArgs.id)})
          const creatorId = currentUser._id
          if(phase == "Offered" || phase == "Successful Replacement" || phase == "Unsuccessful Sales"){
            const salesLog = await addSalesLog({context, currentJobApplicant: newJobApplicant, phase, creatorId, jobApplicantArgs: jobApplicantArgs})
          }
        }

        if (!!args.inheritFromUserId) {
          const mtcMarketingUser = await mongo.User.findOne({username: "mtcmarketing", deletedAt: null})
          let newRecord = await mongo.JobApplicant.findOne({_id: ObjectId(args.id), deletedAt: null})
          newRecord["inheritMTCMarketing"] = true
          if (defaultArgs.inheritFromConsultant === "Co-Broke Consultant") {
            newRecord.offer["coBrokeConsultantId"] = mtcMarketingUser._id.toString()
          } else {
            newRecord.offer["consultantId"] = mtcMarketingUser._id.toString()
          }
          delete newRecord._id
          await mongoCreate('JobApplicant', newRecord, context)
        }
        const currentJobOrder = await mongo.JobOrder.findOne({ _id: ObjectId(currentJobApplicant.jobId), deletedAt: null })
        const jobOrderSlot = currentJobOrder.jobSlot || 0
        const jobApplicants = await mongo.JobApplicant.find({jobId: ObjectId(currentJobApplicant.jobId), phase: "Offered", offer: {$ne: null}, inheritMTCMarketing: {$ne: true}, deletedAt: null}).toArray()
        if (jobApplicants.length >= jobOrderSlot) {
          let isClosed = true
          for (let i = 0; i < jobApplicants.length; i++) {
            const item = jobApplicants[i]
            const offer = item.offer || {}
            const isCompleted = isJobOfferCompleted({
              workType: offer.workType,
              startDate: offer.startDate,
              endDate: offer.endDate,
              guaranteePeriod: offer.guaranteePeriod,
              replacementCandidateId: offer.replacementCandidateId,
            })
            if (!isCompleted) { 
              isClosed = false
              break 
            }
          }
          let jobArgs = {
            id: currentJobOrder._id,
            status: isClosed ? "CLOSED" : "COMPLETED"
          }
          if (isClosed) {
            jobArgs["jobCloseReason"] = "Completed"
          }
          const responseJobOrder = await mongoUpdate('JobOrder', jobArgs, context)
        } else {
          const responseJobOrder = await mongoUpdate('JobOrder', {
            id: currentJobOrder._id,
            status: "IN_PROGRESS"
          }, context)
        }

        return {
          success: true,
          message: "Job applicant has been updated successfully!",
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    cloneJobApplicant: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (args.jobApplicantId && args.jobId) {
        if (!!currentUser) {
          let currentJobApplicant = await mongo.JobApplicant.findOne({_id: ObjectId(args.jobApplicantId), deletedAt: null})
          if (currentJobApplicant) {
            delete currentJobApplicant["_id"]
            delete currentJobApplicant["createdAt"]
            delete currentJobApplicant["updatedAt"]
            delete currentJobApplicant["phase"]
            delete currentJobApplicant["jobId"]
            const newVariables = {
              ...currentJobApplicant,
              phase: "Successful Replacement",
              jobId: ObjectId(args.jobId),
              offer: {
                ...currentJobApplicant.offer,
                isClone: true,
                replacementType: "Replaced By",
                replacementJobId: args.jobId
              }
            }
            const data = await mongoCreate('JobApplicant', newVariables, context)
            return {
              success: true,
              message: "Job applicant has been cloned!",
            }
          }
          return {
            success: false,
            message: "Job applicant not found.",
          }
        }
        return {
          success: false,
          message: "Job applicant not found.",
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    updateJobApplicantDragging: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const {jobApplicantsInput} = args
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        let jobApplicantResult = []
        jobApplicantsInput.forEach(jobApplicant => {
          jobApplicant.jobApplicants.forEach(item => {
            jobApplicantResult.push({id: item.id, position: item.position, phase: jobApplicant.phase})
          })
        })
        jobApplicantResult.map(async item => {
          await mongo.JobApplicant.findOneAndUpdate(
            {
              _id: ObjectId(item.id)
            },
            {
              $set: {
                phase: item.phase,
                position: item.position,
              }
            },
            {
              returnOriginal: false
            }
          )
        })
        return {
          success: true,
          message: "Job applicant has been updated successfully!"
        }
      }

      return {
        success: false,
        message: "User is not authorized.",
      }
    }),
    deleteJobApplicant: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        await mongoDelete('JobApplicant', args, context)
        return {
          success: true,
          message: "Job applicant has been deleted successfully!"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    exportExcel: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { userIds, label, status, startDate, endDate } = args || {}
      const formatStartDate = moment.utc(moment(startDate).format("YYYY-MM-DD")).valueOf()
      const formatEndDate = moment.utc(moment(endDate).format("YYYY-MM-DD")).valueOf()
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        let jobApplicantFilters = {
          phase: {$in: ["Offered", "Successful Replacement", "Unsuccessful Sales"]}, 
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null,
          $and: [
            {$or: [
              {
                'offer.consultantId': {
                  $in: userIds
                }
              },
              {
                'offer.coBrokeConsultantId': {
                  $in: userIds
                }
              },
              {
                'offer.replacementCoBrokeConsultantId': {
                  $in: userIds
                }
              },
            ]},
            {$or: [
              {
                "$or": [
                  {'offer.startDate': {
                    $gte: formatStartDate,
                    $lte: formatEndDate
                  }},
                  {'offer.replacementCandidateStartDate': {
                    $gte: formatStartDate,
                    $lte: formatEndDate
                  }},
                ],
                "offer.workType": {$eq: "Permanent"}
              },
              {
                "$and": [
                  {
                    'offer.payrollCycleStartDate': {
                      $lte: formatEndDate,
                    }
                  },
                  {
                    'offer.payrollCycleEndDate': {
                      $gte: formatStartDate
                    }
                  },
                  {"offer.workType": {$ne: "Permanent"}}
                ]
              }
            ]
          }]
        }
        let jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).sort({ createdAt: -1 }).toArray()
        jobApplicants = jobApplicants.filter(jobApplicant => {
          const offer = jobApplicant.offer || {}
          if (offer.workType != "Permanent") return jobApplicant
          const date = offer && (offer.replacementCandidateStartDate || offer.startDate)
          const isSameDay = moment(date).isSame(formatStartDate, "month")
          if (isSameDay) return jobApplicant
          return null
        })

        jobApplicants = jobApplicants.filter(i => i.caseClose !== "Cancel Invoice")

        let jobOrderReportData = []
        let externalSaleReportData = []
        let jobApplicantOfferFilter = []
        let totalJobOderSales = 0
        let totalExternalSales = 0
        let result = jobApplicantFormatHelper({jobApplicants})

        jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
          const offer = i.offer || {}
          return offer.isCoBrokeConsultant 
            ? userIds.includes(offer.coBrokeConsultantId) 
            : userIds.includes(offer.consultantId)
        }) : result

        const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
          phase: {$in: ["Successful Replacement"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
          offer: {$ne: null}, 
          deletedAt: null
        }).toArray()

        const jobApplicantsOfferedList = await mongo.JobApplicant.find({
          phase: {$in: ["Offered"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null
        }).toArray()
        
        const jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))

        let totalPlacementFeeAmount = []
        for (const jobApplicant of jobApplicantOfferFilter) {
          const offer = jobApplicant.offer || {}
          const jobApplicantsReplacementSuccess = (jobApplicantReplacementSuccessList || []).filter(i => i.jobId.toString() === jobApplicant.jobId.toString()).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
          const job = await mongo.JobOrder.findOne({_id: ObjectId(jobApplicant.jobId), deletedAt: null}) || {}
          const replacementJob = offer.replacementJobId && offer.replacementType && await mongo.JobOrder.findOne({_id: ObjectId(offer.replacementJobId), deletedAt: null}) || null
          const company = await mongo.Company.findOne({_id: ObjectId(job && job.companyId), deletedAt: null}) || {}
          const candidate = await mongo.People.findOne({_id: ObjectId(jobApplicant.candidateId), deletedAt: null}) || {}
          const coBrokeConsultant = await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) || {}
          const selectConsultant = await mongo.User.findOne({_id: ObjectId(offer.consultantId), deletedAt: null}) || {}
          const inheritFromUser = await mongo.User.findOne({_id: ObjectId(jobApplicant.inheritFromUserId), deletedAt: null}) || {}
          const offerCandidate = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId == jobApplicant.candidateId.toString())
          const replacementSuccessCandidate = jobApplicantsReplacementSuccess.find(i => i.id.toString() === offer.replacementCandidateId)
          const coBrokeResponse = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
          const replacedCoBroke = coBrokeResponse && coBrokeResponse.offer && coBrokeResponse.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBrokeResponse.offer.coBrokeConsultantId), deletedAt: null}) : null
          const jobApplicantReplacementSuccessPhase = await mongo.JobApplicant.findOne({
            phase: "Successful Replacement", 
            jobId: ObjectId(jobApplicant.jobId),
            offer: {$exists: true},
            candidateId: offer.replacementCandidateId && ObjectId(offer.replacementCandidateId),
            deletedAt: null
          })
          let replaceBy = null
          if (!!jobApplicantReplacementSuccessPhase) {
            replaceBy = await mongo.People.findOne({_id: ObjectId(jobApplicantReplacementSuccessPhase.candidateId), deletedAt: null})
          }
          let replaceFor = null
          const jobApplicantOfferedPhase = await mongo.JobApplicant.findOne({
            phase: "Offered", 
            jobId: ObjectId(jobApplicant.jobId),
            offer: {$exists: true},
            "offer.replacementCandidateId": {
              $eq: jobApplicant.candidateId.toString()
            },
            deletedAt: null
          })
          if (!!jobApplicantOfferedPhase) {
            replaceFor = await mongo.People.findOne({_id: ObjectId(jobApplicantOfferedPhase.candidateId), deletedAt: null})
          }

          let consultantResult = null
          if (offer.referred === "SHARED_WITH_OTHER") {
            if (offer.isCoBrokeConsultant) {
              consultantResult = coBrokeConsultant
            } else {
              consultantResult = selectConsultant
            }
          } else {
            if (offer.referred === "CLOSED_MYSELF") {
              consultantResult = selectConsultant
            } else {
              consultantResult = selectConsultant
            }
          }

          let coBroke = ""
          let percentage = ""
          let replacedCandidate = ""
          let inheritFrom = ""

          if (offer.workType === "Permanent" && jobApplicant && jobApplicant.inheritFromUserId) {
            inheritFrom = `\n Inherit from ${inheritFromUser.fullName}`
          }

          if (offer.coBrokeConsultantId) {
            if (offer.isCoBrokeConsultant) {
              coBroke = `\n ${selectConsultant.fullName} (Co-Broke)`
            } else {
              coBroke = `\n ${coBrokeConsultant.fullName} (Co-Broke)`
            }
          }

          if (offer.workType === "Permanent") {
            let text = `${offer.coBrokeConsultant ? offer.coBrokeCustomerBillingPercentage : offer.customerBillingPercentage} %`
            if (offer.coBrokeConsultantId) {
              percentage = `${text} \n Co-broke`
            } else {
              percentage = text
            }
          }

          let totalPlacementFee = 0
          let baseSalary = offer.workType === "Permanent" && jobApplicant.inheritFromUserId ? (offer.salary * 2) : offer.salary
          const contractMonthSalaries = offer.contractMonthSalaries || []
          const currentMonthSalary = contractMonthSalaries.find(i => moment(i.month).isSame(formatStartDate, "month"))
          if (offer.workType != "Permanent") {
            if (!!currentMonthSalary) {
              baseSalary = currentMonthSalary.salary
            } else {
              baseSalary = 0
            }
          }
          const isReplacement = offer.replacementCandidateId
          if (offer.workType === "Permanent") {
            if (!isReplacement) {
              totalPlacementFee = formatPermanentFee({
                isAnnualSalary: offer.period === "Annual Salary",
                salary: offer.salary, allowanceFee: offer.allowanceFee,
                isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                percent: (offer.customerBillingPercentage || 0) / 100
              })
            } else {
              const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
              if (offer.chargeDifference && (chargeSalary > 0)) {
                totalPlacementFee = formatPermanentFee({
                  isAnnualSalary: offer.period === "Annual Salary",
                  salary: chargeSalary, allowanceFee: offer.allowanceFee,
                  isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                  isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                  percent: (offer.customerBillingPercentage || 0) / 100
                })
              }
            }
          } else {
            if (!isReplacement) {
              totalPlacementFee = formatContractFee({
                salary: baseSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
                isCoBroke: offer.coBrokeConsultantId,
              })
            }
          }
          if (offer.referred === "SHARED_WITH_OTHER") {
            if (jobApplicant.phase === "Successful Replacement") {
              const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (offerCandidate && offerCandidate.offer && offerCandidate.offer.coBrokeConsultantId)
              if (offer.isCoBrokeConsultant) {
                if (isSameCoBroke) {
                  totalPlacementFee = formatPermanentFee({
                    isAnnualSalary: offer.period === "Annual Salary",
                    salary: offer.salary, allowanceFee: offer.allowanceFee,
                    isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                    isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                    percent: (offer.customerBillingPercentage || 0) / 100
                  })
                } else {
                  totalPlacementFee = 0
                }
              }  else {
                if (offer.workType === "Permanent") {
                  if (!isReplacement) {
                    if (Object.keys(replacedCoBroke || {}).length > 0) {
                      totalPlacementFee = formatPermanentFee({
                        isAnnualSalary: offer.period === "Annual Salary",
                        salary: offer.salary, allowanceFee: offer.allowanceFee,
                        isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                        isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                        percent: (offer.customerBillingPercentage || 0) / 100
                      })
                    } else {
                      const percentResult = offer.customerBillingPercentage * (isSameCoBroke ? 1 : 2)
                      totalPlacementFee = formatPermanentFee({
                        isAnnualSalary: offer.period === "Annual Salary",
                        salary: offer.salary, allowanceFee: offer.allowanceFee,
                        isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                        isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                        percent: percentResult / 100
                      })
                    }
                  }
                }
              }
            } else if (jobApplicant.phase === "Offered") {
              const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.coBrokeConsultantId)
              if (offer.isCoBrokeConsultant) {
                if (!isSameCoBroke) {
                  if (offer.workType === "Permanent") {
                    totalPlacementFee = formatPermanentFee({
                      isAnnualSalary: offer.period === "Annual Salary",
                      salary: offer.salary, allowanceFee: offer.allowanceFee,
                      isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                      isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                      percent: (offer.customerBillingPercentage || 0) / 100
                    })
                  } else {
                    totalPlacementFee = formatContractFee({
                      salary: baseSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
                      isCoBroke: offer.coBrokeConsultantId,
                    })
                  }
                }
              } else {
                const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
                if (offer.workType === "Permanent" && isReplacement && offer.chargeDifference && (chargeSalary > 0)) {
                  totalPlacementFee = formatPermanentFee({
                    isAnnualSalary: offer.period === "Annual Salary",
                    salary: chargeSalary, allowanceFee: offer.allowanceFee,
                    isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                    isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                    percent: (offer.customerBillingPercentage || 0) / 100
                  })
                }
              }
            }
            if (!!isReplacement) {
              if (!!offer.chargeDifference) {
                const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
                totalPlacementFee = formatPermanentFee({
                  isAnnualSalary: offer.period === "Annual Salary",
                  salary: chargeSalary, allowanceFee: offer.allowanceFee,
                  isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                  isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                  percent: (offer.customerBillingPercentage || 0) / 100
                })
              } else {
                totalPlacementFee = 0
              }
            } 
          }

          if (jobApplicant.phase === "Successful Replacement") { 
            if (offer.replacementReferred === "SHARED_WITH_OTHER") {
              if (offer.workType === "Permanent") {
                totalPlacementFee = formatPermanentFee({
                  isAnnualSalary: offer.period === "Annual Salary",
                  salary: offer.salary, allowanceFee: offer.allowanceFee,
                  isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                  isCoBroke: true, oneTimeFee: offer.oneTimeFee,
                  percent: (offer.customerBillingPercentage || 0) / 100
                })
              } else {
                totalPlacementFee = formatContractFee({
                  salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
                  isCoBroke: true,
                })
              }
            }
          }

          if (jobApplicant.phase === "Unsuccessful Sales") {
            if (jobApplicant.caseClose === "Cancel Invoice") {
              totalPlacementFee = 0
            } else if (jobApplicant.caseClose === "Refund 50%") {
              totalPlacementFee = totalPlacementFee / 2
            }
          }

          if (offer.isClone) {
            totalPlacementFee = 0
          }

          if (offer.replacementCandidateId && !!jobApplicantReplacementSuccessPhase && !!replaceBy) {
            if (!!replacementJob) {
              replacedCandidate = `\n (Replacement for ${replaceBy.fullName} in ${replacementJob.title})`
            } else {
              replacedCandidate = `\n (Replacement for ${replaceBy.fullName})`
            }
          } else if (!!jobApplicantOfferedPhase) {
            if (!!replaceFor) {
              if (!!replacementJob) {
                replacedCandidate = `\n (Replacement by ${replaceFor.fullName} under ${replacementJob.title})`
              } else {
                replacedCandidate = `\n (Replacement by ${replaceFor.fullName})`
              }
            }
          } else if (jobApplicant.phase === "Successful Replacement" && !!replacementJob) {
            replacedCandidate = `\n (Replaced under ${replacementJob.title})`
          }

          if (jobApplicant.phase === "Unsuccessful Sales" && jobApplicant.caseClose === "Refund 50%") {
            replacedCandidate = `\n Refund 50%`
          }

          totalPlacementFeeAmount.push(totalPlacementFee)
          jobOrderReportData.push([
            parseInt(jobApplicantOfferFilter.findIndex(i => i == jobApplicant) + 1),
            company.name, job.title, `${candidate.fullName} ${replacedCandidate}`, offer.workType, 
            offer.startDate && moment(offer.startDate).format("DD MMM YYYY"),
            offer.guaranteePeriod > 0 && `${offer.guaranteePeriod} days` || "",
            `${consultantResult.fullName} ${inheritFrom} ${coBroke}`, baseSalary, percentage,
            offer.fee, totalPlacementFee, offer.remarks, offer.isClone
          ])    
        }
        
        totalJobOderSales = _.sum(totalPlacementFeeAmount)
        const externalSales = await mongo.ExternalSale.find({
          ownerId: {
            $in: userIds.map(id => ObjectId(id))
          }, 
          month: { $gte: formatStartDate, $lte: formatEndDate },
          deletedAt: null
        }).sort({ month: -1 }).toArray()
        if (externalSales && externalSales.length > 0) {
          totalExternalSales = (externalSales || []).reduce((acc, obj) => acc + (obj.amount || 0), 0)
          for (const externalSale of externalSales) {
            const owner = await mongo.User.findOne({_id: ObjectId(externalSale.ownerId), deletedAt: null})
            externalSaleReportData.push([
              parseInt(externalSales.findIndex(i => i == externalSale) + 1),
              owner && owner.fullName, externalSale.typeOfFee, 
              externalSale.candidate, externalSale.amount || 0
            ])
          }
        }
        const consultant = label && label.replace(/\s/g, "-").toLowerCase() || ""
        const fileName = `sales-report-${moment(formatStartDate).format("MMM-YYYY").toLowerCase()}-${consultant}-${status.toLowerCase()}`

        const buildResult = await buildExcelReport(
          fileName, exportReport({
            jobOrders: jobOrderReportData, 
            externalSales: externalSaleReportData,
            headerOptions: {
              consultant: label,
              date: moment(formatStartDate).format("MMM YYYY"),
              totalJobOderSales: parseFloat(totalJobOderSales).toFixed(2),
              totalExternalSales: parseFloat(totalExternalSales).toFixed(2),
              totalSales: parseFloat(totalJobOderSales + totalExternalSales)
            }
          })
        )

        if (!buildResult.success) {
          return {
            success: false,
            message: "Can not export file."
          }
        }
        return {
          success: true,
          message: "Export done",
          url: buildResult.url
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    exportClientExcel: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { userIds, label, status, startDate: defaultStartDate, endDate: defaultEndDate } = args || {}
      
      const startDate = moment.utc(moment(defaultStartDate).format("YYYY-MM-DD")).valueOf()
      const endDate = moment.utc(moment(defaultEndDate).format("YYYY-MM-DD")).valueOf()
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {

        let jobApplicants = []
        let externalSales = []
        if (userIds && userIds.length > 0) {
          let jobApplicantFilters = {
            phase: {$in: ["Offered", "Successful Replacement", "Unsuccessful Sales"]}, 
            offer: {$ne: null}, 
            inheritMTCMarketing: {$ne: true},
            deletedAt: null,
            $and: [
              {$or: [
                {
                  'offer.consultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.coBrokeConsultantId': {
                    $in: userIds
                  }
                },
                {
                  'offer.replacementCoBrokeConsultantId': {
                    $in: userIds
                  }
                },
              ]},
              {$or: [
                {
                  "$or": [
                    {'offer.startDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                    {'offer.replacementCandidateStartDate': {
                      $gte: startDate,
                      $lte: endDate
                    }},
                  ],
                  "offer.workType": {$eq: "Permanent"}
                },
                {
                  "$and": [
                    {
                      'offer.payrollCycleStartDate': {
                        $lte: endDate,
                      }
                    },
                    {
                      'offer.payrollCycleEndDate': {
                        $gte: startDate
                      }
                    },
                    {"offer.workType": {$ne: "Permanent"}}
                  ]
                }
              ]
            }]
          }
          jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).toArray()
          jobApplicants = jobApplicants.filter(i => i.caseClose !== "Cancel Invoice")
          let externalSaleFilters = {
            deletedAt: null,
            ownerId: {
              $in: userIds.map(id => ObjectId(id))
            },
            month: {
              $gte: startDate,
              $lte: endDate
            }
          }
          externalSales = await mongo.ExternalSale.find(externalSaleFilters).toArray()
        }

        let jobApplicantOfferFilter = []
        let result = jobApplicantFormatHelper({jobApplicants})
        jobApplicantOfferFilter = userIds && userIds.length > 0 ? result.filter(i => {
          const offer = i.offer || {}
          return offer.isCoBrokeConsultant 
            ? userIds.includes(offer.coBrokeConsultantId) 
            : userIds.includes(offer.consultantId)
        }) : result
        const jobApplicantReplacementSuccessList = await mongo.JobApplicant.find({
          phase: {$in: ["Successful Replacement"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))}, 
          offer: {$ne: null}, 
          deletedAt: null
        }).toArray()

        const jobApplicantsOfferedList = await mongo.JobApplicant.find({
          phase: {$in: ["Offered"]}, 
          jobId: {$in: jobApplicantOfferFilter.map(item => ObjectId(item.jobId))},
          offer: {$ne: null}, 
          inheritMTCMarketing: {$ne: true},
          deletedAt: null
        }).toArray()

        const jobApplicantsOffered = (jobApplicantsOfferedList || []).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
        
        let jobSaleGrouped = []
        let jobApplicantResponse = jobApplicantFormatFiltered(jobApplicantOfferFilter)

        for (const jobApplicant of jobApplicantResponse) {
          const offer = jobApplicant.offer || {}
          const jobOrder = jobApplicant.jobId && await mongo.JobOrder.findOne({_id: ObjectId(jobApplicant.jobId), deletedAt: null}) || null
          const company = jobOrder && jobOrder.companyId && await mongo.Company.findOne({_id: ObjectId(jobOrder.companyId), deletedAt: null}) || null
          const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
          const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === jobApplicant.candidateId.toString())
          const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null

          let createdAtFormatDate = offer.startDate && moment(offer.startDate).valueOf("YYYY/MM/DD")
          if (!!offer.payrollCycleEndDate) {
            createdAtFormatDate = moment(offer.payrollCycleEndDate).valueOf("YYYY/MM/DD")
          }
          let totalFee = jobApplicantFormatTotalFee({
            jobApplicant,
            jobApplicantReplacementSuccessList,
            jobApplicantsOffered,
            coBrokeConsultant,
            replacedCoBroke,
          })
          
          if (company && totalFee > 0) {
            jobSaleGrouped.push({
              companyId: company && company._id,
              companyName: company && company.name,
              value: totalFee
            })
          }
        }

        const jobApplicantDataMapped = _.chain(jobSaleGrouped).groupBy("companyId").map((value, key) => ({ 
          id: key, 
          name: value[0].companyName, 
          value: _.sum(value.map(i => i.value))
        })).value()
        const responseData = _.orderBy(jobApplicantDataMapped, ["name", "asc"])
        const fileName = `client-report-${moment(startDate).format("MMM-YYYY").toLowerCase()}-${moment(endDate).format("MMM-YYYY").toLowerCase()}`
        const buildResult = await buildExcelReport(
          fileName, exportClientReport({
            data: responseData.map(i => [i.name, i.value]),
            headerOptions: {
              title: label,
              time: moment().utc(moment().valueOf()).format("DD/MM/YYYY")
            }
          })
        )

        if (!buildResult.success) {
          return {
            success: false,
            message: "Can not export file."
          }
        }
        return {
          success: true,
          message: "Export done",
          url: buildResult.url
        }

      } else {
        return {
          success: false,
          message: "User is not authorized."
        }
      }
    }),
    updateJobApplicantContractInvoice: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })

      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!currentUser) {
        const currentJobApplicant = await mongo.JobApplicant.findOne({_id: ObjectId(args.id), deletedAt: null})
        if (!!currentJobApplicant) {
          let contractInvoices = [...(currentJobApplicant.contractInvoices || [])]
          const itemIdx = contractInvoices.findIndex(i => moment(i.month).format("MM-YYYY") === moment(args.month).format("MM-YYYY"))
          if (!!itemIdx !== -1) {
            contractInvoices[itemIdx]["invoiceNo"] = args.invoiceNo || null
            contractInvoices[itemIdx]["invoiceAmount"] = args.invoiceAmount || null
            await mongo.JobApplicant.findOneAndUpdate(
              {
                _id: ObjectId(currentJobApplicant._id),
              },
              { $set: { contractInvoices }},
              { returnOriginal: false }
            )
            return {
              success: true,
            }
          }
        }
        return {
          success: false,
          message: "Not found,"
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    generateAutoFillInvoice: requiresAuth.createResolver(async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        const jobApplicants = await mongo.JobApplicant.find({
          deletedAt: null,
          phase: {$in: ["Offered", "Successful Replacement", "Unsuccessful Sales", "Void"]}, 
          offer: {$ne: null},
          contractInvoices: {$eq: null},
          "offer.workType": "Contract / Temp / Part Time",
          "offer.contractMonthSalaries": {$ne: null},
        }).toArray()
        if (jobApplicants && jobApplicants.length > 0) {
          let variables = []
          jobApplicants.forEach(jobApplicant => {
            const contractMonthSalaries = jobApplicant.offer.contractMonthSalaries
            variables.push({
              id: ObjectId(jobApplicant._id),
              contractInvoices: contractMonthSalaries.map((contract, idx) => ({
                month: contract.month,
                invoiceNo: idx === 0 ? (jobApplicant.invoiceNo || null) : null,
                invoiceAmount: idx === 0 ? (jobApplicant.invoiceAmount || null) : null,
              }))
            })
          })
          if (variables && variables.length > 0) {
            const bulkArgs = variables.map(item => {
              return {
                updateOne: {
                  filter: { _id: ObjectId(item.id) },
                  update: {
                    $set: {
                      contractInvoices: item.contractInvoices
                    }
                  },
                  upsert: true
                }
              }
            })
            await mongo.JobApplicant.bulkWrite(bulkArgs, { ordered: true })
          }
        }
        return {
          success: true,
        }
      }
      return {
        success: false,
        message: "User is not authorized."
      }
    }),
    modifyJobApplicantGroup: requiresAuth.createResolver(async (parent, args, context) =>  {
      const { mongo } = context

      try {
        console.log("\n")
        console.log("Create migration.")
        console.log("\n")
  
        console.log('init updateJobApplicantConsultantGroup.')
        await updateJobApplicantConsultantGroup(context)
        console.log('init updateJobApplicantConsultantGroup done.')
  
        console.log('\n')
        console.log('init updateJobOrderGroup.')
        await updateJobOrderGroup(context)
        console.log('init updateJobOrderGroup done.')
  
        console.log('\n')
        console.log('init updateExternalSales.')
        await updateExternalSales(context)
        console.log('init updateExternalSales done.')
  
        console.log('\n')
        console.log('init updateCandidateContractStatus.')
        await updateCandidateContractStatus(context)
        console.log('init updateCandidateContractStatus done.')
        
        console.log('\n')
        console.log("Done!")
        console.log("\n")

        return {
          success: true,
          message: "Successfully run migration."
        }
      } catch (e) {
        return {
          success: false,
          message: e.stack
        }
      }
    }),
    createJobApplicantIndexes: requiresAuth.createResolver(
      async (parent, {}, { mongo, user }) => {
      try {
        await mongo.JobApplicant.createIndex(
          { phase: "text"},
          { name: "jobApplicant-phase-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { jobId: 1},
          { name: "jobApplicant-jobId-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { candidateId: 1},
          { name: "jobApplicant-candidateId-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { candidateStatus: 1},
          { name: "jobApplicant-candidateStatus-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { mainConsultantIds: 1},
          { name: "jobApplicant-mainConsultantIds-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { consultantId: 1},
          { name: "jobApplicant-consultantId-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { coBrokeConsultantIds: 1},
          { name: "jobApplicant-coBrokeConsultantIds-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { inheritMTCMarketing: 1},
          { name: "jobApplicant-inheritMTCMarketing-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { startDate: 1},
          { name: "jobApplicant-startDate-unique" }
        )
        await mongo.JobApplicant.createIndex(
          { endDate: 1},
          { name: "jobApplicant-endDate-unique" }
        )

        await mongo.JobApplicant.createIndex(
          { 'offer.startDate': 1, 'offer.replacementCandidateStartDate': 1, 'offer.workType': 1, 'offer.payrollCycleStartDate': 1, 'offer.payrollCycleEndDate': 1, 'offer.workType': 1, 'consultantGroupId': 1, 'coBrokeConsultantGroupId': 1},
          { name: "migration-updateJobApplicantConsultantGroup-index" }
        )
        await mongo.ExternalSale.createIndex(
          { ownerGroupId: 1, updatedAt: 1, createdAt: 1},
          { name: "migration-updateExternalSales-index" }
        )
        await mongo.JobOrder.createIndex(
          { ownerGroupId: 1, updatedAt: 1, createdAt: 1},
          { name: "migration-updateJobOrderGroup-index" }
        )

        return {
          success: true,
          message: "Done."
        }
      } catch (error) {
        return {
          success: false,
          message: error.message
        }
      }
    }),
  }
}