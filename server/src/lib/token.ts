import jwt from 'jsonwebtoken'
import { jwtClaimsSchema, type JwtClaims, type Role } from '@pdms/shared'
import { env } from './env'

export const AUTH_COOKIE = 'pdms_token'

/** The role claim is embedded in the token, per CLAUDE.md section 2. */
export const signToken = (userId: string, role: Role): string =>
  jwt.sign({ sub: userId, role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as jwt.SignOptions)

/**
 * Returns null rather than throwing on any failure — expired, tampered,
 * wrong shape. Callers treat all of those identically (401), and a null is
 * harder to accidentally ignore than a caught exception.
 *
 * The payload is re-validated with the shared Zod schema because
 * jwt.verify only proves the signature, not that the claims look like ours.
 */
export const verifyToken = (token: string): JwtClaims | null => {
  try {
    const raw = jwt.verify(token, env.JWT_SECRET)
    const parsed = jwtClaimsSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/**
 * httpOnly so client JS cannot read it (section 2). secure/sameSite/
 * partitioned all key off the SAME flag (COOKIE_SECURE) rather than being
 * independently toggleable, so they can never drift into a combination a
 * browser would reject or silently drop:
 *
 * - Locally, client and server are both localhost: `lax` + no `secure`
 *   works, and `secure` would break over plain http.
 * - Deployed, client (Vercel) and server (Render) are different hosts, so
 *   the cookie is genuinely cross-site. That requires `sameSite: 'none'`,
 *   which browsers refuse to honour without `secure: true` alongside it —
 *   never one without the other.
 *
 * `sameSite: 'none'` is necessary but not sufficient, though: it says the
 * cookie MAY be sent cross-site, but says nothing about whether the
 * browser treats third-party cookies as allowed AT ALL. Chrome's Incognito
 * windows block third-party cookies by default regardless of SameSite, and
 * Safari's ITP blocks every third-party cookie unconditionally — SameSite
 * has no bearing on either. `partitioned: true` (CHIPS — Cookies Having
 * Independent Partitioned State) is the actual fix for that: a cookie
 * scoped to the (Vercel origin, Render origin) pair specifically, which is
 * exempt from both of those blocks because it structurally cannot be used
 * for cross-site tracking. Supported by Chrome and Safari 18.4+; on an
 * older browser without CHIPS support the attribute is simply ignored, no
 * worse off than before. Only ever set alongside `secure`/`sameSite:
 * 'none'`, never on its own — a Partitioned cookie without Secure is
 * meaningless and some browsers reject it outright.
 */
export const cookieOptions = (): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax' | 'none'
  partitioned: boolean
  path: string
  maxAge: number
} => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
  partitioned: env.COOKIE_SECURE,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
})
