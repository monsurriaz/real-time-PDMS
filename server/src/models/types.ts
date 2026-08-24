import type { Types } from 'mongoose'

/**
 * Bridges a /shared Zod-inferred type to its Mongoose document type.
 *
 * On the wire an id is a hex string; in Mongo it is an ObjectId. Rather than
 * hand-writing a second interface per model — which CLAUDE.md's definition of
 * done forbids — each model declares its document type as
 * `Doc<Parcel, 'customer'>` and lets TypeScript verify the Mongoose schema
 * against it. A renamed or retyped field in /shared then fails the build here
 * instead of drifting quietly.
 */
export type Doc<T extends { _id: string }, Refs extends keyof T = never> = Omit<
  T,
  '_id' | 'createdAt' | 'updatedAt' | Refs
> & {
  _id: Types.ObjectId
} & {
  // Ref fields become ObjectId, preserving nullability from the shared type.
  [K in Refs]: null extends T[K] ? Types.ObjectId | null : Types.ObjectId
}

/**
 * Doc<T> deliberately omits createdAt/updatedAt so a Schema definition does
 * not have to declare fields that `timestamps: true` manages. They do exist
 * on every stored document though, so a read that needs one asks for this
 * shape explicitly:
 *
 *     .lean<Timestamped<PricingConfigDoc>>()
 *
 * which keeps the claim visible at the call site rather than hiding it behind
 * a cast.
 */
export type Timestamped<T> = T & {
  createdAt: Date
  updatedAt: Date
}
