import { Router } from 'express'
import {
  loginInputSchema,
  registerInputSchema,
  selfUserSchema,
  type SelfUser,
} from '@pdms/shared'
import { UserModel, type UserDoc } from '../models'
import { runAsSystem } from '../lib/context'
import { hashPassword, verifyPassword, wasteTimeLikeAVerify } from '../lib/password'
import { AUTH_COOKIE, cookieOptions, signToken } from '../lib/token'
import { requireAuth } from '../middleware/auth'
import { conflict, unauthorized } from '../middleware/httpError'

export const authRouter = Router()

/**
 * Serialises a user for the wire. Built from the shared schema rather than by
 * hand, so a field added to /shared cannot leak here by accident — and
 * passwordHash cannot appear at all, because selfUserSchema has no such key
 * and Zod strips what it does not declare.
 */
const toSelfUser = (doc: UserDoc): SelfUser =>
  selfUserSchema.parse({
    _id: doc._id.toString(),
    name: doc.name,
    email: doc.email,
    phone: doc.phone,
    role: doc.role,
    zone: doc.zone,
  })

/**
 * POST /auth/register — customers only in M1.
 *
 * Role is not read from the body. registerInputSchema has no role field and
 * Zod strips unknown keys, so `{"role":"admin"}` in the payload is silently
 * discarded rather than honoured.
 */
authRouter.post('/register', async (req, res, next) => {
  try {
    const input = registerInputSchema.parse(req.body)

    // No actor exists yet, so this must run unscoped.
    const created = await runAsSystem('auth: register', async () => {
      const existing = await UserModel.findOne({ email: input.email })
        .select('_id')
        .lean()
      if (existing) throw conflict('an account with that email already exists')

      const passwordHash = await hashPassword(input.password)
      return UserModel.create({
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: 'customer',
        zone: input.zone,
        isActive: true,
        passwordHash,
      })
    })

    res
      .cookie(AUTH_COOKIE, signToken(created._id.toString(), created.role), cookieOptions())
      .status(201)
      .json({ user: toSelfUser(created) })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/login', async (req, res, next) => {
  try {
    const input = loginInputSchema.parse(req.body)

    /**
     * Runs as system: the caller is by definition unauthenticated, so role
     * scoping has no actor to scope to. passwordHash is select:false on the
     * schema, so it must be asked for explicitly.
     */
    const user = await runAsSystem('auth: login lookup', () =>
      UserModel.findOne({ email: input.email }).select('+passwordHash'),
    )

    if (!user) {
      // Spend the same time a real verify would, so a missing account and a
      // wrong password are indistinguishable from the outside.
      await wasteTimeLikeAVerify()
      throw unauthorized('invalid email or password')
    }

    const ok = await verifyPassword(input.password, user.passwordHash)
    if (!ok) throw unauthorized('invalid email or password')
    if (!user.isActive) throw unauthorized('this account is disabled')

    res
      .cookie(AUTH_COOKIE, signToken(user._id.toString(), user.role), cookieOptions())
      .json({ user: toSelfUser(user) })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/logout', (_req, res) => {
  // Same attributes as when set, or the browser keeps the original cookie.
  const { maxAge: _maxAge, ...clearOpts } = cookieOptions()
  res.clearCookie(AUTH_COOKIE, clearOpts).json({ ok: true })
})

/**
 * GET /auth/me — the record behind the current token. Reads the database
 * rather than trusting the token's claims, so an account disabled or renamed
 * mid-session reflects immediately.
 */
authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()

    // Scoped read: the customer/agent rules resolve to "only yourself".
    const user = await UserModel.findById(actor.id)
    if (!user || !user.isActive) throw unauthorized('session no longer valid')

    res.json({ user: toSelfUser(user) })
  } catch (err) {
    next(err)
  }
})
