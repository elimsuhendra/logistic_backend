const _pipe = (a, b) => (args) => b(a(args))
export const checkPermissions = (...ops) => ops.reduce(_pipe) 

const createResolver = resolver => {
  const baseResolver = resolver
  baseResolver.createResolver = childResolver => {
    const newResolver = async (parent, args, context, info) => {
      await resolver(parent, args, context, info)
      return childResolver(parent, args, context, info)
    }
    return createResolver(newResolver)
  }
  return baseResolver
}

// requiresAuth
export default createResolver(async (parent, args, { mongo, user }, info) => {

})

export const checkUserAuth = async (params) => {
  // console.log("CHECK USER AUTH")
  if (process.env.ENABLE_PERMISSION_CHECK === 'true') {
    const { context } = await params
    const { user } = context

    if (!user || !user._id) {
      throw new Error('Not authenticated')
    }
  }

  return params
}