/**
 * Drives a rider's GPS along a real Dhaka route, emitting location:update over
 * the socket exactly as a phone would.
 *
 *   npm run simulate -- --delivery <id>
 *   npm run simulate -- --delivery <id> --speed 20
 *   npm run simulate -- --tracking PD-SEED-10 --speed 20
 *
 * Without this the flagship feature is undemoable: nobody is riding a
 * motorbike around Mirpur during the presentation. --speed replays a
 * 40-minute route in a minute or two.
 *
 * The route geometry is real — OpenRouteService's road path between the
 * parcel's two geocoded points, cached like every other ORS call — so the
 * marker follows actual streets rather than a straight line across the city.
 */
import { parseArgs } from 'node:util'
import mongoose from 'mongoose'
import { io, type Socket } from 'socket.io-client'
import {
  LOCATION_MIN_INTERVAL_MS,
  SOCKET_EVENTS,
  type GeoPoint,
  type LocationUpdate,
} from '@pdms/shared'
import { connectDb, disconnectDb } from '../server/src/lib/db'
import { runAsSystem } from '../server/src/lib/context'
import { env } from '../server/src/lib/env'
import { routeGeometry } from '../server/src/lib/routing'
import { DeliveryModel, ParcelModel, UserModel } from '../server/src/models'

const { values } = parseArgs({
  options: {
    delivery: { type: 'string' },
    tracking: { type: 'string' },
    speed: { type: 'string', default: '1' },
    password: { type: 'string', default: 'pdms-demo-2026' },
  },
})

const speedMultiplier = Math.max(0.1, Number(values.speed) || 1)
const API = `http://localhost:${env.PORT}`

const log = (msg: string): void => {
  const t = new Date().toLocaleTimeString('en-GB')
  console.log(`  ${t}  ${msg}`)
}

/** Metres between two points, for reporting progress. */
const metresBetween = (a: GeoPoint, b: GeoPoint): number => {
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

/** Bearing in degrees, so the marker can face the direction of travel. */
const bearing = (a: GeoPoint, b: GeoPoint): number => {
  const toRad = (d: number): number => (d * Math.PI) / 180
  const [lng1, lat1] = a.coordinates
  const [lng2, lat2] = b.coordinates
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1))
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360
}

/**
 * Walk the route at a fixed spacing so ticks are evenly spaced on the ground
 * rather than clustered where ORS happened to emit dense geometry.
 */
const resample = (line: GeoPoint[], stepMetres: number): GeoPoint[] => {
  if (line.length < 2) return line
  const out: GeoPoint[] = [line[0] as GeoPoint]
  let carry = 0

  for (let i = 1; i < line.length; i += 1) {
    const from = line[i - 1] as GeoPoint
    const to = line[i] as GeoPoint
    const segment = metresBetween(from, to)
    if (segment === 0) continue

    let travelled = stepMetres - carry
    while (travelled <= segment) {
      const f = travelled / segment
      out.push({
        type: 'Point',
        coordinates: [
          from.coordinates[0] + (to.coordinates[0] - from.coordinates[0]) * f,
          from.coordinates[1] + (to.coordinates[1] - from.coordinates[1]) * f,
        ],
      })
      travelled += stepMetres
    }
    carry = segment - (travelled - stepMetres)
  }

  const last = line.at(-1)
  if (last) out.push(last)
  return out
}

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms))

const main = async (): Promise<void> => {
  await connectDb()

  // ---- resolve the delivery ----
  const delivery = await runAsSystem('simulate: load', async () => {
    if (values.delivery) {
      if (!mongoose.Types.ObjectId.isValid(values.delivery)) {
        throw new Error(`not a valid delivery id: ${values.delivery}`)
      }
      return DeliveryModel.findById(values.delivery).lean().exec()
    }
    if (values.tracking) {
      const parcel = await ParcelModel.findOne({ trackingId: values.tracking })
        .select('_id')
        .lean()
        .exec()
      if (!parcel) throw new Error(`no parcel with tracking ID ${values.tracking}`)
      return DeliveryModel.findOne({ parcel: parcel._id }).lean().exec()
    }
    throw new Error('pass --delivery <id> or --tracking <PD-XXXX-XX>')
  })

  if (!delivery) throw new Error('delivery not found')
  if (!delivery.agent) {
    throw new Error('this delivery has no rider assigned — assign one first')
  }
  if (!['Accepted', 'PickedUp', 'InTransit'].includes(delivery.status)) {
    throw new Error(
      `delivery is ${delivery.status}; the server only accepts positions once a rider has accepted it`,
    )
  }

  const parcel = await runAsSystem('simulate: parcel', async () =>
    ParcelModel.findById(delivery.parcel).lean().exec(),
  )
  if (!parcel?.pickup.point || !parcel.drop.point) {
    throw new Error('parcel is missing geocoded pickup or drop coordinates')
  }

  // ---- who is the rider, so we can authenticate as them ----
  const rider = await runAsSystem('simulate: rider', async () => {
    const AgentModel = mongoose.model('Agent')
    const agent = await AgentModel.findById(delivery.agent)
      .select('user')
      .lean<{ user: mongoose.Types.ObjectId } | null>()
      .exec()
    if (!agent) return null
    return UserModel.findById(agent.user).select('email name').lean().exec()
  })
  if (!rider) throw new Error('could not resolve the rider for this delivery')

  console.log('')
  console.log(`  simulating  ${parcel.trackingId}`)
  console.log(`  rider       ${rider.name} <${rider.email}>`)
  console.log(`  route       ${parcel.pickup.area} -> ${parcel.drop.area}`)
  console.log(`  status      ${delivery.status}`)
  console.log(`  speed       ${speedMultiplier}x`)
  console.log('')

  // ---- real road geometry ----
  log('fetching road geometry from OpenRouteService…')
  const geometry = await routeGeometry(parcel.pickup.point, parcel.drop.point)
  log(`route has ${geometry.length} shape points`)

  /**
   * The cadence is fixed at the server's limit — one tick per 3 seconds
   * (section 6) — and --speed changes how far the rider moves between ticks,
   * not how often it emits. Emitting faster would simply get dropped: the
   * server rate-limits per agent and discards the excess rather than queueing
   * it, so a 20x run sending every 150ms would lose 19 ticks in 20 and the
   * marker would teleport.
   *
   * 30 km/h is about 8.3 m/s, so a real rider covers ~25 m in 3 seconds.
   * At Nx, each tick covers N times that.
   */
  const REALISTIC_MPS = 8.3
  const stepMetres = REALISTIC_MPS * (LOCATION_MIN_INTERVAL_MS / 1000) * speedMultiplier
  const tickMs = LOCATION_MIN_INTERVAL_MS

  const path = resample(geometry, stepMetres)
  const totalMetres = path.reduce(
    (sum, p, i) => (i === 0 ? 0 : sum + metresBetween(path[i - 1] as GeoPoint, p)),
    0,
  )
  log(
    `${path.length} ticks over ${(totalMetres / 1000).toFixed(2)} km — ` +
      `${Math.round(stepMetres)} m every ${(tickMs / 1000).toFixed(1)}s ` +
      `≈ ${((path.length * tickMs) / 1000).toFixed(0)}s total ` +
      `(real time would be ${((totalMetres / REALISTIC_MPS) / 60).toFixed(0)} min)`,
  )

  // ---- authenticate as the rider, exactly as the app does ----
  log(`logging in as ${rider.email}…`)
  const loginRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: rider.email, password: values.password }),
  })
  if (!loginRes.ok) {
    throw new Error(
      `login failed (${loginRes.status}). Is the server running on ${API}? Is --password right?`,
    )
  }
  const cookie = (loginRes.headers.getSetCookie?.() ?? [])
    .map((c) => c.split(';')[0])
    .join('; ')
  log('authenticated')

  // ---- connect the socket with that cookie, like a browser ----
  const socket: Socket = io(API, {
    transports: ['websocket'],
    extraHeaders: { cookie },
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('connect_error', (err) => reject(new Error(`socket refused: ${err.message}`)))
    setTimeout(() => reject(new Error('socket did not connect within 10s')), 10_000)
  })
  log(`socket connected (${socket.id})`)

  let sent = 0
  let accepted = 0
  let persisted = 0
  let rateLimited = 0

  /**
   * The server acks each tick. A rider is a publisher only (section 6), so it
   * is not in the room and never sees location:broadcast — the ack is the only
   * way the phone knows whether a tick landed.
   */
  const emitTick = (update: LocationUpdate): void => {
    socket.emit(
      SOCKET_EVENTS.locationUpdate,
      update,
      (r: { accepted: boolean; persisted: boolean; reason?: string }) => {
        if (r.accepted) {
          accepted += 1
          if (r.persisted) persisted += 1
        } else if (r.reason === 'rate limited') {
          rateLimited += 1
        }
      },
    )
  }

  const startedAt = Date.now()
  let travelled = 0

  for (let i = 0; i < path.length; i += 1) {
    const point = path[i] as GeoPoint
    const previous = i > 0 ? (path[i - 1] as GeoPoint) : point
    if (i > 0) travelled += metresBetween(previous, point)

    const update: LocationUpdate = {
      deliveryId: delivery._id.toString(),
      point,
      heading: Math.round(bearing(previous, point)),
      // The ground speed a real rider would have, not the replay speed.
      speed: REALISTIC_MPS,
      at: new Date(),
    }
    emitTick(update)
    sent += 1

    const pct = Math.round((travelled / Math.max(1, totalMetres)) * 100)
    log(
      `tick ${String(i + 1).padStart(3)}/${path.length}  ` +
        `${point.coordinates[1].toFixed(5)}, ${point.coordinates[0].toFixed(5)}  ` +
        `${(travelled / 1000).toFixed(2)}/${(totalMetres / 1000).toFixed(2)} km  ${pct}%`,
    )

    if (i < path.length - 1) await sleep(tickMs)
  }

  // Give the last broadcast a moment to come back before counting.
  await sleep(600)
  const elapsed = (Date.now() - startedAt) / 1000

  console.log('')
  console.log(`  done in ${elapsed.toFixed(0)}s`)
  console.log(`  ticks emitted              ${sent}`)
  console.log(`  accepted by the server     ${accepted}   (rate limit: 1 per 3s)`)
  console.log(`  dropped as rate-limited    ${rateLimited}`)
  console.log(`  written to Mongo           ${persisted}   (throttle: 1 per 30s)`)
  console.log(
    `  expected: accepted ~${Math.max(1, Math.floor(elapsed / 3))}, written ~${Math.max(1, Math.ceil(elapsed / 30))}`,
  )
  console.log('')

  socket.close()
  await disconnectDb()
}

main().catch(async (err: unknown) => {
  console.error(`\n  simulate failed: ${err instanceof Error ? err.message : String(err)}\n`)
  await mongoose.disconnect().catch(() => undefined)
  process.exit(1)
})
