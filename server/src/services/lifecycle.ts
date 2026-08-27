import mongoose from 'mongoose'
import {
  TERMINAL_STATUSES,
  type DeliveryStatus,
  type GeoPoint,
  type Role,
} from '@pdms/shared'
import type { Actor } from '../lib/context'
import { runAsSystem } from '../lib/context'
import { env } from '../lib/env'
import { DeliveryModel, LIFECYCLE_WRITE } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { HttpError } from '../middleware/httpError'
import { broadcast } from '../sockets/broadcast'
import { syncCodOnTransition } from './payments'

/**
 * THE state machine. CLAUDE.md section 5: legal transitions live in one map
 * here, every status change goes through advanceStatus(), and no route
 * mutates status directly.
 *
 *   Booked -> Assigned(offered) -> Accepted -> PickedUp -> InTransit -> Delivered   (terminal)
 *                        \-> Cancelled (before PickedUp only)
 *                        \-> Failed    (from InTransit only)
 *   Assigned -> Booked    (declined by the offered rider, or the offer expired)
 *   Accepted -> Assigned  (admin reassigns before pickup — a fresh offer)
 *
 * M8: `Assigned` changed meaning. It used to mean "a rider has this"; it now
 * means "offered to a rider, awaiting their response" — `Accepted` is the
 * state that means the rider actually took the job. Everything downstream
 * that used to treat bare `Assigned` as committed load (workload tie-break,
 * the GPS-publish gate, a rider's own active-count) now keys off `Accepted`
 * instead — see the ACTIVE_STATUSES-style constants in assignment.ts,
 * agents.ts, sockets/index.ts and simulate.ts. Anything that means "still
 * open, not yet finished" (notifications, analytics, the customer's rail
 * count) adds `Accepted` alongside the `Assigned` it already had, since both
 * are "not delivered yet" from that angle.
 */

/**
 * What may follow what. Terminal states map to an empty list, which is what
 * makes "no transition leaves a terminal state" a property of the data rather
 * than a special case in the code.
 */
export const LEGAL_TRANSITIONS: Record<
  DeliveryStatus,
  readonly DeliveryStatus[]
> = {
  Booked: ['Assigned', 'Cancelled'],
  // Accepted: the offered rider took it. Booked: they declined, or the offer
  // expired — either way back to the pool, unassigned. Cancelled: still
  // before PickedUp, so still allowed.
  Assigned: ['Accepted', 'Booked', 'Cancelled'],
  // Assigned: an admin reassigns before pickup — a FRESH offer to someone
  // else, so the new rider starts at Assigned (offered), not Accepted.
  Accepted: ['PickedUp', 'Assigned', 'Cancelled'],
  // Not Cancelled: the parcel is in our hands now. Not Failed either — that
  // is InTransit-only.
  PickedUp: ['InTransit'],
  InTransit: ['Delivered', 'Failed'],
  Delivered: [],
  Cancelled: [],
  Failed: [],
}

/**
 * WHO may drive a transition, kept separate from whether the transition is
 * legal at all. Two questions, two maps: conflating them makes it impossible
 * to state "this move is valid but you may not make it".
 *
 * - An agent moves their own delivery through the physical steps.
 * - A customer may cancel their own parcel while nobody has collected it.
 * - An admin can do anything the state machine permits, because someone has
 *   to be able to unstick a delivery during a demo — EXCEPT Accepted and
 *   this Booked edge (M8): "only the assigned rider may accept or decline"
 *   is explicit, so admin is deliberately left off both. An admin can still
 *   reassign (a fresh Assigned offer) or cancel outright; they cannot answer
 *   an offer on a rider's behalf.
 */
export const TRANSITION_AUTHORITY: Record<DeliveryStatus, readonly Role[]> = {
  Assigned: ['admin'],
  Accepted: ['agent'],
  // Reached only from Assigned (a decline) — 'system' bypasses this check
  // entirely, which is how an expired offer returns to Booked with no actor.
  Booked: ['agent'],
  PickedUp: ['agent', 'admin'],
  InTransit: ['agent', 'admin'],
  Delivered: ['agent', 'admin'],
  Failed: ['agent', 'admin'],
  Cancelled: ['customer', 'admin'],
}

/**
 * How long after booking a parcel is promised.
 *
 * CLAUDE.md does not state a service level, so this is an assumption made in
 * one place rather than scattered: `delivery.expectedBy` is booking time plus
 * this, and everything that says "delayed" — the admin alert, the board's
 * overdue flag — reads that field rather than re-deriving a deadline.
 *
 * If the promise ever needs to differ by zone or by weight it belongs in
 * PricingConfig beside the rates, where an admin can edit it without a deploy.
 * One number in one file is the honest version of "we have not decided that
 * yet"; six copies of `24 * 3_600_000` would not be.
 */
export const PROMISED_WINDOW_HOURS = 24

export const promisedBy = (bookedAt: Date): Date =>
  new Date(bookedAt.getTime() + PROMISED_WINDOW_HOURS * 3_600_000)

export const isTerminal = (s: DeliveryStatus): boolean =>
  (TERMINAL_STATUSES as readonly DeliveryStatus[]).includes(s)

export const canTransition = (
  from: DeliveryStatus,
  to: DeliveryStatus,
): boolean => LEGAL_TRANSITIONS[from].includes(to)

/** Why a transition was refused, in words an agent's phone can display. */
export class TransitionError extends HttpError {
  readonly from: DeliveryStatus
  readonly to: DeliveryStatus

  constructor(
    status: number,
    message: string,
    from: DeliveryStatus,
    to: DeliveryStatus,
  ) {
    super(status, message)
    this.name = 'TransitionError'
    this.from = from
    this.to = to
  }
}

/**
 * Who is driving a transition. `'system'` is the server acting on its own —
 * auto-assignment right after booking is the only case today.
 *
 * A distinct value rather than a borrowed admin identity, because the event
 * log has to stay truthful: /shared's DeliveryEvent already models `actor` as
 * nullable so that "the system did this" is representable, and stamping the
 * booking customer's id with role 'admin' would make TRANSITION_AUTHORITY a
 * lie in the audit trail.
 */
export type TransitionActor = Actor | 'system'

export interface AdvanceArgs {
  deliveryId: string
  to: DeliveryStatus
  actor: TransitionActor
  /** Where the actor was. Riders have GPS; admins do not. */
  point?: GeoPoint
  note?: string
}

interface DeliverySnapshot {
  _id: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  agent: mongoose.Types.ObjectId | null
  status: DeliveryStatus
  proofOfDelivery?: unknown
  offerExpiresAt?: Date | null
}

/**
 * Which timestamp column a transition fills. Kept as data so adding a state
 * does not mean finding every `if` that sets a date.
 */
const TIMESTAMP_FIELD: Partial<Record<DeliveryStatus, string>> = {
  Assigned: 'assignedAt',
  Accepted: 'acceptedAt',
  PickedUp: 'pickedUpAt',
  Delivered: 'deliveredAt',
}

/**
 * M8: how long a fresh offer stays open, in milliseconds. Read at the moment
 * an offer is made (see `advanceStatus`'s write step) and snapshotted onto
 * `offerExpiresAt`, the same way a price is snapshotted onto a parcel — a
 * later config change must not retroactively shorten an offer already in
 * flight. `OFFER_WINDOW_MINUTES` in `.env` — see that file's comment for how
 * to shorten it for a demo.
 */
export const offerWindowMs = (): number => env.OFFER_WINDOW_MINUTES * 60_000

/** Has this delivery's outstanding offer passed its deadline? */
export const isOfferExpired = (d: {
  status: DeliveryStatus
  offerExpiresAt?: Date | null
}): boolean =>
  d.status === 'Assigned' && Boolean(d.offerExpiresAt) && d.offerExpiresAt!.getTime() < Date.now()

/**
 * The one way a delivery's status changes.
 *
 * The update is conditional on the status we validated against, so two agents
 * tapping at once cannot both succeed — the second finds the row already
 * moved and is told so, rather than appending a second contradictory event.
 */
export const advanceStatus = async (
  args: AdvanceArgs,
): Promise<{ status: DeliveryStatus; at: Date }> => {
  const { deliveryId, to, actor, point, note } = args

  if (!mongoose.Types.ObjectId.isValid(deliveryId)) {
    throw new HttpError(400, 'not a valid delivery id')
  }

  // Read unscoped, then authorise explicitly. Relying on role scoping to hide
  // the row would turn "not yours" into a confusing 404 and would not stop an
  // admin-shaped mistake.
  const delivery = await runAsSystem('lifecycle: load delivery', async () =>
    DeliveryModel.findById(deliveryId)
      .select('parcel agent status proofOfDelivery offerExpiresAt')
      .lean<DeliverySnapshot | null>()
      .exec(),
  )
  if (!delivery) throw new HttpError(404, 'delivery not found')

  const from = delivery.status

  // ---- 1. is the move legal at all? ----
  if (isTerminal(from)) {
    throw new TransitionError(
      409,
      `this delivery is already ${from} and cannot change`,
      from,
      to,
    )
  }
  if (from === to) {
    throw new TransitionError(409, `already ${from}`, from, to)
  }
  if (!canTransition(from, to)) {
    const allowed = LEGAL_TRANSITIONS[from]
    throw new TransitionError(
      422,
      allowed.length > 0
        ? `cannot go from ${from} to ${to} — only ${allowed.join(' or ')}`
        : `cannot leave ${from}`,
      from,
      to,
    )
  }

  // ---- 2. may THIS actor make it? ----
  // The system is trusted: it is the server itself, and it only reaches here
  // for transitions the map above has already validated.
  if (actor !== 'system' && !TRANSITION_AUTHORITY[to].includes(actor.role)) {
    throw new TransitionError(
      403,
      `a ${actor.role} cannot move a delivery to ${to}`,
      from,
      to,
    )
  }

  // An agent may only touch their own assignment; a customer only their own
  // parcel. Admins are unrestricted.
  if (actor !== 'system' && actor.role === 'agent') {
    const ownsIt = await runAsSystem('lifecycle: agent owns delivery', async () => {
      const AgentModel = mongoose.model('Agent')
      const agent = await AgentModel.findOne({
        user: new mongoose.Types.ObjectId(actor.id),
      })
        .select('_id')
        .lean<{ _id: mongoose.Types.ObjectId } | null>()
        .exec()
      return agent !== null && delivery.agent?.equals(agent._id) === true
    })
    if (!ownsIt) {
      throw new TransitionError(403, 'this delivery is not assigned to you', from, to)
    }
  }

  if (actor !== 'system' && actor.role === 'customer') {
    const ownsIt = await runAsSystem('lifecycle: customer owns parcel', async () => {
      const parcel = await ParcelModel.findById(delivery.parcel)
        .select('customer')
        .lean<{ customer: mongoose.Types.ObjectId } | null>()
        .exec()
      return parcel?.customer.equals(new mongoose.Types.ObjectId(actor.id)) === true
    })
    if (!ownsIt) {
      throw new TransitionError(403, 'this is not your parcel', from, to)
    }
  }

  // ---- 3. state-specific preconditions ----
  if (to === 'Delivered' && !delivery.proofOfDelivery) {
    /**
     * Section 5: "Delivered requires proof of delivery already stored on the
     * record." Read, never accepted alongside the transition — otherwise the
     * proof and the status could be written from different intentions.
     */
    throw new TransitionError(
      422,
      'record proof of delivery before marking this delivered',
      from,
      to,
    )
  }
  if (to === 'Failed' && !note?.trim()) {
    // A failed delivery with no stated reason is unreconcilable later.
    throw new TransitionError(422, 'a failure needs a reason', from, to)
  }
  if (to === 'Accepted' && isOfferExpired(delivery)) {
    /**
     * A defensive race guard, not the expiry mechanism itself (that is
     * evaluation-on-read, at each read path). This only catches the narrow
     * window where a rider's Accept tap lands after the deadline but before
     * any read has re-evaluated it — refusing here rather than accepting is
     * what makes the deadline real rather than advisory.
     */
    throw new TransitionError(409, 'this offer has expired', from, to)
  }

  // ---- 4. append the event and move ----
  const at = new Date()
  const timestampField = TIMESTAMP_FIELD[to]

  /**
   * M8: moving TO Assigned is always a FRESH offer — the first one (from
   * Booked) or a reassignment's new one (from Accepted, or a different rider
   * while still Assigned) — so it always gets a new deadline.
   *
   * Moving TO Booked is only ever reachable from Assigned (the map above is
   * what guarantees that), and only ever means "the offer didn't stick" — a
   * decline (actor is the agent) or an expiry (actor is 'system'). Either
   * way: unassign, close out the offer window, and remember who let it go so
   * they are never offered this SAME delivery again.
   */
  const isFreshOffer = to === 'Assigned'
  const isOfferFallthrough = to === 'Booked'

  const updated = await runAsSystem('lifecycle: advance', async () =>
    DeliveryModel.findOneAndUpdate(
      // Conditional on `from`: this is the optimistic lock.
      { _id: delivery._id, status: from },
      {
        $set: {
          status: to,
          ...(timestampField ? { [timestampField]: at } : {}),
          ...(to === 'Failed' && note ? { failureReason: note.trim() } : {}),
          ...(point ? { lastKnownLocation: point, lastLocationAt: at } : {}),
          ...(isFreshOffer ? { offerExpiresAt: new Date(at.getTime() + offerWindowMs()) } : {}),
          ...(isOfferFallthrough ? { agent: null, offerExpiresAt: null } : {}),
        },
        // $push, never $set — delivery.events is append-only and the model
        // rejects any other operator against it.
        $push: {
          events: {
            status: to,
            at,
            // Null actor + null role reads as "the system did this".
            actor: actor === 'system' ? null : new mongoose.Types.ObjectId(actor.id),
            actorRole: actor === 'system' ? null : actor.role,
            ...(point ? { point } : {}),
            ...(note?.trim() ? { note: note.trim() } : {}),
          },
          ...(isOfferFallthrough && delivery.agent ? { excludedAgents: delivery.agent } : {}),
        },
      },
      // The marker that identifies this as THE lifecycle write. Delivery's
      // pre-hook refuses any status change that arrives without it.
      { new: true, [LIFECYCLE_WRITE]: true },
    )
      .select('status')
      .lean<{ status: DeliveryStatus } | null>()
      .exec(),
  )

  if (!updated) {
    // The filter matched nothing, so status changed under us.
    throw new TransitionError(
      409,
      'this delivery just changed status — reload and try again',
      from,
      to,
    )
  }

  await syncAgentAvailability(delivery.agent, to)

  /**
   * The COD ledger follows the lifecycle, for the same reason availability
   * does: this is the single status path, so anything that must happen when a
   * delivery finishes hangs off it rather than off whichever route triggered
   * it. Delivered means the rider is holding cash; Failed and Cancelled mean
   * nobody ever will.
   */
  await syncCodOnTransition({
    parcelId: delivery.parcel,
    agentId: delivery.agent,
    to,
  })

  /**
   * Section 6: the server broadcasts status:changed to the parcel's room.
   *
   * Announced from here rather than from each route, so advanceStatus stays
   * the single path — a transition cannot happen without the room hearing
   * about it. Goes through the broadcaster registry, so this file never
   * imports the socket server (and unit tests need no socket at all).
   */
  const agentName = await riderName(delivery.agent)
  broadcast.statusChanged({
    deliveryId: delivery._id.toString(),
    parcelId: delivery.parcel.toString(),
    status: to,
    at,
    agentName,
    ...(note?.trim() ? { note: note.trim() } : {}),
  })

  return { status: updated.status, at }
}

/** The rider's display name, for the status event's payload. */
const riderName = async (
  agentId: mongoose.Types.ObjectId | null,
): Promise<string | null> => {
  if (!agentId) return null
  return runAsSystem('lifecycle: rider name', async () => {
    const AgentModel = mongoose.model('Agent')
    const UserModel = mongoose.model('User')
    const agent = await AgentModel.findById(agentId)
      .select('user')
      .lean<{ user: mongoose.Types.ObjectId } | null>()
      .exec()
    if (!agent) return null
    const user = await UserModel.findById(agent.user)
      .select('name')
      .lean<{ name: string } | null>()
      .exec()
    return user?.name ?? null
  })
}

/**
 * Keep the rider's availability in step with what they are carrying.
 *
 * Not stated in CLAUDE.md — an inference, but a load-bearing one: section 5
 * filters assignment to `status: 'available'`, so if availability never
 * changed, one rider would absorb every parcel in their zone and the $near
 * query would keep returning the same person. Flipping on PickedUp rather
 * than Assigned lets a rider hold several upcoming jobs but only one in hand.
 */
const syncAgentAvailability = async (
  agentId: mongoose.Types.ObjectId | null,
  to: DeliveryStatus,
): Promise<void> => {
  if (!agentId) return

  const next =
    to === 'PickedUp'
      ? 'on_delivery'
      : to === 'Delivered' || to === 'Failed'
        ? 'available'
        : null
  if (!next) return

  await runAsSystem('lifecycle: agent availability', async () => {
    const AgentModel = mongoose.model('Agent')
    /**
     * An offline rider stays offline. Being handed a delivery is not consent
     * to be put back on shift, and silently flipping them available would
     * make them a candidate for further assignments.
     */
    await AgentModel.updateOne(
      { _id: agentId, status: { $ne: 'offline' } },
      { $set: { status: next } },
    ).exec()
  })
}

/**
 * The transitions this actor could make right now. The agent UI uses it to
 * decide which buttons to show — a convenience only, since advanceStatus
 * re-checks everything (rule 3: the client never decides what is legal).
 */
export const availableTransitions = (
  from: DeliveryStatus,
  role: Role,
): readonly DeliveryStatus[] =>
  LEGAL_TRANSITIONS[from].filter((to) => TRANSITION_AUTHORITY[to].includes(role))

/**
 * M8's offer expiry, evaluated on read rather than on a schedule (Render's
 * free tier sleeps after 15 minutes idle, so cron/setInterval would not
 * reliably fire). Every read path that lists or loads a delivery — the admin
 * board, an agent's runs, a tracking screen — calls this on each row first,
 * so an expired offer is caught the moment anyone actually looks at it.
 *
 * Idempotent by construction, not by a separate check: advanceStatus's own
 * optimistic lock (conditional on `status: from`) means a second concurrent
 * call finds the row already moved and throws a 409 — caught here and
 * treated as "already expired", never as a real error. Two reads racing to
 * expire the same offer cannot double-apply it.
 */
export const evaluateOfferExpiry = async (d: {
  _id: mongoose.Types.ObjectId | string
  status: DeliveryStatus
  offerExpiresAt?: Date | null
}): Promise<DeliveryStatus> => {
  if (!isOfferExpired(d)) return d.status
  try {
    const result = await advanceStatus({
      deliveryId: d._id.toString(),
      to: 'Booked',
      actor: 'system',
      note: 'Offer expired',
    })
    return result.status
  } catch (err) {
    // A concurrent read already applied the same expiry — the outcome is the
    // same either way, so this is not a failure worth surfacing.
    if (err instanceof TransitionError) return 'Booked'
    throw err
  }
}
