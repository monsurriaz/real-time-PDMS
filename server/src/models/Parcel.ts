import mongoose, { Schema, type Types } from 'mongoose'
import { parcelSizeSchema, zoneName, type Parcel } from '@pdms/shared'
import type { Doc } from './types'
import { runAsSystem } from '../lib/context'
import { ALLOW_ALL, DENY_ALL, roleScopePlugin } from './plugins/roleScope'

export type ParcelDoc = Doc<Parcel, 'customer'>

const geoPointPath = {
  type: {
    type: String,
    enum: ['Point'],
    required: false,
  },
  coordinates: {
    type: [Number],
    required: false,
    validate: {
      validator: (v: number[] | undefined) => v === undefined || v.length === 2,
      message: 'coordinates must be [longitude, latitude]',
    },
  },
}

const address = new Schema(
  {
    line1: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    zone: { type: String, required: true, enum: zoneName.options },
    city: { type: String, required: true, default: 'Dhaka', trim: true },
    contactName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
    point: geoPointPath,
    resolvedLabel: { type: String, required: false },
  },
  { _id: false },
)

const priceBreakdown = new Schema(
  {
    zoneBase: { type: Number, required: true, min: 0 },
    distanceKm: { type: Number, required: true, min: 0 },
    perKmRate: { type: Number, required: true, min: 0 },
    distanceCost: { type: Number, required: true, min: 0 },
    weightTierLabel: { type: String, required: true },
    weightSurcharge: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    pricingConfigVersion: { type: Date, required: true },
  },
  { _id: false },
)

const parcelMongooseSchema = new Schema<ParcelDoc>(
  {
    trackingId: { type: String, required: true, unique: true, index: true },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    pickup: { type: address, required: true },
    drop: { type: address, required: true },
    weightKg: { type: Number, required: true, min: 0 },
    size: { type: String, required: true, enum: parcelSizeSchema.options },
    description: { type: String, required: false, trim: true },
    /**
     * Immutable once written. CLAUDE.md section 5: a later PricingConfig edit
     * must never retroactively change an existing parcel's price, and the
     * cheapest way to guarantee that is to forbid the field from changing at
     * all rather than to remember not to touch it.
     */
    price: { type: priceBreakdown, required: true, immutable: true },
    isCod: { type: Boolean, required: true, default: false },
    codAmount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
)

/** Assignment runs $near against the pickup point (section 5). */
parcelMongooseSchema.index({ 'pickup.point': '2dsphere' }, { sparse: true })
parcelMongooseSchema.index({ 'drop.point': '2dsphere' }, { sparse: true })

interface DeliveryRefRow {
  parcel: Types.ObjectId
}

/**
 * An agent may see a parcel only while it is one of their assignments. That
 * fact lives on Delivery, so this reaches across — as a system query with an
 * explicit filter, so Delivery's own scoping cannot double-apply and quietly
 * narrow the result.
 *
 * `mongoose.model` is looked up lazily rather than imported, because Parcel
 * and Delivery scope against each other and a static import would be a cycle.
 */
const parcelIdsAssignedTo = async (
  agentUserId: string,
): Promise<Types.ObjectId[]> => {
  const AgentModel = mongoose.model('Agent')
  const DeliveryModel = mongoose.model('Delivery')

  return runAsSystem('role-scope: agent -> own parcels', async () => {
    const agent = await AgentModel.findOne({
      user: new mongoose.Types.ObjectId(agentUserId),
    })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()

    if (!agent) return []

    const rows = await DeliveryModel.find({ agent: agent._id })
      .select('parcel')
      .lean<DeliveryRefRow[]>()

    return rows.map((r) => r.parcel)
  })
}

roleScopePlugin<ParcelDoc>(parcelMongooseSchema, {
  admin: () => ALLOW_ALL,
  customer: (actor) => ({ customer: new mongoose.Types.ObjectId(actor.id) }),
  agent: async (actor) => {
    const ids = await parcelIdsAssignedTo(actor.id)
    return ids.length > 0 ? { _id: { $in: ids } } : DENY_ALL
  },
})

export const ParcelModel = mongoose.model<ParcelDoc>('Parcel', parcelMongooseSchema)
