/**
 * Seeds zones, pricing, and demo logins.
 *
 * Idempotent by construction: every write is an upsert keyed on a natural
 * unique field (email, zone name, the pricing singleton), and passwords are
 * written with $setOnInsert so re-running never re-hashes or resets one.
 * Running it twice is a no-op; running it after a schema change repairs the
 * existing rows in place.
 *
 *   npm run seed
 */
import mongoose from 'mongoose'
import type { AgentStatus, GeoPoint, Vehicle, ZoneName } from '@pdms/shared'
import { connectDb, disconnectDb } from '../server/src/lib/db'
import { runAsSystem } from '../server/src/lib/context'
import { hashPassword } from '../server/src/lib/password'
import {
  AgentModel,
  PricingConfigModel,
  UserModel,
  ZoneModel,
  type UserDoc,
} from '../server/src/models'

/** Shared across every demo account so the whole class can log in fast. */
const DEMO_PASSWORD = 'pdms-demo-2026'

const point = (lng: number, lat: number): GeoPoint => ({
  type: 'Point',
  coordinates: [lng, lat],
})

/**
 * Real Dhaka centroids — the tracking map in M4 is far easier to sanity-check
 * when the markers land on actual roads.
 */
const ZONES: ReadonlyArray<{
  name: ZoneName
  label: string
  centre: GeoPoint
}> = [
  { name: 'Dhanmondi', label: 'Dhanmondi, Dhaka', centre: point(90.3742, 23.7461) },
  { name: 'Mirpur', label: 'Mirpur, Dhaka', centre: point(90.3654, 23.8223) },
  { name: 'Uttara', label: 'Uttara, Dhaka', centre: point(90.3983, 23.8759) },
  { name: 'Bashundhara', label: 'Bashundhara R/A, Dhaka', centre: point(90.4264, 23.8203) },
  { name: 'Gulshan', label: 'Gulshan, Dhaka', centre: point(90.4152, 23.7925) },
  { name: 'Mohammadpur', label: 'Mohammadpur, Dhaka', centre: point(90.3596, 23.7639) },
]

interface SeedUser {
  name: string
  email: string
  phone: string
  role: 'customer' | 'agent' | 'admin'
  zone?: ZoneName
}

const CUSTOMERS: readonly SeedUser[] = [
  { name: 'Nusrat Jahan', email: 'nusrat@demo.pdms', phone: '01711000001', role: 'customer', zone: 'Dhanmondi' },
  { name: 'Tanvir Ahmed', email: 'tanvir@demo.pdms', phone: '01711000002', role: 'customer', zone: 'Gulshan' },
  { name: 'Sadia Islam', email: 'sadia@demo.pdms', phone: '01711000003', role: 'customer', zone: 'Uttara' },
]

const ADMIN: SeedUser = {
  name: 'Ops Admin',
  email: 'admin@demo.pdms',
  phone: '01711000000',
  role: 'admin',
}

/**
 * 2 available, 1 on delivery, 1 offline — the mix CLAUDE.md section 9 asks
 * for, so assignment has both a hit and a near-miss to demonstrate.
 */
const AGENTS: ReadonlyArray<
  SeedUser & {
    zones: ZoneName[]
    vehicle: Vehicle
    status: AgentStatus
    at?: GeoPoint
  }
> = [
  {
    name: 'Rakib Hasan',
    email: 'rakib@demo.pdms',
    phone: '01811000001',
    role: 'agent',
    zones: ['Dhanmondi', 'Mohammadpur'],
    vehicle: 'motorcycle',
    status: 'available',
    at: point(90.3728, 23.7489),
  },
  {
    name: 'Sabbir Rahman',
    email: 'sabbir@demo.pdms',
    phone: '01811000002',
    role: 'agent',
    zones: ['Gulshan', 'Bashundhara'],
    vehicle: 'motorcycle',
    status: 'available',
    at: point(90.4138, 23.7941),
  },
  {
    name: 'Imran Kabir',
    email: 'imran@demo.pdms',
    phone: '01811000003',
    role: 'agent',
    zones: ['Uttara'],
    vehicle: 'van',
    status: 'on_delivery',
    at: point(90.3991, 23.8712),
  },
  {
    name: 'Jahid Hossain',
    email: 'jahid@demo.pdms',
    phone: '01811000004',
    role: 'agent',
    zones: ['Mirpur'],
    vehicle: 'bicycle',
    status: 'offline',
    // No position: an offline rider who has not reported one yet. This is
    // also what keeps the sparse 2dsphere index honest.
  },
]

/**
 * Upsert a user without ever rewriting an existing password.
 *
 * The hash is computed only when it will actually be inserted — bcrypt at 12
 * rounds is deliberately slow, and hashing eight passwords on every run of an
 * otherwise no-op script adds a pointless second.
 */
const upsertUser = async (u: SeedUser): Promise<UserDoc> => {
  const existing = await UserModel.findOne({ email: u.email }).select('_id')

  if (existing) {
    await UserModel.updateOne(
      { _id: existing._id },
      { $set: { name: u.name, phone: u.phone, role: u.role, zone: u.zone, isActive: true } },
    )
    const refreshed = await UserModel.findById(existing._id)
    if (!refreshed) throw new Error(`user vanished mid-seed: ${u.email}`)
    return refreshed
  }

  return UserModel.create({
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    zone: u.zone,
    isActive: true,
    passwordHash: await hashPassword(DEMO_PASSWORD),
  })
}

const seed = async (): Promise<void> => {
  await connectDb()

  await runAsSystem('seed script', async () => {
    // ---- zones ----
    for (const z of ZONES) {
      await ZoneModel.updateOne(
        { name: z.name },
        {
          $set: {
            label: z.label,
            centre: z.centre,
            isServiceable: true,
          },
          /**
           * Zone base starts at 0 so the worked example documented in
           * CLAUDE.md section 5 — 3 km, 2 kg -> BDT 126 — reproduces exactly
           * from a fresh seed. Admins raise per-zone bases from the pricing
           * screen in M2; nothing here is hard-coded downstream.
           */
          $setOnInsert: { baseFare: 0 },
        },
        { upsert: true },
      )
    }
    console.log(`  zones            ${ZONES.length}`)

    // ---- pricing config (singleton) ----
    await PricingConfigModel.updateOne(
      { key: 'default' },
      {
        $setOnInsert: {
          key: 'default',
          /**
           * Placeholder rate, chosen so that the documented example holds:
           * 0 zone base + (3 km x 12) + 90 (1-3 kg tier) = BDT 126.
           */
          perKmRate: 12,
          weightTiers: [
            { maxKg: 1, baseFee: 60, label: 'Up to 1 kg' },
            { maxKg: 3, baseFee: 90, label: '1 - 3 kg' },
            { maxKg: 5, baseFee: 130, label: '3 - 5 kg' },
          ],
          zoneBaseOverrides: [],
        },
      },
      { upsert: true },
    )
    console.log('  pricing config   1 (perKmRate BDT 12, 3 weight tiers)')

    // ---- people ----
    const admin = await upsertUser(ADMIN)
    for (const c of CUSTOMERS) await upsertUser(c)
    console.log(`  customers        ${CUSTOMERS.length}`)
    console.log('  admins           1')

    // ---- agents ----
    for (const a of AGENTS) {
      const user = await upsertUser(a)
      await AgentModel.updateOne(
        { user: user._id },
        {
          $set: {
            zones: a.zones,
            vehicle: a.vehicle,
            status: a.status,
            ...(a.at
              ? { currentLocation: a.at, locationUpdatedAt: new Date() }
              : {}),
          },
        },
        { upsert: true },
      )
    }
    const counts = AGENTS.reduce<Record<string, number>>((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1
      return acc
    }, {})
    console.log(
      `  agents           ${AGENTS.length} (${Object.entries(counts)
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')})`,
    )

    // ---- credentials ----
    const firstCustomer = CUSTOMERS[0]
    const firstAgent = AGENTS[0]
    if (!firstCustomer || !firstAgent) throw new Error('demo roster is empty')

    console.log('\n  demo logins — password is the same for all:\n')
    console.log(`    password   ${DEMO_PASSWORD}\n`)
    console.log(`    customer   ${firstCustomer.email}`)
    console.log(`    agent      ${firstAgent.email}`)
    console.log(`    admin      ${admin.email}`)
    console.log('\n  other accounts:')
    for (const c of CUSTOMERS.slice(1)) console.log(`    customer   ${c.email}`)
    for (const a of AGENTS.slice(1)) console.log(`    agent      ${a.email}  (${a.status})`)
  })
}

console.log('\nseeding...\n')

seed()
  .then(async () => {
    await disconnectDb()
    console.log('\ndone.\n')
    process.exit(0)
  })
  .catch(async (err: unknown) => {
    console.error('\nseed failed:', err)
    await mongoose.disconnect().catch(() => undefined)
    process.exit(1)
  })
