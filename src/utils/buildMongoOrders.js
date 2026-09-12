export default orderBy => {
  // orderBy = [firstName_DESC]
  // output = { firstName: -1 }
  if (Array.isArray(orderBy)) {
    return orderBy.reduce((h, order) => {
      if (order.includes('_ASC')) {
        return {...h, [order.replace('_ASC', '')]: 1 }
      } else if (order.includes('_DESC')) {
        return {...h, [order.replace('_DESC', '')]: -1 }
      }
    }, {})
  }

  // orderBy = firstName_DESC
  // output = { firstName: -1 }
  let h = {}
  if (orderBy.includes('_ASC')) {
    h = { [orderBy.replace('_ASC', '')]: 1 }
  } else if (orderBy.includes('_DESC')) {
    h = { [orderBy.replace('_DESC', '')]: -1 }
  }
  // console.log('Order by: ', JSON.stringify(h, null, 2))
  return h
}
