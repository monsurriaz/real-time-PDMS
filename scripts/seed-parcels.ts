/**
 * The ~20 demo parcels from CLAUDE.md section 9, deferred from M1 because
 * they need geocoding and a price snapshot.
 *
 * Called by seed.ts after users and pricing exist.
 *
 * Idempotency works differently here than for users. A parcel's price is
 * immutable by design, so a seeded parcel cannot be updated in place — and
 * delivery.events is append-only, so its history cannot be rewritten either.
 * Instead every parcel whose tracking ID starts with PD-SEED- is deleted and
 * rebuilt, which makes `npm run seed` a "restore the demo to a known state"
 * command. Parcels booked through the UI have random tracking IDs and are
 * never touched.
 */
import mongoose from 'mongoose'
import type {
  DeliveryStatus,
  GeoPoint,
  ParcelSize,
  ZoneName,
} from '@pdms/shared'
import { geocodeAddress } from '../server/src/lib/geocode'
import { routeBetween } from '../server/src/lib/routing'
import { priceFor } from '../server/src/services/pricing'
import {
  AgentModel,
  DeliveryModel,
  ParcelModel,
  UserModel,
} from '../server/src/models'

/** Real places in the seeded zones, so Nominatim actually resolves them. */
interface Place {
  line1: string
  area: string
  zone: ZoneName
  contactName: string
  contactPhone: string
}

const PLACES: Record<string, Place> = {
  dhanmondi27: { line1: 'Road 27', area: 'Dhanmondi', zone: 'Dhanmondi', contactName: 'Nusrat Jahan', contactPhone: '01711000001' },
  dhanmondi9: { line1: 'Road 9A', area: 'Dhanmondi', zone: 'Dhanmondi', contactName: 'Rumana Haque', contactPhone: '01711000011' },
  gulshan1: { line1: 'Gulshan Avenue', area: 'Gulshan 1', zone: 'Gulshan', contactName: 'Tanvir Ahmed', contactPhone: '01711000002' },
  gulshan2: { line1: 'Road 113', area: 'Gulshan 2', zone: 'Gulshan', contactName: 'Farhan Chowdhury', contactPhone: '01711000012' },
  uttara7: { line1: 'Sector 7', area: 'Uttara', zone: 'Uttara', contactName: 'Sadia Islam', contactPhone: '01711000003' },
  uttara4: { line1: 'Sector 4', area: 'Uttara', zone: 'Uttara', contactName: 'Mahmudul Karim', contactPhone: '01711000013' },
  mirpur10: { line1: 'Mirpur 10', area: 'Mirpur', zone: 'Mirpur', contactName: 'Shahin Alam', contactPhone: '01711000014' },
  mirpur1: { line1: 'Mirpur 1', area: 'Mirpur', zone: 'Mirpur', contactName: 'Rehana Begum', contactPhone: '01711000015' },
  // "Block C, Bashundhara R/A" does not resolve in OSM; the spelled-out
  // residential-area name does. Verified against Nominatim rather than assumed.
  bashundhara: { line1: 'Block B', area: 'Bashundhara Residential Area', zone: 'Bashundhara', contactName: 'Ashiq Rahman', contactPhone: '01711000016' },
  mohammadpur: { line1: 'Ring Road', area: 'Mohammadpur', zone: 'Mohammadpur', contactName: 'Jubair Hossain', contactPhone: '01711000017' },
}

const place = (k: keyof typeof PLACES): Place => {
  const p = PLACES[k]
  if (!p) throw new Error(`unknown demo place: ${k}`)
  return p
}

interface Spec {
  n: number
  from: keyof typeof PLACES
  to: keyof typeof PLACES
  weightKg: number
  size: ParcelSize
  status: DeliveryStatus
  customer: 'nusrat' | 'tanvir' | 'sadia'
  /** Which seeded agent carries it, for anything past Booked. */
  agent?: 'rakib' | 'sabbir' | 'imran'
  isCod?: boolean
  codAmount?: number
  /** Hours since booking, so the board has a plausible spread. */
  agedHours: number
  /** Marks the delayed-looking one: expectedBy already in the past. */
  overdue?: boolean
  failureReason?: string
}

/**
 * Twenty parcels across every lifecycle state, including exactly one Failed
 * and one Booked that is already past its expected time (section 9).
 */
const SPECS: readonly Spec[] = [
  { n: 1, from: 'dhanmondi27', to: 'gulshan1', weightKg: 2, size: 'small', status: 'Booked', customer: 'nusrat', agedHours: 1 },
  { n: 2, from: 'mirpur10', to: 'uttara7', weightKg: 0.8, size: 'small', status: 'Booked', customer: 'sadia', agedHours: 2 },
  // the delayed-looking one
  { n: 3, from: 'mohammadpur', to: 'bashundhara', weightKg: 4.2, size: 'large', status: 'Booked', customer: 'tanvir', agedHours: 27, overdue: true },

  { n: 4, from: 'gulshan2', to: 'dhanmondi9', weightKg: 1.5, size: 'small', status: 'Assigned', customer: 'tanvir', agent: 'sabbir', agedHours: 3 },
  { n: 5, from: 'uttara4', to: 'mirpur1', weightKg: 3.4, size: 'medium', status: 'Assigned', customer: 'sadia', agent: 'imran', agedHours: 4 },
  { n: 6, from: 'dhanmondi27', to: 'mohammadpur', weightKg: 0.6, size: 'small', status: 'Assigned', customer: 'nusrat', agent: 'rakib', agedHours: 5 },

  { n: 7, from: 'dhanmondi9', to: 'gulshan1', weightKg: 2.2, size: 'medium', status: 'PickedUp', customer: 'nusrat', agent: 'rakib', agedHours: 6, isCod: true, codAmount: 1500 },
  { n: 8, from: 'bashundhara', to: 'uttara7', weightKg: 1.1, size: 'small', status: 'PickedUp', customer: 'tanvir', agent: 'sabbir', agedHours: 7 },

  { n: 9, from: 'gulshan1', to: 'mirpur10', weightKg: 4.8, size: 'large', status: 'InTransit', customer: 'tanvir', agent: 'sabbir', agedHours: 8 },
  { n: 10, from: 'mohammadpur', to: 'dhanmondi27', weightKg: 0.9, size: 'small', status: 'InTransit', customer: 'nusrat', agent: 'rakib', agedHours: 9, isCod: true, codAmount: 800 },
  { n: 11, from: 'uttara7', to: 'bashundhara', weightKg: 2.7, size: 'medium', status: 'InTransit', customer: 'sadia', agent: 'imran', agedHours: 10 },

  { n: 12, from: 'dhanmondi27', to: 'gulshan2', weightKg: 1, size: 'small', status: 'Delivered', customer: 'nusrat', agent: 'rakib', agedHours: 30 },
  { n: 13, from: 'mirpur1', to: 'uttara4', weightKg: 3.1, size: 'medium', status: 'Delivered', customer: 'sadia', agent: 'imran', agedHours: 34 },
  { n: 14, from: 'gulshan1', to: 'dhanmondi9', weightKg: 0.7, size: 'small', status: 'Delivered', customer: 'tanvir', agent: 'sabbir', agedHours: 38, isCod: true, codAmount: 2400 },
  { n: 15, from: 'bashundhara', to: 'mohammadpur', weightKg: 4.5, size: 'large', status: 'Delivered', customer: 'tanvir', agent: 'sabbir', agedHours: 44 },
  { n: 16, from: 'uttara7', to: 'mirpur10', weightKg: 2, size: 'medium', status: 'Delivered', customer: 'sadia', agent: 'imran', agedHours: 50 },
  { n: 17, from: 'dhanmondi9', to: 'bashundhara', weightKg: 1.3, size: 'small', status: 'Delivered', customer: 'nusrat', agent: 'rakib', agedHours: 56 },

  { n: 18, from: 'mirpur10', to: 'gulshan2', weightKg: 2.5, size: 'medium', status: 'Cancelled', customer: 'tanvir', agedHours: 20 },
  { n: 19, from: 'mohammadpur', to: 'uttara4', weightKg: 3.8, size: 'medium', status: 'Cancelled', customer: 'sadia', agedHours: 24 },

  // the single Failed one
  { n: 20, from: 'gulshan2', to: 'mirpur1', weightKg: 1.9, size: 'small', status: 'Failed', customer: 'tanvir', agent: 'sabbir', agedHours: 15, failureReason: 'Recipient not reachable after three attempts' },
]

const SEED_PREFIX = 'PD-SEED-'
const trackingFor = (n: number): string =>
  `${SEED_PREFIX}${String(n).padStart(2, '0')}`

const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3_600_000)

/**
 * The event trail a parcel in `status` would have accumulated. Section 5
 * requires every transition to append an event with actor, timestamp and
 * coordinates, so a seeded parcel that skipped straight to Delivered with no
 * history would misrepresent what the app produces.
 */
const CHAIN: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  Booked: ['Booked'],
  Assigned: ['Booked', 'Assigned'],
  PickedUp: ['Booked', 'Assigned', 'PickedUp'],
  InTransit: ['Booked', 'Assigned', 'PickedUp', 'InTransit'],
  Delivered: ['Booked', 'Assigned', 'PickedUp', 'InTransit', 'Delivered'],
  Cancelled: ['Booked', 'Cancelled'],
  Failed: ['Booked', 'Assigned', 'PickedUp', 'InTransit', 'Failed'],
}

export const seedParcels = async (): Promise<void> => {
  // ---- look up the people the specs refer to ----
  const emailFor = (k: string): string => `${k}@demo.pdms`
  const customers = new Map<string, mongoose.Types.ObjectId>()
  for (const k of ['nusrat', 'tanvir', 'sadia'] as const) {
    const u = await UserModel.findOne({ email: emailFor(k) }).select('_id').lean()
    if (!u) throw new Error(`missing seeded customer ${k}`)
    customers.set(k, u._id)
  }

  const agents = new Map<string, { agentId: mongoose.Types.ObjectId; userId: mongoose.Types.ObjectId }>()
  for (const k of ['rakib', 'sabbir', 'imran'] as const) {
    const u = await UserModel.findOne({ email: emailFor(k) }).select('_id').lean()
    if (!u) throw new Error(`missing seeded agent user ${k}`)
    const a = await AgentModel.findOne({ user: u._id }).select('_id').lean()
    if (!a) throw new Error(`missing seeded agent record ${k}`)
    agents.set(k, { agentId: a._id, userId: u._id })
  }

  // ---- clear only the previously seeded demo parcels ----
  const stale = await ParcelModel.find({ trackingId: { $regex: `^${SEED_PREFIX}` } })
    .select('_id')
    .lean()
  if (stale.length > 0) {
    const ids = stale.map((p) => p._id)
    await DeliveryModel.deleteMany({ parcel: { $in: ids } })
    await ParcelModel.deleteMany({ _id: { $in: ids } })
    console.log(`  cleared ${stale.length} previously seeded parcels`)
  }

  console.log(`  geocoding + routing ${SPECS.length} parcels (throttled — this takes a minute)`)

  let done = 0
  for (const spec of SPECS) {
    const from = place(spec.from)
    const to = place(spec.to)

    // Cached after the first pass, so a re-seed is fast.
    const fromGeo = await geocodeAddress({ ...from, city: 'Dhaka' }, 'pickup')
    const toGeo = await geocodeAddress({ ...to, city: 'Dhaka' }, 'drop')
    const route = await routeBetween(fromGeo.point, toGeo.point)

    const price = await priceFor({
      distanceKm: route.distanceKm,
      weightKg: spec.weightKg,
      zone: from.zone,
    })

    const bookedAt = hoursAgo(spec.agedHours)
    const customerId = customers.get(spec.customer)
    if (!customerId) throw new Error(`unknown customer ${spec.customer}`)
    const agentEntry = spec.agent ? agents.get(spec.agent) : undefined

    const parcel = await ParcelModel.create({
      trackingId: trackingFor(spec.n),
      customer: customerId,
      pickup: { ...from, city: 'Dhaka', ...fromGeo },
      drop: { ...to, city: 'Dhaka', ...toGeo },
      weightKg: spec.weightKg,
      size: spec.size,
      description: 'Demo parcel',
      price,
      isCod: spec.isCod ?? false,
      codAmount: spec.isCod ? (spec.codAmount ?? 0) : 0,
      createdAt: bookedAt,
      updatedAt: bookedAt,
    })

    // Spread the trail between booking and now.
    const chain = CHAIN[spec.status]
    const stepMs = (Date.now() - bookedAt.getTime()) / (chain.length + 1)
    const pointFor = (s: DeliveryStatus): GeoPoint =>
      s === 'Delivered' || s === 'Failed' ? toGeo.point : fromGeo.point

    const events = chain.map((status, i) => ({
      status,
      at: new Date(bookedAt.getTime() + stepMs * i),
      actor: status === 'Booked' ? customerId : (agentEntry?.userId ?? null),
      actorRole: status === 'Booked' ? ('customer' as const) : agentEntry ? ('agent' as const) : ('admin' as const),
      point: pointFor(status),
      ...(status === 'Failed' && spec.failureReason ? { note: spec.failureReason } : {}),
    }))

    const at = (s: DeliveryStatus): Date | null => {
      const i = chain.indexOf(s)
      return i === -1 ? null : new Date(bookedAt.getTime() + stepMs * i)
    }

    const isDelivered = spec.status === 'Delivered'

    await DeliveryModel.create({
      parcel: parcel._id,
      agent: agentEntry?.agentId ?? null,
      status: spec.status,
      events,
      assignedAt: at('Assigned'),
      pickedUpAt: at('PickedUp'),
      deliveredAt: at('Delivered'),
      /**
       * Section 5: Delivered requires proof of delivery already on the
       * record. Seeding a Delivered parcel without it would create demo data
       * the app's own rules forbid. Signature rather than photo, so no fake
       * Cloudinary URL is invented.
       */
      ...(isDelivered
        ? {
            proofOfDelivery: {
              method: 'signature' as const,
              receivedBy: to.contactName,
              capturedAt: at('Delivered') ?? new Date(),
            },
          }
        : {}),
      ...(spec.status === 'Failed' && spec.failureReason
        ? { failureReason: spec.failureReason }
        : {}),
      lastKnownLocation: pointFor(spec.status),
      lastLocationAt: at(spec.status) ?? bookedAt,
      /**
       * The delayed-looking parcel is overdue by construction; the rest get a
       * plausible window so M6's "delayed" alert has something to compare.
       */
      expectedBy: spec.overdue
        ? hoursAgo(3)
        : new Date(bookedAt.getTime() + 24 * 3_600_000),
    })

    done += 1
    if (done % 5 === 0) console.log(`    ${done}/${SPECS.length}`)
  }

  const byStatus = SPECS.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})
  console.log(
    `  parcels          ${SPECS.length} (${Object.entries(byStatus)
      .map(([k, v]) => `${v} ${k}`)
      .join(', ')})`,
  )
}
