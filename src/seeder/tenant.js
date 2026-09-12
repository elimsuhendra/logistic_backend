import tenant from './data/tenant'

const importTenant = async (context) => {
  const { mongo } = context

  await mongo.Tenant.updateOne({
    nickname: tenant.nickname
  }, {
    $set: tenant
  }, {
    upsert: true
  })

  return await mongo.Tenant.findOne({})
}

export default importTenant
