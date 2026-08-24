import { Schema } from 'mongoose'

/**
 * A GeoJSON Point path that is genuinely ABSENT when unset.
 *
 * Declaring the point inline as a nested path — `{ type: {...}, coordinates:
 * {...} }` — looks equivalent but is not: Mongoose materialises the nested
 * object and defaults the array, producing `{ coordinates: [] }` on documents
 * that were never given a position. A sparse 2dsphere index skips *missing*
 * keys, not present-but-malformed ones, so Mongo then rejects the write with
 * "Can't extract geo keys: unknown GeoJSON type".
 *
 * A single-nested subdocument with `default: undefined` omits the field
 * entirely instead, which is what sparse needs. Every optional point in the
 * schema layer goes through here so the fix cannot be half-applied.
 */
const pointSchema = new Schema(
  {
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
        validator: (v: number[]) =>
          v.length === 2 &&
          v[0] !== undefined &&
          v[1] !== undefined &&
          v[0] >= -180 &&
          v[0] <= 180 &&
          v[1] >= -90 &&
          v[1] <= 90,
        message:
          'coordinates must be [longitude, latitude] within valid bounds — note the order',
      },
    },
  },
  { _id: false },
)

/** An optional point: absent unless explicitly written. */
export const optionalPoint = {
  type: pointSchema,
  required: false,
  default: undefined,
} as const

/** A required point, for paths where a position is part of the record. */
export const requiredPoint = {
  type: pointSchema,
  required: true,
} as const
