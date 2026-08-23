import { z } from 'zod'
import {
  geoPoint,
  objectId,
  phone,
  taka,
  timestamps,
  trackingId,
  zoneName,
} from './common'
import { priceBreakdownSchema } from './pricing'

/**
 * One end of a journey. The geocoded point carries a 2dsphere index so
 * assignment can run $near against pickup.
 */
export const addressSchema = z.object({
  line1: z.string().min(3).max(200),
  area: z.string().min(2).max(120),
  zone: zoneName,
  city: z.string().min(2).max(80).default('Dhaka'),
  contactName: z.string().min(2).max(80),
  contactPhone: phone,
  /** Filled by the geocoder; absent until Nominatim resolves the address. */
  point: geoPoint.optional(),
  /** Nominatim's canonical string, cached so we never re-ask (section 2). */
  resolvedLabel: z.string().optional(),
})
export type Address = z.infer<typeof addressSchema>

export const parcelSizeSchema = z.enum(['small', 'medium', 'large'])
export type ParcelSize = z.infer<typeof parcelSizeSchema>

/**
 * The shipment itself: what is being sent, where, and what it cost. The
 * lifecycle does NOT live here — see Delivery. Splitting them keeps the
 * append-only event log off the document customers read most often.
 */
export const parcelSchema = z.object({
  _id: objectId,
  trackingId: trackingId,
  customer: objectId,
  pickup: addressSchema,
  drop: addressSchema,
  weightKg: z.number().positive().max(1000),
  size: parcelSizeSchema,
  description: z.string().max(300).optional(),
  /**
   * Price snapshotted at booking time. CLAUDE.md section 5: editing
   * PricingConfig later must never change an existing parcel's price, so this
   * is a stored breakdown rather than a recomputation.
   */
  price: priceBreakdownSchema,
  /** Cash on delivery: agent collects this amount at the door. */
  isCod: z.boolean().default(false),
  codAmount: taka.default(0),
  ...timestamps,
})
export type Parcel = z.infer<typeof parcelSchema>

/**
 * POST /parcels input (M2). Price is absent — the server computes it from
 * PricingConfig and never trusts a client-supplied amount.
 */
export const bookParcelInputSchema = z.object({
  pickup: addressSchema.omit({ point: true, resolvedLabel: true }),
  drop: addressSchema.omit({ point: true, resolvedLabel: true }),
  weightKg: z.number().positive().max(1000),
  size: parcelSizeSchema,
  description: z.string().max(300).optional(),
  isCod: z.boolean().default(false),
  codAmount: taka.default(0),
})
export type BookParcelInput = z.infer<typeof bookParcelInputSchema>
