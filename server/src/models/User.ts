import mongoose, { Schema } from 'mongoose'
import {
  role as roleSchema,
  userStatusSchema,
  zoneName,
  type SavedAddress,
  type User,
} from '@pdms/shared'
import type { Doc } from './types'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'

/**
 * passwordHash exists only on the document type, never in the shared User
 * schema — /shared describes what may cross the wire, and CLAUDE.md section 7
 * says this never does.
 */
export type UserDoc = Doc<User> & {
  passwordHash: string
  /** Customer only in practice; the field exists on every role for simplicity. */
  savedAddresses: Array<Doc<SavedAddress>>
  /**
   * Admin photo-moderation decisions (M9.6) — never sent to the client, and
   * deliberately not part of the shared `User` schema for that reason (the
   * same way `passwordHash` never is). See `moderationEvent` above for why
   * this is its own array rather than folded into `accountHistory`.
   */
  moderationHistory: Array<{ action: 'avatar_cleared'; at: Date; by: mongoose.Types.ObjectId }>
}

/**
 * A customer's saved address (profile's role-specific tab). Same shape as the
 * booking form's own address, plus a label — no `point`: a saved address is
 * a template a booking re-geocodes, not a pre-resolved location that could go
 * stale between when it was saved and when it is next used.
 */
const savedAddress = new Schema(
  {
    label: { type: String, required: true, trim: true, minlength: 2, maxlength: 40 },
    line1: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    zone: { type: String, required: true, enum: zoneName.options },
    city: { type: String, required: true, default: 'Dhaka', trim: true },
    contactName: { type: String, required: true, trim: true },
    contactPhone: { type: String, required: true, trim: true },
  },
  { timestamps: false },
)

/**
 * One suspend/reactivate decision. Append-only, never edited in place — the
 * same shape and the same reasoning as Agent's `approvalHistory`.
 */
const accountEvent = new Schema(
  {
    status: { type: String, required: true, enum: userStatusSchema.options },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
)

/**
 * One admin photo-moderation decision (M9.6) — currently only "cleared this
 * account's avatar". A SIBLING array to `accountHistory` above, not a third
 * kind of entry interleaved into it: `accountHistory`'s own `status` field is
 * what /admin/customers' "last decision" column reads via `.at(-1)`, and an
 * avatar-clear appended into that same array would silently become the
 * "last decision" shown there even though nothing about the account's
 * standing changed. Same append-only discipline (actor + timestamp, never
 * edited), same reason a suspension gets one: a photo does not just vanish,
 * someone removed it, and the record says who and when.
 */
const moderationEvent = new Schema(
  {
    action: { type: String, required: true, enum: ['avatar_cleared'] },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
)

const userSchema = new Schema<UserDoc>(
  {
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    phone: { type: String, required: true, trim: true },
    /**
     * Enum values come from the Zod enum's own options, so adding a role in
     * /shared cannot leave the database validator behind.
     */
    role: { type: String, required: true, enum: roleSchema.options },
    zone: { type: String, enum: zoneName.options, required: false },
    /**
     * Indexed because requireAuth reads it on EVERY authenticated request —
     * see the middleware's own note on why a login-time check was not enough.
     */
    status: {
      type: String,
      required: true,
      enum: userStatusSchema.options,
      default: 'active',
      index: true,
    },
    accountHistory: { type: [accountEvent], required: true, default: [] },
    /** M9.6: never sent to the client. See `moderationEvent` above. */
    moderationHistory: { type: [moderationEvent], required: true, default: [] },
    /**
     * Null until the account dismisses its one-time welcome. See the shared
     * schema's note for why this is not "firstLoginAt".
     */
    welcomeSeenAt: { type: Date, required: false, default: null },
    /**
     * M9.6: all three roles. A Cloudinary delivery URL or null — see the
     * shared schema's own note on why this reuses `cloudinaryUrl` rather
     * than a second validator.
     */
    avatarUrl: { type: String, required: false, default: null },
    savedAddresses: { type: [savedAddress], required: true, default: [] },
    passwordHash: {
      type: String,
      required: true,
      /**
       * Excluded from every query result unless explicitly re-selected. The
       * one caller that needs it (login) asks for it by name, which makes
       * accidental serialization a compile-and-review problem rather than a
       * silent leak.
       */
      select: false,
    },
  },
  { timestamps: true },
)

/**
 * Customers and agents may read only themselves; admins read everyone.
 * Registration and login run as system, since neither has an actor yet.
 */
roleScopePlugin<UserDoc>(userSchema, {
  admin: () => ALLOW_ALL,
  customer: (actor) => ({ _id: new mongoose.Types.ObjectId(actor.id) }),
  agent: (actor) => ({ _id: new mongoose.Types.ObjectId(actor.id) }),
})

export const UserModel = mongoose.model<UserDoc>('User', userSchema)
