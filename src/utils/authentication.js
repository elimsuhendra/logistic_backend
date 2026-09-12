export const getRoles = (userObj) => {
  const { role, inactive } = userObj || {}

  return {
    isAdmin: true,
    isSuperAdmin: (!inactive && role === 'SuperAdmin') || false,
    isRole: (roleCode) => !inactive && roleCode === role,
    isStaff: true,
  }
}

export const getCustomerRoles = (customerObj, userObj) => {
  const {roles} = customerObj  || {}
  const { inactive } = userObj || {}
  let customerRoles = []
  if (!!roles && roles.length > 0) {
    customerRoles = roles.filter(role => role.userId.toString() === userObj._id.toString())
  }

  return {
    isAdmin: !inactive && customerRoles.length > 0 && !!customerRoles.find(role => role.role === 'Admin'),
    isStaff: !inactive && customerRoles.length > 0 && !!customerRoles.find(role => role.role === 'Staff'),
  }
}