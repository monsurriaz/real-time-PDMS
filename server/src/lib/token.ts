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
 * httpOnly so client JS cannot read it (section 2), sameSite lax so the
 * cookie survives normal top-level navigation while still blocking
 * cross-site POSTs. Secure follows COOKIE_SECURE — false on localhost,
 * true once deployed behind HTTPS.
 */
export const cookieOptions = (): {
  httpOnly: true
  secure: boolean
  sameSite: 'lax' | 'none'
  path: string
  maxAge: number
} => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  /**
   * Deployed, client and server sit on different hosts (Vercel and Render),
   * so the cookie must be sameSite=none to travel at all — and that requires
   * Secure. Locally both are localhost, where lax works and Secure would
   * break over plain http.
   */
  sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
})
