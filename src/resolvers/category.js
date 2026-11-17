import requiresAuth from 'src/utils/permissions'
import { ObjectId } from 'mongodb'
import buildMongoOrders from 'src/utils/buildMongoOrders'
import { sanitizeRegex } from 'src/utils/common'

function buildCategoryFilter(filter = {}) {
  const { OR, AND, _id_in, type, type_in, name, label_regex, inactive } = filter || {}
  const out = { deletedAt: null }

  if (_id_in) out._id = { $in: _id_in.filter(id => ObjectId.isValid(id)).map(id => ObjectId(id)) }
  if (type) out.type = type
  if (type_in) out.type = { $in: type_in }
  if (name) out.name = name
  if (label_regex) out.label = { $regex: sanitizeRegex(label_regex), $options: 'i' }
  // seeded / older rows may not have the field, so false means "not true"
  if (inactive === true) out.inactive = true
  if (inactive === false) out.inactive = { $ne: true }
  if (Array.isArray(OR) && OR.length) out.$or = OR.map(buildCategoryFilter)
  if (Array.isArray(AND) && AND.length) out.$and = AND.map(buildCategoryFilter)

  return out
}

export default {
  Category: {
    id: parent => String(parent._id || parent.id),
    inactive: parent => Boolean(parent.inactive),
  },
  Query: {
    allCategories: requiresAuth.createResolver(async (parent, args, { mongo }) => {
      const { filter = {}, first, skip, orderBy } = args
      return await mongo.Category.find(buildCategoryFilter(filter))
        .sort(orderBy ? buildMongoOrders(orderBy) : { label: 1 })
        .skip(skip || 0)
        .limit(first || 100)
        .toArray()
    }),
    _allCategoriesMeta: requiresAuth.createResolver(async (parent, { filter = {} }, { mongo }) => {
      const count = await mongo.Category.countDocuments(buildCategoryFilter(filter))
      return { count }
    }),
    getCategory: requiresAuth.createResolver(async (parent, { id }, { mongo }) => {
      if (!id || !ObjectId.isValid(id)) return null
      return await mongo.Category.findOne({ _id: ObjectId(id), deletedAt: null })
    }),
  },
}
