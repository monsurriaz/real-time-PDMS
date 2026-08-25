import { z } from 'zod'
import { agentApplicationFieldsSchema } from './agent'
import { objectId, phone, role as roleSchema, timestamps, zoneName } from './common'
import { addressInputSchema } from './parcel'

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
  isActive: z.boolean().default(true),
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
})
export type PublicUser = z.infer<typeof publicUserSchema>

/** GET /auth/me — your own record, so your own phone is fair game. */
export const selfUserSchema = publicUserSchema.extend({
  phone: phone,
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
