import { Router } from 'express'
import mongoose from 'mongoose'
import {
  changePasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  savedAddressInputSchema,
  selfUserSchema,
  updateAccountInputSchema,
  type SavedAddress,
  type SelfUser,
} from '@pdms/shared'
import { AgentModel } from '../models/Agent'
import { UserModel, type UserDoc } from '../models'
import { runAsSystem } from '../lib/context'
import { hashPassword, verifyPassword, wasteTimeLikeAVerify } from '../lib/password'
import { AUTH_COOKIE, cookieOptions, signToken } from '../lib/token'
import { requireAuth, requireRole } from '../middleware/auth'
import { conflict, HttpError, unauthorized } from '../middleware/httpError'

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

const toSavedAddress = (a: UserDoc['savedAddresses'][number]): SavedAddress => ({
  _id: a._id.toString(),
  label: a.label,
  line1: a.line1,
  area: a.area,
  zone: a.zone,
  city: a.city,
  contactName: a.contactName,
  contactPhone: a.contactPhone,
})

/**
 * POST /auth/register — customer or agent, chosen by the client and
 * validated by a discriminated union with no `admin` branch. See
 * registerInputSchema's own note: that absence, not a runtime check, is what
 * makes `{"role":"admin"}` fail to parse rather than being silently
 * downgraded — see auth.test.ts for the assertion that a payload naming the
 * admin role never reaches this handler with a matched shape.
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
      const user = await UserModel.create({
        name: input.name,
        email: input.email,
        phone: input.phone,
        role: input.role,
        ...(input.role === 'customer' && input.zone ? { zone: input.zone } : {}),
        isActive: true,
        passwordHash,
      })

      if (input.role === 'agent') {
        /**
         * pending, not the shift `status` default of 'offline' by
         * accident — both happen to start there, but approvalStatus is the
         * one services/assignment.ts actually checks. Explicit here so the
         * two are never confused at the one place a new rider is created.
         */
        await AgentModel.create({
          user: user._id,
          zones: [input.zone],
          vehicle: input.vehicle,
          nid: input.nid,
          status: 'offline',
          approvalStatus: 'pending',
        })
      }

      return user
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
     *
     * `.exec()` matters. A Mongoose Query is a lazy thenable — returning it
     * unexecuted would run it after runAsSystem has already exited, back
     * inside the request context, where an anonymous caller is denied every
     * document and login fails for a correct password.
     */
    const user = await runAsSystem('auth: login lookup', async () =>
      UserModel.findOne({ email: input.email }).select('+passwordHash').exec(),
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

/**
 * PATCH /auth/me — the profile's Account tab, every role.
 *
 * Re-issues the auth cookie when the email actually changed. The JWT's own
 * claims (`sub`, `role`) do not depend on email, so nothing here is
 * technically broken by skipping this — but an account-affecting change is
 * exactly the moment to hand back a fresh token rather than let a stale one
 * ride out its remaining life, and it costs nothing to do on every save.
 */
authRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const input = updateAccountInputSchema.parse(req.body)

    const updated = await runAsSystem('auth: update account', async () => {
      if (input.email) {
        const clash = await UserModel.findOne({
          email: input.email,
          _id: { $ne: new mongoose.Types.ObjectId(actor.id) },
        })
          .select('_id')
          .lean()
          .exec()
        if (clash) throw conflict('an account with that email already exists')
      }

      const current = await UserModel.findById(actor.id).exec()
      if (!current) throw unauthorized('session no longer valid')

      const emailChanged = current.email !== input.email
      current.name = input.name
      current.phone = input.phone
      current.email = input.email
      await current.save()
      return { user: current, emailChanged }
    })

    if (updated.emailChanged) {
      res.cookie(
        AUTH_COOKIE,
        signToken(updated.user._id.toString(), updated.user.role),
        cookieOptions(),
      )
    }
    res.json({ user: toSelfUser(updated.user) })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /auth/me/password — the Password tab, on purpose its own endpoint
 * (see changePasswordInputSchema's note) so it can never share a Save button
 * with a name/phone/email edit.
 */
authRouter.patch('/me/password', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const input = changePasswordInputSchema.parse(req.body)

    await runAsSystem('auth: change password', async () => {
      const user = await UserModel.findById(actor.id).select('+passwordHash').exec()
      if (!user) throw unauthorized('session no longer valid')

      const ok = await verifyPassword(input.currentPassword, user.passwordHash)
      if (!ok) throw new HttpError(422, 'current password is incorrect')

      user.passwordHash = await hashPassword(input.newPassword)
      await user.save()
    })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

/**
 * Saved addresses — the customer profile's role-specific tab. Booking form
 * autofill from these is not wired up this session (see DEFERRED.md); this
 * is CRUD on the list itself.
 */
authRouter.get('/me/addresses', requireAuth, requireRole('customer'), async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const user = await UserModel.findById(actor.id).select('savedAddresses').exec()
    if (!user) throw unauthorized('session no longer valid')
    res.json({ addresses: user.savedAddresses.map(toSavedAddress) })
  } catch (err) {
    next(err)
  }
})

authRouter.post('/me/addresses', requireAuth, requireRole('customer'), async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const input = savedAddressInputSchema.parse(req.body)

    const user = await UserModel.findById(actor.id).select('savedAddresses').exec()
    if (!user) throw unauthorized('session no longer valid')

    user.savedAddresses.push({ ...input, _id: new mongoose.Types.ObjectId() })
    await user.save()
    res.status(201).json({ addresses: user.savedAddresses.map(toSavedAddress) })
  } catch (err) {
    next(err)
  }
})

authRouter.delete(
  '/me/addresses/:addressId',
  requireAuth,
  requireRole('customer'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const { addressId } = req.params
      if (!addressId || !mongoose.Types.ObjectId.isValid(addressId)) {
        throw new HttpError(400, 'not a valid address id')
      }

      const user = await UserModel.findById(actor.id).select('savedAddresses').exec()
      if (!user) throw unauthorized('session no longer valid')

      const before = user.savedAddresses.length
      user.savedAddresses = user.savedAddresses.filter(
        (a) => a._id.toString() !== addressId,
      ) as UserDoc['savedAddresses']
      if (user.savedAddresses.length === before) {
        throw new HttpError(404, 'address not found')
      }
      await user.save()
      res.json({ addresses: user.savedAddresses.map(toSavedAddress) })
    } catch (err) {
      next(err)
    }
  },
)
