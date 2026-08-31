import { Router } from 'express'
import mongoose from 'mongoose'
import {
  changePasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  savedAddressInputSchema,
  selfUserSchema,
  updateAccountInputSchema,
  uploadAvatarInputSchema,
  type SavedAddress,
  type SelfUser,
} from '@pdms/shared'
import { AgentModel } from '../models/Agent'
import { UserModel, type UserDoc } from '../models'
import { assertOurCloud } from '../lib/cloudinary'
import { runAsSystem } from '../lib/context'
import { hashPassword, verifyPassword, wasteTimeLikeAVerify } from '../lib/password'
import { AUTH_COOKIE, cookieOptions, signToken } from '../lib/token'
import { requireAuth, requireRole, suspended } from '../middleware/auth'
import { conflict, HttpError, unauthorized } from '../middleware/httpError'
import { authRateLimiter } from '../middleware/rateLimit'

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
    avatarUrl: doc.avatarUrl,
    // The timestamp itself never crosses the wire — only the answer to the
    // one question a client has about it.
    showWelcome: doc.welcomeSeenAt === null,
  })

const toSavedAddress = (a: UserDoc['savedAddresses'][number]): SavedAddress => ({
  _id: a._id.toString(),
  label: a.label,
  line1: a.line1,
  area: a.area,
  // Optional on the shared schema for exactly this reason — a document
  // saved before these two fields existed on the model may not have them.
  zone: a.zone,
  city: a.city,
  contactName: a.contactName,
  contactPhone: a.contactPhone,
  lastUsedAt: a.lastUsedAt ?? null,
  ...(a.point ? { point: a.point } : {}),
  ...(a.resolvedLabel ? { resolvedLabel: a.resolvedLabel } : {}),
})

/**
 * POST /auth/register — customer or agent, chosen by the client and
 * validated by a discriminated union with no `admin` branch. See
 * registerInputSchema's own note: that absence, not a runtime check, is what
 * makes `{"role":"admin"}` fail to parse rather than being silently
 * downgraded — see auth.test.ts for the assertion that a payload naming the
 * admin role never reaches this handler with a matched shape.
 */
authRouter.post('/register', authRateLimiter, async (req, res, next) => {
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
        status: 'active',
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

authRouter.post('/login', authRateLimiter, async (req, res, next) => {
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
    /**
     * Checked AFTER the password, so a wrong password on a suspended account
     * still answers "invalid email or password" — otherwise this endpoint
     * would confirm which addresses have accounts to anyone who guesses.
     *
     * Still checked here at all, even though requireAuth now checks it on
     * every request: without this, a suspended customer would be handed a
     * fresh cookie and a 200 and then be refused by everything behind it,
     * which reads as a broken app rather than as a suspension.
     */
    if (user.status === 'suspended') throw suspended()

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
    // Suspension is not re-checked here — requireAuth already did, for this
    // route and every other one behind a cookie.
    const user = await UserModel.findById(actor.id)
    if (!user) throw unauthorized('session no longer valid')

    res.json({ user: toSelfUser(user) })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /auth/me — the profile's Account tab, every role.
 *
 * Name and phone only. Email is shown on this tab but is read-only — it is
 * the account's sign-in identity, and this route no longer accepts it at
 * all (updateAccountInputSchema has no such field), not merely a client that
 * declines to render an editable box for it. This used to also handle an
 * email change, with a uniqueness check and a re-issued auth cookie on
 * success; both are gone along with the field they existed for, rather than
 * left in place unreachable.
 */
authRouter.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const input = updateAccountInputSchema.parse(req.body)

    const updated = await runAsSystem('auth: update account', async () => {
      const current = await UserModel.findById(actor.id).exec()
      if (!current) throw unauthorized('session no longer valid')

      current.name = input.name
      current.phone = input.phone
      await current.save()
      return current
    })

    res.json({ user: toSelfUser(updated) })
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
 * PATCH /auth/me/avatar — "Change photo", every role (M9.6).
 *
 * The upload already happened browser -> Cloudinary with the existing
 * unsigned preset — this route only ever receives a URL, never a binary, the
 * same shape POST /deliveries/:id/pod has taken since M5. `assertOurCloud` is
 * the exact function that route uses, reused rather than re-implemented,
 * because a client submitting a URL it found elsewhere on Cloudinary must be
 * refused the same way a rider submitting someone else's proof photo is.
 */
authRouter.patch('/me/avatar', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const input = uploadAvatarInputSchema.parse(req.body)
    assertOurCloud(input.avatarUrl)

    const user = await UserModel.findById(actor.id).exec()
    if (!user) throw unauthorized('session no longer valid')

    user.avatarUrl = input.avatarUrl
    await user.save()

    res.json({ user: toSelfUser(user) })
  } catch (err) {
    next(err)
  }
})

/**
 * DELETE /auth/me/avatar — "Remove", every role.
 *
 * Clears `avatarUrl` only. The server cannot delete the Cloudinary asset
 * itself — the unsigned preset carries no API secret, the same accepted
 * limitation proof-of-delivery photos have had since M5 (see DEFERRED.md) —
 * so the image is orphaned on Cloudinary, not actually removed. No audit
 * entry: this is the account's OWNER clearing their own photo, not a
 * moderation decision — see routes/agents.ts and routes/customers.ts for
 * the admin-initiated version, which does record one.
 */
authRouter.delete('/me/avatar', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()

    const user = await UserModel.findById(actor.id).exec()
    if (!user) throw unauthorized('session no longer valid')

    user.avatarUrl = null
    await user.save()

    res.json({ user: toSelfUser(user) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /auth/me/welcome — the one-time welcome has been seen.
 *
 * Idempotent, and conditional on the field still being null, so a double
 * click or a second tab cannot move the timestamp once it is set. Returns the
 * refreshed self user rather than `{ ok: true }`, so the client seeds its
 * session cache from the response instead of refetching /auth/me purely to
 * learn that a banner is gone.
 */
authRouter.post('/me/welcome', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()

    const user = await UserModel.findById(actor.id).exec()
    if (!user) throw unauthorized('session no longer valid')

    if (user.welcomeSeenAt === null) {
      user.welcomeSeenAt = new Date()
      await user.save()
    }

    res.json({ user: toSelfUser(user) })
  } catch (err) {
    next(err)
  }
})

/**
 * Saved addresses — the customer profile's role-specific tab, and (M9.9)
 * what the booking form's pick-up autofill reads from.
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

    // lastUsedAt starts null (never booked with yet); point/resolvedLabel
    // start absent (never geocoded yet) — both filled in later by
    // routes/parcels.ts as this address is actually used.
    user.savedAddresses.push({
      ...input,
      _id: new mongoose.Types.ObjectId(),
      lastUsedAt: null,
    })
    await user.save()
    res.status(201).json({ addresses: user.savedAddresses.map(toSavedAddress) })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /auth/me/addresses/:addressId — correct one field without deleting
 * and retyping the whole address (M9.9). Reuses the exact same
 * `savedAddressInputSchema` the Add flow validates against — editing always
 * supplies the complete set, same as adding does.
 *
 * If the edit changes any of the fields geocoding actually reads (line1,
 * area, zone, city), the stored `point`/`resolvedLabel` are cleared: they
 * describe the OLD text, and carrying them forward against new text would
 * silently mis-locate a future autofilled booking. Editing only the label or
 * the contact fields leaves them alone — nothing about where "here" is
 * changed.
 */
authRouter.patch(
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
      const input = savedAddressInputSchema.parse(req.body)

      const user = await UserModel.findById(actor.id).select('savedAddresses').exec()
      if (!user) throw unauthorized('session no longer valid')

      const existing = user.savedAddresses.find((a) => a._id.toString() === addressId)
      if (!existing) throw new HttpError(404, 'address not found')

      const locationChanged =
        existing.line1 !== input.line1 ||
        existing.area !== input.area ||
        existing.zone !== input.zone ||
        existing.city !== input.city

      existing.label = input.label
      existing.line1 = input.line1
      existing.area = input.area
      existing.zone = input.zone
      existing.city = input.city
      existing.contactName = input.contactName
      existing.contactPhone = input.contactPhone
      if (locationChanged) {
        existing.point = undefined
        existing.resolvedLabel = undefined
      }

      await user.save()
      res.json({ addresses: user.savedAddresses.map(toSavedAddress) })
    } catch (err) {
      next(err)
    }
  },
)

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
