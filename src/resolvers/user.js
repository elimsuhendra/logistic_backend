import requiresAuth, { checkUserAuth, checkPermissions } from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import moment from 'moment'
import { prepareCreate, prepareUpdate, compareObject } from 'src/utils/model'
import { getRoles, getCustomerRoles } from 'src/utils/authentication'
import { withFilter } from 'graphql-subscriptions'
import pubsub from 'src/utils/pubsub'
import userValidation from 'src/validations/user'
import buildMongoFilters from 'src/utils/buildMongoFilters'
import buildMongoOrders from 'src/utils/buildMongoOrders'
import _ from 'lodash'
import { tryLogin, hashPassword, tryLoginEcommerce, tryLoginDriver } from 'src/utils/auth'
import bcrypt from 'bcryptjs'
import agenda from 'jobs'
import shortid from 'shortid'
import { sms } from "utils/smsServices"
import { isEmptyObject, isBlankString } from "utils/validate"
import { mongoCreate, mongoUpdate, mongoDelete } from "utils/crud"
import { createLog } from '../utils/crud'

// Restrict a User mongo filter to users that have an active employee record in the given account
const applyAccountEmployeeFilter = async (mongo, filters, accountId) => {
  if (!accountId) return filters
  if (!ObjectId.isValid(String(accountId))) return { ...filters, _id: { $in: [] } }
  const employees = await mongo.Employee.find({
    accountId: { $in: [ObjectId(String(accountId)), String(accountId)] },
    inactive: { $ne: true },
    deletedAt: null,
  }).project({ userId: 1 }).toArray()
  const userIds = _.uniqBy(
    (employees || [])
      .map(e => e.userId)
      .filter(id => id && ObjectId.isValid(String(id)))
      .map(id => ObjectId(String(id))),
    id => String(id)
  )
  return { $and: [filters, { _id: { $in: userIds } }] }
}

export default {
  Employee: {
    id: parent => (parent && (parent._id || parent.id)) ? String(parent._id || parent.id) : null,
    accountId: parent => (parent && parent.accountId) ? String(parent.accountId) : null,
    userId: parent => (parent && parent.userId) ? String(parent.userId) : null,
    roleId: parent => (parent && parent.roleId) ? String(parent.roleId) : null,
    account: async (parent, args, { mongo }) => {
      if (!parent || !parent.accountId || !ObjectId.isValid(String(parent.accountId))) return null
      return await mongo.Account.findOne({ _id: ObjectId(String(parent.accountId)), deletedAt: null })
    },
    roleData: async (parent, args, { mongo }) => {
      if (!parent || !parent.roleId || !ObjectId.isValid(String(parent.roleId))) return null
      return await mongo.Role.findOne({ _id: ObjectId(String(parent.roleId)), deletedAt: null })
    },
  },
  User: {
    id: parent => parent._id || parent.id,
    phone: parent => (parent && (parent.phone || parent.mobileNumber)) || null,
    mobileNumber: parent => (parent && (parent.mobileNumber || parent.phone)) || null,
    roleId: parent => (parent && parent.roleId ? String(parent.roleId) : null),
    avatar: async ({ _id }, args, { dataloaders }) => {
      if (!dataloaders) {
        console.log('No dataloaders provided')
      }
      return await dataloaders.get('photoByObjectLoader').load({ objectId: _id, objectType: 'User' })
    },
    groups: async ({ _id }, args, { dataloaders }) => {
      const loadedGroups = await dataloaders.get('groupsByUserLoader').load(_id)

      return await dataloaders.get('groupsByUserLoader').load(_id)
    },
    lastGroup2: async ({ _id }, args, { dataloaders }) => {
      return await dataloaders.get('lastGroupsByUserLoader').load(_id)
    },
    salary: async ({ _id }, args, { mongo }) => {
      const currentYear = moment().format("YYYY")
      const current = await mongo.UserSalary.findOne({ userId: _id, year: parseInt(currentYear), deletedAt: null })
      return current || null
    },
    account: async ({ _id, accountId }, args, { mongo }) => {
      if(!accountId) return null;
      const account = await mongo.Account.findOne({ _id: ObjectId(accountId) , deletedAt: null })
      return account
    },
    accounts: async ({ _id }, args, { mongo }) => {
      const empList = await mongo.Employee.find({ userId: { $in: [ObjectId(_id), String(_id)] }, deletedAt: null }).toArray()
      const empAccountIds = (empList || [])
        .map(e => e && e.accountId)
        .filter(id => id && ObjectId.isValid(String(id)))
        .map(id => ObjectId(String(id)))
      if (empAccountIds.length > 0) {
        const empAccounts = await mongo.Account.find({ _id: { $in: empAccountIds }, deletedAt: null }).toArray()
        if (empAccounts && empAccounts.length > 0) return empAccounts
      }
      const accounts = await mongo.Account.find({ userIds: { $in: [ObjectId(_id), String(_id)] }, deletedAt: null }).toArray()
      return accounts || []
    },
    roleData: async ({ roleId, role, _id, accountId }, args, { mongo }) => {
      let roleObj = null
      if (_id && accountId && ObjectId.isValid(String(accountId))) {
        const employee = await mongo.Employee.findOne({ userId: ObjectId(_id), accountId: ObjectId(accountId) , deletedAt: null })
        if(employee && employee.roleId){
          roleObj = await mongo.Role.findOne({ _id: ObjectId(employee.roleId), deletedAt: null })
        }
      }

      return roleObj
    },
    employees: async ({ _id }, args, { mongo }) => {
      const list = await mongo.Employee.find({ userId: { $in: [ObjectId(_id), String(_id)] }, deletedAt: null }).toArray()
      return (list || []).map(item => ({
        ...item,
        id: item._id ? String(item._id) : item.id,
        accountId: item.accountId ? String(item.accountId) : null,
        userId: item.userId ? String(item.userId) : null,
        roleId: item.roleId ? String(item.roleId) : null,
      }))
    },
    employee: async ({ _id, accountId }, args, { mongo }) => {
      if (!_id || !accountId || !ObjectId.isValid(String(accountId))) return null
      const employee = await mongo.Employee.findOne({ userId: ObjectId(_id), accountId: ObjectId(accountId) , deletedAt: null })
      return employee
    },
  },
  Subscription: {
    User: {
      subscribe: requiresAuth.createResolver(
        withFilter(
          () => pubsub.asyncIterator(process.env.APP_NAME + '-' + process.env.APP_ENV + '-User'),
          (payload, args) => {
            if (!payload) return false
            return compareObject(payload.User.node, args.dataFilter)
          }
        )
      )
    }
  },
  Query: {
    getUser: async (parent, args, context) => {
      if (!args.id) return null

      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context

      const theUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })

      if (!!theUser && !!getRoles(theUser).isAdmin) {
        const { id } = args
        const { mongo, user } = context

        return await mongo.User.findOne({ _id: ObjectId(id), deletedAt: null })
      }

      return null
    },
    allUsers: requiresAuth.createResolver(async (parent, args, context) => {
      // Read
      let { allowAdmin, filter = {}, first, skip, orderBy } = args
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)
      if (currentUser) {
        const limit = first || 10
        const offset = skip || 0

        if(currentUser.username == "superadmin"){
          allowAdmin = true
        }
        if (!allowAdmin) {
          filter._id_ne = currentUser._id.toString()
        }
        const { accountId: filterAccountId, ...restFilter } = filter || {}
        const filters = await applyAccountEmployeeFilter(mongo, buildMongoFilters(restFilter), filterAccountId)
        const obj = await mongo.User.find(filters)
          .sort(orderBy ? buildMongoOrders(orderBy) : { createdAt: -1 })
          .skip(offset)
          .limit(limit)
          .toArray()

          const readyGroups = await mongo.Group.find({
          deletedAt: null
        }).toArray()

        for (let i = 0; i < obj.length; i++) {
          let currUser = obj[i]
          // expose account context so `employee` / `roleData` resolve for this account
          if (filterAccountId) currUser.accountId = filterAccountId
          let readyGroups2 = readyGroups.filter(group =>
            group.managerId.toString() === currUser._id.toString() ||
            group.teamLeaderId.toString() === currUser._id.toString() ||
            group.staffIds.includes(currUser._id.toString())
          )

          if (readyGroups2.length > 0) {
            readyGroups2.sort((a, b) => b.updatedAt - a.updatedAt)
            readyGroups2 = readyGroups2.length > 0 ? readyGroups2[0] : []
            obj[i]["lastGroup"] = {
              id: readyGroups2._id.toString(),
              name: readyGroups2.name
            }
          }
        }

        return obj
      }
      return null
    }),
    _allUsersMeta: requiresAuth.createResolver(
      async (parent, { allowAdmin, filter }, { mongo, user }) => {
        const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
        const rolesObj = getRoles(currentUser)
        if (!allowAdmin) {
          filter._id_ne = currentUser._id.toString()
        }
        if (currentUser) {
          const { accountId: filterAccountId, ...restFilter } = filter || {}
          const filters = await applyAccountEmployeeFilter(mongo, buildMongoFilters(restFilter), filterAccountId)
          const count = await mongo.User.countDocuments(filters)

          return { count }
        }
        return { count: 0 }
      }
    ),
    me: requiresAuth.createResolver(async (parent, args, { mongo, user }) => {
      if (!user) return null
      const userObj = await mongo.User.findOne({ _id: ObjectId(user._id) })
      if (userObj && args && args.accountId) {
        userObj.accountId = args.accountId
      }
      return userObj
    })
  },
  Mutation: {
    login: async (parent, args, context) => {
      if ('username' in args) { args.username = args.username.toLowerCase().trim() }
      const rs = await tryLogin(
        { username: args.username, password: args.password },
        context
      )

      const { user } = rs
      if (!!user) {
        await createLog(
          {
            action: 'user_login',
            objectId: user._id,
            objectType: "User",
            payload: args,
          },
          context,
        );
      }
      return rs
    },
    createUser: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { input } = args
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)
      
      if (!!currentUser) {
        if ('username' in input) {
          const validation = await userValidation({
            user: Object.assign({}, input),
            mongo
          })

          if (validation.errors) {
            return {
              success: false,
              message: "Failed to update user. User already exists.",
              errors: validation.errors
            }
          }
        }

        if ('password' in input) {
          input.password = hashPassword(input.password)
        }

        input.approved = true
        input.dateJoin = input["dateJoin"] ? moment.utc(moment(input["dateJoin"]).format("YYYY-MM-DD")).valueOf() : null
        try {
          if (!rolesObj.isAdmin && !!input.roles && !!input.roles.includes('Admin')) {
            return {
              success: false,
              message: 'Unauthorized Action'
            }
          }

          const paramUser = {
            ...input
          }
          delete paramUser.employee
          delete paramUser.employees
          const employeeList = Array.isArray(input.employees) && input.employees.length > 0
            ? input.employees
            : (input.employee ? [input.employee] : [])
          const primaryEmployee = employeeList[0] || input.employee
          if (primaryEmployee) {
            if (primaryEmployee.roleId) {
              paramUser.roleId = primaryEmployee.roleId
            }
            if (primaryEmployee.employeeID) {
              paramUser.employeeID = primaryEmployee.employeeID
            }
            if (primaryEmployee.phone) {
              paramUser.phone = primaryEmployee.phone
              paramUser.mobileNumber = primaryEmployee.phone
            }
          }

          const newObj = prepareCreate(paramUser)
          newObj._id = new ObjectId()

          let { user, errors } = await userValidation({ user: newObj, mongo })
          const userObj = user || newObj

          if (errors) {
            return {
              success: false,
              message: "Failed to create new user. User already exists.",
              errors: errors
            }
          } else {
            const rs = await mongoCreate('User', userObj, context)
            if (employeeList.length > 0) {
              for (let i = 0; i < employeeList.length; i++) {
                const empItem = employeeList[i]
                let paramEmployee = {
                  userId: userObj._id,
                  ...empItem,
                }
                if (!paramEmployee.email && paramEmployee.emailEmployee) {
                  paramEmployee.email = paramEmployee.emailEmployee
                }
                paramEmployee = prepareCreate(paramEmployee)
                await mongoCreate('Employee', paramEmployee, context)
              }
            }

            pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-User', { User: { mutation: 'CREATED', node: userObj } })
          }

          return {
            success: true,
            message: "New user has been created",
            user: user
          }
        } catch (err) {
          return {
            success: false,
            message: "Failed to create new user",
            errors: formatErrors(err, mongo)
          }
        }
      }

      return {
        success: false
      }
    },
    importUsers: async (parent, args, context) => {
      // Create multiple users. If the username or email already exists, update that user instead.
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const rolesObj = getRoles(currentUser)

      const emptyResponse = (message) => ({
        success: false,
        message,
        createdCount: 0,
        updatedCount: 0,
        failedCount: 0,
        results: []
      })

      if (!currentUser || !rolesObj.isAdmin) return emptyResponse('Unauthorized Action')

      const MAX_IMPORT_ROWS = 1000
      const rows = args.users || []
      if (rows.length === 0) return emptyResponse('No user records found to import.')
      if (rows.length > MAX_IMPORT_ROWS) return emptyResponse(`Too many rows. Maximum ${MAX_IMPORT_ROWS} users per import.`)

      const ALLOWED_ROLES = ['SuperAdmin', 'Finance', 'Admin', 'Manager', 'TeamLeader', 'Staff', 'Driver']
      const exactCaseInsensitive = (value) => new RegExp(`^${_.escapeRegExp(value)}$`, 'i')
      const clean = (value) => (value === null || value === undefined ? '' : String(value).trim())

      let createdCount = 0
      let updatedCount = 0
      let failedCount = 0
      const results = []

      for (let i = 0; i < rows.length; i++) {
        const input = rows[i]
        const rowNumber = input.row || i + 2
        const username = clean(input.username).replace(/^@/, '').toLowerCase()
        const email = clean(input.email).toLowerCase()
        const fullName = clean(input.fullName)
        const password = clean(input.password)
        const employeeID = clean(input.employeeID)
        const mobileCode = clean(input.mobileCode)
        const mobileNumber = clean(input.mobileNumber)

        const fail = (message, action = null) => {
          failedCount++
          results.push({ row: rowNumber, username, email, action, success: false, message })
        }

        try {
          if (!username && !email) {
            fail('Username or Email is required.')
            continue
          }

          let role = null
          if (clean(input.role)) {
            role = ALLOWED_ROLES.find(r => r.toLowerCase() === clean(input.role).replace(/\s+/g, '').toLowerCase())
            if (!role) {
              fail(`Invalid role "${input.role}". Allowed: ${ALLOWED_ROLES.join(', ')}.`)
              continue
            }
            if (role === 'SuperAdmin' && !rolesObj.isSuperAdmin) {
              fail('Only a SuperAdmin can assign the SuperAdmin role.')
              continue
            }
          }

          // Find existing users by username or email
          const conditions = []
          if (username) conditions.push({ username: exactCaseInsensitive(username) })
          if (email) conditions.push({ email: exactCaseInsensitive(email) })
          const matches = await mongo.User.find({ deletedAt: null, $or: conditions }).toArray()
          const uniqueMatches = _.uniqBy(matches, m => m._id.toString())

          if (uniqueMatches.length > 1) {
            fail('Username and Email belong to different existing users.')
            continue
          }

          const existing = uniqueMatches[0]

          if (existing) {
            // UPDATE: only overwrite fields that are provided in the file
            const update = {}
            if (fullName) update.fullName = fullName
            if (username) update.username = username
            if (email) update.email = email
            if (role) update.role = role
            if (employeeID) update.employeeID = employeeID
            if (mobileCode) update.mobileCode = mobileCode
            if (mobileNumber) update.mobileNumber = mobileNumber
            if (typeof input.inactive === 'boolean') update.inactive = input.inactive
            if (password) update.password = hashPassword(password)

            const rs = await mongoUpdate('User', { id: existing._id.toString(), ...update }, context)
            if (!rs || rs instanceof Error) {
              fail('Failed to update user.', 'updated')
              continue
            }

            updatedCount++
            results.push({ row: rowNumber, username: existing.username, email: existing.email, action: 'updated', success: true, message: 'User updated.' })
          } else {
            // CREATE
            if (!password) {
              fail('Password is required for a new user.', 'created')
              continue
            }

            const newObj = {
              _id: new ObjectId(),
              fullName,
              username: username || null,
              email: email || null,
              password: hashPassword(password),
              role: role || 'Staff',
              employeeID,
              inactive: typeof input.inactive === 'boolean' ? input.inactive : false,
              approved: true,
              dateJoin: null,
            }
            if (mobileCode) newObj.mobileCode = mobileCode
            if (mobileNumber) newObj.mobileNumber = mobileNumber

            const rs = await mongoCreate('User', newObj, context)
            if (!rs || rs instanceof Error) {
              fail('Failed to create user.', 'created')
              continue
            }

            createdCount++
            results.push({ row: rowNumber, username, email, action: 'created', success: true, message: 'User created.' })
          }
        } catch (err) {
          console.log('⛔️ importUsers row error - ', err)
          fail(err.message || 'Unexpected error.')
        }
      }

      return {
        success: createdCount + updatedCount > 0,
        message: `Created ${createdCount}, updated ${updatedCount}, failed ${failedCount}.`,
        createdCount,
        updatedCount,
        failedCount,
        results
      }
    },
    updateUser: async (parent, args, context) => {
      // Update data
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context
      const { id, input } = args

      try {
        const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
        const updatedUser = await mongo.User.findOne({ _id: ObjectId(id), deletedAt: null })

        const rolesObj = getRoles(currentUser)

        if (!!currentUser && !!updatedUser && (!!rolesObj.isAdmin)) {
          input.dateJoin = input["dateJoin"] ? moment.utc(moment(input["dateJoin"]).format("YYYY-MM-DD")).valueOf() : null
          if ('email' in input) { input.email = input.email.toLowerCase() }
          if ('password' in input) {
            if (input.password && input.password.trim()) {
              input.password = hashPassword(input.password.trim())
            } else {
              delete input.password
            }
          }
          const sendEmail = !updatedUser.approved && !!input.approved

          const paramUser = {
            ...input
          }
          delete paramUser.employee
          delete paramUser.employees
          const employeeList = Array.isArray(input.employees) && input.employees.length > 0
            ? input.employees
            : (input.employee ? [input.employee] : [])
          const primaryEmployee = employeeList[0] || input.employee
          if (primaryEmployee) {
            if (primaryEmployee.roleId) {
              paramUser.roleId = primaryEmployee.roleId
            }
            if (primaryEmployee.employeeID) {
              paramUser.employeeID = primaryEmployee.employeeID
            }
            if (primaryEmployee.phone) {
              paramUser.phone = primaryEmployee.phone
              paramUser.mobileNumber = primaryEmployee.phone
            }
          }
          const obj = await mongoUpdate('User', { id, ...paramUser }, context)
          const lastUser = await mongo.User.findOne({ _id: ObjectId(id) })

          // check user in employee
          const targetUserId = ObjectId.isValid(id) ? ObjectId(id) : (currentUser && currentUser._id)
          if (Array.isArray(input.employees) && input.employees.length > 0) {
            await mongo.Employee.updateMany(
              { userId: { $in: [targetUserId, String(targetUserId)] }, deletedAt: null },
              { $set: { deletedAt: Date.now() } }
            )
            for (let i = 0; i < input.employees.length; i++) {
              const empItem = input.employees[i]
              let paramEmployee = {
                userId: targetUserId,
                ...empItem,
              }
              if (!paramEmployee.email && paramEmployee.emailEmployee) {
                paramEmployee.email = paramEmployee.emailEmployee
              }
              paramEmployee = prepareCreate(paramEmployee)
              await mongoCreate('Employee', paramEmployee, context)
            }
          } else {
            let employee = await mongo.Employee.findOne({ userId: targetUserId, deletedAt: null })
            if (!employee && currentUser && currentUser._id) {
              employee = await mongo.Employee.findOne({ userId: ObjectId(currentUser._id), deletedAt: null })
            }

            if (!employee && input.employee) {
              let paramEmployee = {
                userId: targetUserId,
                ...input.employee,
              }
              if (!paramEmployee.email && paramEmployee.emailEmployee) {
                paramEmployee.email = paramEmployee.emailEmployee
              }
              paramEmployee = prepareCreate(paramEmployee)
              await mongoCreate('Employee', paramEmployee, context)
            } else if (employee && input.employee) {
              let updateEmployee = {
                id: employee._id || employee.id,
                ...input.employee,
              }
              if (!updateEmployee.email && updateEmployee.emailEmployee) {
                updateEmployee.email = updateEmployee.emailEmployee
              }
              await mongoUpdate('Employee', updateEmployee, context)
            }
          }

          if (obj && !(obj instanceof Error)) {
            pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-User', {
              User: {
                mutation: 'UPDATED',
                node: { _id: ObjectId(id), roles: lastUser ? lastUser.roles : obj.roles }
              }
            })

            const updatedUser = await mongo.User.findOne({ _id: ObjectId(id) })

            if (sendEmail) {
              //Send Register Successfully Email
              agenda.now('register-successfully-ecommerce-email', {
                to: updatedUser.email,
                subject: 'Thanks for your registration. Your account has been approved!',
                fullName: updatedUser.fullName,
              })
            }
            return { user: updatedUser, success: true }
          } else {
            return new Error(
              JSON.stringify({ error: `Cannot update User ${id}` })
            )
          }
        }
      } catch (err) {
        console.log(err)
      }
    },
    updateProfile: async (parent, args, context) => {
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      if (!!currentUser) {
        if ('email' in args && args.email) { args.email = args.email.toLowerCase() }
        if ('dateJoin' in args) {
          args.dateJoin = args.dateJoin ? moment.utc(moment(args.dateJoin).format("YYYY-MM-DD")).valueOf() : null
        }

        const id = currentUser._id
        if ('currentPassword' in args && args.currentPassword && 'newPassword' in args && args.newPassword) {
          if (bcrypt.compareSync(args.currentPassword, currentUser.password)) {
            args.password = hashPassword(args.newPassword)
          }
        } else if ('newPassword' in args && args.newPassword && args.newPassword.trim()) {
          args.password = hashPassword(args.newPassword.trim())
        }

        delete args.currentPassword
        delete args.newPassword

        const employeeList = Array.isArray(args.employees) && args.employees.length > 0
          ? args.employees
          : (args.employee ? [args.employee] : [])
        const primaryEmployee = employeeList[0] || args.employee

        const paramUser = { ...args }
        delete paramUser.employee
        delete paramUser.employees

        if (primaryEmployee) {
          if (primaryEmployee.roleId) {
            paramUser.roleId = primaryEmployee.roleId
          }
          if (primaryEmployee.employeeID) {
            paramUser.employeeID = primaryEmployee.employeeID
          }
          if (primaryEmployee.phone) {
            paramUser.phone = primaryEmployee.phone
            paramUser.mobileNumber = primaryEmployee.phone
          }
        }

        const update = prepareUpdate(paramUser)
        const obj = await mongo.User.updateOne(
          { _id: ObjectId(id) },
          { $set: update },
          { returnOriginal: false }
        )

        if (Array.isArray(args.employees) && args.employees.length > 0) {
          await mongo.Employee.updateMany(
            { userId: { $in: [ObjectId(id), String(id)] }, deletedAt: null },
            { $set: { deletedAt: Date.now() } }
          )
          for (let i = 0; i < args.employees.length; i++) {
            const empItem = args.employees[i]
            let paramEmployee = {
              userId: ObjectId(id),
              ...empItem,
            }
            if (!paramEmployee.email && paramEmployee.emailEmployee) {
              paramEmployee.email = paramEmployee.emailEmployee
            }
            paramEmployee = prepareCreate(paramEmployee)
            await mongoCreate('Employee', paramEmployee, context)
          }
        }

        const lastUser = await mongo.User.findOne({ _id: ObjectId(id) })

        if (obj.matchedCount) {
          if (obj.modifiedCount) {
            pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-User', {
              User: {
                mutation: 'UPDATED',
                node: { _id: ObjectId(id), role: lastUser.role }
              }
            })
          }
          return { user: lastUser, success: true }
        } else {
          return new Error(
            JSON.stringify({ matchedCount: obj.matchedCount, modifiedCount: obj.modifiedCount })
          )
        }
      }
    },
    deleteUser: async (parent, args, context) => {
      // Update data
      await checkPermissions(checkUserAuth)({ context })
      const { mongo, user } = context

      const currentUser = await mongo.User.findOne({ _id: ObjectId(user._id), deletedAt: null })
      const deletedUser = await mongo.User.findOne({ _id: ObjectId(args.id), deletedAt: null })
      if (!!currentUser && !!deletedUser && !!getRoles(currentUser).isAdmin) {
        const rs = await mongoDelete('User', args, context)

        pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-User', {
          User: {
            mutation: 'DELETED',
            previousValues: deletedUser,
            node: deletedUser
          }
        })

        return {
          success: true,
          message: 'User has been deleted'
        }
      }
    },
    registerAs: async (parent, args, context) => {
      const { mongo, user } = context
      const { email, mobileCode, mobileNumber } = args
      if ('email' in args) { args.email = args.email.toLowerCase() }
      if ('firstName' in args) { args.fullName = args.firstName + (!!args.lastName ? ` ${args.lastName}` : '') }
      args.inactive = false
      args.approved = false
      args.roles = "Staff"
      if (!email && !(mobileCode && mobileNumber)) {
        return {
          success: false,
          message: "Required either email or mobile for new user registration"
        }
      }
      if ('password' in args) {
        args.password = hashPassword(args.password)
      }
      try {
        const newObj = prepareCreate(args)
        newObj._id = new ObjectId()
        let { user, errors } = await userValidation({ user: newObj, mongo })
        const userObj = user || newObj

        if (errors) {
          return {
            success: false,
            message: "Failed to create new user. User already exists.",
            errors: errors
          }
        } else {
          const rs = await mongo.User.insertOne(userObj)
          pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-User', { User: { mutation: 'CREATED', node: userObj } })

        }

        return {
          success: true,
          message: "New user has been created",
          user: user
        }
      } catch (err) {
        return {
          success: false,
          message: "Failed to create new user",
          errors: formatErrors(err, mongo)
        }
      }
    },
    forgetPassword: async (parent, args, context) => {
      const { mongo } = context
      const { email } = args
      if (!!email) {
        const currentUser = await mongo.User.findOne({ email, deletedAt: null })
        if (!!currentUser) {
          const user = await mongo.User.updateOne(
            { _id: ObjectId(currentUser._id) },
            {
              $set: {
                resetToken: `${shortid.generate()}${shortid.generate()}-${new Date().valueOf()}`,
              }
            },
            { returnOriginal: false }
          )
          const lastUser = await mongo.User.findOne({ _id: ObjectId(currentUser._id) })
          if (!!lastUser.email) {
            agenda.now('forget-password', {
              to: lastUser.email,
              email: lastUser.email,
              fullName: lastUser.fullName,
              token: lastUser.resetToken,
              subject: '',
            })
          }
          return {
            success: true,
            message: "Your request to reset password has been sent. Please check your email."
          }
        }
        return {
          success: false,
          message: "Email can not find in system."
        }
      }
      return {
        success: false,
        message: "Please input email."
      }
    },
    resetPassword: async (parent, args, context) => {
      const { mongo } = context
      const { email, token, password } = args
      if (!!email && !!token && !!password) {
        const currentUser = await mongo.User.findOne({ email, resetToken: { $exists: true, $eq: token }, deletedAt: null })
        if (!!currentUser) {
          await mongo.User.updateOne(
            { _id: ObjectId(currentUser._id) },
            {
              $set: {
                password: hashPassword(password),
                resetToken: null
              }
            },
            { returnOriginal: false }
          )
          return {
            success: true,
            message: "Your password has been changed."
          }
        }
        return {
          success: false,
          message: "Invalid token."
        }
      }
      return {
        success: false,
        message: "Invalid email & token."
      }
    }
  }
}
