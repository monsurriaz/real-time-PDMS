import { z } from 'zod'

/**
 * Primitives shared by every entity. Nothing here is entity-specific — if a
 * schema needs a shape only it uses, that shape belongs in its own file.
 */

/** Mongo ObjectId as it appears on the wire: a 24-char hex string. */
export const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24-character hex ObjectId')

/**
 * GeoJSON Point. Mongo's 2dsphere index requires this exact shape, and
 * coordinates are [longitude, latitude] — not the lat/lng order humans say
 * out loud. Getting this backwards silently returns wrong $near results, so
 * the bounds are enforced per-axis rather than on a bare tuple of numbers.
 */
export const geoPoint = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().min(-180).max(180), // longitude
    z.number().min(-90).max(90), // latitude
  ]),
})
export type GeoPoint = z.infer<typeof geoPoint>

/** Bangladesh mobile numbers, the only format the demo data uses. */
export const phone = z
  .string()
  .regex(/^(?:\+?880|0)1[3-9]\d{8}$/, 'must be a Bangladeshi mobile number')

/** Tracking ID format from CLAUDE.md section 9: PD-XXXX-XX. */
export const trackingId = z
  .string()
  .regex(/^PD-[A-Z0-9]{4}-[A-Z0-9]{2}$/, 'must look like PD-XXXX-XX')

/** Currency is BDT throughout; amounts are whole poisha-free taka. */
export const taka = z.number().int().nonnegative()

/**
 * A Cloudinary delivery URL, and nothing else.
 *
 * Every upload in this project — proof-of-delivery photos, and since M9.6,
 * profile avatars — happens straight from the browser with the unsigned
 * preset (CLAUDE.md section 2), so the URL arrives from the client and
 * cannot be trusted on shape alone. This narrows it to Cloudinary's delivery
 * host; the server additionally checks it names OUR cloud (assertOurCloud in
 * lib/cloudinary.ts on both sides that use it), which is the part only the
 * server knows. Lives here rather than in delivery.ts (where it started,
 * M5) because a second caller outside deliveries would otherwise have to
 * import a delivery-specific module for a generic URL shape — and because
 * payment.ts already needs it (the COD reconciliation row) without being
 * able to import delivery.ts without a circular dependency.
 */
export const cloudinaryUrl = z
  .string()
  .url()
  .max(500)
  .refine(
    (u) => u.startsWith('https://res.cloudinary.com/'),
    'must be an https Cloudinary delivery URL',
  )

export const zoneName = z.enum([
  'Dhanmondi',
  'Mirpur',
  'Uttara',
  'Bashundhara',
  'Gulshan',
  'Mohammadpur',
])
export type ZoneName = z.infer<typeof zoneName>

export const role = z.enum(['customer', 'agent', 'admin'])
export type Role = z.infer<typeof role>

/** Fields Mongoose adds to every document, shared by all entity schemas. */
export const timestamps = {
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}
