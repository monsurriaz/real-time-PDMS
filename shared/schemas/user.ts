import { z } from 'zod'
import { objectId, phone, role, timestamps, zoneName } from './common'

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
  role: role,
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

/**
 * POST /auth/register. Role is deliberately NOT accepted from the client —
 * M1 registers customers only, and letting the body carry a role would be a
 * privilege-escalation hole. Agents and admins are created by the seed
 * script.
 */
export const registerInputSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().toLowerCase(),
  phone: phone,
  password: password,
  zone: zoneName.optional(),
})
export type RegisterInput = z.infer<typeof registerInputSchema>

export const loginInputSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'password is required'),
})
export type LoginInput = z.infer<typeof loginInputSchema>

/** Decoded JWT payload. The role claim is embedded per CLAUDE.md section 2. */
export const jwtClaimsSchema = z.object({
  sub: objectId,
  role: role,
  iat: z.number().optional(),
  exp: z.number().optional(),
})
export type JwtClaims = z.infer<typeof jwtClaimsSchema>
