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

/**
 * `podOtp` is intersected in rather than added to /shared's Delivery: /shared
 * holds what crosses the client/server boundary, and this never does.
 */
export type DeliveryDoc = Doc<Delivery, 'parcel' | 'agent'> & {
  podOtp?: PodOtp
}

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
    /**
     * The Cloudinary secure URL. A URL, never the bytes: the SRS's memory
     * constraint and CLAUDE.md section 2 both put the image on Cloudinary, and
     * a 6 MB buffer in a document the tracking screen reads on every poll
     * would be the single worst thing in this database.
     */
    photoUrl: { type: String, required: false },
    otpVerifiedAt: { type: Date, required: false },
    /**
     * Not required since M5: it IS the evidence for a signature, but for photo
     * and OTP proof the evidence is the photo or the verified code, and forcing
     * a name there would record an unverified claim as part of the proof.
     * Which field each method needs is enforced by the shared Zod schema.
     */
    receivedBy: { type: String, required: false, trim: true },
    capturedAt: { type: Date, required: true },
  },
  { _id: false },
)

/**
 * The pending delivery code. Never leaves the server as a whole; `select:
 * false` keeps it out of every read that does not name it, so a handler that
 * forgets to project cannot leak the code to the rider it is meant to check.
 *
 * The code is stored as typed rather than hashed, because with no SMS provider
 * in the stack the server itself has to be able to show it to the parcel's
 * owner — see the tracking route. It is single-purpose, expires in minutes,
 * and is deleted the moment it verifies, which is the trade being made; the
 * PROOF record keeps only a timestamp, so nothing replayable survives.
 */
const podOtp = new Schema(
  {
    code: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
)

export interface PodOtp {
  code: string
  issuedAt: Date
  expiresAt: Date
  attempts: number
}

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
    podOtp: { type: podOtp, required: false, select: false, default: undefined },
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
 * The marker advanceStatus() passes so its own writes are recognised.
 *
 * A Mongoose query option rather than a field on the document: it must travel
 * with the WRITE and leave no trace in the data. Anything writing `status`
 * without it is refused below.
 */
export const LIFECYCLE_WRITE = '__lifecycleWrite' as const

/** Does this update touch `status`, by any operator or as a bare assignment? */
const touchesStatus = (update: Record<string, unknown>): boolean => {
  if ('status' in update) return true
  for (const [op, block] of Object.entries(update)) {
    if (!op.startsWith('$') || typeof block !== 'object' || block === null) continue
    if ('status' in (block as Record<string, unknown>)) return true
  }
  return false
}

/**
 * CLAUDE.md section 5 says "no route mutates status directly". Until now that
 * was discipline: `DeliveryModel` is exported, and any future handler could
 * `$set: { status }` and skip the transition map, the authority check, the
 * Delivered precondition, the event append and the broadcast in one line.
 *
 * This turns the sentence into an enforced rule. Exported as a pure function so
 * it can be unit-tested without a database — the hook below is a one-line call.
 */
export const assertLifecycleWrite = (
  update: Record<string, unknown> | null | undefined,
  options: Record<string, unknown>,
): void => {
  if (!update || !touchesStatus(update)) return
  if (options[LIFECYCLE_WRITE] === true) return
  throw new Error(
    'delivery.status may only be changed by advanceStatus() — it owns the transition map, ' +
      'the authority check and the event trail (CLAUDE.md section 5). ' +
      'If this really is a lifecycle write, pass the LIFECYCLE_WRITE option.',
  )
}

deliveryMongooseSchema.pre(
  ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'],
  function (next) {
    const update = this.getUpdate()
    if (Array.isArray(update)) {
      // An aggregation pipeline update. Nothing here uses one, and letting it
      // through would be a hole in exactly the wall this hook is.
      next(new Error('pipeline updates are not allowed on Delivery'))
      return
    }
    try {
      assertLifecycleWrite(
        update as Record<string, unknown> | null,
        this.getOptions() as Record<string, unknown>,
      )
      next()
    } catch (err) {
      next(err as Error)
    }
  },
)

/**
 * The same rule for `doc.status = x; await doc.save()`.
 *
 * No marker exists for this path because nothing should use it: advanceStatus
 * works through findOneAndUpdate, conditionally on the status it validated
 * against, which is also the optimistic lock that stops two riders both
 * winning. A read-modify-save would quietly lose that.
 */
deliveryMongooseSchema.pre('save', function (next) {
  if (!this.isNew && this.isModified('status')) {
    next(
      new Error(
        'delivery.status cannot be changed with save() — go through advanceStatus(), ' +
          'which updates conditionally on the status it checked',
      ),
    )
    return
  }
  next()
})

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
