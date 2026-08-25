import type { NextFunction, Request, RequestHandler, Response } from 'express'
import mongoose from 'mongoose'
import { ACCOUNT_SUSPENDED, type Role, type UserStatus } from '@pdms/shared'
import { runAsSystem, runInRequestContext, type Actor } from '../lib/context'
import { UserModel } from '../models/User'
import { AUTH_COOKIE, verifyToken } from '../lib/token'
import { forbidden, HttpError, unauthorized } from './httpError'

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

/**
 * Is this account still allowed to act? Read from the database, per request.
 *
 * A JWT is a bearer token: it is valid until it expires, and nothing about
 * suspending an account can reach into a cookie already sitting in someone's
 * browser. The old check lived at login only, which meant suspending a
 * customer stopped them signing in again and did nothing at all to the session
 * they were in the middle of — they kept booking parcels for up to seven days.
 * The database read is what actually blocks them, so it happens on every
 * authenticated request rather than at the one moment they are least likely to
 * be doing anything.
 *
 * Runs as system: the point is to check an account's own status, and a scoped
 * read would be answering the question with the very session under suspicion.
 *
 * Cost is one indexed findById per authenticated request. At this project's
 * scale that is the honest price of the guarantee; the alternative is short-
 * lived tokens plus a refresh endpoint, which is more moving parts than a
 * seven-day course build should carry.
 */
const accountStatus = async (actorId: string): Promise<UserStatus | null> => {
  if (!mongoose.Types.ObjectId.isValid(actorId)) return null
  const user = await runAsSystem('auth: account status', async () =>
    UserModel.findById(actorId)
      .select('_id status')
      .lean<{ _id: mongoose.Types.ObjectId; status?: UserStatus } | null>()
      .exec(),
  )
  if (!user) return null
  /**
   * `.lean()` skips document hydration, which is where Mongoose would apply
   * the schema default — so an account created before `status` existed comes
   * back with the field simply absent. Absent means active: this field was
   * introduced to take a capability AWAY, and defaulting the other way would
   * lock every pre-existing account out of its own session the moment the
   * middleware shipped.
   *
   * `_id` is selected so "no such user" stays distinguishable from "user with
   * no status yet" — they get a 401 and a pass respectively, and collapsing
   * them is exactly the bug this comment exists to prevent.
   */
  return user.status ?? 'active'
}

/**
 * The 403 a suspended caller gets.
 *
 * A 403 and not a 401, deliberately: 401 means "we do not know who you are",
 * which the client answers by showing the login screen — and this caller is
 * perfectly well identified, would log in successfully as far as their
 * password is concerned, and would land straight back here. `reason` is
 * machine-readable so the UI can say what happened instead of matching prose.
 */
export const suspended = (): HttpError =>
  new HttpError(
    403,
    'this account has been suspended — contact an administrator to have it reinstated',
    undefined,
    ACCOUNT_SUSPENDED,
  )

/**
 * 401 unless a valid token was presented, and 403 if the account behind it has
 * been suspended since the token was issued.
 *
 * Express 4 does not catch a rejected promise from async middleware, so the
 * whole body is wrapped and errors are handed to `next` by hand.
 */
export const requireAuth = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const actor = req.actor
  if (!actor) {
    next(unauthorized())
    return
  }

  void (async () => {
    try {
      const status = await accountStatus(actor.id)
      /**
       * A token naming a user who no longer exists is a 401, not a 403: there
       * is no account to be suspended, so "we do not know who you are" is the
       * true answer.
       */
      if (status === null) {
        next(unauthorized('session no longer valid'))
        return
      }
      if (status === 'suspended') {
        next(suspended())
        return
      }
      next()
    } catch (err) {
      next(err)
    }
  })()
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
