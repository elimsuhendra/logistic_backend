import { formatError } from 'graphql'
const format = error => {
  const data = formatError(error)

  return data
}

export default format
