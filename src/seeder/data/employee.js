let indexTime = 0

const employees = [
  {
    seeder: true,
    locked: true,
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    username: 'superadmin',
    accountName: 'superadmin',
    roleCode: 'SuperAdmin',
    roleName: 'Super Admin',
    menuPermissions: ['all'],
    employeeID: '001/SA/2026',
    email: 'superadmin@logistic.com',
    phone: '08999878046',
    inactive: false,
  },
]

export default employees
