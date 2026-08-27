import { Router, type NextFunction, type Request, type Response } from 'express'
import mongoose from 'mongoose'
import {
  maskNid,
  updateAgentDetailsInputSchema,
  setAgentLocationInputSchema,
  setAgentStatusInputSchema,
  type AgentApprovalStatus,
  type AgentRosterItem,
  type AgentSelf,
  type AgentStatus,
  type GeoPoint,
  type Vehicle,
  type ZoneName,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { UserModel } from '../models/User'
import { ZoneModel } from '../models/Zone'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'

export const agentsRouter = Router()

/**
 * The rider's own shift controls: where they are, and whether they are on duty.
 *
 * These stand in for the GPS stream until M4 (CLAUDE.md section 6). Without a
 * way to set a position by hand, every rider sits wherever the seed left them
 * and the $near assignment query in section 5 cannot be exercised at all.
 */

interface AgentLean {
  _id: mongoose.Types.ObjectId
  user: mongoose.Types.ObjectId
  status: AgentStatus
  approvalStatus: AgentApprovalStatus
  vehicle: Vehicle
  zones: ZoneName[]
  nid: string
  currentLocation?: GeoPoint
  locationUpdatedAt?: Date
}

/**
 * M8: bare 'Assigned' is now just an unanswered offer — it isn't real load
 * until the rider says Accepted, so it doesn't count toward their own
 * "active deliveries" figure either (matches assignment.ts's ACTIVE_STATUSES).
 */
const ACTIVE_STATUSES = ['Accepted', 'PickedUp', 'InTransit'] as const

const objectIdParam = (raw: string | undefined): string => {
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw new HttpError(400, 'not a valid id')
  }
  return raw
}

/** The Agent document belonging to the signed-in rider. */
const myAgent = async (userId: string): Promise<AgentLean> => {
  // Scoped read: Agent's rule for an agent resolves to their own record only.
  const agent = await AgentModel.findOne({
    user: new mongoose.Types.ObjectId(userId),
  }).lean<AgentLean | null>()

  if (!agent) {
    throw new HttpError(
      404,
      'no rider record for this account — an admin needs to create one',
    )
  }
  return agent
}

const toSelf = async (agent: AgentLean): Promise<AgentSelf> => {
  const activeCount = await runAsSystem('agents: active count', async () =>
    DeliveryModel.countDocuments({
      agent: agent._id,
      status: { $in: ACTIVE_STATUSES },
    }).exec(),
  )

  return {
    _id: agent._id.toString(),
    status: agent.status,
    approvalStatus: agent.approvalStatus,
    vehicle: agent.vehicle,
    zones: agent.zones as AgentSelf['zones'],
    nid: agent.nid,
    ...(agent.currentLocation ? { currentLocation: agent.currentLocation } : {}),
    ...(agent.locationUpdatedAt ? { locationUpdatedAt: agent.locationUpdatedAt } : {}),
    activeCount,
  }
}

/**
 * GET /agents/counts — what the admin rail shows beside "Riders".
 *
 * `pendingApproval` counts riders waiting on a decision. approvalStatus is a
 * real, indexed field now, so this is a plain count — no strictQuery
 * workaround needed, unlike when this comment described a field that did
 * not exist yet.
 */
agentsRouter.get('/counts', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const [total, onShift, pendingApproval] = await runAsSystem(
      'agents: rail counts',
      async () =>
        Promise.all([
          AgentModel.countDocuments({}).exec(),
          AgentModel.countDocuments({ status: { $ne: 'offline' } }).exec(),
          AgentModel.countDocuments({ approvalStatus: 'pending' }).exec(),
        ]),
    )
    res.json({ total, onShift, pendingApproval })
  } catch (err) {
    next(err)
  }
})

agentsRouter.get('/me', requireAuth, requireRole('agent'), async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    res.json({ agent: await toSelf(await myAgent(actor.id)) })
  } catch (err) {
    next(err)
  }
})

/**
 * PATCH /agents/me/details — the profile's "Rider details" tab: vehicle and
 * the zones this rider covers. NID is deliberately not accepted here — see
 * agentApplicationFieldsSchema's own note, it is not re-editable once
 * submitted.
 */
agentsRouter.patch(
  '/me/details',
  requireAuth,
  requireRole('agent'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const input = updateAgentDetailsInputSchema.parse(req.body)
      const agent = await myAgent(actor.id)

      await AgentModel.updateOne(
        { _id: agent._id },
        { $set: { vehicle: input.vehicle, zones: input.zones } },
      )

      res.json({
        agent: await toSelf({ ...agent, vehicle: input.vehicle, zones: input.zones }),
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /agents/me/location — drop a pin, by zone centre or by coordinates.
 *
 * Writes `currentLocation`, which is the exact field the sparse 2dsphere index
 * and the $near assignment query both read.
 */
agentsRouter.post(
  '/me/location',
  requireAuth,
  requireRole('agent'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const input = setAgentLocationInputSchema.parse(req.body)
      const agent = await myAgent(actor.id)

      let point: GeoPoint
      if (input.mode === 'zone') {
        const zone = await ZoneModel.findOne({ name: input.zone })
          .select('centre')
          .lean<{ centre: GeoPoint } | null>()
        if (!zone) throw new HttpError(404, `${input.zone} is not a known zone`)
        point = zone.centre
      } else {
        point = { type: 'Point', coordinates: [input.lng, input.lat] }
      }

      const at = new Date()
      await AgentModel.updateOne(
        { _id: agent._id },
        { $set: { currentLocation: point, locationUpdatedAt: at } },
      )

      res.json({
        agent: await toSelf({
          ...agent,
          currentLocation: point,
          locationUpdatedAt: at,
        }),
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /agents/me/status — go on or off shift.
 *
 * Going offline removes the rider from the $near pool immediately, because
 * suggestAgents filters on `status: 'available'`.
 *
 * Manual offline is sticky: syncAgentAvailability in lifecycle.ts guards its
 * update with `status: { $ne: 'offline' }`, so completing a delivery cannot
 * quietly put an off-shift rider back into the pool. Only this endpoint brings
 * them back.
 *
 * Refused while `on_delivery`: that state means a parcel is physically in the
 * rider's hands, and letting them vanish from the roster mid-run would strand
 * it with nobody accountable. A pending or rejected rider CAN still toggle
 * this — it costs nothing, since suggestAgents excludes them regardless of
 * shift status — but going available never actually produces work until an
 * admin approves them.
 */
agentsRouter.post(
  '/me/status',
  requireAuth,
  requireRole('agent'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const input = setAgentStatusInputSchema.parse(req.body)
      const agent = await myAgent(actor.id)

      if (agent.status === 'on_delivery') {
        throw new HttpError(
          422,
          'you are carrying a parcel — finish it, or ask an admin to reassign it, before changing your shift',
        )
      }

      if (agent.status === input.status) {
        res.json({ agent: await toSelf(agent) })
        return
      }

      await AgentModel.updateOne({ _id: agent._id }, { $set: { status: input.status } })
      res.json({ agent: await toSelf({ ...agent, status: input.status }) })
    } catch (err) {
      next(err)
    }
  },
)

interface UserNameRow {
  _id: mongoose.Types.ObjectId
  name: string
  phone: string
  email: string
}

/**
 * GET /agents — the admin roster AND the approval queue in one list; the
 * client buckets by `approvalStatus` into the two tables /admin/agents draws,
 * the same way the rider workspace buckets one delivery list into active and
 * finished rather than this route offering two shapes.
 *
 * `maskedNid` is the only form the NID leaves the server in — see maskNid's
 * own note. There is no "give me the full number" variant of this route.
 */
agentsRouter.get('/', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const rows = await AgentModel.find({})
      .select('user vehicle zones status approvalStatus nid createdAt')
      .sort({ createdAt: -1 })
      .lean<
        Array<{
          _id: mongoose.Types.ObjectId
          user: mongoose.Types.ObjectId
          vehicle: Vehicle
          zones: ZoneName[]
          status: AgentStatus
          approvalStatus: AgentApprovalStatus
          nid: string
          createdAt: Date
        }>
      >()

    const users = await UserModel.find({ _id: { $in: rows.map((r) => r.user) } })
      .select('name phone email')
      .lean<UserNameRow[]>()
    const byUser = new Map(users.map((u) => [u._id.toString(), u]))

    const agents: AgentRosterItem[] = rows.flatMap((r) => {
      const u = byUser.get(r.user.toString())
      // A rider whose User record vanished is not one to show — should not
      // happen outside a corrupted seed, but flatMap lets it drop silently
      // rather than crashing the whole roster on one bad row.
      if (!u) return []
      return [
        {
          _id: r._id.toString(),
          userId: u._id.toString(),
          name: u.name,
          phone: u.phone,
          email: u.email,
          vehicle: r.vehicle,
          zones: r.zones,
          status: r.status,
          approvalStatus: r.approvalStatus,
          maskedNid: maskNid(r.nid),
          appliedAt: r.createdAt,
        },
      ]
    })

    res.json({ agents })
  } catch (err) {
    next(err)
  }
})

/**
 * Approve or reject one application. Both append to `approvalHistory` rather
 * than overwrite anything — the same append-only shape Delivery's events use
 * — naming the acting admin, which is the audit trail CLAUDE.md's spirit for
 * section 5 (every lifecycle change records who and when) asks for here too.
 */
const decide = (nextStatus: 'approved' | 'rejected') =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const id = objectIdParam(req.params.id)

      const agent = await AgentModel.findById(id).select('approvalStatus').lean<{
        approvalStatus: AgentApprovalStatus
      } | null>()
      if (!agent) throw new HttpError(404, 'agent not found')
      if (agent.approvalStatus !== 'pending') {
        throw new HttpError(422, `this application is already ${agent.approvalStatus}`)
      }

      const at = new Date()
      await AgentModel.updateOne(
        { _id: id },
        {
          $set: { approvalStatus: nextStatus },
          $push: {
            approvalHistory: {
              status: nextStatus,
              at,
              by: new mongoose.Types.ObjectId(actor.id),
            },
          },
        },
      )

      res.json({ approvalStatus: nextStatus, at })
    } catch (err) {
      next(err)
    }
  }

agentsRouter.post('/:id/approve', requireAuth, requireRole('admin'), decide('approved'))
agentsRouter.post('/:id/reject', requireAuth, requireRole('admin'), decide('rejected'))
