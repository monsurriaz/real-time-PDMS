import mongoose, { Schema, type Types } from 'mongoose'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'

/**
 * Road distance between two points, cached per pair (CLAUDE.md section 5).
 *
 * The key is the two coordinate pairs rounded to 5 decimals — about a metre.
 * Because geocoding is itself cached and deterministic, the same address pair
 * always produces the same coordinates and therefore the same key, which is
 * what makes this a per-address-pair cache in practice. Rounding also stops
 * floating-point noise from producing near-duplicate rows.
 */
export interface RouteCacheDoc {
  _id: Types.ObjectId
  key: string
  distanceKm: number
  durationMin: number
  lookedUpAt: Date
}

const routeCacheSchema = new Schema<RouteCacheDoc>(
  {
    key: { type: String, required: true, unique: true, index: true },
    distanceKm: { type: Number, required: true, min: 0 },
    durationMin: { type: Number, required: true, min: 0 },
    lookedUpAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
)

roleScopePlugin<RouteCacheDoc>(routeCacheSchema, {
  admin: () => ALLOW_ALL,
  customer: () => ALLOW_ALL,
  agent: () => ALLOW_ALL,
})

export const RouteCacheModel = mongoose.model<RouteCacheDoc>(
  'RouteCache',
  routeCacheSchema,
)
