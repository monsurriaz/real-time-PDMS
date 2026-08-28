import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import mongoose from 'mongoose'
import {
  LOCATION_MIN_INTERVAL_MS,
  LOCATION_PERSIST_INTERVAL_MS,
  SOCKET_EVENTS,
  locationUpdateSchema,
  objectId as objectIdSchema,
  type JoinResult,
  type LocationBroadcast,
} from '@pdms/shared'
import { runAsSystem, runInRequestContext, type Actor } from '../lib/context'
import { env } from '../lib/env'
import { AUTH_COOKIE, verifyToken } from '../lib/token'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { registerBroadcaster } from './broadcast'

/**
 * The real-time layer (CLAUDE.md section 6).
 *
 * Authentication reuses the JWT cookie from the REST layer — section 7 says
 * handshakes are authenticated, and a second auth mechanism would be a second
 * thing to get wrong.
 *
 * Room authorisation reuses the REST role scoping *literally*: joining
 * parcel:{id} runs a scoped query for that parcel inside the joiner's request
 * context. If the Mongoose middleware hides it, they cannot join. There is no
 * separate socket permission model to drift out of step.
 */

const room = (parcelId: string): string => `parcel:${parcelId}`

/** Read the auth cookie off the handshake without a cookie-parser detour. */
const tokenFromHandshake = (socket: Socket): string | null => {
  const raw = socket.handshake.headers.cookie
  if (!raw) return null
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === AUTH_COOKIE) return decodeURIComponent(rest.join('='))
  }
  return null
}

interface SocketActor {
  actor: Actor
}

/** Per-socket state, kept off the socket object's loose `data` typing. */
const actors = new WeakMap<Socket, SocketActor>()

/**
 * Section 6: at most one location:update per agent per 3 seconds, and excess
 * is DROPPED rather than queued. Queueing would replay a stale burst of
 * positions after the window, which is worse than losing them — the next real
 * tick is only three seconds away.
 */
const lastAccepted = new Map<string, number>()

/**
 * Section 6: a location reaches Mongo at most once per 30 seconds. Broadcast
 * on every accepted tick, persist on the slower cadence — the free tier will
 * not survive per-tick writes.
 */
const lastPersisted = new Map<string, number>()

/** Anything a socket may see is decided by the same scoping as the REST API. */
const mayJoin = async (actor: Actor, parcelId: string): Promise<boolean> =>
  new Promise((resolve) => {
    runInRequestContext(actor, () => {
      void ParcelModel.exists({ _id: new mongoose.Types.ObjectId(parcelId) })
        .then((found) => resolve(found !== null))
        .catch(() => resolve(false))
    })
  })

/** The delivery a rider is claiming to move, and whether it is really theirs. */
const agentOwnsDelivery = async (
  actor: Actor,
  deliveryId: string,
): Promise<{ ok: boolean; parcelId?: string }> =>
  runAsSystem('socket: agent owns delivery', async () => {
    const AgentModel = mongoose.model('Agent')
    const agent = await AgentModel.findOne({
      user: new mongoose.Types.ObjectId(actor.id),
    })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId } | null>()
      .exec()
    if (!agent) return { ok: false }

    const delivery = await DeliveryModel.findById(deliveryId)
      .select('agent parcel status')
      .lean<{
        agent: mongoose.Types.ObjectId | null
        parcel: mongoose.Types.ObjectId
        status: string
      } | null>()
      .exec()

    if (!delivery || !delivery.agent?.equals(agent._id)) return { ok: false }

    /**
     * Section 6: a rider publishes "while a delivery is active". A finished
     * parcel should not keep moving on a customer's map — and (M8) neither
     * should one merely OFFERED to them: bare 'Assigned' means awaiting a
     * response, not a rider who has agreed to carry anything yet.
     */
    if (!['Accepted', 'PickedUp', 'InTransit'].includes(delivery.status)) {
      return { ok: false }
    }

    return { ok: true, parcelId: delivery.parcel.toString() }
  })

export const createSocketServer = (httpServer: HttpServer): Server => {
  const io = new Server(httpServer, {
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
    // The client falls back to REST polling on its own, so socket.io's own
    // long-polling transport is left enabled only as a first-connect helper.
    transports: ['websocket', 'polling'],
  })

  /**
   * ---- handshake authentication (section 7) ----
   *
   * The account's status is checked here as well as in requireAuth, for the
   * same reason it is checked there rather than at login: a suspended
   * customer's cookie is still cryptographically valid, and a socket outlives
   * the request that opened it. Without this, suspending someone would close
   * nothing — they would keep receiving a rider's position for as long as the
   * tab stayed open.
   *
   * The check is on connect only, not per event. A live socket held by an
   * account suspended mid-stream survives until it reconnects, which is a gap
   * worth naming: closing it would mean either watching the collection or
   * re-reading the user on every GPS tick, and section 6's whole point is that
   * ticks do not touch Mongo.
   */
  io.use((socket, next) => {
    const token = tokenFromHandshake(socket)
    const claims = token ? verifyToken(token) : null
    if (!claims) {
      next(new Error('unauthorised'))
      return
    }
    void (async () => {
      const active = await runAsSystem('socket: account status', async () => {
        const user = await mongoose
          .model('User')
          .findById(claims.sub)
          .select('status')
          .lean<{ status?: string } | null>()
          .exec()
        if (!user) return false
        /**
         * `.lean()` skips the schema default, so an account created before
         * `status` existed comes back with the field simply absent — see
         * middleware/auth.ts's own note. Absent means active there; it has to
         * mean active here too, or every account seeded before M6.9
         * (every demo rider included) gets refused a socket connection
         * outright, which is exactly what was happening.
         */
        return (user.status ?? 'active') === 'active'
      })
      if (!active) {
        next(new Error('unauthorised'))
        return
      }
      actors.set(socket, { actor: { id: claims.sub, role: claims.role } })
      next()
    })()
  })

  io.on('connection', (socket) => {
    const entry = actors.get(socket)
    if (!entry) {
      socket.disconnect(true)
      return
    }
    const { actor } = entry

    socket.on(SOCKET_EVENTS.join, (raw: unknown, ack?: (r: JoinResult) => void) => {
      void (async () => {
        const parsed = objectIdSchema.safeParse(raw)
        if (!parsed.success) {
          ack?.({ parcelId: String(raw), ok: false, reason: 'not a valid parcel id' })
          return
        }
        const parcelId = parsed.data

        if (!(await mayJoin(actor, parcelId))) {
          // Same answer whether it does not exist or is not theirs — telling
          // them apart would leak which tracking IDs are real.
          ack?.({ parcelId, ok: false, reason: 'not found' })
          return
        }

        await socket.join(room(parcelId))
        ack?.({ parcelId, ok: true })
      })()
    })

    socket.on(SOCKET_EVENTS.leave, (raw: unknown) => {
      const parsed = objectIdSchema.safeParse(raw)
      if (parsed.success) void socket.leave(room(parsed.data))
    })

    /**
     * ---- the rider's GPS ticks ----
     *
     * The optional ack tells the publisher what happened to its tick. Section
     * 6 makes the agent a publisher only — they are not in the room and so
     * never see location:broadcast — which would otherwise leave the phone (and
     * the simulator) unable to report whether anything was accepted at all.
     */
    socket.on(
      SOCKET_EVENTS.locationUpdate,
      (raw: unknown, ack?: (r: { accepted: boolean; persisted: boolean; reason?: string }) => void) => {
      void (async () => {
        if (actor.role !== 'agent') {
          ack?.({ accepted: false, persisted: false, reason: 'only riders publish positions' })
          return
        }

        const parsed = locationUpdateSchema.safeParse(raw)
        if (!parsed.success) {
          ack?.({ accepted: false, persisted: false, reason: 'malformed update' })
          return
        }
        const update = parsed.data

        // ---- rate limit: drop, do not queue ----
        const now = Date.now()
        const previous = lastAccepted.get(actor.id) ?? 0
        if (now - previous < LOCATION_MIN_INTERVAL_MS) {
          ack?.({ accepted: false, persisted: false, reason: 'rate limited' })
          return
        }
        lastAccepted.set(actor.id, now)

        const owns = await agentOwnsDelivery(actor, update.deliveryId)
        if (!owns.ok || !owns.parcelId) {
          ack?.({ accepted: false, persisted: false, reason: 'not your active delivery' })
          return
        }

        // ---- persist on the slower cadence ----
        const lastWrite = lastPersisted.get(update.deliveryId) ?? 0
        const shouldPersist = now - lastWrite >= LOCATION_PERSIST_INTERVAL_MS
        if (shouldPersist) {
          lastPersisted.set(update.deliveryId, now)
          await runAsSystem('socket: persist location', async () =>
            DeliveryModel.updateOne(
              { _id: new mongoose.Types.ObjectId(update.deliveryId) },
              {
                $set: {
                  lastKnownLocation: update.point,
                  lastLocationAt: new Date(now),
                },
              },
            ).exec(),
          )
          await runAsSystem('socket: persist agent location', async () => {
            const AgentModel = mongoose.model('Agent')
            await AgentModel.updateOne(
              { user: new mongoose.Types.ObjectId(actor.id) },
              {
                $set: {
                  currentLocation: update.point,
                  locationUpdatedAt: new Date(now),
                },
              },
            ).exec()
          })
        }

        // ---- broadcast every accepted tick ----
        const payload: LocationBroadcast = {
          deliveryId: update.deliveryId,
          point: update.point,
          ...(update.heading === undefined ? {} : { heading: update.heading }),
          ...(update.speed === undefined ? {} : { speed: update.speed }),
          // Server clock, so ordering on the client is server ordering.
          at: new Date(now),
          persisted: shouldPersist,
        }
        io.to(room(owns.parcelId)).emit(SOCKET_EVENTS.locationBroadcast, payload)
        ack?.({ accepted: true, persisted: shouldPersist })
      })()
      },
    )

    socket.on('disconnect', () => {
      actors.delete(socket)
    })
  })

  /**
   * Let advanceStatus announce transitions without importing this module.
   * Keeps the lifecycle service the single path for status changes while still
   * satisfying section 6's status:changed broadcast.
   */
  registerBroadcaster({
    statusChanged: (payload) => {
      io.to(room(payload.parcelId)).emit(SOCKET_EVENTS.statusChanged, payload)
    },
    location: (payload) => {
      // Only used if something other than a socket tick produces a position.
      io.emit(SOCKET_EVENTS.locationBroadcast, payload)
    },
    // M9: a posted message, broadcast into the SAME parcel:{id} room chat
    // reuses wholesale — no second room topology, no second join handshake.
    message: (payload) => {
      io.to(room(payload.parcelId)).emit(SOCKET_EVENTS.messageNew, payload)
    },
  })

  return io
}

/** Exposed for the throttle tests. */
export const __throttleState = { lastAccepted, lastPersisted }
