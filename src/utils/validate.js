export function validateEmail(email) {
  const re =
    /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
  return re.test(String(email).toLowerCase())
}

export function isBlankString(stringValue) {
  return !stringValue || stringValue.toString().trim().length === 0
}

export function isEmptyObject(obj) {
  if (obj === undefined || obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return true
  }
  for (var prop in obj) {
    if (obj.hasOwnProperty(prop)) {
      return false
    }
  }

  return JSON.stringify(obj) === JSON.stringify({})
}

export function hasSameValueInsideObject(obj, value = false) {
  if (isEmptyObject(obj)) {
    return true
  }
  const checkerResult = [...new Set(Object.values(obj))]
  return checkerResult.length === 1 && checkerResult[0] === value
}

export function checkCorrectlyInputType(value, dataTypeInput) {
  try {
    switch (dataTypeInput) {
      case "positive_integer":
        return /^\d*$/.test(value)
      case "integer":
        return /^-?\d*$/.test(value)
      case "decimal":
        return /^-?\d*[.]?\d*$/.test(value)
      case "positive_decimal":
        return /^-?\d*[.]?\d*$/.test(value) && (value === "" || parseFloat(value) >= 0)
      case "money":
        return /^-?\d*[.]?\d{0,2}$/.test(value) && (value === "" || parseFloat(value) >= 0)
      case "a-z":
        return /^[a-z]*$/i.test(value)
      case "shippingTime":
        return /^[0-9a-zA-Z-+]+$/.test(value)
      case "containedNumber":
        return /\w*\d{1,}\w*/.test(value)
    }
    return true
  } catch (e) {
    return false
  }
}