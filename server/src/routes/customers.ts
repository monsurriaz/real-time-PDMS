import { Router, type NextFunction, type Request, type Response } from 'express'
import mongoose from 'mongoose'
import type { CustomerRow, UserStatus } from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { ParcelModel } from '../models/Parcel'
import { UserModel } from '../models/User'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'

export const customersRouter = Router()

/**
 * /admin/customers — the customer roster, and suspend/reactivate.
 *
 * Shaped after routes/agents.ts rather than invented fresh: one list endpoint
 * the client filters, and two decision endpoints that append to an append-only
 * history naming the acting admin. The two screens do the same kind of work, so
 * they should be the same kind of code.
 *
 * Every handler here is admin-only. That is stated twice — `requireRole` on the
 * route, and the User model's own scope rule, which resolves to "yourself" for
 * a customer and an agent — so a missing guard fails closed rather than open.
 */

interface CustomerLean {
  _id: mongoose.Types.ObjectId
  name: string
  email: string
  /** M9.6. Optional for the same `.lean()` reason `status` is below. */
  avatarUrl?: string | null
  /**
   * Optional because `.lean()` skips the schema default, so an account
   * created before this field existed comes back without it. See
   * middleware/auth.ts — absent means active, there and here.
   */
  status?: UserStatus
  /** Optional for the same reason `status` is — a lean read applies no default. */
  accountHistory?: Array<{ status: UserStatus; at: Date; by: mongoose.Types.ObjectId }>
  createdAt: Date
}

/**
 * GET /customers — every customer, with how many parcels they have sent.
 *
 * Counted in JavaScript from a projection rather than with `$group`, for the
 * reason services/analytics.ts records: an aggregation bypasses the roleScope
 * query middleware entirely, so the safe version of "count across every
 * customer" is a scoped-model read taken deliberately inside runAsSystem.
 *
 * One request for the whole list, filtered and paged on the client — the same
 * choice /admin/agents makes. A course demo has tens of customers, and a server
 * -side pager would be three more parameters to get wrong for no benefit
 * anybody can see.
 */
customersRouter.get('/', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const rows = await UserModel.find({ role: 'customer' })
      .select('name email avatarUrl status accountHistory createdAt')
      .sort({ createdAt: -1 })
      .lean<CustomerLean[]>()

    const counts = await runAsSystem('customers: parcels per customer', async () => {
      const parcels = await ParcelModel.find({})
        .select('customer')
        .lean<Array<{ customer: mongoose.Types.ObjectId }>>()
        .exec()
      const out = new Map<string, number>()
      for (const p of parcels) {
        const key = p.customer.toString()
        out.set(key, (out.get(key) ?? 0) + 1)
      }
      return out
    })

    const customers: CustomerRow[] = rows.map((r) => {
      // Append-only, so the last entry is the current decision.
      const last = r.accountHistory?.at(-1)
      return {
        _id: r._id.toString(),
        name: r.name,
        email: r.email,
        avatarUrl: r.avatarUrl ?? null,
        status: r.status ?? 'active',
        parcelCount: counts.get(r._id.toString()) ?? 0,
        joinedAt: r.createdAt,
        lastDecision: last
          ? { status: last.status, at: last.at, by: last.by.toString() }
          : null,
      }
    })

    res.json({ customers })
  } catch (err) {
    next(err)
  }
})

/**
 * Suspend or reactivate one customer.
 *
 * Both append to `accountHistory` rather than overwrite anything, naming the
 * admin who decided — the same append-only shape as an agent's approval trail
 * and a delivery's events, and for the same reason: the status says what is
 * true now, and only the trail says who made it true.
 *
 * There is no body. The status is in the URL, so there is no client-supplied
 * field for the record to disagree with — the same reasoning as
 * POST /payments/settlements accepting no amount.
 *
 * A customer only. An admin cannot suspend another admin from here, and a
 * rider is refused for a different reason: their working state is
 * `approvalStatus` on Agent, and giving riders a second, overlapping way to be
 * switched off would leave two fields that have to agree.
 */
const decide = (nextStatus: UserStatus) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const id = req.params.id
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new HttpError(400, 'not a valid customer id')
      }

      const target = await UserModel.findById(id)
        .select('role status')
        .lean<{ role: string; status?: UserStatus } | null>()
      if (!target) throw new HttpError(404, 'customer not found')
      if (target.role !== 'customer') {
        throw new HttpError(422, 'only a customer account can be suspended from here')
      }
      // Absent means active — see CustomerLean. Normalised before the
      // comparison, or Reactivate on an account that never had the field would
      // "succeed" and append a decision that changed nothing.
      if ((target.status ?? 'active') === nextStatus) {
        throw new HttpError(422, `this account is already ${nextStatus}`)
      }

      const at = new Date()
      await UserModel.updateOne(
        { _id: id },
        {
          $set: { status: nextStatus },
          $push: {
            accountHistory: {
              status: nextStatus,
              at,
              by: new mongoose.Types.ObjectId(actor.id),
            },
          },
        },
      )

      res.json({ status: nextStatus, at })
    } catch (err) {
      next(err)
    }
  }

customersRouter.post(
  '/:id/suspend',
  requireAuth,
  requireRole('admin'),
  decide('suspended'),
)
customersRouter.post(
  '/:id/reactivate',
  requireAuth,
  requireRole('admin'),
  decide('active'),
)

/**
 * Admin photo moderation (M9.6) — clears a customer's avatar, not their
 * account. A separate, lesser action from suspend/reactivate above: this
 * appends to `moderationHistory`, not `accountHistory` — see the model's own
 * note for why the two stay apart. The server cannot delete the underlying
 * Cloudinary asset (no API secret, same limitation POD photos have always
 * had); this only ever clears the field.
 */
customersRouter.post(
  '/:id/clear-avatar',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const id = req.params.id
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new HttpError(400, 'not a valid customer id')
      }

      const target = await UserModel.findById(id).select('role avatarUrl')
      if (!target) throw new HttpError(404, 'customer not found')
      if (target.role !== 'customer') {
        throw new HttpError(422, 'only a customer account can be moderated from here')
      }
      if (!target.avatarUrl) {
        throw new HttpError(422, 'this account has no photo to clear')
      }

      const at = new Date()
      await UserModel.updateOne(
        { _id: id },
        {
          $set: { avatarUrl: null },
          $push: {
            moderationHistory: {
              action: 'avatar_cleared',
              at,
              by: new mongoose.Types.ObjectId(actor.id),
            },
          },
        },
      )

      res.json({ avatarUrl: null, at })
    } catch (err) {
      next(err)
    }
  },
)
