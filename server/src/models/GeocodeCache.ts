import mongoose, { Schema, type Types } from 'mongoose'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'
import { requiredPoint } from './geo'

/**
 * Every Nominatim result we have ever seen, keyed by a normalised address
 * string. CLAUDE.md section 2 requires caching every result: the public
 * instance allows 1 req/sec and blocks abusers, so re-asking for an address
 * we already resolved is both slow and rude.
 *
 * Misses are cached too. An address that does not resolve will not start
 * resolving because someone retried, and without a negative entry a customer
 * mistyping their street becomes an unbounded stream of upstream requests.
 */
export interface GeocodeCacheDoc {
  _id: Types.ObjectId
  key: string
  /** The raw query sent upstream, kept for debugging a bad normalisation. */
  query: string
  found: boolean
  point?: { type: 'Point'; coordinates: [number, number] }
  resolvedLabel?: string
  lookedUpAt: Date
}

const geocodeCacheSchema = new Schema<GeocodeCacheDoc>(
  {
    key: { type: String, required: true, unique: true, index: true },
    query: { type: String, required: true },
    found: { type: Boolean, required: true },
    point: { ...requiredPoint, required: false, default: undefined },
    resolvedLabel: { type: String, required: false },
    lookedUpAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: true },
)

/**
 * Reference data derived from public OSM data — it contains no customer
 * information, and every role needs it to book or view a parcel.
 */
roleScopePlugin<GeocodeCacheDoc>(geocodeCacheSchema, {
  admin: () => ALLOW_ALL,
  customer: () => ALLOW_ALL,
  agent: () => ALLOW_ALL,
})

export const GeocodeCacheModel = mongoose.model<GeocodeCacheDoc>(
  'GeocodeCache',
  geocodeCacheSchema,
)
