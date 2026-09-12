import { hashPassword } from 'src/utils/auth'
let indexTime = 0
const users = [
  {
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    username: 'superadmin',
    password: hashPassword('AmazingMagicCode'),
    fullName: 'Super Admin',
    role: 'SuperAdmin',
    inactive: false,
    approved: true,
  },
]

export default users
