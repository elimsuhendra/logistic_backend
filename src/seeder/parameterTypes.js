import parameterValues from './data/parameterValues'
import { ObjectId } from "mongodb"

const importParameterTypes = async (context) => {
  const { mongo } = context
  let indexTime = 0 
  const groupedTypes = parameterValues.reduce((prev, value) => {
    if (!prev[value.Type]) {
      prev[value.Type] = {
        createdAt: Date.now() + indexTime++,
        updatedAt: null,
        deletedAt: null,
        label: value.Type,
        code: value.Type.toLowerCase().replace(/\s/g, '-'),
        parameterValues: []
      }
    }

    prev[value.Type].parameterValues.push({
      id: new ObjectId(),
      label: value.label,
      code: value.code,
      position: prev[value.Type].parameterValues.length
    })
    return prev
  }, {})

  const parameterTypes = Object.values(groupedTypes)

  const bulkArgs = parameterTypes.map((parameterType, index) => {
    return {
      updateOne: {
        filter: { code: parameterType.code },
        update: {
          $set: {
            ...parameterType,
            position: index
          }
        },
        upsert: true
      }
    }
  })

  // await mongo.ParameterType.deleteMany({})
  await mongo.ParameterType.bulkWrite(bulkArgs, { ordered: true })

  const allParameterTypes = await mongo.ParameterType.find().toArray()

  return allParameterTypes
}

export default importParameterTypes
