import { ObjectId } from 'mongodb'
import _ from 'lodash'
import { isBlankString, isEmptyObject } from 'utils/validate'

export async function addNewParameter({ 
  typeLabel, 
  typeCode, 
  valueLabel, 
  valueCode, 
  includeDelete = true 
}, { mongo }) {
  if (!valueCode) return
  const parameterType = await mongo.ParameterType.findOne({ code: typeCode, deletedAt: null })
  if (!parameterType) {
    await mongo.ParameterType.insertOne({
      code: typeCode,
      label: typeLabel,
      parameterValues: [{
        id: new ObjectId(),
        label: valueLabel || valueCode,
        code: valueCode,
        position: 0,
      }],
      createdAt: new Date().getTime(),
      updatedAt: null,
      deletedAt: null,
    })
  } else {
    let currentParameterValue = (parameterType.parameterValues || []).find(v => v.code === valueCode)
    if (!isEmptyObject(currentParameterValue)) {
      const label = currentParameterValue.label
      let argsLabel = isBlankString(valueLabel) ? label : valueLabel
      if (isBlankString(argsLabel)) {
        argsLabel = valueCode
      }
      let variables = {
        "parameterValues.$.label": argsLabel
      }
      if (!!includeDelete) {
        variables = {
          ...variables,
          "parameterValues.$.deletedAt": null,
        }
      }
      await mongo.ParameterType.updateOne(
        { code: typeCode, "parameterValues.code": valueCode },
        {
          $set: variables
        }
      )
      return
    }
    const parameterValueId = new ObjectId()
    await mongo.ParameterType.updateOne(
      { code: typeCode },
      {
        $push: {
          parameterValues: {
            label: valueLabel || valueCode,
            code: valueCode,
            id: parameterValueId,
            position: (parameterType.parameterValues || []).length
          }
        }
      }
    )
  }
}
