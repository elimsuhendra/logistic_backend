import { ObjectId } from 'mongodb'

const updateDeletedAt = async (mongo, record, action) => {
  return await mongo[record.collectionName].findOneAndUpdate(
    { _id: ObjectId(record.id), deletedAt: null },
    {
      $set: {
        // updatedAt: new Date().getTime(), // Fixme: Consider this situation
        deletedAt: action === 'DELETE' ? new Date().getTime() : null
      }
    }
  )
}

const softNestedDelete = async (mongo, id, collectionName, action = 'DELETE', docs = []) => {
  try {
    if (id instanceof Array) {
      return await id.map(i => softNestedDelete(mongo, i, collectionName, action, docs))
    }
    const node = await updateDeletedAt(mongo, { id, collectionName }, action)
    console.log(`[DELETE] Deleting: ${collectionName}, ID: ${id}`)
    return { success: true, node }
  } catch (e) {
    console.log(`[ERROR] Failed in deleting: ${collectionName}, ID: ${id}`)
    return { success: false }
  }
}

export default softNestedDelete
