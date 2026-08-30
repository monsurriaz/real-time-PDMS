import { z } from 'zod'
import { agentApplicationFieldsSchema } from './agent'
import { cloudinaryUrl, objectId, phone, role as roleSchema, timestamps, zoneName } from './common'
import { addressInputSchema } from './parcel'

/**
 * Whether this account may be used at all.
 *
 * Replaces the old boolean `isActive`, which said the same thing less
 * precisely and, more to the point, was only ever consulted at login — so a
 * disabled account kept working for as long as its cookie lasted. Two names
 * for one fact would have been worse than one: the check now lives in
 * requireAuth, and it reads this.
 *
 * `suspended` is reversible on purpose, unlike an agent's `rejected`. An
 * admin suspends an account to stop it doing something now, not to close it
 * forever, so /admin/customers offers Reactivate on the same row.
 */
export const userStatusSchema = z.enum(['active', 'suspended'])
export type UserStatus = z.infer<typeof userStatusSchema>

/**
 * One suspend/reactivate decision, appended to the account's history.
 *
 * The same append-only shape as an agent's `approvalHistory` and a delivery's
 * `events[]`, for the same reason: the current status says what is true now,
 * and only a trail says who made it true and when.
 */
export const accountEventSchema = z.object({
  status: userStatusSchema,
  at: z.coerce.date(),
  by: objectId,
})
export type AccountEvent = z.infer<typeof accountEventSchema>

/**
 * A User is anyone who can log in. Agents get an extra Agent document keyed
 * back to their User; admins and customers do not.
 *
 * passwordHash appears in no schema on this file on purpose — see
 * publicUser, which is the only shape the server is allowed to serialize.
 */
export const userSchema = z.object({
  _id: objectId,
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  phone: phone,
  role: roleSchema,
  /** Customers get a home zone so booking can default the pickup area. */
  zone: zoneName.optional(),
  status: userStatusSchema.default('active'),
  accountHistory: z.array(accountEventSchema).default([]),
  /**
   * When this account dismissed its one-time welcome. Null means it has not
   * seen one yet.
   *
   * Named after what it gates rather than "firstLoginAt", because a first
   * login is the wrong moment for a rider: registration signs them straight
   * in while their application is still pending, so a flag stamped then would
   * be spent on the pending screen and the "you're approved" notice would
   * never appear. This is only written when a welcome is actually shown and
   * dismissed, which makes "first login after approval" true for a rider and
   * "first login" true for a customer, from one field.
   */
  welcomeSeenAt: z.coerce.date().nullable().default(null),
  /**
   * M9.6: all three roles, not just riders — a customer or an admin is as
   * much a person as a rider is. Optional/nullable and defaulting to null
   * the same way a missing `status` reads as active: absent means no photo
   * uploaded yet, never an error. A Cloudinary delivery URL and nothing
   * else — the exact same `cloudinaryUrl` refinement proof-of-delivery
   * photos already validate against, reused rather than a second one that
   * could drift from it.
   */
  avatarUrl: cloudinaryUrl.nullable().default(null),
  ...timestamps,
})
export type User = z.infer<typeof userSchema>

/**
 * The ONLY user shape that may cross the wire. CLAUDE.md section 7 forbids
 * sending passwordHash, and forbids leaking another user's phone number, so
 * phone is absent here and added back only for the requester's own record.
 */
export const publicUserSchema = userSchema.pick({
  _id: true,
  name: true,
  email: true,
  role: true,
  zone: true,
  avatarUrl: true,
})
export type PublicUser = z.infer<typeof publicUserSchema>

/** GET /auth/me — your own record, so your own phone is fair game. */
export const selfUserSchema = publicUserSchema.extend({
  phone: phone,
  /**
   * Whether this session should show the one-time welcome. A boolean rather
   * than the timestamp itself: the client's only question is "show it or not",
   * and when the account was welcomed is nobody's business but the server's.
   */
  showWelcome: z.boolean(),
})
export type SelfUser = z.infer<typeof selfUserSchema>

const password = z
  .string()
  .min(8, 'password must be at least 8 characters')
  .max(200)

const commonRegisterFields = {
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  phone: phone,
  password: password,
}

/**
 * POST /auth/register — a discriminated union on `role`, with exactly two
 * literal branches: `customer` and `agent`. That is the whole mechanism that
 * keeps a client from registering an admin — there is no third branch for
 * `{"role":"admin"}` to match, so it fails to parse rather than being
 * silently downgraded or trusted. Tested directly in auth.test.ts, because
 * "the option isn't in the UI" is not the same claim as "the server refuses
 * it".
 *
 * An agent branch application starts `pending` — set server-side in the
 * route, never accepted from the body — and cannot be assigned work until an
 * admin approves it (services/assignment.ts's own filter, not this schema).
 */
export const registerInputSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('customer'),
    ...commonRegisterFields,
    zone: zoneName.optional(),
  }),
  z.object({
    role: z.literal('agent'),
    ...commonRegisterFields,
    ...agentApplicationFieldsSchema.shape,
  }),
])
export type RegisterInput = z.infer<typeof registerInputSchema>

export const loginInputSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'password is required'),
})
export type LoginInput = z.infer<typeof loginInputSchema>

/** Decoded JWT payload. The role claim is embedded per CLAUDE.md section 2. */
export const jwtClaimsSchema = z.object({
  sub: objectId,
  role: roleSchema,
  iat: z.number().optional(),
  exp: z.number().optional(),
})
export type JwtClaims = z.infer<typeof jwtClaimsSchema>

/**
 * The profile's Account tab, shared by every role. Changing `email` changes
 * how the account signs in, which is exactly why the route that handles this
 * re-issues the auth cookie on success — CLAUDE.md rule 3's spirit applied to
 * a session rather than a delivery: the client states what it wants, the
 * server decides whether the new email is available and acts.
 */
export const updateAccountInputSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  phone: phone,
})
export type UpdateAccountInput = z.infer<typeof updateAccountInputSchema>

/**
 * The Password tab. Deliberately its own endpoint with its own input rather
 * than an optional field on updateAccountInputSchema — v3's own note is that
 * this must not share a Save button with a phone edit, and a shared schema
 * would make that too easy to get wrong later.
 */
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1, 'enter your current password'),
  newPassword: password,
})
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>

/**
 * PATCH /auth/me/avatar — the profile's "Change photo", every role.
 *
 * The upload itself already happened browser -> Cloudinary with the existing
 * unsigned preset (M9.6 reuses the POD path wholesale, CLAUDE.md section 2);
 * this is just the URL the client got back, validated with the same
 * `cloudinaryUrl` refinement as everywhere else one crosses the wire. The
 * server still checks it names OUR cloud (routes/auth.ts) — a client must
 * not be able to store an arbitrary Cloudinary URL as someone's avatar.
 */
export const uploadAvatarInputSchema = z.object({ avatarUrl: cloudinaryUrl })
export type UploadAvatarInput = z.infer<typeof uploadAvatarInputSchema>

/**
 * A customer's saved address — the booking form's own address shape plus a
 * label, so "Home" and "Office" are the same fields booking already
 * validates rather than a second, looser address type. No `point`: a saved
 * address is a template a booking re-geocodes, not a pre-resolved location
 * that could go stale.
 */
export const savedAddressInputSchema = addressInputSchema.extend({
  label: z.string().min(2).max(40),
})
export type SavedAddressInput = z.infer<typeof savedAddressInputSchema>

export const savedAddressSchema = savedAddressInputSchema.extend({
  _id: objectId,
})
export type SavedAddress = z.infer<typeof savedAddressSchema>

/**
 * One row of /admin/customers.
 *
 * Deliberately narrower than the agent roster's row: that one carries a phone
 * number because an admin approving an application may need to call the
 * applicant, and nothing on this screen needs a customer's phone to decide
 * whether to suspend them. Section 7 says the fewest fields that answer the
 * question.
 */
export const customerRowSchema = z.object({
  _id: objectId,
  name: z.string(),
  email: z.string().email(),
  avatarUrl: cloudinaryUrl.nullable(),
  status: userStatusSchema,
  /** Everything they have ever sent, not just what is moving. */
  parcelCount: z.number().int().nonnegative(),
  joinedAt: z.coerce.date(),
  /** The most recent suspend/reactivate, if the account has ever had one. */
  lastDecision: accountEventSchema.nullable(),
})
export type CustomerRow = z.infer<typeof customerRowSchema>

/**
 * The `reason` a suspended caller's 403 carries, so the client can tell "your
 * account is suspended" apart from "you are not allowed to do that" without
 * matching on prose. Same idea as a geocoding failure's `reason` — see
 * middleware/httpError.ts.
 */
export const ACCOUNT_SUSPENDED = 'account_suspended' as const
