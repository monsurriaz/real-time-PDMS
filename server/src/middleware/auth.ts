import type { NextFunction, Request, RequestHandler, Response } from 'express'
import type { Role } from '@pdms/shared'
import { runInRequestContext, type Actor } from '../lib/context'
import { AUTH_COOKIE, verifyToken } from '../lib/token'
import { forbidden, unauthorized } from './httpError'

declare module 'express-serve-static-core' {
  interface Request {
    /** Present once attachActor has run; null when the caller is anonymous. */
    actor: Actor | null
  }
}

/**
 * Reads the cookie, verifies the JWT, and opens the async context that
 * Mongoose query middleware scopes against.
 *
 * Mounted globally and before every route, so any query inside a request runs
 * with a context — that is what lets the roleScope plugin treat a missing
 * context as "not an HTTP request" rather than as a route that forgot to
 * authenticate.
 */
export const attachActor: RequestHandler = (req, res, next) => {
  const cookies = req.cookies as Record<string, string | undefined> | undefined
  const token = cookies?.[AUTH_COOKIE]
  const claims = token ? verifyToken(token) : null

  const actor: Actor | null = claims
    ? { id: claims.sub, role: claims.role }
    : null

  req.actor = actor
  runInRequestContext(actor, () => {
    next()
  })
}

/** 401 unless a valid token was presented. */
export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.actor) {
    next(unauthorized())
    return
  }
  next()
}

/**
 * 403 unless the token's role claim is one of `roles`. Always used after
 * requireAuth; checks the claim rather than re-reading the database, since
 * the role is embedded in the signed token (CLAUDE.md section 2).
 */
export const requireRole =
  (...roles: readonly Role[]): RequestHandler =>
  (req, _res, next) => {
    const actor = req.actor
    if (!actor) {
      next(unauthorized())
      return
    }
    if (!roles.includes(actor.role)) {
      next(forbidden(`requires role: ${roles.join(' or ')}`))
      return
    }
    next()
  }
