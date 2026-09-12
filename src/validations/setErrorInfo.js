export default errors => {
  // TODO: check if error not a object
  if (errors) {
    return Object.keys(errors)
      .map(key => [key, errors[key][0]])
      .map(e => {
        return {
          field: e[0],
          message: e[1]
        }
      })
  }
  return null
}
