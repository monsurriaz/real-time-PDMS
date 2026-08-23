import mongoose, { Schema } from 'mongoose'
import {
  pricingConfigSchema,
  zoneName,
  type PricingConfig,
} from '@pdms/shared'
import type { Doc } from './types'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'

export type PricingConfigDoc = Doc<PricingConfig>

const weightTier = new Schema(
  {
    maxKg: { type: Number, required: true, min: 0 },
    baseFee: { type: Number, required: true, min: 0 },
    label: { type: String, required: true, trim: true },
  },
  { _id: false },
)

const zoneBaseOverride = new Schema(
  {
    zone: { type: String, required: true, enum: zoneName.options },
    baseFare: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const pricingConfigMongooseSchema = new Schema<PricingConfigDoc>(
  {
    /**
     * Singleton enforced by the database, not by convention. A unique index
     * on a literal key means a second config cannot be created even by a
     * buggy migration.
     */
    key: { type: String, required: true, unique: true, default: 'default', enum: ['default'] },
    perKmRate: { type: Number, required: true, min: 0 },
    weightTiers: { type: [weightTier], required: true },
    zoneBaseOverrides: { type: [zoneBaseOverride], required: true, default: [] },
  },
  { timestamps: true },
)

/**
 * The ascending / non-overlapping tier rule from CLAUDE.md section 5 is
 * expressed once, in the shared Zod schema. Re-running that same schema here
 * means the rule holds even for a write that never passed through a route —
 * the seed script, or a fix applied by hand.
 */
pricingConfigMongooseSchema.pre('validate', function (next) {
  const result = pricingConfigSchema
    .pick({ perKmRate: true, weightTiers: true, zoneBaseOverrides: true })
    .safeParse({
      perKmRate: this.perKmRate,
      weightTiers: this.weightTiers,
      zoneBaseOverrides: this.zoneBaseOverrides ?? [],
    })

  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ')
    next(new Error(`invalid PricingConfig — ${detail}`))
    return
  }
  next()
})

/**
 * Readable by everyone — a customer needs it for a live quote. Writes are
 * admin-only, enforced by requireRole on the route; scoping controls reach,
 * not permission to mutate.
 */
roleScopePlugin<PricingConfigDoc>(pricingConfigMongooseSchema, {
  admin: () => ALLOW_ALL,
  customer: () => ALLOW_ALL,
  agent: () => ALLOW_ALL,
})

export const PricingConfigModel = mongoose.model<PricingConfigDoc>(
  'PricingConfig',
  pricingConfigMongooseSchema,
)
