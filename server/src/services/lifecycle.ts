import mongoose from 'mongoose'
import {
  TERMINAL_STATUSES,
  type DeliveryStatus,
  type GeoPoint,
  type Role,
} from '@pdms/shared'
import type { Actor } from '../lib/context'
import { runAsSystem } from '../lib/context'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { HttpError } from '../middleware/httpError'

/**
 * THE state machine. CLAUDE.md section 5: legal transitions live in one map
 * here, every status change goes through advanceStatus(), and no route
 * mutates status directly.
 *
 *   Booked -> Assigned -> PickedUp -> InTransit -> Delivered   (terminal)
 *                     \-> Cancelled (before PickedUp only)
 *                     \-> Failed    (from InTransit only)
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
  // Cancelled is reachable from Assigned because section 5 allows it "before
  // PickedUp", and Assigned is before PickedUp.
  Assigned: ['PickedUp', 'Cancelled'],
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
 *   to be able to unstick a delivery during a demo.
 */
export const TRANSITION_AUTHORITY: Record<DeliveryStatus, readonly Role[]> = {
  Assigned: ['admin'],
  PickedUp: ['agent', 'admin'],
  InTransit: ['agent', 'admin'],
  Delivered: ['agent', 'admin'],
  Failed: ['agent', 'admin'],
  Cancelled: ['customer', 'admin'],
  Booked: [], // only creation produces Booked
}

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

export interface AdvanceArgs {
  deliveryId: string
  to: DeliveryStatus
  actor: Actor
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
}

/**
 * Which timestamp column a transition fills. Kept as data so adding a state
 * does not mean finding every `if` that sets a date.
 */
const TIMESTAMP_FIELD: Partial<Record<DeliveryStatus, string>> = {
  Assigned: 'assignedAt',
  PickedUp: 'pickedUpAt',
  Delivered: 'deliveredAt',
}

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
      .select('parcel agent status proofOfDelivery')
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
  if (!TRANSITION_AUTHORITY[to].includes(actor.role)) {
    throw new TransitionError(
      403,
      `a ${actor.role} cannot move a delivery to ${to}`,
      from,
      to,
    )
  }

  // An agent may only touch their own assignment; a customer only their own
  // parcel. Admins are unrestricted.
  if (actor.role === 'agent') {
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

  if (actor.role === 'customer') {
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

  // ---- 4. append the event and move ----
  const at = new Date()
  const timestampField = TIMESTAMP_FIELD[to]

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
        },
        // $push, never $set — delivery.events is append-only and the model
        // rejects any other operator against it.
        $push: {
          events: {
            status: to,
            at,
            actor: new mongoose.Types.ObjectId(actor.id),
            actorRole: actor.role,
            ...(point ? { point } : {}),
            ...(note?.trim() ? { note: note.trim() } : {}),
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
    // The filter matched nothing, so status changed under us.
    throw new TransitionError(
      409,
      'this delivery just changed status — reload and try again',
      from,
      to,
    )
  }

  await syncAgentAvailability(delivery.agent, to)

  return { status: updated.status, at }
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
