import { ObjectId } from 'mongodb'
import { prepareUpdate, prepareCreate, softNestedDelete } from 'src/utils/model'
import pubsub from 'src/utils/pubsub'
import _, { concat, round } from "lodash"
import moment from 'moment'
import { mongoCreate, mongoUpdate, mongoDelete } from 'utils/crud'
import jobApplicant from '../resolvers/jobApplicant'

export function jobApplicantFormatTotalFeeV2({
  jobApplicant, jobApplicantReplacementSuccessList, jobApplicantsOffered, coBrokeConsultant, replacedCoBroke, userIds, currUserId, MONTH
}, context)
{
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
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
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
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
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
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
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
                  percent: (offer.customerBillingPercentage || 0) / 100,
                  MONTH
                })
              } else {
                const percentResult = offer.customerBillingPercentage * (isSameCoBroke ? 1 : 2)
                totalFee = formatPermanentFee({
                  isAnnualSalary: offer.period === "Annual Salary",
                  salary: offer.salary, allowanceFee: offer.allowanceFee,
                  isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                  isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                  percent: percentResult / 100,
                  MONTH
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
                percent: (offer.customerBillingPercentage || 0) / 100,
                MONTH
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
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
            })
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
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
            })
          } else {
            totalFee = 0
          }
        }
      } else if (jobApplicant.phase === "Void") {
        const isReplaced = (
          !!offer.replacementCoBrokeConsultantId &&
          offer.replacementCoBrokeConsultantId !== offer.coBrokeConsultantId //&&
          // !(userIds || []).includes(offer.replacementCoBrokeConsultantId) &&
          // !(userIds || []).includes(offer.consultantId)
        )
       
        if (isReplaced) {
          totalFee = 0
        }
      }

      let arr_temp = [offer.coBrokeConsultantId, offer.consultantId]
     
      if(!arr_temp.includes(currUserId)){
        totalFee = 0
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
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
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
      
    if (jobApplicant.phase === "Unsuccessful Sales") {
      if (jobApplicant.caseClose === "Cancel Invoice") {
        totalFee = 0
      } else if (jobApplicant.caseClose === "Refund 50%") {
        totalFee = totalFee / 2
      }
    }
  
    if (!!jobApplicant.inheritFromUserId) {
      totalFee = totalFee + jobApplicant.inheritSalary
    }

    return totalFee
}

export function jobApplicantFormatTotalFeeV3({
  jobApplicant, jobApplicantReplacementSuccessList, jobApplicantsOffered, coBrokeConsultant, replacedCoBroke, userIds, startDate, MONTH
})
{
  const offer = jobApplicant.offer || {}
  const jobApplicantsReplacementSuccess = (jobApplicantReplacementSuccessList || []).filter(i => i.jobId.toString() === jobApplicant.jobId.toString()).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
  const offerCandidate = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId == jobApplicant.candidateId.toString())
  const replacementSuccessCandidate = jobApplicantsReplacementSuccess.find(i => i.id.toString() === offer.replacementCandidateId)
  
  let totalFee = 0
  let totalFallout = 0
  const isReplacement = offer.replacementCandidateId

  let offerSalary = 0
  const contractMonthSalaries = offer.contractMonthSalaries || []
  startDate = (jobApplicant.startDate ? jobApplicant.startDate : startDate)
  const currentMonthSalary = contractMonthSalaries.find(i => moment(i.month).isSame(startDate, "month"))
  if (!!currentMonthSalary) {
    offerSalary = currentMonthSalary.salary
  }

  if (offer.workType === "Permanent") {
    if (!isReplacement) {
      // if(jobApplicant.phase != "Void"){
      //   totalFee = formatPermanentFee({
      //     isAnnualSalary: offer.period === "Annual Salary",
      //     salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
      //     isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
      //     awsNumber: offer.awsNumber,
      //     isCoBroke: offer.coBrokeConsultantId,
      //     percent: (offer.customerBillingPercentage || 0) / 100,
      //     MONTH
      //   })
      // }else{
      //   totalFallout = formatPermanentFee({
      //     isAnnualSalary: offer.period === "Annual Salary",
      //     salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
      //     isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
      //     awsNumber: offer.awsNumber,
      //     isCoBroke: offer.coBrokeConsultantId,
      //     percent: (offer.customerBillingPercentage || 0) / 100,
      //     MONTH
      //   })

      // }

      totalFee = formatPermanentFee({
        isAnnualSalary: offer.period === "Annual Salary",
        salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
        isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
        awsNumber: offer.awsNumber,
        isCoBroke: offer.coBrokeConsultantId,
        percent: (offer.customerBillingPercentage || 0) / 100,
        MONTH
      })

      if (jobApplicant.phase === "Void") {
        totalFallout = formatPermanentFee({
          isAnnualSalary: offer.period === "Annual Salary",
          salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
          isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
          awsNumber: offer.awsNumber,
          isCoBroke: offer.coBrokeConsultantId,
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
        })
      }
    } else {
      const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
      if (offer.chargeDifference && (chargeSalary > 0)) {
        if(offer.period === "Monthly Rate" && !!replacementSuccessCandidate){
            let initialCandidatePlacementFee = (replacementSuccessCandidate.offer.salary + replacementSuccessCandidate.offer.allowanceFee) * (replacementSuccessCandidate.offer.customerBillingPercentage / 100)
            let replacementCandidateFee = (offer.salary + offer.allowanceFee) * (offer.customerBillingPercentage / 100)
            totalFee = replacementCandidateFee - initialCandidatePlacementFee / (offer.coBrokeConsultantId ? 2 : 1)

        }else{
          totalFee = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: chargeSalary, allowanceFee: offer.allowanceFee, fee: offer.fee,
            isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
            awsNumber: offer.awsNumber,
            isCoBroke: offer.coBrokeConsultantId,
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
          })
         
        }

        if (jobApplicant.phase === "Void") {
          totalFallout = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: chargeSalary, allowanceFee: offer.allowanceFee, fee: offer.fee,
            isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
            awsNumber: offer.awsNumber,
            isCoBroke: offer.coBrokeConsultantId,
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
          })
        }
      }
    }
  } else {
    if (!isReplacement) {
      totalFee = formatContractFee({
        salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
        isCoBroke: offer.coBrokeConsultantId
      })

      if (jobApplicant.phase === "Void") {
        totalFallout = formatContractFee({
          salary: offer.salary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
          isCoBroke: offer.coBrokeConsultantId,
        })
      }
    }
  }
  
  if (offer.referred === "SHARED_WITH_OTHER") {
    if (jobApplicant.phase === "Successful Replacement") {
      const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (offerCandidate && offerCandidate.offer && offerCandidate.offer.coBrokeConsultantId && offerCandidate.offer.coBrokeConsultantId && offerCandidate.offer.coBrokeConsultantId.toString())
      if (offer.isCoBrokeConsultant) { 
        if (isSameCoBroke) {
          totalFee = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: offer.salary, allowanceFee: offer.allowanceFee,
            isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
            isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
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
                percent: (offer.customerBillingPercentage || 0) / 100,
                MONTH
              })
            } else {
              const percentResult = offer.customerBillingPercentage * (isSameCoBroke ? 1 : 2)
              totalFee = formatPermanentFee({
                isAnnualSalary: offer.period === "Annual Salary",
                salary: offer.salary, allowanceFee: offer.allowanceFee,
                isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                percent: percentResult / 100,
                MONTH
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
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
            })
          } else {
            totalFee = formatContractFee({
              salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
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
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
          })

        }
      }
    } else if (jobApplicant.phase === "Void") {
      const isReplaced = (
        !!offer.replacementCoBrokeConsultantId &&
        offer.replacementCoBrokeConsultantId !== offer.coBrokeConsultantId &&
        !(userIds || []).includes(offer.replacementCoBrokeConsultantId) &&
        !(userIds || []).includes(offer.consultantId)
      )

      if (isReplaced) {
        totalFee = 0
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
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
        })
      } else {
        totalFee = 0
      }
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
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
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
    if (jobApplicant.phase === "Void") {
      totalFallout = 0
    }
  }

  if (jobApplicant.phase === "Unsuccessful Sales") {
    if (jobApplicant.caseClose === "Cancel Invoice") {
      totalFee = 0
    } else if (jobApplicant.caseClose === "Refund 50%") {
      totalFee = totalFee / 2
    }
  }

  return {
    totalFee: totalFee,
    totalFallout: totalFallout
  }
}

export function jobApplicantFormatTotalFeeV4({
  jobApplicant, jobApplicantReplacementSuccessList, jobApplicantsOffered, coBrokeConsultant, replacedCoBroke, userIds, startDate, MONTH
})
{
  const offer = jobApplicant.offer || {}
  const jobApplicantsReplacementSuccess = (jobApplicantReplacementSuccessList || []).filter(i => i.jobId.toString() === jobApplicant.jobId.toString()).map(jobApplicant => ({id: jobApplicant.candidateId, offer: jobApplicant.offer}))
  const offerCandidate = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId == jobApplicant.candidateId.toString())
  const replacementSuccessCandidate = jobApplicantsReplacementSuccess.find(i => i.id.toString() === offer.replacementCandidateId)
  
  let totalFee = 0
  let totalFallout = 0
  const isReplacement = offer.replacementCandidateId

  let offerSalary = 0
  const contractMonthSalaries = offer.contractMonthSalaries || []
  startDate = (jobApplicant.startDate ? jobApplicant.startDate : startDate)
  const currentMonthSalary = contractMonthSalaries.find(i => moment(i.month).isSame(startDate, "month"))
  if (!!currentMonthSalary) {
    offerSalary = currentMonthSalary.salary
  }

  let flagSuccessfulReplacement = false
  let flagReplacement = false
  if (jobApplicant.phase === "Offered") {
    if (offer.workType === "Permanent") {
      if (!isReplacement) {
        totalFee = formatPermanentFee({
          isAnnualSalary: offer.period === "Annual Salary",
          salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
          isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
          awsNumber: offer.awsNumber,
          isCoBroke: offer.coBrokeConsultantId,
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
        })

        if (jobApplicant.phase === "Void") {
          totalFallout = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
            isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
            awsNumber: offer.awsNumber,
            isCoBroke: offer.coBrokeConsultantId,
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
          })
        }
      } else {
        const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
        if (offer.chargeDifference && (chargeSalary > 0)) {
          if(offer.period == "Monthly Rate"){
              let initialCandidatePlacementFee = (replacementSuccessCandidate.offer.salary + replacementSuccessCandidate.offer.allowanceFee) * (replacementSuccessCandidate.offer.customerBillingPercentage / 100)
              let replacementCandidateFee = (offer.salary + offer.allowanceFee) * (offer.customerBillingPercentage / 100)
              totalFee = replacementCandidateFee - initialCandidatePlacementFee / (offer.coBrokeConsultantId ? 2 : 1)
          }else{
            totalFee = formatPermanentFee({
              isAnnualSalary: offer.period === "Annual Salary",
              salary: chargeSalary, allowanceFee: offer.allowanceFee, fee: offer.fee,
              isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
              awsNumber: offer.awsNumber,
              isCoBroke: offer.coBrokeConsultantId,
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
            })
          }

          if (jobApplicant.phase === "Void") {
            totalFallout = formatPermanentFee({
              isAnnualSalary: offer.period === "Annual Salary",
              salary: chargeSalary, allowanceFee: offer.allowanceFee, fee: offer.fee,
              isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
              awsNumber: offer.awsNumber,
              isCoBroke: offer.coBrokeConsultantId,
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
            })
          }
        }else{
            // if client holder different from candidate holder
            if(replacementSuccessCandidate && (replacementSuccessCandidate.consultantId != offer.consultantId)){
                // flagReplacement = true

                // totalFee = formatPermanentFee({
                //   isAnnualSalary: replacementSuccessCandidate.offer.period === "Annual Salary",
                //   salary: replacementSuccessCandidate.offer.salary, 
                //   allowanceFee: replacementSuccessCandidate.offer.allowanceFee, 
                //   fee: replacementSuccessCandidate.offer.fee,
                //   isAWS: replacementSuccessCandidate.offer.isAWS, 
                //   oneTimeFee: replacementSuccessCandidate.offer.oneTimeFee,
                //   awsNumber: replacementSuccessCandidate.offer.awsNumber,
                //   isCoBroke: replacementSuccessCandidate.offer.coBrokeConsultantId,
                //   percent: replacementSuccessCandidate.offer.customerBillingPercentage / 100,
                //   MONTH
                // })
            }
        }
      }
    } else if (offer.workType == "Contract / Temp / Part Time") {
      if (!isReplacement) {
        totalFee = formatContractFee({
          salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
          isCoBroke: offer.coBrokeConsultantId
        })

        if (jobApplicant.phase === "Void") {
          totalFallout = formatContractFee({
            salary: offer.salary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
            isCoBroke: offer.coBrokeConsultantId,
          })
        }
      }
    }
  }

  if (offer.referred === "SHARED_WITH_OTHER") {
    if (jobApplicant.phase === "Successful Replacement") {
      const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (offerCandidate && offerCandidate.offer && offerCandidate.offer.coBrokeConsultantId && offerCandidate.offer.coBrokeConsultantId && offerCandidate.offer.coBrokeConsultantId.toString())
      if (offer.isCoBrokeConsultant) {
        if (isSameCoBroke) {
          totalFee = formatPermanentFee({
            isAnnualSalary: offer.period === "Annual Salary",
            salary: offer.salary, allowanceFee: offer.allowanceFee,
            isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
            isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
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
                percent: (offer.customerBillingPercentage || 0) / 100,
                MONTH
              })
            } else {
              const percentResult = offer.customerBillingPercentage * (isSameCoBroke ? 1 : 2)
              totalFee = formatPermanentFee({
                isAnnualSalary: offer.period === "Annual Salary",
                salary: offer.salary, allowanceFee: offer.allowanceFee,
                isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
                isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
                percent: percentResult / 100,
                MONTH
              })

              // totalFee = formatPermanentFee({
              //   isAnnualSalary: offer.period === "Annual Salary",
              //   salary: offer.salary, allowanceFee: offer.allowanceFee, fee: offer.fee,
              //   isAWS: offer.isAWS, oneTimeFee: offer.oneTimeFee,
              //   awsNumber: offer.awsNumber,
              //   isCoBroke: offer.coBrokeConsultantId,
              //   percent: (offer.customerBillingPercentage || 0) / 100,
              //   MONTH
              // })

            }
          }
        }
      }
    } else if (jobApplicant.phase === "Offered") {
      const isSameCoBroke = (coBrokeConsultant && coBrokeConsultant._id.toString()) === (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.coBrokeConsultantId)
      if (offer.coBrokeConsultantId) {
        if (!isSameCoBroke) {
          if (offer.workType === "Permanent") {
            totalFee = formatPermanentFee({
              isAnnualSalary: offer.period === "Annual Salary",
              salary: offer.salary, allowanceFee: offer.allowanceFee,
              isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
              isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
              percent: (offer.customerBillingPercentage || 0) / 100,
              MONTH
            })
          } else {
            totalFee = formatContractFee({
              salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
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
            percent: (offer.customerBillingPercentage || 0) / 100,
            MONTH
          })
        }
      }
    } else if (jobApplicant.phase === "Void") {
      const isReplaced = (
        !!offer.replacementCoBrokeConsultantId &&
        offer.replacementCoBrokeConsultantId !== offer.coBrokeConsultantId &&
        !(userIds || []).includes(offer.replacementCoBrokeConsultantId) &&
        !(userIds || []).includes(offer.consultantId)
      )

      if (isReplaced) {
        totalFee = 0
      }
    }

    if (!!isReplacement && !flagReplacement) {
      if (!!offer.chargeDifference) {
        const chargeSalary = offer.salary - (replacementSuccessCandidate && replacementSuccessCandidate.offer && replacementSuccessCandidate.offer.salary || 0)
        totalFee = formatPermanentFee({
          isAnnualSalary: offer.period === "Annual Salary",
          salary: chargeSalary, allowanceFee: offer.allowanceFee,
          isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
          isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
        })
      } else {
        // totalFee = 0
      }
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
          percent: (offer.customerBillingPercentage || 0) / 100,
          MONTH
        })
      } else {
        totalFee = formatContractFee({
          salary: offerSalary, fee: offer.fee, oneTimeFee: offer.oneTimeFee,
          isCoBroke: true,
        })
      }
    }else{
      // compare client holder with candidate holder 
      let customerBillingPercentage = offer.customerBillingPercentage
      const clientHolder = offer.consultantId
      const candidateHolder = offerCandidate.consultantId
      customerBillingPercentage = customerBillingPercentage * (clientHolder == candidateHolder ? 1 : 1/2)

      totalFee = formatPermanentFee({
        isAnnualSalary: offer.period === "Annual Salary",
        salary: offer.salary, allowanceFee: offer.allowanceFee,
        isAWS: offer.isAWS, awsNumber: offer.awsNumber, fee: offer.fee,
        isCoBroke: offer.coBrokeConsultantId, oneTimeFee: offer.oneTimeFee,
        percent: customerBillingPercentage / 100,
        MONTH
      })
    }
  }

  if (offer.isClone) {
    totalFee = 0
    if (jobApplicant.phase === "Void") {
      totalFallout = 0
    }
  }

  if (jobApplicant.phase === "Unsuccessful Sales") {
    if (jobApplicant.caseClose === "Cancel Invoice") {
      totalFee = 0
    } else if (jobApplicant.caseClose === "Refund 50%") {
      totalFee = totalFee / 2
    }
  }

  return {
    totalFee: totalFee,
    totalFallout: totalFallout
  }
}

export async function getJobApplicantByFilter({
  mongo, userIds, phase_in, formatStartDate, formatEndDate, monthName = "", year = ""
}, context)
{
  let jobApplicants = []
  let externalSales = []
  if (userIds && userIds.length > 0) {
    let jobApplicantFilters = {
      phase: {$in: phase_in}, 
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
    jobApplicants = await mongo.JobApplicant.find(jobApplicantFilters).toArray()

    jobApplicants = jobApplicants.filter(jobApplicant => {
      let flagReturn = true
      const offer = jobApplicant.offer
      if (offer.replacementCandidateStartDate){
        let replacementCandidateStartDate = offer.replacementCandidateStartDate
        const isSameDay = moment(replacementCandidateStartDate).isSame(formatStartDate, "month")
        if(formatEndDate && offer.replacementCandidateEndDate){
          const dateEnd = offer.replacementCandidateEndDate
          const isSameDayEnd = moment(dateEnd).isSame(formatEndDate, "month")
          flagReturn =  (isSameDay || isSameDayEnd) ? true : false
        }else{
          flagReturn = (isSameDay ? true : false)
        }
      }

      return flagReturn
    })
    
    jobApplicants.map(jobApplicant => {
      jobApplicant.startDate = formatStartDate
      jobApplicant.endDate = formatEndDate
      jobApplicant.monthName = monthName
      jobApplicant.year = formatStartDate
    })
    
    let externalSaleFilters = {
      deletedAt: null,
      ownerId: {
        $in: userIds.map(id => ObjectId(id))
      },
      month: {
        $gte: formatStartDate,
        $lte: formatEndDate
      }
    }
    externalSales = await mongo.ExternalSale.find(externalSaleFilters).toArray()
    
    externalSales.map(externalSale =>{
      externalSale.monthName = monthName
      externalSale.year = formatStartDate
    })
  }
  return {
    jobApplicants: jobApplicants,
    externalSales: externalSales
  }
}

export function filterJobApplicantOfferWorkType ({jobApplicantOfferFilter, startDate, endDate, dateFormat}) 
{
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

export function jobApplicantFormatHelper({jobApplicants}) {
  let result = []
  jobApplicants.forEach(jobApplicant => {
    let offer = jobApplicant.offer || {}
    if (offer.workType === "Permanent" && jobApplicant.inheritFromUserId) {
      offer.salary = jobApplicant && jobApplicant.inheritSalary || 0
    }
    const isInheritSale = offer.workType === "Permanent" && !!jobApplicant.inheritFromUserId
    const coBrokeConsultant = offer && offer.coBrokeConsultantId
    if (coBrokeConsultant) {
      let defaultJobApplicant = {
        ...jobApplicant,
        offer: {
          ...offer,
        }
      }
      let coBrokeConsultantItem = {
        ...jobApplicant,
        offer: {
          ...offer,
          isCoBrokeConsultant: true,
        }
      }
      if (!!isInheritSale) {
        if (jobApplicant.inheritFromConsultant === "Co-Broke Consultant") {
          coBrokeConsultantItem.offer.salary = jobApplicant.inheritSalary || 0
        } else {
          defaultJobApplicant.offer.salary = jobApplicant.inheritSalary || 0
        }
      }
      const jobApplicantMerged = [defaultJobApplicant, coBrokeConsultantItem]
      result.push(...jobApplicantMerged)
      if (offer.replacementCoBrokeConsultantId && (offer.coBrokeConsultantId !== offer.replacementCoBrokeConsultantId)) {
        let coBrokeConsultantItem =  {
          ...jobApplicant,
          offer: {
            ...offer,
            coBrokeConsultantId: offer.replacementCoBrokeConsultantId,
            isCoBrokeConsultant: true,
            isReplacementCoBrokeConsultant: true,
          }
        }
        if (!!isInheritSale) {
          if (jobApplicant.inheritFromConsultant === "Co-Broke Consultant") {
            coBrokeConsultantItem.offer.salary = jobApplicant.inheritSalary || 0
          }
        }
        result.push(coBrokeConsultantItem)
      }
    } else if (offer.replacementCoBrokeConsultantId && (offer.coBrokeConsultantId !== offer.replacementCoBrokeConsultantId)) {
      let defaultJobApplicant = {
        ...jobApplicant,
        offer: {
          ...offer,
        }
      }
      let coBrokeConsultantItem =  {
        ...jobApplicant,
        offer: {
          ...offer,
          coBrokeConsultantId: offer.replacementCoBrokeConsultantId,
          isCoBrokeConsultant: true,
          isReplacementCoBrokeConsultant: true,
        }
      }
      if (!!isInheritSale) {
        if (jobApplicant.inheritFromConsultant === "Co-Broke Consultant") {
          coBrokeConsultantItem.offer.salary = jobApplicant.inheritSalary || 0
        } else {
          defaultJobApplicant.offer.salary = jobApplicant.inheritSalary || 0
        }
      }
      const jobApplicantMerged = [defaultJobApplicant, coBrokeConsultantItem]
      result.push(...jobApplicantMerged)
    } else {
      if (!!isInheritSale) {
        offer.salary = jobApplicant.inheritSalary || 0
      }
      result.push({...jobApplicant})
    }
  })
  return result
}

function formatPermanentFee({
  isAnnualSalary = false, salary = 0, allowanceFee = 0, isAWS = false, awsNumber = 0, 
  fee = 0, oneTimeFee = 0, percent = 0, isCoBroke = false, MONTH
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

async function getLastSalesLogPerJob(mongo, $arrMatches){
  let pipelines = [
      { 
        $match: $arrMatches
      },
      {
        $sort: { createdAt: -1 }
      },
      {
        $group: {
          _id: null,
          lastId: {$first: "$_id" },
          lastJobApplicantId: {$first: "$jobApplicantId"},
          lastJobId: {$first: "$jobId"},
          lastConsultantId: {$first: "$consultantId"},
          lastCoBrokeConsultantId: {$first: "$coBrokeConsultantId"},
          lastInvoiceAt: {$first: "$invoiceAt"},
          lastCreatedAt: {$first: "$createdAt"},
          lastAction: {$sum: "$action"},
          totalAmount: {$sum: "$amount"},
          count: {$sum: 1}
        }
      }
    ] 

    return mongo.SalesLog.aggregate(pipelines).toArray() || []
}

function increaseSalesLogOffered(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, finalConsultantId = ""){
  let increaseParams = []
  let decreaseParams = []
  let flagIncreaseSalesLogConsultant = false
  let amountConsultant = (currentJobApplicant.inheritFromConsultant == "Main Consultant" ? amount / 2 : amount)
  finalConsultantId = (finalConsultantId ? finalConsultantId : currentJobApplicant.offer.consultantId)
  if(amountBefore > 0){
    console.log("take out consultant:", amountBefore, amountConsultant, consultantIdBefore.toString(), finalConsultantId)
    if(amountBefore != amountConsultant || consultantIdBefore.toString() != finalConsultantId){
      const newParam = Object.assign({}, param)
      newParam.action = "Take Out"
      newParam.consultantId = consultantIdBefore
      newParam.actionDescription = "take out previous sales amount from consultant"
      newParam.amount = amountBefore * -1
      newParam.order = 1

      decreaseParams.push(newParam)
      flagIncreaseSalesLogConsultant = true
    }
  }else{
    flagIncreaseSalesLogConsultant = true
  }

  if(!!flagIncreaseSalesLogConsultant && amount > 0){
    const newParam = Object.assign({}, param)
    newParam.action = "Offered"
    newParam.consultantId = new ObjectId(finalConsultantId)
    newParam.amount = amount
    newParam.actionDescription = "Increase sales amount for offered"
    newParam.order = 1
    increaseParams.push(newParam)
  }

  return {
    decreaseParams: decreaseParams,
    increaseParams: increaseParams
  }
}

function increaseSalesLogOfferedCoBroke(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2, finalConsultantId = "", finalCoBrokeConsultantId = "" ){
  let increaseParams = []
  let decreaseParams = []
  let flagIncreaseSalesLogConsultant = false
  let amountConsultant = (currentJobApplicant.inheritFromConsultant == "Main Consultant" ? amount / 2 : amount)
  finalConsultantId = (finalConsultantId ? finalConsultantId : currentJobApplicant.offer.consultantId)
  if(amountBefore > 0){
    if(amountBefore != amountConsultant || consultantIdBefore.toString() != finalConsultantId.toString()){
      const newParam = Object.assign({}, param)
      newParam.action = "Take Out"
      newParam.consultantId = consultantIdBefore
      newParam.actionDescription = "take out previous sales amount from consultant"
      newParam.amount = amountBefore * -1
      newParam.order = 1

      decreaseParams.push(newParam)
      flagIncreaseSalesLogConsultant = true
    }
  }else{
    flagIncreaseSalesLogConsultant = true
  }

  // decrease last sales log coBroke
  let flagIncreaseSalesLogCoBroke = false

  let amountCoBroke = (currentJobApplicant.inheritFromConsultant == "Co-Broke Consultant" ? amount / 2 : amount)
  finalCoBrokeConsultantId = (finalCoBrokeConsultantId ? finalCoBrokeConsultantId : currentJobApplicant.offer.coBrokeConsultantId)
  if(coBrokeAmountBefore > 0){
    if(coBrokeAmountBefore != amountCoBroke || coBrokeConsultantIdBefore2.toString() != finalCoBrokeConsultantId.toString()){
      const newParam = Object.assign({}, param)
      newParam.action = "Take Out"
      newParam.consultantId = new ObjectId(coBrokeConsultantIdBefore2)
      newParam.actionDescription = "take out previous sales amount from coBroke consultant"
      newParam.amount = coBrokeAmountBefore * -1
      newParam.order = 2

      decreaseParams.push(newParam)
      flagIncreaseSalesLogCoBroke = true
    }
  }else{
    flagIncreaseSalesLogCoBroke = true
  }

  if(!!flagIncreaseSalesLogConsultant && amount > 0){
    const newParam = Object.assign({}, param)
    // newParam2.amountInOut = newAmount - amountBefore
    // newParam.action = "Offered"
    newParam.consultantId = new ObjectId(finalConsultantId)
    newParam.amount = amount
    newParam.actionDescription = "increase sales amount for offered for coBroke consultant"
    newParam.coBrokeConsultantId = currentJobApplicant.offer.coBrokeConsultantId
    newParam.order = 1
    increaseParams.push(newParam)
  }

  if(!!flagIncreaseSalesLogCoBroke && amount > 0){
    const newParam2 = Object.assign({}, param)
    // newParam22.amountInOut = newAmount - amountBefore
    // newParam2.action = "Offered"
    newParam2.consultantId = new ObjectId(finalCoBrokeConsultantId)
    newParam2.amount = amount
    newParam2.actionDescription = "increase sales amount for offered for coBroke consultant"
    newParam2.order = 2
    increaseParams.push(newParam2)
  }

  return {
    decreaseParams: decreaseParams,
    increaseParams: increaseParams
  }
}

function increaseSalesLogOfferedCoBrokeInherit(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2, mtcMarketingUser, salesLogMtcBefore, finalConsultantId = "", finalCoBrokeConsultantId = ""){
  let increaseParams = []
  let decreaseParams = []
  let flagIncreaseSalesLogConsultant = false
  let amountConsultant = (currentJobApplicant.inheritFromConsultant == "Main Consultant" ? amount / 2 : amount)
  finalConsultantId = (finalConsultantId ? finalConsultantId : currentJobApplicant.offer.consultantId)

  if(amountBefore > 0){
    if(amountBefore != amountConsultant || consultantIdBefore.toString() != finalConsultantId.toString()){
      const newParam = Object.assign({}, param)
      newParam.action = "Take Out"
      newParam.consultantId = consultantIdBefore
      newParam.actionDescription = "take out previous sales amount from consultant"
      newParam.amount = amountBefore * -1
      newParam.order = 1

      decreaseParams.push(newParam)
      flagIncreaseSalesLogConsultant = true
    }
  }else{
    flagIncreaseSalesLogConsultant = true
  }

  // decrease last sales log coBroke
  let flagIncreaseSalesLogCoBroke = false

  let amountCoBroke = (currentJobApplicant.inheritFromConsultant == "Co-Broke Consultant" ? amount / 2 : amount)
  finalCoBrokeConsultantId = (finalCoBrokeConsultantId ? finalCoBrokeConsultantId : currentJobApplicant.offer.coBrokeConsultantId)
  if(coBrokeAmountBefore > 0){
    if(coBrokeAmountBefore != amountCoBroke || coBrokeConsultantIdBefore2.toString() != finalCoBrokeConsultantId.toString()){
      const newParam = Object.assign({}, param)
      newParam.action = "Take Out"
      newParam.consultantId = new ObjectId(coBrokeConsultantIdBefore2)
      newParam.actionDescription = "take out previous sales amount from coBroke consultant"
      newParam.amount = coBrokeAmountBefore * -1
      newParam.order = 2

      decreaseParams.push(newParam)
      flagIncreaseSalesLogCoBroke = true
    }
  }else{
    flagIncreaseSalesLogCoBroke = true
  }

  let amountMtc = amount/2
  let flagIncreaseSalesLogMtc = false;
  if(!!salesLogMtcBefore){
    if(amountMtc != salesLogMtcBefore.totalAmount || salesLogMtcBefore.lastConsultantId.toString() != mtcMarketingUser._id.toString()){
      const newParam = Object.assign({}, param)
      newParam.action = "Take Out"
      newParam.consultantId = salesLogMtcBefore.lastConsultantId
      newParam.actionDescription = "take out previous sales amount for mtc"
      newParam.amount = salesLogMtcBefore.totalAmount * -1
      newParam.order = 3

      decreaseParams.push(newParam)
      flagIncreaseSalesLogMtc = true
    }
  }else{
    flagIncreaseSalesLogMtc = true
  }

  if(!!flagIncreaseSalesLogConsultant && amountConsultant > 0){
    const newParam = Object.assign({}, param)
    newParam.consultantId = currentJobApplicant.offer.consultantId
    newParam.coBrokeConsultantId = currentJobApplicant.offer.coBrokeConsultantId
    newParam.amount = amountConsultant
    newParam.actionDescription = "Inherit sales amount for consultant"
    newParam.order = 1
    increaseParams.push(newParam)
  }

  if(!!flagIncreaseSalesLogCoBroke && amountCoBroke > 0){
    const newParam = Object.assign({}, param)
    newParam.consultantId = new ObjectId(currentJobApplicant.offer.coBrokeConsultantId)
    newParam.amount = amountCoBroke
    newParam.actionDescription = "Inherit sales amount for coBroke consultant"
    newParam.order = 2
    increaseParams.push(newParam)
  }

  if(!!flagIncreaseSalesLogMtc && amountMtc > 0){
    const newParam = Object.assign({}, param)
    newParam.action = "Inherit"
    newParam.consultantId = mtcMarketingUser._id
    newParam.amount = amountMtc
    newParam.actionDescription = "Inherit sales amount for MTC"
    newParam.order = 3
    increaseParams.push(newParam)
  }

  return {
    decreaseParams: decreaseParams,
    increaseParams: increaseParams
  }
}

function createSalesLogReplacement({param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2, mtcMarketingUser, salesLogMtcBefore, finalConsultantId = "", finalCoBrokeConsultantId = ""}){
  
}

export async function addSalesLog({context, currentJobApplicant, phase, creatorId, jobApplicantArgs}){
  // invoiceAt didapat dari:
  // -- apabila permanent dari offer.startDate
  // -- apabila contract dari offer.contractMonthSalaries bulan
  const { mongo, user } = context
  const userIds = [currentJobApplicant.offer.consultantId]
  const offer = currentJobApplicant.offer
  let jobApplicantOfferFilter = [currentJobApplicant]

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

  const coBrokeConsultant = offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(offer.coBrokeConsultantId), deletedAt: null}) : null
  const coBroke = jobApplicantsOffered.find(i => i.offer && i.offer.replacementCandidateId === currentJobApplicant.candidateId.toString())
  const replacedCoBroke = coBroke && coBroke.offer && coBroke.offer.coBrokeConsultantId ? await mongo.User.findOne({_id: ObjectId(coBroke.offer.coBrokeConsultantId), deletedAt: null}) : null
  const MONTH = 12
  let startDate = (currentJobApplicant.offer.payrollCycleStartDate ? currentJobApplicant.offer.payrollCycleStartDate : currentJobApplicant.offer.startDate)
  let billingDates = []
  let replacementJobApplicant = null
  if(phase == "Successful Replacement"){
    replacementJobApplicant = await mongo.JobApplicant.findOne({
      jobId: currentJobApplicant.jobId,
      "offer.replacementCandidateId": currentJobApplicant.candidateId.toString()
    }) || null
  }
  
  if(offer.workType == "Contract / Temp / Part Time"){
    const contractMonthSalaries = offer.contractMonthSalaries || []
    for (const contractMonthSalary of contractMonthSalaries){
      if (contractMonthSalary.salary > 0) {
        billingDates.push(contractMonthSalary.month)
      }
    }
  }else{
    billingDates.push(startDate)
  }

  let company = null
  if(!!currentJobApplicant.inheritFromUserId){
    company = await mongo.User.findOne({username: "mtc001", deletedAt: null})
  }

  const mtcMarketingUser = await mongo.User.findOne({username: "mtcmarketing", deletedAt: null})
  const createSalesLogs = []
  const createSalesLogDetails = []

  for(const billingDate of billingDates){
    let jobApplicantFormatTotalFee = jobApplicantFormatTotalFeeV3({
      jobApplicant: currentJobApplicant,
      jobApplicantReplacementSuccessList,
      jobApplicantsOffered,
      coBrokeConsultant,
      replacedCoBroke,
      userIds,
      startDate: billingDate,
      MONTH
    })

    let amount = (jobApplicantFormatTotalFee ? jobApplicantFormatTotalFee.totalFee : 0)
    let referred = "CLOSED_MYSELF"

    // get amount before in saleslog
    let salesLogArgs = {
      jobApplicantId: currentJobApplicant._id
    }
    // const salesLogBefore = await mongo.SalesLog.findOne(salesLogArgs, {sort: {createdAt: -1}}) || null
    // console.log("salesLogBefore", salesLogBefore)

    let flagCreate = true

    // get latest saleslog by jobId and consultantId  
    let arrMatches = {
      jobApplicantId: currentJobApplicant._id,
      order: 1
    }
    
    if(offer.workType == "Contract / Temp / Part Time"){
      arrMatches.invoiceAt = billingDate
    }

    const lastSalesLogPerJob = await getLastSalesLogPerJob(mongo, arrMatches)
    // console.log("lastSalesLogPerJob", lastSalesLogPerJob)
    let amountBefore = 0
    let actionBefore
    let consultantIdBefore
    let coBrokeConsultantIdBefore
    let invoiceAtBefore
    if(lastSalesLogPerJob.length > 0){
      actionBefore = lastSalesLogPerJob[0].actionBefore
      amountBefore = lastSalesLogPerJob[0].totalAmount
      consultantIdBefore = lastSalesLogPerJob[0].lastConsultantId
      // coBrokeConsultantIdBefore = lastSalesLogPerJob[0].lastCoBrokeConsultantId
      invoiceAtBefore = lastSalesLogPerJob[0].lastInvoiceAt

      const lastSalesLogPerJobDetail  = await mongo.SalesLogDetail.findOne({salesLogId: lastSalesLogPerJob[0].lastId}) || null
      // console.log("lastSalesLogPerJobDetail", lastSalesLogPerJobDetail)
      if(lastSalesLogPerJobDetail){
        coBrokeConsultantIdBefore = lastSalesLogPerJobDetail.jobApplicantData.offer.coBrokeConsultantId
      }

      // console.log(invoiceAtBefore ,startDate, amountBefore, amount, consultantIdBefore.toString(), currentJobApplicant.offer.consultantId, coBrokeConsultantIdBefore, currentJobApplicant.offer.coBrokeConsultantId)
      // if(invoiceAtBefore == startDate && amountBefore == amount && consultantIdBefore.toString() == currentJobApplicant.offer.consultantId && coBrokeConsultantIdBefore == currentJobApplicant.offer.coBrokeConsultantId){
      //   flagCreate = false
      // }
    }
    
    let flagCoBrokeCreate = true
    // get latest saleslog by jobId and coBrokeConsultantId
    let coBrokeAmountBefore = 0
    let coBrokeActionBefore
    let coBrokeConsultantIdBefore2
    let coBrokeInvoiceAtBefore
    if(!!currentJobApplicant.offer.coBrokeConsultantId || !!replacementJobApplicant){
      referred = "SHARED_WITH_OTHER"
      let arrMatches = {
        jobApplicantId: currentJobApplicant._id,
        order: 2
      }

      if(offer.workType == "Contract / Temp / Part Time"){
        arrMatches.invoiceAt = billingDate
      }

      const lastSalesLogCoBrokePerJob = await getLastSalesLogPerJob(mongo, arrMatches)
      if(lastSalesLogCoBrokePerJob.length > 0){
        coBrokeActionBefore = lastSalesLogCoBrokePerJob[0].lastAction
        coBrokeAmountBefore = lastSalesLogCoBrokePerJob[0].totalAmount
        coBrokeConsultantIdBefore2 = lastSalesLogCoBrokePerJob[0].lastConsultantId
        coBrokeInvoiceAtBefore = lastSalesLogCoBrokePerJob[0].lastInvoiceAt

        // console.log(coBrokeInvoiceAtBefore ,startDate, coBrokeAmountBefore, amount, coBrokeConsultantIdBefore2.toString(), currentJobApplicant.offer.coBrokeConsultantId)
        // if(coBrokeInvoiceAtBefore == startDate && coBrokeAmountBefore == amount && coBrokeConsultantIdBefore2.toString() == currentJobApplicant.offer.coBrokeConsultantId){
        //   flagCoBrokeCreate = false
        // }
      }
    }

    // get sales log Mtc Before
    let arrMatchesMtc = {
      jobApplicantId: currentJobApplicant._id,
      order: 3
    }
    const lastSalesLogMtcPerJob = await getLastSalesLogPerJob(mongo, arrMatchesMtc)
    let salesLogMtcBefore
    if(lastSalesLogMtcPerJob.length > 0){
      salesLogMtcBefore = lastSalesLogMtcPerJob[0]
    }

    let actionDescription

    let param = {
      action: phase,
      actionDescription: actionDescription,
      consultantId: new ObjectId(currentJobApplicant.offer.consultantId),
      jobApplicantId: new ObjectId(currentJobApplicant._id),
      replacementJobApplicantId: null,
      jobId: new ObjectId(currentJobApplicant.jobId),
      invoiceAt: billingDate,
      candidateId: currentJobApplicant.candidateId,
      amount: amount,
      workType: "Permanent",
      referred: referred,
      creatorId: creatorId.toString()
    }

    let increaseParams = []
    let decreaseParams = []
    let newParam2 = {}

      if(phase == "Offered"){
        if(currentJobApplicant.offer.workType == "Permanent"){
          // if candidate replacement by other canddidate and lastest sales log not found create sales log
          if(!!currentJobApplicant.offer.replacementCandidateId){
            
          }else{

            // jika cobroke, bandingkan dengan cobroke dari sales log sebelumnya, 
            if(!!currentJobApplicant.offer.coBrokeConsultantId){
              param.referred = "SHARED_WITH_OTHER"
         
              if(!!currentJobApplicant.inheritFromUserId){
                param.action = "Inherit"

                const arraySalesLogOfferedCoBrokeInherit = increaseSalesLogOfferedCoBrokeInherit(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2, mtcMarketingUser, salesLogMtcBefore)
                if(arraySalesLogOfferedCoBrokeInherit.decreaseParams.length > 0){
                  decreaseParams = decreaseParams.concat(arraySalesLogOfferedCoBrokeInherit.decreaseParams)
                }
                
                if(arraySalesLogOfferedCoBrokeInherit.increaseParams.length > 0){
                  increaseParams = increaseParams.concat(arraySalesLogOfferedCoBrokeInherit.increaseParams)
                }
              }else{
                const arraySalesLogOfferedCoBroke = increaseSalesLogOfferedCoBroke(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2)
                if(arraySalesLogOfferedCoBroke.decreaseParams.length > 0){
                  decreaseParams = decreaseParams.concat(arraySalesLogOfferedCoBroke.decreaseParams)
                }
                
                if(arraySalesLogOfferedCoBroke.increaseParams.length > 0){
                  increaseParams = increaseParams.concat(arraySalesLogOfferedCoBroke.increaseParams)
                }
              }
            }else{
              const arraySalesLogOffered = increaseSalesLogOffered(param, amountBefore, amount, consultantIdBefore, currentJobApplicant)
              if(arraySalesLogOffered.decreaseParams.length > 0){
                decreaseParams = decreaseParams.concat(arraySalesLogOffered.decreaseParams)
              }
              
              if(arraySalesLogOffered.increaseParams.length > 0){
                increaseParams = increaseParams.concat(arraySalesLogOffered.increaseParams)
              }
            }
          }
        }else if(currentJobApplicant.offer.workType == "Contract / Temp / Part Time"){
          param.workType = "Contract / Temp / Part Time"
          if(!!offer.replacementCandidateId){
            param.action = "Replacement"
            let flagIncreaseSalesLogConsultant = false
            let flagIncreaseSalesLogCoBroke = false

            if(currentJobApplicant.offer.referred == "SHARED_WITH_OTHER"){
              param.refered = "SHARED_WITH_OTHER"
                // cek sales log before

                if(!!currentJobApplicant.inheritFromUserId){
                  // cek sales log before

                  if(!!flagIncreaseSalesLogConsultant){
                    const newParam = Object.assign({}, param)
                    newParam.action = "Inherit"
                    newParam.consultantId = currentJobApplicant.offer.consultantId
                    newParam.coBrokeConsultantId = currentJobApplicant.offer.coBrokeConsultantId
                    newParam.amount = amount / 2
                    newParam.actionDescription = "Increase sales amount for offered"
                    newParam.order = 1
                    increaseParams.push(newParam)
                  }

                  // cek sales log coBroke before

                  if(!!flagIncreaseSalesLogCoBroke){
                    const newParam = Object.assign({}, param)
                    newParam.action = "Inherit"
                    newParam.consultantId = currentJobApplicant.offer.coBrokeConsultantId
                    newParam.amount = amount / 2
                    newParam.actionDescription = "Increase sales amount for offered"
                    newParam.order = 2
                    increaseParams.push(newParam)
                  }

                  // cek sales log MTC before 

                  if(!!flagIncreaseSalesLogMtc){
                    const newParam = Object.assign({}, param)
                    newParam.action = "Inherit"
                    newParam.consultantId = currentJobApplicant.offer.consultantId
                    newParam.amount = amount / 2
                    newParam.actionDescription = "Increase sales amount for MTC"
                    newParam.order = 3
                    increaseParams.push(newParam)
                  }
                }else{
                  // cek sales log before

                  if(!!flagIncreaseSalesLogConsultant){
                    const newParam = Object.assign({}, param)
                    newParam.action = "Offered"
                    newParam.consultantId = currentJobApplicant.offer.consultantId
                    newParam.coBrokeConsultantId = currentJobApplicant.offer.coBrokeConsultantId
                    newParam.amount = amount
                    newParam.actionDescription = "increase sales amount for consultant"
                    newParam.order = 1
                    increaseParams.push(newParam)
                  }

                  // cek sales log coBroke before 

                  if(!!flagIncreaseSalesLogCoBroke){
                    const newParam = Object.assign({}, param)
                    newParam.action = "Inherit"
                    newParam.consultantId = currentJobApplicant.offer.coBrokeConsultantId
                    newParam.amount = amount
                    newParam.actionDescription = "increase sales amount for coBroke consultant"
                    newParam.order = 2
                    increaseParams.push(newParam)
                  }
                }
            }else{
              const arraySalesLogOffered = increaseSalesLogOffered(param, amountBefore, amount, consultantIdBefore, currentJobApplicant)
              if(arraySalesLogOffered.decreaseParams.length > 0){
                decreaseParams = decreaseParams.concat(arraySalesLogOffered.decreaseParams)
              }
              
              if(arraySalesLogOffered.increaseParams.length > 0){
                increaseParams = increaseParams.concat(arraySalesLogOffered.increaseParams)
              }
              
            }
          }else{

            let flagIncreaseSalesLogConsultant = false
            let flagIncreaseSalesLogCoBroke = false
            let flagIncreaseSalesLogMtc = false

            
            if(!!currentJobApplicant.offer.coBrokeConsultantId){
              param.referred = "SHARED_WITH_OTHER"
              if(!!currentJobApplicant.inheritFromUserId){
                // cek sales log before

                if(!!flagIncreaseSalesLogConsultant){
                  const newParam = Object.assign({}, param)
                  newParam.action = "Inherit"
                  newParam.consultantId = currentJobApplicant.offer.consultantId
                  newParam.coBrokeConsultantId = currentJobApplicant.offer.coBrokeConsultantId
                  newParam.amount = amount / 2
                  newParam.actionDescription = "Inherit sales amount for consultant"
                  newParam.order = 1
                  increaseParams.push(newParam)
                }

                // cek sales log coBroke before

                if(!!flagIncreaseSalesLogCoBroke){
                  const newParam = Object.assign({}, param)
                  newParam.action = "Inherit"
                  newParam.consultantId = currentJobApplicant.offer.coBrokeConsultantId
                  newParam.amount = amount / 2
                  newParam.actionDescription = "Inherit sales amount for coBroke consultant"
                  newParam.order = 2
                  increaseParams.push(newParam)
                }

                // cek sales log MTC before 

                if(!!flagIncreaseSalesLogMtc){
                  const newParam = Object.assign({}, param)
                  newParam.action = "Inherit"
                  newParam.consultantId = currentJobApplicant.offer.consultantId
                  newParam.amount = amount / 2
                  newParam.actionDescription = "Inherit sales amount for MTC"
                  newParam.order = 3
                  increaseParams.push(newParam)
                }
              }else{
                const arraySalesLogOfferedCoBroke = increaseSalesLogOfferedCoBroke(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2)
                if(arraySalesLogOfferedCoBroke.decreaseParams.length > 0){
                  decreaseParams = decreaseParams.concat(arraySalesLogOfferedCoBroke.decreaseParams)
                }
                
                if(arraySalesLogOfferedCoBroke.increaseParams.length > 0){
                  increaseParams = increaseParams.concat(arraySalesLogOfferedCoBroke.increaseParams)
                }
              }
            }else{
              const arraySalesLogOffered = increaseSalesLogOffered(param, amountBefore, amount, consultantIdBefore, currentJobApplicant)
              if(arraySalesLogOffered.decreaseParams.length > 0){
                decreaseParams = decreaseParams.concat(arraySalesLogOffered.decreaseParams)
              }
              
              if(arraySalesLogOffered.increaseParams.length > 0){
                increaseParams = increaseParams.concat(arraySalesLogOffered.increaseParams)
              }
            }
          }
        }
      }else if(phase == "Successful Replacement"){
          // get amount current jobApplicant and get consultant or cobroke from replaced jobApplicant 
          param.action = "Successful Replacement"
          param.replacementJobApplicantId = new ObjectId(replacementJobApplicant._id)
          let finalConsultantId
          let finalCoBrokeConsultantId

          // decrease sales log replacement consultant / coBroke Consultant
          if(!!replacementJobApplicant){
            const offerReplacementJobApplicant = replacementJobApplicant.offer

            if(!!offerReplacementJobApplicant.chargeDifference){
              const amountReplacementJobApplicant = formatPermanentFee({
                isAnnualSalary: offerReplacementJobApplicant.period === "Annual Salary",
                salary: offerReplacementJobApplicant.salary, allowanceFee: offerReplacementJobApplicant.allowanceFee,
                isAWS: offerReplacementJobApplicant.isAWS, awsNumber: offerReplacementJobApplicant.awsNumber, fee: offerReplacementJobApplicant.fee,
                isCoBroke: offerReplacementJobApplicant.coBrokeConsultantId, oneTimeFee: offerReplacementJobApplicant.oneTimeFee,
                percent: offerReplacementJobApplicant.customerBillingPercentage / 100,
                MONTH
              })

              amount = amountReplacementJobApplicant
            }
            finalConsultantId = replacementJobApplicant.offer.consultantId
            finalCoBrokeConsultantId = replacementJobApplicant.offer.coBrokeConsultantId ? replacementJobApplicant.offer.coBrokeConsultantId : null

            if(!!replacementJobApplicant.offer.coBrokeConsultantId){
              let sameCoBroke = (currentJobApplicant.offer.coBrokeConsultantId == replacementJobApplicant.offer.coBrokeConsultantId ? true : false)
              
              if(!sameCoBroke){
                finalCoBrokeConsultantId = replacementJobApplicant.offer.coBrokeConsultantId
              }
            }else{
              let sameConsultant = (currentJobApplicant.offer.consultantId == replacementJobApplicant.offer.consultantId ? true : false)

              if(!sameConsultant){
                finalConsultantId = currentJobApplicant.offer.consultantId
                finalCoBrokeConsultantId = replacementJobApplicant.offer.consultantId

                amount = amount / 2
              }
            }
            finalConsultantId = new ObjectId(finalConsultantId)
            finalCoBrokeConsultantId = finalCoBrokeConsultantId ? new ObjectId(finalCoBrokeConsultantId) : null


            let arrMatches = {
              jobApplicantId: replacementJobApplicant._id,
              order: 1
            }
            const lastSalesLogPerJob = await getLastSalesLogPerJob(mongo, arrMatches)

            if(lastSalesLogPerJob.length > 0){
              const salesLogBefore = lastSalesLogPerJob[0]
              
              if(salesLogBefore.totalAmount > 0){
                const newParam = Object.assign({}, param)
                newParam.action = "Take Out"
                newParam.jobApplicantId = replacementJobApplicant._id
                newParam.consultantId = replacementJobApplicant.offer.consultantId
                newParam.actionDescription = "take out previous replaced sales amount for replacement for consultant"
                newParam.amount = salesLogBefore.totalAmount * -1
                newParam.order = 1

                decreaseParams.push(newParam)
              }
            }

            if(!!finalCoBrokeConsultantId){
              param.referred = "SHARED_WITH_OTHER"

              let arrMatches = {
                jobApplicantId: replacementJobApplicant._id,
                order: 2
              }
              const lastSalesLogCoBrokePerJob = await getLastSalesLogPerJob(mongo, arrMatches)

              if(lastSalesLogCoBrokePerJob.length > 0){
                const salesLogCoBrokeBefore = lastSalesLogCoBrokePerJob[0]
                console.log("salesLogCoBrokeBefore", salesLogCoBrokeBefore)
                if(salesLogCoBrokeBefore.totalAmount > 0){
                  const newParam = Object.assign({}, param)
                  newParam.action = "Take Out"
                  newParam.jobApplicantId = replacementJobApplicant._id
                  newParam.consultantId = replacementJobApplicant.offer.coBrokeConsultantId
                  newParam.actionDescription = "take out previous replaced sales amount for replacement for coBroke consultant"
                  newParam.amount = salesLogCoBrokeBefore.totalAmount * -1
                  newParam.order = 2

                  decreaseParams.push(newParam)
                }
              }
            }
          }
          
          if(!!finalCoBrokeConsultantId){
            param.referred = "SHARED_WITH_OTHER"
            // decrease last sales log coBroke
            let amountCoBroke = (replacementJobApplicant.inheritFromConsultant == "Co-Broke Consultant" ? amount / 2 : amount)
            let amountMtc = amount/2
            let flagIncreaseSalesLogCoBroke = false

            if(!!replacementJobApplicant.inheritFromUserId){
              param.action = "Inherit"
              let flagIncreaseSalesLogMtc = false
              let arrMatches = {
                jobApplicantId: currentJobApplicant._id,
                order: 3
              }
              const lastSalesLogMtcPerJob = await getLastSalesLogPerJob(mongo, arrMatches)
              if(lastSalesLogMtcPerJob.length > 0){
                const salesLogMtcBefore = lastSalesLogMtcPerJob[0]
                if(amountMtc != salesLogMtcBefore.totalAmount || salesLogMtcBefore.lastConsultantId.toString() != mtcMarketingUser._id.toString()){
                  const newParam = Object.assign({}, param)
                  newParam.action = "Take Out"
                  newParam.consultantId = salesLogMtcBefore.lastConsultantId
                  newParam.actionDescription = "take out previous sales amount for mtc"
                  newParam.amount = salesLogMtcBefore.totalAmount * -1
                  newParam.order = 3

                  decreaseParams.push(newParam)
                  flagIncreaseSalesLogMtc = true
                }
              }else{
                flagIncreaseSalesLogMtc = true
              }

              const arraySalesLogOfferedCoBrokeInherit = increaseSalesLogOfferedCoBrokeInherit(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2, mtcMarketingUser, salesLogMtcBefore, finalConsultantId, finalCoBrokeConsultantId)
              if(arraySalesLogOfferedCoBrokeInherit.decreaseParams.length > 0){
                decreaseParams = decreaseParams.concat(arraySalesLogOfferedCoBrokeInherit.decreaseParams)
              }
              
              if(arraySalesLogOfferedCoBrokeInherit.increaseParams.length > 0){
                increaseParams = increaseParams.concat(arraySalesLogOfferedCoBrokeInherit.increaseParams)
              }

            }else{
              const arraySalesLogOfferedCoBroke = increaseSalesLogOfferedCoBroke(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2, finalConsultantId, finalCoBrokeConsultantId)
              if(arraySalesLogOfferedCoBroke.decreaseParams.length > 0){
                decreaseParams = decreaseParams.concat(arraySalesLogOfferedCoBroke.decreaseParams)
              }
              
              if(arraySalesLogOfferedCoBroke.increaseParams.length > 0){
                increaseParams = increaseParams.concat(arraySalesLogOfferedCoBroke.increaseParams)
              }

            }
          }else{
            param.actionDescription = "Increase sales amount for replacement"
            const arraySalesLogOffered = increaseSalesLogOffered(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, finalConsultantId)
            if(arraySalesLogOffered.decreaseParams.length > 0){
              decreaseParams = decreaseParams.concat(arraySalesLogOffered.decreaseParams)
            }
            
            if(arraySalesLogOffered.increaseParams.length > 0){
              increaseParams = increaseParams.concat(arraySalesLogOffered.increaseParams)
            }
          }
      }else if(phase == "Unsuccessful Sales"){
        param.action = "Unsuccessful Sales"

          if(!!currentJobApplicant.offer.coBrokeConsultantId){
            const arraySalesLogOfferedCoBroke = increaseSalesLogOfferedCoBroke(param, amountBefore, amount, consultantIdBefore, currentJobApplicant, coBrokeAmountBefore, coBrokeConsultantIdBefore2)
            if(arraySalesLogOfferedCoBroke.decreaseParams.length > 0){
              decreaseParams = decreaseParams.concat(arraySalesLogOfferedCoBroke.decreaseParams)
            }
            
            if(arraySalesLogOfferedCoBroke.increaseParams.length > 0){
              increaseParams = increaseParams.concat(arraySalesLogOfferedCoBroke.increaseParams)
            }
          }else{
            const arraySalesLogOffered = increaseSalesLogOffered(param, amountBefore, amount, consultantIdBefore, currentJobApplicant)
            if(arraySalesLogOffered.decreaseParams.length > 0){
              decreaseParams = decreaseParams.concat(arraySalesLogOffered.decreaseParams)
            }
            
            if(arraySalesLogOffered.increaseParams.length > 0){
              increaseParams = increaseParams.concat(arraySalesLogOffered.increaseParams)
            }
          }
      }

      let modeTest = false
      let decreaseSalesLog = null
      let decreaseSalesLogDetail = null
      if(decreaseParams.length > 0 && !modeTest){
        for (let i = 0; i < decreaseParams.length; i++) {
          decreaseSalesLog = await mongoCreate('SalesLog', decreaseParams[i], context)
          createSalesLogs.push(decreaseSalesLog)
        }
      }

      let createSalesLog = null
      let createSalesLogDetail = null
      if(increaseParams.length > 0 && !modeTest){
        for (let i = 0; i < increaseParams.length; i++) {
          createSalesLog = await mongoCreate('SalesLog', increaseParams[i], context)
          createSalesLogs.push(createSalesLog)

          const increaseParamSalesLogDetail = {
            salesLogId: createSalesLog._id.toString(),
            jobApplicantId: currentJobApplicant._id.toString(),
            jobApplicantData: currentJobApplicant
          }
          createSalesLogDetail = await mongoCreate('SalesLogDetail', increaseParamSalesLogDetail, context)
          createSalesLogDetails.push(createSalesLogDetail)
        }
      }
  }
  
  if(createSalesLogs.length > 0 || createSalesLogDetails.length > 0){
    return {
      success: true,
      message: "SalesLog has been created successfully!",
      createSalesLog: createSalesLogs,
      createSalesLogDetail: createSalesLogDetails,
    }
  }else{
    return {
      success: false,
      message: "Nothing happened!"
    }
  }
  
}