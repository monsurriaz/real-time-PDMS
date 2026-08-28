import mongoose, { Schema } from 'mongoose'
import { messageSenderRoleSchema, type Message } from '@pdms/shared'
import type { Doc } from './types'
import { runAsSystem } from '../lib/context'
import { ALLOW_ALL, DENY_ALL, roleScopePlugin } from './plugins/roleScope'

export type MessageDoc = Doc<Message, 'delivery' | 'parcel' | 'sender'>

const messageMongooseSchema = new Schema<MessageDoc>(
  {
    delivery: { type: Schema.Types.ObjectId, ref: 'Delivery', required: true, index: true },
    parcel: { type: Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
    sender: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, required: true, enum: messageSenderRoleSchema.options },
    body: { type: String, required: true, trim: true, maxlength: 500 },
  },
  { timestamps: true },
)

/** The thread reads in send order — one query per open thread. */
messageMongooseSchema.index({ delivery: 1, createdAt: 1 })

interface ParcelRefRow {
  _id: mongoose.Types.ObjectId
}

interface DeliveryRefRow {
  _id: mongoose.Types.ObjectId
}

/**
 * Scoping mirrors Delivery's own rule exactly — a customer via the parcels
 * they own, an agent via the deliveries currently theirs — rather than a
 * second permission model for chat (the M9 brief's own instruction, and the
 * M6 socket-room bypass is exactly the kind of drift a parallel mechanism
 * would risk repeating). The route layer (routes/messages.ts) narrows
 * further, to the CURRENT thread's two participants; this is the coarser
 * "could this caller ever see ANY of this delivery's messages" cut, the
 * same division of labour Delivery and Parcel already use between
 * themselves.
 */
const parcelIdsOwnedBy = async (
  customerId: string,
): Promise<mongoose.Types.ObjectId[]> => {
  const ParcelModel = mongoose.model('Parcel')
  return runAsSystem('role-scope: message customer -> own parcels', async () => {
    const rows = await ParcelModel.find({
      customer: new mongoose.Types.ObjectId(customerId),
    })
      .select('_id')
      .lean<ParcelRefRow[]>()
    return rows.map((r) => r._id)
  })
}

const deliveryIdsForAgent = async (
  agentUserId: string,
): Promise<mongoose.Types.ObjectId[]> => {
  const AgentModel = mongoose.model('Agent')
  const DeliveryModel = mongoose.model('Delivery')
  return runAsSystem('role-scope: message agent -> own deliveries', async () => {
    const agent = await AgentModel.findOne({
      user: new mongoose.Types.ObjectId(agentUserId),
    })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId } | null>()
    if (!agent) return []

    const rows = await DeliveryModel.find({ agent: agent._id })
      .select('_id')
      .lean<DeliveryRefRow[]>()
    return rows.map((r) => r._id)
  })
}

roleScopePlugin<MessageDoc>(messageMongooseSchema, {
  admin: () => ALLOW_ALL,
  customer: async (actor) => {
    const ids = await parcelIdsOwnedBy(actor.id)
    return ids.length > 0 ? { parcel: { $in: ids } } : DENY_ALL
  },
  agent: async (actor) => {
    const ids = await deliveryIdsForAgent(actor.id)
    return ids.length > 0 ? { delivery: { $in: ids } } : DENY_ALL
  },
})

export const MessageModel = mongoose.model<MessageDoc>('Message', messageMongooseSchema)
