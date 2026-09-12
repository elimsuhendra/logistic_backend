import { ObjectId } from 'mongodb'
import { prepareUpdate, prepareCreate, softNestedDelete } from 'src/utils/model'
import pubsub from 'src/utils/pubsub'
import _ from "lodash"
import moment from 'moment'

export async function getGroupByUserId({mongo, userId }) {
    let consultantGroupIdArr = await mongo.Group.find({ 
      $or: [
        {staffIds: userId},
        {teamLeaderId: ObjectId(userId)},
        {managerId: ObjectId(userId)},
      ],
      deletedAt: null
    }).limit(1).sort({ updatedAt: -1 }).toArray()
    
    consultantGroupIdArr = consultantGroupIdArr.length > 0 ? consultantGroupIdArr[0] : null
    return consultantGroupIdArr
}

export async function updateTest() {
  console.log('updateTest')
}