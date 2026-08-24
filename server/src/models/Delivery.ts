import mongoose, { Schema, type Types } from 'mongoose'
import {
  deliveryStatusSchema,
  podMethodSchema,
  role as roleSchema,
  type Delivery,
} from '@pdms/shared'
import type { Doc } from './types'
import { runAsSystem } from '../lib/context'
import { optionalPoint } from './geo'
import { ALLOW_ALL, DENY_ALL, roleScopePlugin } from './plugins/roleScope'

export type DeliveryDoc = Doc<Delivery, 'parcel' | 'agent'>

const deliveryEvent = new Schema(
  {
    status: { type: String, required: true, enum: deliveryStatusSchema.options },
    at: { type: Date, required: true },
    actor: { type: Schema.Types.ObjectId, ref: 'User', required: false, default: null },
    actorRole: { type: String, enum: roleSchema.options, required: false, default: null },
    point: optionalPoint,
    note: { type: String, required: false, trim: true },
  },
  { _id: false },
)

const proofOfDelivery = new Schema(
  {
    method: { type: String, required: true, enum: podMethodSchema.options },
    photoUrl: { type: String, required: false },
    otpVerifiedAt: { type: Date, required: false },
    receivedBy: { type: String, required: true, trim: true },
    capturedAt: { type: Date, required: true },
  },
  { _id: false },
)

const deliveryMongooseSchema = new Schema<DeliveryDoc>(
  {
    parcel: {
      type: Schema.Types.ObjectId,
      ref: 'Parcel',
      required: true,
      unique: true,
    },
    agent: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      required: false,
      default: null,
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: deliveryStatusSchema.options,
      default: 'Booked',
      index: true,
    },
    events: { type: [deliveryEvent], required: true, default: [] },

    assignedAt: { type: Date, required: false, default: null },
    pickedUpAt: { type: Date, required: false, default: null },
    deliveredAt: { type: Date, required: false, default: null },

    proofOfDelivery: { type: proofOfDelivery, required: false },
    failureReason: { type: String, required: false, trim: true },

    lastKnownLocation: optionalPoint,
    lastLocationAt: { type: Date, required: false },

    expectedBy: { type: Date, required: false, default: null },
  },
  { timestamps: true },
)

deliveryMongooseSchema.index({ lastKnownLocation: '2dsphere' }, { sparse: true })
/** The admin live board sorts active deliveries by recency. */
deliveryMongooseSchema.index({ status: 1, updatedAt: -1 })

/**
 * events[] is append-only (CLAUDE.md section 5).
 *
 * Mongoose has no built-in append-only array, so this compares the saved
 * array against the one loaded from the database and rejects any save that
 * shortens it or rewrites an existing entry. Appending is the only edit that
 * survives.
 */
deliveryMongooseSchema.pre('save', function (next) {
  if (this.isNew) {
    next()
    return
  }
  if (!this.isModified('events')) {
    next()
    return
  }

  // `$__original` is not public API, so compare against the modified paths
  // instead: any events mutation that is not a pure push shows up as a
  // change to an indexed sub-path such as `events.0.status`.
  const touched = this.modifiedPaths().filter((p) => /^events\.\d+\./.test(p))
  if (touched.length > 0) {
    next(
      new Error(
        `delivery.events is append-only — refusing to rewrite ${touched.join(', ')}`,
      ),
    )
    return
  }
  next()
})

/**
 * Blanket refusal of array-rewriting update operators on events. A $set or
 * $pull against events would bypass the save hook above entirely.
 */
deliveryMongooseSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate'],
  function (next) {
    const update = this.getUpdate()
    if (!update || Array.isArray(update)) {
      next()
      return
    }
    const forbidden = ['$set', '$unset', '$pull', '$pop', '$pullAll'] as const
    for (const op of forbidden) {
      const block = update[op] as Record<string, unknown> | undefined
      if (!block) continue
      const bad = Object.keys(block).filter((k) => k === 'events' || k.startsWith('events.'))
      if (bad.length > 0) {
        next(
          new Error(
            `delivery.events is append-only — ${op} on ${bad.join(', ')} is not allowed; use $push`,
          ),
        )
        return
      }
    }
    next()
  },
)

interface ParcelRefRow {
  _id: Types.ObjectId
}

/**
 * A customer sees a delivery only when they own its parcel. Ownership lives
 * on Parcel, so this reaches across as a system query with an explicit
 * filter — same reasoning as Parcel's agent rule, in the other direction.
 */
const parcelIdsOwnedBy = async (
  customerId: string,
): Promise<Types.ObjectId[]> => {
  const ParcelModel = mongoose.model('Parcel')
  return runAsSystem('role-scope: customer -> own deliveries', async () => {
    const rows = await ParcelModel.find({
      customer: new mongoose.Types.ObjectId(customerId),
    })
      .select('_id')
      .lean<ParcelRefRow[]>()
    return rows.map((r) => r._id)
  })
}

const agentDocIdFor = async (
  agentUserId: string,
): Promise<Types.ObjectId | null> => {
  const AgentModel = mongoose.model('Agent')
  return runAsSystem('role-scope: agent -> own deliveries', async () => {
    const agent = await AgentModel.findOne({
      user: new mongoose.Types.ObjectId(agentUserId),
    })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
    return agent?._id ?? null
  })
}

roleScopePlugin<DeliveryDoc>(deliveryMongooseSchema, {
  admin: () => ALLOW_ALL,
  customer: async (actor) => {
    const ids = await parcelIdsOwnedBy(actor.id)
    return ids.length > 0 ? { parcel: { $in: ids } } : DENY_ALL
  },
  agent: async (actor) => {
    const agentId = await agentDocIdFor(actor.id)
    return agentId ? { agent: agentId } : DENY_ALL
  },
})

export const DeliveryModel = mongoose.model<DeliveryDoc>(
  'Delivery',
  deliveryMongooseSchema,
)
