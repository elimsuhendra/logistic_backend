import { ObjectId } from 'mongodb'
import moment from 'moment'
import _ from "lodash"

const convertObject = (object, key, convertId=false) => {
	if (!object[key]) return null

	if (object[key].constructor == String) {
		if (convertId || key.match(/^[A-z]+Id$/)) object[key] = ObjectId(object[key])
		if (convertId || key === '_id') object[key] = ObjectId(object[key])
	}
	else if (object[key].constructor == Array) {
		if (convertId || key.match(/^[A-z]+Id$/)) object[key] = object[key].map(value => !!value && ObjectId(value) || null)
		if (convertId || key === '_id') object[key] = object[key].map(value => !!value && ObjectId(value) || null)
	}
	else if (object[key].constructor == Object) {
		if (convertId || key.match(/^[A-z]+Id$/)) object[key] = convertObjectKey(object[key], true)
		if (convertId || key === '_id') object[key] = convertObjectKey(object[key], true)
	}

  return object
}

const convertObjectKey = (object, convertId = false) => {
  Object.keys(object).map(key => {
    convertObject(object, key, convertId)
  })
  return object
}

export const convertObjectId = object => {
  return convertObjectKey(object)
}

export function sanitizeRegex(str) {
	if (!str) { return '' }

	const trimmedStr = str.trim()
	const sanitizedStr = trimmedStr.replace(/[#-.]|[[-^]|[?|{}]/g, '\\$&')

	return sanitizedStr
}


export const formatSlug = (title) => {
	const dashify = (title || '').toLowerCase().replace(/[^a-zA-Z\d:]/g, '-')
	const simplify = dashify.replace(/(-)\1+/g, '-')

	return simplify
}

function isNumeric(value) {
  return /^-?\d+$/.test(value);
}

export const isJobOfferCompleted = ({workType, startDate, endDate, guaranteePeriod, replacementCandidateId}) => {
  const today = moment().format("YYYY-MM-DD")
  if (replacementCandidateId) return true
  if (workType === "Permanent") {
    if (!startDate || guaranteePeriod < 0) return false
    if (guaranteePeriod === 0) return true
    const jobOfferDate = moment(startDate).add(parseInt(guaranteePeriod), "d").format("YYYY-MM-DD")
    const isCompletedDate = moment(today).isAfter(jobOfferDate)
    if (isCompletedDate) return true
  } else {
    if (!endDate) return false
    const isCompletedDate = moment(today).isAfter(endDate)
    if (isCompletedDate) return true
  }
  return false
}

export function asyncChunk(array, size = 25) {
  const chunks = _.chunk(array, size)
  return async (processFn) => {
    return _.flatMap(await Promise.all(chunks.map(async (chunk, index) => {
      return await processFn(chunk, index)
    })))
  }
}

export function twoDecimalMaxLength(num){
  num = String(num)
  if(num.indexOf(".") > -1){
    let num2 = num.split(".")
    if(num2[1].length > 2){
      num2[1] = num2[1].substring(0,2)
    }
    num = num2[0]+'.'+num2[1]
  }

  return num
}