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
  {
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    username: 'goldenexpressindo',
    password: hashPassword('AmazingMagicCode'),
    fullName: 'Golden Expressindo',
    role: 'Admin',
    inactive: false,
    approved: true,
  },
  {
    createdAt: Date.now() + indexTime++,
    updatedAt: null,
    deletedAt: null,
    username: 'cahayabintangmas',
    password: hashPassword('AmazingMagicCode'),
    fullName: 'Cahaya Bintang Mas',
    role: 'Admin',
    inactive: false,
    approved: true,
  },
]

export default users
