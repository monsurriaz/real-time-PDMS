import { Router } from 'express'
import mongoose from 'mongoose'
import {
  advanceStatusInputSchema,
  assignInputSchema,
  recordPodInputSchema,
  type DeliveryListItem,
  type DeliveryStatus,
  type PodMethod,
  type ZoneName,
} from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { UserModel } from '../models/User'
import { requireAuth, requireRole } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'
import { assignDelivery, suggestAgents } from '../services/assignment'
import { codStatusForParcels } from '../services/payments'
import { issueOtp, recordProof } from '../services/pod'
import { advanceStatus, availableTransitions } from '../services/lifecycle'

export const deliveriesRouter = Router()

const objectIdParam = (raw: string | undefined): string => {
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw new HttpError(400, 'not a valid id')
  }
  return raw
}

interface DeliveryRow {
  _id: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  agent: mongoose.Types.ObjectId | null
  status: DeliveryStatus
  proofOfDelivery?: { method: PodMethod }
  expectedBy: Date | null
  createdAt: Date
  updatedAt: Date
}

interface ParcelRow {
  _id: mongoose.Types.ObjectId
  trackingId: string
  pickup: { area: string; zone: ZoneName }
  drop: { area: string; zone: ZoneName; contactName: string }
  weightKg: number
  price: { total: number }
  isCod: boolean
  codAmount: number
}

/**
 * Joins deliveries to their parcels and riders for the list views.
 *
 * Three scoped queries rather than an aggregation: `$lookup` bypasses query
 * middleware entirely, which would quietly defeat the role scoping that keeps
 * an agent from seeing another agent's run.
 */
const toListItems = async (
  rows: DeliveryRow[],
  role: 'customer' | 'agent' | 'admin',
): Promise<DeliveryListItem[]> => {
  if (rows.length === 0) return []

  const parcels = await ParcelModel.find({
    _id: { $in: rows.map((r) => r.parcel) },
  })
    .select('trackingId pickup drop weightKg price isCod codAmount')
    .lean<ParcelRow[]>()
  const parcelById = new Map(parcels.map((p) => [p._id.toString(), p]))

  // Rider names come from User via Agent. Run as system: an agent may see the
  // name of whoever holds a delivery they can already see, and an admin sees
  // all — but Agent's own scoping would hide other riders' records.
  const agentIds = rows.map((r) => r.agent).filter((a): a is mongoose.Types.ObjectId => a !== null)
  const nameByAgentId = new Map<string, string>()
  if (agentIds.length > 0) {
    await runAsSystem('deliveries: rider names', async () => {
      const agents = await AgentModel.find({ _id: { $in: agentIds } })
        .select('user')
        .lean<Array<{ _id: mongoose.Types.ObjectId; user: mongoose.Types.ObjectId }>>()
        .exec()
      const users = await UserModel.find({ _id: { $in: agents.map((a) => a.user) } })
        .select('name')
        .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>()
        .exec()
      const userName = new Map(users.map((u) => [u._id.toString(), u.name]))
      for (const a of agents) {
        nameByAgentId.set(a._id.toString(), userName.get(a.user.toString()) ?? 'Unknown rider')
      }
    })
  }

  /**
   * Where each COD parcel's cash stands. One query for the page rather than
   * one per row, and only for the parcels that are actually COD.
   */
  const codStatus = await codStatusForParcels(
    parcels.filter((p) => p.isCod).map((p) => p._id),
  )

  const now = Date.now()

  return rows.flatMap((d) => {
    const p = parcelById.get(d.parcel.toString())
    // A delivery whose parcel the caller cannot see is not theirs to list.
    if (!p) return []

    return [
      {
        _id: d._id.toString(),
        parcelId: p._id.toString(),
        trackingId: p.trackingId,
        status: d.status,
        pickupArea: p.pickup.area,
        pickupZone: p.pickup.zone,
        dropArea: p.drop.area,
        dropZone: p.drop.zone,
        recipientName: p.drop.contactName,
        weightKg: p.weightKg,
        total: p.price.total,
        isCod: p.isCod,
        codAmount: p.codAmount,
        codStatus: p.isCod ? (codStatus.get(p._id.toString()) ?? null) : null,
        hasProofOfDelivery: Boolean(d.proofOfDelivery),
        podMethod: d.proofOfDelivery?.method ?? null,
        agentName: d.agent ? (nameByAgentId.get(d.agent.toString()) ?? null) : null,
        agentId: d.agent ? d.agent.toString() : null,
        /**
         * Computed server-side from the same map advanceStatus enforces, so
         * the UI never decides what is legal (rule 3) — it only renders what
         * the server already said.
         */
        allowedTransitions: [...availableTransitions(d.status, role)],
        expectedBy: d.expectedBy,
        isOverdue:
          d.expectedBy !== null &&
          d.expectedBy.getTime() < now &&
          !['Delivered', 'Cancelled', 'Failed'].includes(d.status),
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
      },
    ]
  })
}

/**
 * GET /deliveries — an agent's own run list, or every delivery for an admin.
 *
 * The filter comes from role scoping on the model, not from this handler.
 * `?status=` narrows it further for the admin board.
 */
deliveriesRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()

    const statusParam = (req.query as Record<string, string | undefined>).status
    const filter = statusParam ? { status: statusParam } : {}

    const rows = await DeliveryModel.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .select('parcel agent status proofOfDelivery expectedBy createdAt updatedAt')
      .lean<DeliveryRow[]>()

    res.json({ deliveries: await toListItems(rows, actor.role) })
  } catch (err) {
    next(err)
  }
})

/**
 * GET /deliveries/:id/candidates — who could take this parcel.
 *
 * Admin only: it exposes riders' names and distances, which is exactly what
 * section 7 says a customer must not see.
 */
deliveriesRouter.get(
  '/:id/candidates',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = objectIdParam(req.params.id)

      const delivery = await DeliveryModel.findById(id).select('parcel status').lean<{
        parcel: mongoose.Types.ObjectId
        status: DeliveryStatus
      } | null>()
      if (!delivery) throw new HttpError(404, 'delivery not found')

      const parcel = await ParcelModel.findById(delivery.parcel)
        .select('pickup.zone pickup.point')
        .lean<{ pickup: { zone: ZoneName; point?: { type: 'Point'; coordinates: [number, number] } } } | null>()
      if (!parcel) throw new HttpError(404, 'parcel not found')

      const suggestion = await suggestAgents({
        pickup: parcel.pickup.point,
        zone: parcel.pickup.zone,
      })

      res.json({
        zone: parcel.pickup.zone,
        hasPickupPoint: Boolean(parcel.pickup.point),
        ...suggestion,
      })
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /deliveries/:id/assign — assign or reassign.
 *
 * An empty body auto-picks the nearest available rider; `agentId` is the
 * section 5 admin override.
 */
deliveriesRouter.post(
  '/:id/assign',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const actor = req.actor
      if (!actor) throw unauthorized()
      const id = objectIdParam(req.params.id)
      const input = assignInputSchema.parse(req.body ?? {})

      const result = await assignDelivery({
        deliveryId: id,
        ...(input.agentId ? { agentId: input.agentId } : {}),
        actor,
      })

      res.json(result)
    } catch (err) {
      next(err)
    }
  },
)

/**
 * POST /deliveries/:id/status — the only way a status changes.
 *
 * No role gate beyond requireAuth: advanceStatus owns both the legality and
 * the authority decision, and duplicating the role list here would be a
 * second place to keep in step with the map.
 */
deliveriesRouter.post('/:id/status', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const id = objectIdParam(req.params.id)
    const input = advanceStatusInputSchema.parse(req.body)

    const result = await advanceStatus({
      deliveryId: id,
      to: input.to,
      actor,
      ...(input.point ? { point: input.point } : {}),
      ...(input.note ? { note: input.note } : {}),
    })

    res.json(result)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /deliveries/:id/pod/otp — send a delivery code.
 *
 * Returns when it was issued and when it dies, never the code itself. See
 * services/pod.ts for why: the rider is the party the code checks.
 */
deliveriesRouter.post('/:id/pod/otp', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const id = objectIdParam(req.params.id)

    res.json({ otp: await issueOtp({ deliveryId: id, actor }) })
  } catch (err) {
    next(err)
  }
})

/**
 * POST /deliveries/:id/pod — record proof of delivery.
 *
 * Three live methods since M5: a Cloudinary photo URL, a code the server
 * verifies, or a signed-for name. Which fields each needs is expressed once, in
 * the shared discriminated union, so a half-filled payload cannot arrive as an
 * empty proof.
 *
 * Stored separately from the transition on purpose: section 5 says Delivered
 * requires proof "already stored on the record", so the two are distinct acts.
 */
deliveriesRouter.post('/:id/pod', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const id = objectIdParam(req.params.id)
    const input = recordPodInputSchema.parse(req.body)

    const proofOfDelivery = await recordProof({ deliveryId: id, actor, input })
    res.json({ proofOfDelivery })
  } catch (err) {
    next(err)
  }
})

/** GET /deliveries/:id — one delivery with its full event trail. */
deliveriesRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const id = objectIdParam(req.params.id)

    const rows = await DeliveryModel.find({ _id: new mongoose.Types.ObjectId(id) })
      .select('parcel agent status proofOfDelivery expectedBy createdAt updatedAt')
      .lean<DeliveryRow[]>()

    const [item] = await toListItems(rows, actor.role)
    if (!item) throw new HttpError(404, 'delivery not found')

    const full = await DeliveryModel.findById(id)
      .select('events failureReason proofOfDelivery')
      .lean<{
        events: unknown[]
        failureReason?: string
        proofOfDelivery?: unknown
      } | null>()

    res.json({
      delivery: item,
      events: full?.events ?? [],
      failureReason: full?.failureReason,
      proofOfDelivery: full?.proofOfDelivery ?? null,
    })
  } catch (err) {
    next(err)
  }
})
