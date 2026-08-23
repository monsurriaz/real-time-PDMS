import mongoose, { Schema } from 'mongoose'
import { zoneName, type Zone } from '@pdms/shared'
import type { Doc } from './types'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'

export type ZoneDoc = Doc<Zone>

const zoneSchema = new Schema<ZoneDoc>(
  {
    name: { type: String, required: true, unique: true, enum: zoneName.options },
    label: { type: String, required: true, trim: true },
    centre: {
      type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point',
      },
      coordinates: {
        type: [Number],
        required: true,
        validate: {
          validator: (v: number[]) => v.length === 2,
          message: 'centre.coordinates must be [longitude, latitude]',
        },
      },
    },
    baseFare: { type: Number, required: true, min: 0 },
    isServiceable: { type: Boolean, required: true, default: true },
  },
  { timestamps: true },
)

zoneSchema.index({ centre: '2dsphere' })

/** Reference data. Every role needs it to render a zone picker or a map. */
roleScopePlugin<ZoneDoc>(zoneSchema, {
  admin: () => ALLOW_ALL,
  customer: () => ALLOW_ALL,
  agent: () => ALLOW_ALL,
})

export const ZoneModel = mongoose.model<ZoneDoc>('Zone', zoneSchema)
