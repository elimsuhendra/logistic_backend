import softNestedDelete from 'src/utils/softNestedDelete'
import { convertObjectId } from 'src/utils/common'

import { ObjectId } from 'mongodb'

export const prepareUpdate = object => {
  const prepareObj = ob => {
    delete ob.id
    ob = convertObjectId(ob)
    return { updatedAt: new Date().getTime(), ...ob }
  }
  if (object instanceof Array)
    return object.map(obj => {
      return prepareObj(obj)
    })
  else {
    return prepareObj(object)
  }
}

export const prepareCreate = object => {
  const prepareObj = ob => {
    ob = convertObjectId(ob)
    return { createdAt: new Date().getTime(), updatedAt: null, deletedAt: null, ...ob }
  }
  if (object instanceof Array)
    return object.map(obj => {
      return prepareObj(obj)
    })
  else return prepareObj(object)
}

export const prepareLogAudit = (object, action, userId = null, req = {}) => {
  object.__audit__snapshotId = object._id
  object.__audit__action = action
  object.__audit__loggedAt = new Date().getTime()
  object.__audit__userId = userId ? ObjectId(userId) : null
  object.__audit__IP = req.console_debugger
    ? 'console_debugger'
    : req.headers['x-forwarded-for'] || req.connection.remoteAddress
  delete object._id
  return object
}

export { softNestedDelete }


const compareItem = (object, item) => {
  return compareObject(object, item)
}

export const compareObject = (object, compareObject) => {
  if (!object) return false
  if (!compareObject) return true

  try {
    const sameValue = Object.keys(compareObject).every(key => {
      if (key === 'AND') {
        const checkAll = compareObject[key].every(item => compareItem(object, item))
        return checkAll
      }

      if (key === 'OR') {
        const checkSome = compareObject[key].some(item => compareItem(object, item))
        return checkSome
      }

      if (key === '_id' || key.match(/Id$/)) return (compareObject[key] || '').toString() === (object[key] || '').toString()
      if (key === '_id_in') return compareObject['_id_in'].some(item => object._id.toString() === item.toString())

      const [dataKey, operand] = (key || '').split('_') || []
      if (operand === 'ne') return compareObject[key] !== object[dataKey]
      if (operand === 'nin') return !compareObject[key].includes(object[dataKey])
      if (operand === 'in') {
        if (typeof object[dataKey] === 'string') {
          return compareObject[key].some(item => object[dataKey] === item)
        } else if (Array.isArray(object[dataKey])) {
          return compareObject[key].some(item => object[dataKey].includes(item))
        } else {
          return false
        }
      }

      if (operand === 'gte') {
        if (dataKey.includes('At')) return object[dataKey] >= new Date(compareObject[key]).getTime()
        return object[dataKey] >= compareObject[key]
      }
      if (operand === 'gt') {
        if (dataKey.includes('At')) return object[dataKey] > new Date(compareObject[key]).getTime()
        return object[dataKey] > compareObject[key]
      }
      if (operand === 'lte') {
        if (dataKey.includes('At')) return object[dataKey] <= new Date(compareObject[key]).getTime()
        return object[dataKey] <= compareObject[key]
      }
      if (operand === 'lt') {
        if (dataKey.includes('At')) return object[dataKey] < new Date(compareObject[key]).getTime()
        return object[dataKey] < compareObject[key]
      }
      if (operand === 'regex') {
        return object[dataKey].toLowerCase().includes(compareObject[key].toLowerCase())
      }

      return (object[key] === compareObject[key] || (!(key in object) && compareObject[key] == null))
    })

    return sameValue
  } catch (err) {
    console.log("[ERROR] Listener Comparison Failed. ", err)
    return false
  }
}