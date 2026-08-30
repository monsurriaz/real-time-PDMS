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
import { deliveryStatusSchema } from './delivery'
import { paymentSummarySchema } from './payment'
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
  /**
   * Cash on delivery: the agent collects `codAmount` at the door.
   *
   * Snapshotted from `price.total` at booking, server-side — see
   * bookParcelInputSchema, which has no such input field. Stored rather than
   * derived on read for the same reason `price` is: it is what was agreed when
   * the parcel was booked, and a later rate change must not move it.
   */
  isCod: z.boolean().default(false),
  codAmount: taka.default(0),
  ...timestamps,
})
export type Parcel = z.infer<typeof parcelSchema>

/**
 * What the customer fills in. Used by the booking form AND the server route,
 * so the two cannot drift (CLAUDE.md rule 4).
 *
 * Price is absent on purpose: the server computes it from PricingConfig and
 * never trusts a client-supplied amount. Neither is `point` — geocoding is
 * server-side, on submit, to respect Nominatim's 1 req/sec limit.
 */
export const addressInputSchema = addressSchema.omit({
  point: true,
  resolvedLabel: true,
})
export type AddressInput = z.infer<typeof addressInputSchema>

/**
 * `codAmount` is deliberately ABSENT, for the same reason `price` is.
 *
 * What a rider must collect at the door is the delivery fee the server
 * computed and snapshotted — not a figure the sender types. It used to be an
 * input on the booking form, which meant a customer could book a COD parcel
 * and declare any amount they liked, including one below what the delivery
 * actually cost. The route sets it from `price.total`; there is no field here
 * for a client to send, so there is nothing to validate and nothing to forget
 * to ignore.
 */
export const bookParcelInputSchema = z.object({
  pickup: addressInputSchema,
  drop: addressInputSchema,
  weightKg: z.number().positive().max(1000),
  size: parcelSizeSchema,
  description: z.string().max(300).optional(),
  isCod: z.boolean().default(false),
  /**
   * Which of the customer's saved addresses `pickup` came from, if any
   * (M9.9's autofill) — a hint, not a trusted location. The server looks
   * this ID up in the CALLER'S OWN saved addresses and only reuses ITS
   * stored point when `pickup` still matches what that record says word for
   * word; a client-supplied coordinate is never trusted for pricing on its
   * own, same reasoning as the codAmount integrity fix in M6.9. An ID that
   * does not resolve (wrong owner, deleted, edited beyond recognition) is
   * silently ignored and `pickup` is geocoded exactly as if this were absent.
   */
  pickupSavedAddressId: objectId.optional(),
})
export type BookParcelInput = z.infer<typeof bookParcelInputSchema>

/**
 * POST /parcels/quote — the price estimate shown before final confirm. Takes
 * the same payload as booking so the quote and the booking cannot be computed
 * from different inputs.
 */
export const quoteInputSchema = bookParcelInputSchema
export type QuoteInput = z.infer<typeof quoteInputSchema>

/** What a parcel looks like in the customer's list. */
export const parcelListItemSchema = z.object({
  _id: objectId,
  /** Needed to act on the lifecycle — e.g. cancelling before pickup. */
  deliveryId: objectId.nullable(),
  trackingId: trackingId,
  status: deliveryStatusSchema,
  pickupArea: z.string(),
  dropArea: z.string(),
  weightKg: z.number(),
  total: taka,
  isCod: z.boolean(),
  codAmount: taka,
  /**
   * The payment for this parcel. Null only for a parcel booked before M5
   * existed — every booking creates one now, COD included, so the list can
   * state where the money is without a second request per row.
   */
  payment: paymentSummarySchema.nullable(),
  /**
   * What this customer may do next, decided by the server from its own
   * transition map. The client renders these; it never derives them.
   */
  allowedTransitions: z.array(deliveryStatusSchema),
  createdAt: z.coerce.date(),
})
export type ParcelListItem = z.infer<typeof parcelListItemSchema>

/**
 * GET /parcels/recent-recipients — the booking form's drop-off autofill
 * (M9.9). Derived from the customer's OWN past parcels, not a saved-address
 * style model of its own: `Parcel.drop` already carries recipient name,
 * phone and address as one bundle, and a recipient is a fact about who this
 * customer has shipped to before, not something they curate the way a
 * pickup address is. Scoped by the exact same roleScope rule GET /parcels
 * already relies on — this reads through `ParcelModel.find()` unchanged, no
 * aggregation, so a handler that forgets a filter still cannot leak another
 * customer's recipients.
 */
export const recentRecipientSchema = z.object({
  recipientName: z.string(),
  recipientPhone: phone,
  dropLine1: z.string(),
  dropArea: z.string(),
  dropZone: zoneName,
  dropCity: z.string(),
  /** The most recent parcel sent to this recipient at this address. */
  lastUsedAt: z.coerce.date(),
})
export type RecentRecipient = z.infer<typeof recentRecipientSchema>
