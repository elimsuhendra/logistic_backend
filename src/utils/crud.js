import { ObjectId } from 'mongodb'
import { prepareUpdate, prepareCreate, softNestedDelete } from 'src/utils/model'
import pubsub from 'src/utils/pubsub'
import _ from "lodash"

export const mongoCreate = async (collectionName, args, context, validation) => {
  try {
    const { mongo, skipSubscription = false } = context
    const newObj = prepareCreate(args)
    const rs = await mongo[collectionName].insertOne(newObj)

    if (rs.insertedId) {
      if (!skipSubscription) {
        pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-' + collectionName, {
          [collectionName]: { mutation: 'CREATED', node: { ...newObj, id: rs.insertedId } }
        })

        await createLog(
          {
            action: 'create_' + collectionName,
            objectId: newObj._id,
            objectType: collectionName,
            payload: newObj,
          },
          context,
        );
      }

      return {
        ...newObj,
        id: rs.insertedId
      }
    } else {
      console.log('⛔️Error status 422 - ', JSON.stringify(rs))
      return new Error(`⛔️ Can not Create ${collectionName}`)
    }
  } catch (err) {
    console.log('⛔️Error status 500 - ', err)
    return new Error(`⛔️ Can not Create ${collectionName}`)
  }
}

export const mongoUpdate = async (collectionName, { id, ...args }, context, validation) => {
  try {
    const { mongo, skipSubscription = false } = context
    const update = prepareUpdate(args)
    const lastData = await mongo[collectionName].findOne({ _id: ObjectId(id) })
    const rs = await mongo[collectionName].findOneAndUpdate(
      { _id: ObjectId(id) },
      { $set: update },
      { returnOriginal: false }
    )

    if (rs.value) {
      if (!skipSubscription) {
        pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-' + collectionName, {
          [collectionName]: {
            mutation: 'UPDATED',
            node: rs.value
          }
        })

        await createLog(
          {
            action: 'update_' + collectionName,
            objectId: rs.value._id,
            objectType: collectionName,
            payload: args,
            lastData: lastData,
          },
          context,
        );
      }
      const result = rs.value
      result.ok = 1
      result.value = rs.value
      result.matchedCount = 1
      result.modifiedCount = 1
      return result
    } else {
      console.log('⛔️ Error status 422 - ', JSON.stringify(rs))
      return new Error(`⛔️ Can not Update ${collectionName}`)
    }
  } catch (err) {
    console.log('⛔️ Error status 500 - ', err)
    return new Error(`⛔️ Can not Update ${collectionName}`)
  }
}

export const mongoUpdateWithFilter = async (
  collectionName,
  { filters, ...args },
  context,
  validation
) => {
  try {
    const { mongo } = context || {}
    const update = prepareUpdate(args)
    const lastData = await mongo[collectionName].findOne(filters)
    const rs = await mongo[collectionName].findOneAndUpdate(
      filters,
      { $set: update },
      { returnOriginal: false }
    )
    if (rs.value) {
      pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-' + collectionName, {
        [collectionName]: {
          mutation: 'UPDATED',
          node: rs.value
        }
      })

      await createLog(
        {
          action: 'update_' + collectionName,
          objectId: rs.value._id,
          objectType: collectionName,
          payload: args,
          lastData: lastData,
        },
        context,
      );

      return await rs.value
    } else {
      console.log('[Error] Status 422 - ', JSON.stringify(rs))
      return new Error(`Error in Updating ${collectionName}.`)
    }
  } catch (err) {
    console.log('[Error] Status 500 - ', err)
    return new Error(`Error in Updating ${collectionName}.`)
  }
}

export const mongoDelete = async (collectionName, { id }, context, validation) => {
  try {
    const { mongo, skipSubscription = false } = context || {}
    let rs = await softNestedDelete(mongo, id, collectionName)
    if (!rs.errors) {
      let obj = await mongo[collectionName].findOne({ _id: ObjectId(id) })
      obj.id = obj._id
      if (!skipSubscription) {
        pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-' + collectionName, {
          [collectionName]: {
            mutation: 'DELETED',
            previousValues: obj,
            node: obj
          }
        })

        await createLog(
          {
            action: 'delete_' + collectionName,
            objectId: id,
            objectType: collectionName,
            lastData: obj,
          },
          context,
        );
      }
      return { success: true }
    } else {
      console.log('⛔️ Error status 422 - ', JSON.stringify(rs))
      return { success: false, errors: rs.errors }
    }
  } catch (err) {
    console.log('⛔️ Error status 500 - ', err)
    return {
      success: false
    }
  }
}

export const mongoMultiDelete = async (collectionName, { ids }, { mongo }, validation) => {
  try {
    let rs = await softNestedDelete(mongo, ids, collectionName)
    if (!rs.errors) {
      pubsub.publish(process.env.APP_NAME + '-' + process.env.APP_ENV + '-' + collectionName, {
        [collectionName]: {
          mutation: 'DELETED',
          previousValues: ids
        }
      })
      return { success: true }
    } else {
      console.log('⛔️ Error status 422 - ', JSON.stringify(rs))
      return { success: false, errors: rs.errors }
    }
  } catch (err) {
    console.log('⛔️ Error status 500 - ', err)
    return {
      success: false
    }
  }
}

export const mongoAddManyToMany = async (collections, { id, ...args }, { mongo }, validation) => {
  try {
    const colNameId = collections[0].nameId()
    const refNameId = collections[2].nameId()
    const validateData = await Promise.all([
      mongo[collections[0]].findOne({ _id: ObjectId(args[colNameId]), deletedAt: null }),
      mongo[collections[2]].findOne({ _id: ObjectId(args[refNameId]), deletedAt: null })
    ]).then(rs => rs.filter(x => !x)).length
    if (validateData) {
      return {
        success: false,
        errors: [{ message: 'document not found.' }]
      }
    }
    const obj = {
      ...args,
      [colNameId]: ObjectId(args[colNameId]),
      [refNameId]: ObjectId(args[refNameId])
    }
    await mongo[collections[1]].update(
      obj,
      {
        $setOnInsert: prepareCreate(obj)
      },
      {
        upsert: true
      }
    )
    return {
      success: true
    }
  } catch (err) {
    console.log('⛔️ Error status 500 - ', err)
    return {
      success: false
    }
  }
}

export const mongoRemoveManyToMany = async (
  collections,
  { id, ...args },
  { mongo },
  validation
) => {
  try {
    const colNameId = collections[0].nameId()
    const refNameId = collections[2].nameId()
    await mongo[collections[1]].findAndRemove({
      [colNameId]: ObjectId(args[colNameId]),
      [refNameId]: ObjectId(args[refNameId])
    })
    return {
      success: true
    }
  } catch (err) {
    console.log('⛔️⛔️⛔️ Error status 500 - ', err)
    return {
      success: false
    }
  }
}

export const mongoAddIds = async (collections, { id, ids }, { mongo }, validation) => {
  try {
    const refNameIds = collections[1].nameIds()
    let rs = await mongo[collections[0]].findOneAndUpdate(
      {
        _id: ObjectId(id)
      },
      { $set: { [refNameIds]: ids.map(_id => ObjectId(_id)) } },
      { returnOriginal: false }
    )
    if (rs.value) {
      return {
        success: true,
        [collections[0].lowerCaseFirstChar()]: rs.value
      }
    }
    return {
      success: false
    }
  } catch (err) {
    console.log('⛔️ Error status 500 - ', err)
    return {
      success: false
    }
  }
}

export const mongoRemoveIds = async (collections, { id, ids }, { mongo }, validation) => {
  try {
    const refNameIds = [`${collections[1]}Ids`.lowerCaseFirstChar()]
    const obj = await mongo[collections[0]].findOne({ _id: ObjectId(id) })
    if (!obj) return { success: false, errors: [{ message: 'Object not found.' }] }
    const newObjIds = obj[refNameIds]
      .map(oId => {
        if (!ids.includes(String(oId))) return oId
      })
      .filter(x => x)
    let rs = await mongo[collections[0]].findOneAndUpdate(
      {
        _id: ObjectId(id)
      },
      { $set: { [refNameIds]: newObjIds.map(nId => ObjectId(nId)) } },
      { returnOriginal: false }
    )
    if (rs.value) {
      return {
        success: true,
        [collections[0].lowerCaseFirstChar()]: rs.value
      }
    }
    return {
      success: false
    }
  } catch (err) {
    console.log('⛔️ Error status 500 - ', err)
    return {
      success: false
    }
  }
}

export async function ensureHasTextIndex(collectionName, { mongo }) {
  const indexes = await mongo[collectionName].indexes()

  return indexes.some(index => _.get(index, "key._fts") === "text")
}

export async function createLog(args, context) {
  try {
    const { mongo, user } = context || {}
    if (!mongo || !mongo.ActivityLog) return null
    const { action, objectId, objectType, payload, lastData = null } = args

    const formattedObjectId = objectId ? (ObjectId.isValid(objectId) ? ObjectId(objectId) : objectId) : null
    const formattedCreatorId = user && user._id ? (ObjectId.isValid(user._id) ? ObjectId(user._id) : user._id) : null

    const newActivityLog = {
      _id: new ObjectId(),
      objectId: formattedObjectId,
      objectType: objectType,
      action: action,
      payload: payload,
      lastData: lastData,
      createdAt: new Date().getTime(),
      creatorId: formattedCreatorId,
    }

    await mongo.ActivityLog.insertOne(newActivityLog)

    pubsub.publish(
      process.env.APP_NAME + '-' + process.env.APP_ENV + '-ActivityLog',
      {
        ActivityLog: {
          mutation: 'CREATED',
          node: newActivityLog,
        },
      }
    )

    return {
      success: true,
      log: newActivityLog,
    }
  } catch (err) {
    console.error('[Error] createLog failed:', err)
    return { success: false, error: err }
  }
}