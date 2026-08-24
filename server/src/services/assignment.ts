import mongoose from 'mongoose'
import type { DeliveryStatus, GeoPoint, ZoneName } from '@pdms/shared'
import type { Actor } from '../lib/context'
import { runAsSystem } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { HttpError } from '../middleware/httpError'
import { advanceStatus } from './lifecycle'

/**
 * Nearest-available-agent assignment (CLAUDE.md section 5):
 *
 *   $near on the 2dsphere index over agent.currentLocation, filtered to
 *   status 'available' and a matching zone. Falls back to zone-only if no
 *   agent is within 5 km. Admin can override.
 */

/** Section 5's radius, past which proximity stops being the deciding factor. */
export const NEAR_RADIUS_METRES = 5_000

export interface Candidate {
  agentId: string
  userId: string
  name: string
  vehicle: string
  zones: ZoneName[]
  /** Metres from the pickup point, or null when matched by zone alone. */
  distanceMetres: number | null
}

/** How a candidate was found — surfaced so an admin sees why it was offered. */
export type MatchStrategy = 'near' | 'zone-only' | 'none'

export interface AssignmentSuggestion {
  strategy: MatchStrategy
  candidates: Candidate[]
}

interface AgentRow {
  _id: mongoose.Types.ObjectId
  user: mongoose.Types.ObjectId
  vehicle: string
  zones: ZoneName[]
  currentLocation?: GeoPoint
}

interface UserRow {
  _id: mongoose.Types.ObjectId
  name: string
}

/** Great-circle distance, for reporting how far a $near match actually was. */
const haversineMetres = (a: GeoPoint, b: GeoPoint): number => {
  const [lng1, lat1] = a.coordinates
  const [lng2, lat2] = b.coordinates
  const R = 6_371_000
  const toRad = (d: number): number => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const withNames = async (rows: AgentRow[], pickup: GeoPoint | null): Promise<Candidate[]> => {
  if (rows.length === 0) return []
  const UserModel = mongoose.model('User')
  const users = await UserModel.find({ _id: { $in: rows.map((r) => r.user) } })
    .select('name')
    .lean<UserRow[]>()
    .exec()
  const nameById = new Map(users.map((u) => [u._id.toString(), u.name]))

  return rows.map((r) => ({
    agentId: r._id.toString(),
    userId: r.user.toString(),
    name: nameById.get(r.user.toString()) ?? 'Unknown rider',
    vehicle: r.vehicle,
    zones: r.zones,
    distanceMetres:
      pickup && r.currentLocation
        ? Math.round(haversineMetres(pickup, r.currentLocation))
        : null,
  }))
}

/**
 * Who could take this parcel, best first.
 *
 * Runs as system: choosing an agent means looking at agents the requester
 * cannot otherwise see. Authorisation happens at the route (admin only), not
 * by relying on query scoping.
 */
export const suggestAgents = async (args: {
  pickup?: GeoPoint
  zone: ZoneName
  limit?: number
}): Promise<AssignmentSuggestion> => {
  const limit = args.limit ?? 5

  return runAsSystem('assignment: suggest', async () => {
    // ---- 1. nearest available agent in the zone, within 5 km ----
    if (args.pickup) {
      const near = await AgentModel.find({
        status: 'available',
        zones: args.zone,
        currentLocation: {
          $near: {
            $geometry: args.pickup,
            $maxDistance: NEAR_RADIUS_METRES,
          },
        },
      })
        .limit(limit)
        .select('user vehicle zones currentLocation')
        .lean<AgentRow[]>()
        .exec()

      if (near.length > 0) {
        // $near returns nearest-first, so the order is already the ranking.
        return { strategy: 'near', candidates: await withNames(near, args.pickup) }
      }
    }

    /**
     * ---- 2. fallback: zone only ----
     * Section 5's fallback. Reached when nobody available is within 5 km, and
     * also when the parcel has no geocoded pickup point at all — in which
     * case proximity is not a question we can ask.
     */
    const inZone = await AgentModel.find({ status: 'available', zones: args.zone })
      .limit(limit)
      .select('user vehicle zones currentLocation')
      .lean<AgentRow[]>()
      .exec()

    if (inZone.length > 0) {
      const candidates = await withNames(inZone, args.pickup ?? null)
      // No $near ordering here, so sort by known distance where we have it.
      candidates.sort((a, b) => {
        if (a.distanceMetres === null) return 1
        if (b.distanceMetres === null) return -1
        return a.distanceMetres - b.distanceMetres
      })
      return { strategy: 'zone-only', candidates }
    }

    return { strategy: 'none', candidates: [] }
  })
}

interface DeliveryForAssign {
  _id: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  agent: mongoose.Types.ObjectId | null
  status: DeliveryStatus
}

interface ParcelForAssign {
  pickup: { zone: ZoneName; point?: GeoPoint }
}

/**
 * Assign or reassign a delivery.
 *
 * Two distinct cases, deliberately handled by different mechanisms:
 *
 * - Booked -> Assigned is a state change, so it goes through advanceStatus()
 *   like every other transition (section 5: no route mutates status).
 * - Assigned -> Assigned with a different rider is NOT a state change. The
 *   status is already correct; only the agent moves. It still appends an
 *   event, because "who is carrying this" changing is exactly the kind of
 *   thing the audit trail exists to record.
 */
export const assignDelivery = async (args: {
  deliveryId: string
  /** Omit to auto-pick the nearest available rider. */
  agentId?: string
  actor: Actor
}): Promise<{
  status: DeliveryStatus
  agent: Candidate
  strategy: MatchStrategy | 'override'
  reassigned: boolean
}> => {
  const { deliveryId, actor } = args

  if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
    throw new HttpError(400, 'not a valid delivery id')
  }

  const delivery = await runAsSystem('assignment: load delivery', async () =>
    DeliveryModel.findById(deliveryId)
      .select('parcel agent status')
      .lean<DeliveryForAssign | null>()
      .exec(),
  )
  if (!delivery) throw new HttpError(404, 'delivery not found')

  /**
   * Section 5: "Reassignment is allowed only before PickedUp." Once a rider
   * physically holds the parcel, handing it to someone else is a real-world
   * operation this system does not model.
   */
  if (delivery.status !== 'Booked' && delivery.status !== 'Assigned') {
    throw new HttpError(
      422,
      `cannot assign a delivery that is already ${delivery.status} — reassignment is only allowed before pickup`,
    )
  }

  const parcel = await runAsSystem('assignment: load parcel', async () =>
    mongoose
      .model('Parcel')
      .findById(delivery.parcel)
      .select('pickup.zone pickup.point')
      .lean<ParcelForAssign | null>()
      .exec(),
  )
  if (!parcel) throw new HttpError(404, 'the parcel for this delivery is missing')

  // ---- choose a rider ----
  let chosen: Candidate
  let strategy: MatchStrategy | 'override'

  if (args.agentId) {
    chosen = await validateOverride(args.agentId)
    strategy = 'override'
  } else {
    const suggestion = await suggestAgents({
      pickup: parcel.pickup.point,
      zone: parcel.pickup.zone,
      limit: 1,
    })
    const first = suggestion.candidates[0]
    if (!first) {
      throw new HttpError(
        422,
        `no available rider covers ${parcel.pickup.zone} — assign one manually or bring an agent online`,
      )
    }
    chosen = first
    strategy = suggestion.strategy
  }

  const agentObjectId = new mongoose.Types.ObjectId(chosen.agentId)
  const reassigned = delivery.status === 'Assigned'

  if (reassigned && delivery.agent?.equals(agentObjectId)) {
    throw new HttpError(409, `${chosen.name} already has this delivery`)
  }

  if (!reassigned) {
    // First assignment: set the rider, then let the state machine move it.
    await runAsSystem('assignment: attach agent', async () =>
      DeliveryModel.updateOne(
        { _id: delivery._id, status: 'Booked' },
        { $set: { agent: agentObjectId } },
      ).exec(),
    )

    const result = await advanceStatus({
      deliveryId,
      to: 'Assigned',
      actor,
      note: `Assigned to ${chosen.name}`,
    })
    return { status: result.status, agent: chosen, strategy, reassigned: false }
  }

  // Reassignment: the status is already Assigned, so this is an agent swap
  // plus an audit entry. $push, because events is append-only.
  const at = new Date()
  const updated = await runAsSystem('assignment: reassign', async () =>
    DeliveryModel.findOneAndUpdate(
      { _id: delivery._id, status: 'Assigned' },
      {
        $set: { agent: agentObjectId, assignedAt: at },
        $push: {
          events: {
            status: 'Assigned',
            at,
            actor: new mongoose.Types.ObjectId(actor.id),
            actorRole: actor.role,
            note: `Reassigned to ${chosen.name}`,
          },
        },
      },
      { new: true },
    )
      .select('status')
      .lean<{ status: DeliveryStatus } | null>()
      .exec(),
  )

  if (!updated) {
    throw new HttpError(409, 'this delivery just changed — reload and try again')
  }

  return { status: updated.status, agent: chosen, strategy, reassigned: true }
}

/**
 * Validate an admin's explicit choice. Section 5 allows an override, but an
 * override of *who* — not of whether the rider can work: an offline agent
 * would silently never move.
 */
export const validateOverride = async (agentId: string): Promise<Candidate> => {
  if (!mongoose.Types.ObjectId.isValid(agentId)) {
    throw new HttpError(400, 'not a valid agent id')
  }

  return runAsSystem('assignment: validate override', async () => {
    const agent = await AgentModel.findById(agentId)
      .select('user vehicle zones currentLocation status')
      .lean<(AgentRow & { status: string }) | null>()
      .exec()

    if (!agent) throw new HttpError(404, 'agent not found')
    if (agent.status === 'offline') {
      throw new HttpError(422, 'that rider is offline and cannot be assigned')
    }

    const [candidate] = await withNames([agent], null)
    if (!candidate) throw new HttpError(500, 'agent could not be resolved')
    return candidate
  })
}
