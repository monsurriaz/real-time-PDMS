import { Router } from 'express'
import mongoose from 'mongoose'
import {
  MESSAGE_RETENTION_LIMIT,
  postMessageInputSchema,
  type MessageBroadcast,
  type MessageSenderRole,
  type MessageThread,
  type MessageView,
} from '@pdms/shared'
import { runAsSystem, type Actor } from '../lib/context'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { MessageModel } from '../models/Message'
import { ParcelModel } from '../models/Parcel'
import { UserModel } from '../models/User'
import { requireAuth } from '../middleware/auth'
import { HttpError, unauthorized } from '../middleware/httpError'
import { broadcast } from '../sockets/broadcast'

export const messagesRouter = Router()

/**
 * Customer <-> rider chat, one thread per delivery (M9). Reuses the parcel:
 * {id} socket room and its existing role scoping wholesale — see Message.ts's
 * own note, and the M6 socket-room bypass this is written not to repeat.
 *
 * Window: opens at PickedUp, closes the moment the delivery reaches any
 * terminal state. Enforced HERE, server-side, on every post — a stale client
 * still showing the input is not enough to get a message through.
 */

const objectIdParam = (raw: string | undefined): string => {
  if (!raw || !mongoose.Types.ObjectId.isValid(raw)) {
    throw new HttpError(400, 'not a valid id')
  }
  return raw
}

/** The only statuses a thread is open for posting during. */
const OPEN_STATUSES = ['PickedUp', 'InTransit'] as const

interface DeliveryForThread {
  _id: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  agent: mongoose.Types.ObjectId | null
  status: string
}

interface ThreadContext {
  delivery: DeliveryForThread
  /**
   * Whether the window is objectively open (PickedUp/InTransit) — a fact
   * about the DELIVERY, the same for every viewer. `GET` reports this
   * verbatim so a client can tell "not open yet" from "already closed" from
   * "an admin is looking", rather than folding all three into one boolean.
   */
  open: boolean
  /** Whether THIS caller may post right now. Never true for admin. */
  canWrite: boolean
}

/**
 * Load the delivery UNSCOPED, then decide standing explicitly — the same
 * "authorise, don't rely on a scoped 404" shape advanceStatus uses, so "not
 * yours" and "doesn't exist" are never confused with each other.
 */
const loadThreadContext = async (
  deliveryId: string,
  actor: Actor,
): Promise<ThreadContext> => {
  const delivery = await runAsSystem('messages: load delivery', async () =>
    DeliveryModel.findById(deliveryId)
      .select('parcel agent status')
      .lean<DeliveryForThread | null>()
      .exec(),
  )
  if (!delivery) throw new HttpError(404, 'delivery not found')

  const open = (OPEN_STATUSES as readonly string[]).includes(delivery.status)

  if (actor.role === 'admin') {
    return { delivery, open, canWrite: false }
  }

  if (actor.role === 'customer') {
    const owns = await runAsSystem('messages: customer owns parcel', async () => {
      const parcel = await ParcelModel.findById(delivery.parcel)
        .select('customer')
        .lean<{ customer: mongoose.Types.ObjectId } | null>()
        .exec()
      return parcel?.customer.equals(new mongoose.Types.ObjectId(actor.id)) === true
    })
    if (!owns) throw new HttpError(403, 'this is not your parcel')
    return { delivery, open, canWrite: open }
  }

  // actor.role === 'agent'
  const ownsIt = await runAsSystem('messages: agent owns delivery', async () => {
    const agent = await AgentModel.findOne({ user: new mongoose.Types.ObjectId(actor.id) })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId } | null>()
      .exec()
    return agent !== null && delivery.agent?.equals(agent._id) === true
  })
  if (!ownsIt) throw new HttpError(403, 'this delivery is not assigned to you')
  return { delivery, open, canWrite: open }
}

interface MessageRow {
  _id: mongoose.Types.ObjectId
  delivery: mongoose.Types.ObjectId
  parcel: mongoose.Types.ObjectId
  sender: mongoose.Types.ObjectId
  senderRole: MessageSenderRole
  body: string
  createdAt: Date
  updatedAt: Date
}

/** Resolve every sender's display name in one query, not one per message. */
const withSenderNames = async (rows: MessageRow[]): Promise<MessageView[]> => {
  const ids = [...new Set(rows.map((r) => r.sender.toString()))]
  const names = await runAsSystem('messages: sender names', async () => {
    const users = await UserModel.find({ _id: { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('name')
      .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>()
      .exec()
    return new Map(users.map((u) => [u._id.toString(), u.name]))
  })

  return rows.map((r) => ({
    _id: r._id.toString(),
    delivery: r.delivery.toString(),
    parcel: r.parcel.toString(),
    sender: r.sender.toString(),
    senderRole: r.senderRole,
    senderName: names.get(r.sender.toString()) ?? 'Unknown',
    body: r.body,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }))
}

/** GET /messages/:deliveryId — the thread, plus whether it's still open. */
messagesRouter.get('/:deliveryId', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    const deliveryId = objectIdParam(req.params.deliveryId)

    const { delivery, open } = await loadThreadContext(deliveryId, actor)

    const rows = await runAsSystem('messages: load thread', async () =>
      MessageModel.find({ delivery: delivery._id })
        .sort({ createdAt: 1 })
        .select('delivery parcel sender senderRole body createdAt updatedAt')
        .lean<MessageRow[]>()
        .exec(),
    )

    const thread: MessageThread = {
      messages: await withSenderNames(rows),
      open,
      readOnly: actor.role === 'admin',
    }
    res.json(thread)
  } catch (err) {
    next(err)
  }
})

/**
 * POST /messages/:deliveryId — post one message.
 *
 * Rejected the moment the window is closed — before PickedUp, or once the
 * delivery is Delivered/Cancelled/Failed — even if a stale client still
 * shows the input.
 */
messagesRouter.post('/:deliveryId', requireAuth, async (req, res, next) => {
  try {
    const actor = req.actor
    if (!actor) throw unauthorized()
    if (actor.role === 'admin') {
      throw new HttpError(403, 'an admin can read this thread but not post to it')
    }
    const deliveryId = objectIdParam(req.params.deliveryId)
    const input = postMessageInputSchema.parse(req.body)

    const { delivery, canWrite } = await loadThreadContext(deliveryId, actor)
    if (!canWrite) {
      throw new HttpError(
        422,
        'this thread is closed — messaging is only open between pickup and delivery',
      )
    }

    const row = await runAsSystem('messages: create', async () => {
      const doc = await MessageModel.create({
        delivery: delivery._id,
        parcel: delivery.parcel,
        sender: new mongoose.Types.ObjectId(actor.id),
        senderRole: actor.role,
        body: input.body,
      })

      /**
       * Retention cap: prune anything past the newest MESSAGE_RETENTION_LIMIT
       * for this delivery — the same reasoning CLAUDE.md section 6 gives for
       * capping location history, so a long-running delivery's chat cannot
       * grow this collection without bound.
       */
      const count = await MessageModel.countDocuments({ delivery: delivery._id }).exec()
      if (count > MESSAGE_RETENTION_LIMIT) {
        const stale = await MessageModel.find({ delivery: delivery._id })
          .sort({ createdAt: 1 })
          .limit(count - MESSAGE_RETENTION_LIMIT)
          .select('_id')
          .lean<Array<{ _id: mongoose.Types.ObjectId }>>()
          .exec()
        await MessageModel.deleteMany({ _id: { $in: stale.map((s) => s._id) } }).exec()
      }

      // Re-selected lean rather than read off `doc` directly: Doc<> omits
      // createdAt/updatedAt from the mapped type (see models/types.ts), so a
      // fresh, explicitly-typed read is the documented way to get them back.
      return MessageModel.findById(doc._id)
        .select('delivery parcel sender senderRole body createdAt updatedAt')
        .lean<MessageRow | null>()
        .exec()
    })
    if (!row) throw new HttpError(500, 'message could not be resolved')

    const [withName] = await withSenderNames([row])
    if (!withName) throw new HttpError(500, 'message could not be resolved')

    const broadcastPayload: MessageBroadcast = {
      ...withName,
      parcelId: delivery.parcel.toString(),
    }
    broadcast.message(broadcastPayload)

    res.status(201).json({ message: withName })
  } catch (err) {
    next(err)
  }
})
