import mongoose from 'mongoose'
import type { DeliveryStatus, GeoPoint, ZoneName } from '@pdms/shared'
import type { Actor } from '../lib/context'
import { runAsSystem } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { HttpError } from '../middleware/httpError'
import { advanceStatus, type TransitionActor } from './lifecycle'

/**
 * Nearest-available-agent assignment (CLAUDE.md section 5):
 *
 *   $near on the 2dsphere index over agent.currentLocation, filtered to
 *   status 'available' and a matching zone. Falls back to zone-only if no
 *   agent is within 5 km. Admin can override.
 */

/** Section 5's radius, past which proximity stops being the deciding factor. */
export const NEAR_RADIUS_METRES = 5_000

/**
 * How close two riders must be before distance stops deciding between them.
 *
 * 300 m is roughly a block in Dhaka and comfortably above GPS drift, so two
 * riders inside it are the same answer to "who is nearest" — which is what lets
 * workload break the tie without ever contradicting section 5's rule.
 */
export const TIE_BREAK_METRES = 300

export interface Candidate {
  agentId: string
  userId: string
  name: string
  vehicle: string
  zones: ZoneName[]
  /** Metres from the pickup point, or null when matched by zone alone. */
  distanceMetres: number | null
  /**
   * Deliveries this rider is already holding — Assigned, PickedUp or InTransit.
   *
   * Availability flips at PickedUp rather than at Assigned (see lifecycle.ts),
   * which is deliberate: a rider can hold several upcoming jobs but only one in
   * hand. The side effect was that "available" said nothing about how much
   * somebody was already carrying, so the nearest rider could absorb every
   * booking in their zone. Shown to the admin, and used as a tie-break below.
   */
  activeDeliveries: number
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

/** Statuses that mean a rider is already carrying something. */
const ACTIVE_STATUSES = ['Assigned', 'PickedUp', 'InTransit'] as const

/**
 * How many active deliveries each of these riders holds.
 *
 * One query for the whole candidate list rather than a countDocuments per
 * rider: the list is at most five, but this runs on every booking.
 */
const loadFor = async (
  agentIds: readonly mongoose.Types.ObjectId[],
): Promise<Map<string, number>> => {
  if (agentIds.length === 0) return new Map()
  const DeliveryModel = mongoose.model('Delivery')
  const rows = await DeliveryModel.find({
    agent: { $in: agentIds },
    status: { $in: ACTIVE_STATUSES },
  })
    .select('agent')
    .lean<Array<{ agent: mongoose.Types.ObjectId }>>()
    .exec()

  const counts = new Map<string, number>()
  for (const r of rows) {
    const key = r.agent.toString()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

const withNames = async (rows: AgentRow[], pickup: GeoPoint | null): Promise<Candidate[]> => {
  if (rows.length === 0) return []
  const UserModel = mongoose.model('User')
  const users = await UserModel.find({ _id: { $in: rows.map((r) => r.user) } })
    .select('name')
    .lean<UserRow[]>()
    .exec()
  const load = await loadFor(rows.map((r) => r._id))
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
    activeDeliveries: load.get(r._id.toString()) ?? 0,
  }))
}

/**
 * Who could take this parcel, best first.
 *
 * Runs as system: choosing an agent means looking at agents the requester
 * cannot otherwise see. Authorisation happens at the route (admin only), not
 * by relying on query scoping.
 */
/**
 * Rank candidates: nearest first, workload breaking ties.
 *
 * Pure and exported so the rule can be tested directly. `$near` has already
 * ordered the input by distance; this re-sorts with the tie-break applied, and
 * because the comparison falls back to distance whenever the gap exceeds
 * TIE_BREAK_METRES, the section 5 ordering is preserved wherever distance
 * actually distinguishes two riders.
 */
export const rankCandidates = (candidates: readonly Candidate[]): Candidate[] =>
  [...candidates].sort((a, b) => {
    const da = a.distanceMetres ?? Number.POSITIVE_INFINITY
    const db = b.distanceMetres ?? Number.POSITIVE_INFINITY
    // Both unknown: nothing to compare on but load.
    if (!Number.isFinite(da) && !Number.isFinite(db)) {
      return a.activeDeliveries - b.activeDeliveries
    }
    if (Math.abs(da - db) > TIE_BREAK_METRES) return da - db
    return a.activeDeliveries - b.activeDeliveries || da - db
  })

/**
 * Every field assignment requires of a candidate BEFORE distance or zone
 * even enter the question: on shift, and approved.
 *
 * Exported so services/assignment.test.ts can build the exact
 * `AgentModel.find(...)` queries this file runs and inspect their filter
 * with `.getFilter()` — the same technique roleScope.test.ts uses for the
 * socket-room fix, proving the real query object rather than a
 * re-implementation of it. A rider whose application is `pending` or
 * `rejected` must never be a candidate, however close or however free —
 * this is the one line that keeps that true everywhere suggestAgents reads
 * from the roster.
 */
export const ASSIGNABLE_AGENT_FILTER = {
  status: 'available',
  approvalStatus: 'approved',
} as const

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
        ...ASSIGNABLE_AGENT_FILTER,
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
        /**
         * $near returns nearest-first, which is the ranking section 5 asks for.
         * Workload breaks TIES within it rather than overriding it: two riders
         * within a couple of hundred metres of the pick-up are equivalent as
         * far as the customer is concerned, and handing the parcel to the one
         * carrying less spreads the work without ever sending a rider further
         * than the rule allows.
         *
         * The threshold is what makes this a tie-break and not a re-sort. Below
         * it, distance is noise — GPS drift alone is tens of metres.
         */
        return { strategy: 'near', candidates: rankCandidates(await withNames(near, args.pickup)) }
      }
    }

    /**
     * ---- 2. fallback: zone only ----
     * Section 5's fallback. Reached when nobody available is within 5 km, and
     * also when the parcel has no geocoded pickup point at all — in which
     * case proximity is not a question we can ask.
     */
    const inZone = await AgentModel.find({ ...ASSIGNABLE_AGENT_FILTER, zones: args.zone })
      .limit(limit)
      .select('user vehicle zones currentLocation')
      .lean<AgentRow[]>()
      .exec()

    if (inZone.length > 0) {
      /**
       * Same ranking. This branch often has no distance at all — it is the
       * fallback for a parcel with no geocoded pick-up — and where distance is
       * unknown for everyone, workload is the only thing left to rank on, which
       * is a better answer than document order.
       */
      const candidates = rankCandidates(await withNames(inZone, args.pickup ?? null))
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
  actor: TransitionActor
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
            actor: actor === 'system' ? null : new mongoose.Types.ObjectId(actor.id),
            actorRole: actor === 'system' ? null : actor.role,
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

/** The outcome of an automatic assignment attempt. */
export type AutoAssignOutcome =
  | { assigned: true; agentName: string; strategy: MatchStrategy | 'override' }
  | { assigned: false; reason: string }

/**
 * Automatic assignment immediately after booking (CLAUDE.md section 5).
 *
 * Reuses assignDelivery wholesale — the same $near query, the same 5 km
 * zone-only fallback, the same "no rider covers this zone" message the manual
 * path already produces. The only difference is what happens on failure.
 *
 * This never throws. A booking must not fail because the roster happens to be
 * busy: the parcel stays Booked, which is exactly the state the admin board
 * already flags as unassigned. The reason is returned rather than discarded,
 * so the customer's booking response says what happened instead of implying a
 * rider is on the way.
 */
export const autoAssignAfterBooking = async (args: {
  deliveryId: string
}): Promise<AutoAssignOutcome> => {
  try {
    const result = await assignDelivery({
      deliveryId: args.deliveryId,
      actor: 'system',
    })
    return {
      assigned: true,
      agentName: result.agent.name,
      strategy: result.strategy,
    }
  } catch (err) {
    const reason =
      err instanceof HttpError ? err.message : 'assignment could not be completed'
    // Logged loudly, not swallowed. The parcel is still booked and visible.
    console.warn(
      `[assignment] delivery ${args.deliveryId} left unassigned — ${reason}`,
    )
    return { assigned: false, reason }
  }
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
      .select('user vehicle zones currentLocation status approvalStatus')
      .lean<(AgentRow & { status: string; approvalStatus: string }) | null>()
      .exec()

    if (!agent) throw new HttpError(404, 'agent not found')
    /**
     * An admin choosing a specific rider is still bound by the same rule
     * suggestAgents enforces automatically: pending and rejected riders are
     * not assignable, full stop. Checked before the offline check so the
     * message names the actual reason rather than a coincidental one.
     */
    if (agent.approvalStatus !== 'approved') {
      throw new HttpError(422, `that rider's application is ${agent.approvalStatus} and cannot be assigned`)
    }
    if (agent.status === 'offline') {
      throw new HttpError(422, 'that rider is offline and cannot be assigned')
    }

    const [candidate] = await withNames([agent], null)
    if (!candidate) throw new HttpError(500, 'agent could not be resolved')
    return candidate
  })
}
