import mongoose, { Schema } from 'mongoose'
import { role as roleSchema, zoneName, type User } from '@pdms/shared'
import type { Doc } from './types'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'

/**
 * passwordHash exists only on the document type, never in the shared User
 * schema — /shared describes what may cross the wire, and CLAUDE.md section 7
 * says this never does.
 */
export type UserDoc = Doc<User> & {
  passwordHash: string
}

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
    isActive: { type: Boolean, required: true, default: true },
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
