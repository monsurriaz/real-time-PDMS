import { Router } from 'express'
import mongoose from 'mongoose'
import {
  setAgentLocationInputSchema,
  setAgentStatusInputSchema,
  type AgentSelf,
  type GeoPoint,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
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
  status: 'available' | 'on_delivery' | 'offline'
  vehicle: 'bicycle' | 'motorcycle' | 'van'
  zones: string[]
  currentLocation?: GeoPoint
  locationUpdatedAt?: Date
}

const ACTIVE_STATUSES = ['Assigned', 'PickedUp', 'InTransit'] as const

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
    vehicle: agent.vehicle,
    zones: agent.zones as AgentSelf['zones'],
    ...(agent.currentLocation ? { currentLocation: agent.currentLocation } : {}),
    ...(agent.locationUpdatedAt ? { locationUpdatedAt: agent.locationUpdatedAt } : {}),
    activeCount,
  }
}

/**
 * GET /agents/counts — what the admin rail shows beside "Riders".
 *
 * `pendingApproval` counts riders waiting to be let in. The approval flow is
 * M6.5c and no rider carries an approval field yet, so the honest answer today
 * is 0 — but it is REPORTED as a query rather than assumed, because the first
 * attempt here was `countDocuments({ approvalStatus: 'pending' })` and Mongoose
 * silently dropped the unknown path under strictQuery and counted every rider
 * instead. A filter on a field that does not exist does not mean "none"; it
 * means "no filter". Hence the explicit `strictQuery: false`, which makes Mongo
 * evaluate the condition it was given and answer 0 until the field is real.
 */
agentsRouter.get('/counts', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const [total, onShift, pendingApproval] = await runAsSystem(
      'agents: rail counts',
      async () =>
        Promise.all([
          AgentModel.countDocuments({}).exec(),
          AgentModel.countDocuments({ status: { $ne: 'offline' } }).exec(),
          AgentModel.countDocuments({ approvalStatus: 'pending' })
            .setOptions({ strictQuery: false })
            .exec(),
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
 * it with nobody accountable.
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
