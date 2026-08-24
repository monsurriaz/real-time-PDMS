import mongoose from 'mongoose'
import type {
  CodReconciliationRow,
  DeliveryStatus,
  PaymentStatus,
  PaymentSummary,
  Settlement,
} from '@pdms/shared'
import type { Actor } from '../lib/context'
import { runAsSystem } from '../lib/context'
import { env } from '../lib/env'
import { getPaymentProvider } from '../lib/payments'
import { minorToTaka } from '../lib/payments/stripe'
import type { ProviderEvent } from '../lib/payments/provider'
import { AgentModel } from '../models/Agent'
import { DeliveryModel } from '../models/Delivery'
import { ParcelModel } from '../models/Parcel'
import { PaymentModel } from '../models/Payment'
import { ProviderEventModel } from '../models/ProviderEvent'
import { SettlementModel } from '../models/Settlement'
import { UserModel } from '../models/User'
import { HttpError } from '../middleware/httpError'

/**
 * The money ledger.
 *
 * Two rules shape everything here.
 *
 * ONE: an amount is never computed. `Parcel.price` is a snapshot, immutable on
 * the schema, and `Parcel.codAmount` is what the sender asked to be collected.
 * A payment reads one of those two numbers. Re-deriving a price at payment time
 * would mean a rate edit could change what someone owes, which section 5
 * forbids — and the reason the snapshot exists at all.
 *
 * TWO: a running total is never stored. Outstanding COD is a query over Payment
 * documents, so the reconciliation table can be re-derived and audited.
 */

interface ParcelMoney {
  _id: mongoose.Types.ObjectId
  trackingId: string
  customer: mongoose.Types.ObjectId
  isCod: boolean
  codAmount: number
  price: { total: number }
}

/**
 * What a parcel's payment is FOR, and therefore how much it is.
 *
 * A COD parcel's payment tracks the cash the rider collects at the door — the
 * sender's stated amount. A prepaid parcel's payment is the delivery fee from
 * the price snapshot. Two different sums with two different payers, which is
 * why this is one function with the reasoning in it rather than an `amount`
 * argument each caller decides for itself.
 */
export const amountFor = (parcel: ParcelMoney): number =>
  parcel.isCod ? parcel.codAmount : parcel.price.total

/**
 * Create the Payment row for a freshly booked parcel.
 *
 * Idempotent on the parcel: booking is the only caller today, but a retry or a
 * repair script must not produce a second ledger row for one parcel.
 */
export const createPaymentForParcel = async (
  parcel: ParcelMoney,
): Promise<PaymentSummary> => {
  const existing = await runAsSystem('payments: existing row', async () =>
    PaymentModel.findOne({ parcel: parcel._id }).exec(),
  )
  if (existing) return toSummary(existing)

  const created = await runAsSystem('payments: create at booking', async () =>
    PaymentModel.create({
      parcel: parcel._id,
      customer: parcel.customer,
      collectedBy: null,
      method: parcel.isCod ? 'cod' : 'card',
      status: 'pending',
      amount: amountFor(parcel),
      providerRef: null,
      paidAt: null,
      settledAt: null,
    }),
  )
  return toSummary(created)
}

interface PaymentShape {
  _id: mongoose.Types.ObjectId
  method: 'cod' | 'card'
  status: PaymentStatus
  amount: number
  paidAt: Date | null
}

export const toSummary = (p: PaymentShape): PaymentSummary => ({
  _id: p._id.toString(),
  method: p.method,
  status: p.status,
  amount: p.amount,
  paidAt: p.paidAt,
})

/** Payment summaries for a set of parcels, keyed by parcel id. */
export const summariesForParcels = async (
  parcelIds: readonly mongoose.Types.ObjectId[],
): Promise<Map<string, PaymentSummary>> => {
  if (parcelIds.length === 0) return new Map()
  // Scoped read: a customer's own payments only, by the model's own rule.
  const rows = await PaymentModel.find({ parcel: { $in: parcelIds } })
    .select('parcel method status amount paidAt')
    .lean<Array<PaymentShape & { parcel: mongoose.Types.ObjectId }>>()
  return new Map(rows.map((r) => [r.parcel.toString(), toSummary(r)]))
}

/**
 * Start a hosted checkout for a prepaid parcel.
 *
 * The amount comes from the stored Payment row, which came from the price
 * snapshot at booking. Nothing recomputes it here, and no client-supplied
 * amount is accepted anywhere in this path.
 */
export const startCheckout = async (args: {
  parcelId: string
  actor: Actor
}): Promise<{ url: string; provider: string }> => {
  const provider = getPaymentProvider()

  // Scoped: a customer reaches only their own parcel, so an id belonging to
  // someone else is simply not found.
  const parcel = await ParcelModel.findById(args.parcelId)
    .select('trackingId customer isCod codAmount price')
    .lean<ParcelMoney | null>()
  if (!parcel) throw new HttpError(404, 'parcel not found')

  if (parcel.isCod) {
    throw new HttpError(
      422,
      'this parcel is cash on delivery — there is nothing to pay online',
    )
  }

  const payment = await PaymentModel.findOne({ parcel: parcel._id }).exec()
  if (!payment) throw new HttpError(404, 'no payment record for this parcel')
  if (payment.status === 'paid') {
    throw new HttpError(409, 'this parcel is already paid')
  }

  const result = await provider.createCheckout({
    paymentId: payment._id.toString(),
    trackingId: parcel.trackingId,
    // The snapshot. Not `parcel.price.total` recomputed, not a request field.
    amountTaka: payment.amount,
    description: `Parcel delivery ${parcel.trackingId}`,
    successUrl: `${env.CLIENT_ORIGIN}/?payment=success&parcel=${parcel._id.toString()}`,
    cancelUrl: `${env.CLIENT_ORIGIN}/?payment=cancelled&parcel=${parcel._id.toString()}`,
  })

  /**
   * providerRef is stored now rather than on the webhook, so a payment that
   * never completes still points at the attempt — which is the only way to
   * find it in the provider's dashboard afterwards.
   */
  await runAsSystem('payments: record checkout attempt', async () =>
    PaymentModel.updateOne(
      { _id: payment._id },
      { $set: { providerRef: result.providerRef } },
    ).exec(),
  )

  return { url: result.url, provider: provider.name }
}

/**
 * Apply a verified provider callback, exactly once.
 *
 * The caller has already proven the event is genuine; this decides what it
 * means. Returns what happened so the route can log it and so a replay is
 * visibly a replay rather than an indistinguishable 200.
 */
export const applyProviderEvent = async (
  event: ProviderEvent,
): Promise<{ outcome: string; replay: boolean }> => {
  const providerName = env.PAYMENT_PROVIDER

  /**
   * Claim the event id first. A duplicate key here means another delivery of
   * the same event — a Stripe retry, or the same event replayed from the
   * dashboard — and the correct response is to do nothing and say so.
   */
  const paymentObjectId =
    event.paymentId && mongoose.Types.ObjectId.isValid(event.paymentId)
      ? new mongoose.Types.ObjectId(event.paymentId)
      : null

  try {
    await runAsSystem('payments: claim event id', async () =>
      ProviderEventModel.create({
        eventId: event.id,
        provider: providerName,
        type: event.type,
        payment: paymentObjectId,
        outcome: 'claimed',
        receivedAt: new Date(),
      }),
    )
  } catch (err) {
    if (isDuplicateKey(err)) {
      return { outcome: 'already applied', replay: true }
    }
    throw err
  }

  const finish = async (outcome: string): Promise<{ outcome: string; replay: boolean }> => {
    await runAsSystem('payments: record outcome', async () =>
      ProviderEventModel.updateOne({ eventId: event.id }, { $set: { outcome } }).exec(),
    )
    return { outcome, replay: false }
  }

  if (event.type === 'ignored') return finish('ignored: not a payment outcome')
  if (!paymentObjectId) return finish('ignored: event named no payment')

  const payment = await runAsSystem('payments: load for event', async () =>
    PaymentModel.findById(paymentObjectId).exec(),
  )
  if (!payment) return finish('ignored: payment no longer exists')

  if (event.type === 'failed') {
    await runAsSystem('payments: mark failed', async () =>
      PaymentModel.updateOne(
        { _id: payment._id, status: 'pending' },
        { $set: { status: 'failed' } },
      ).exec(),
    )
    return finish('marked failed')
  }

  /**
   * Amount check before crediting. The provider is the authority on what was
   * charged, and our ledger is the authority on what was owed — if they
   * disagree, crediting the parcel anyway would paper over a real bug.
   */
  if (event.amountMinor !== null) {
    const chargedTaka = minorToTaka(event.amountMinor)
    if (chargedTaka !== payment.amount) {
      return finish(
        `ignored: provider charged BDT ${chargedTaka} but the ledger says BDT ${payment.amount}`,
      )
    }
  }

  /**
   * Conditional on `pending`. Belt and braces with the event-id claim above:
   * even if an event id somehow arrived twice, the second write matches nothing
   * and the payment cannot be credited a second time.
   */
  const result = await runAsSystem('payments: mark paid', async () =>
    PaymentModel.updateOne(
      { _id: payment._id, status: 'pending' },
      {
        $set: {
          status: 'paid',
          paidAt: new Date(),
          ...(event.providerRef ? { providerRef: event.providerRef } : {}),
        },
      },
    ).exec(),
  )

  return finish(
    result.modifiedCount === 1
      ? `paid BDT ${payment.amount}`
      : `no change: payment was already ${payment.status}`,
  )
}

const isDuplicateKey = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: number }).code === 11000

/**
 * Keep the COD ledger in step with the lifecycle. Called by advanceStatus
 * after a transition commits, alongside the rider-availability sync — the same
 * reasoning applies: the lifecycle is the single path, so anything that must
 * follow a transition hangs off it rather than off a route.
 *
 * Delivered  -> the rider is holding the cash: 'collected', stamped with who.
 * Failed     -> nothing was collected, and CLAUDE.md is explicit that a failed
 *               delivery's COD must not count as collectable.
 * Cancelled  -> same, one step earlier.
 *
 * Never throws. A ledger hiccup must not be able to reject a rider's status
 * change — the parcel physically moved, and refusing to record that because a
 * payment row misbehaved would leave the system lying about the world.
 */
export const syncCodOnTransition = async (args: {
  parcelId: mongoose.Types.ObjectId
  agentId: mongoose.Types.ObjectId | null
  to: DeliveryStatus
}): Promise<void> => {
  const { parcelId, agentId, to } = args
  if (to !== 'Delivered' && to !== 'Failed' && to !== 'Cancelled') return

  try {
    await runAsSystem('payments: cod follows lifecycle', async () => {
      const payment = await PaymentModel.findOne({
        parcel: parcelId,
        method: 'cod',
      })
        .select('status')
        .lean<{ _id: mongoose.Types.ObjectId; status: PaymentStatus } | null>()
        .exec()
      if (!payment || payment.status !== 'pending') return

      if (to === 'Delivered') {
        await PaymentModel.updateOne(
          { _id: payment._id, status: 'pending' },
          {
            $set: {
              status: 'collected',
              collectedBy: agentId,
              paidAt: new Date(),
            },
          },
        ).exec()
        return
      }

      await PaymentModel.updateOne(
        { _id: payment._id, status: 'pending' },
        { $set: { status: 'failed' } },
      ).exec()
    })
  } catch (err) {
    console.error('[payments] COD sync failed — status change stands', err)
  }
}

/** COD status for a set of parcels, for the rider and admin lists. */
export const codStatusForParcels = async (
  parcelIds: readonly mongoose.Types.ObjectId[],
): Promise<Map<string, PaymentStatus>> => {
  if (parcelIds.length === 0) return new Map()
  const rows = await runAsSystem('payments: cod status for list', async () =>
    PaymentModel.find({ parcel: { $in: parcelIds }, method: 'cod' })
      .select('parcel status')
      .lean<Array<{ parcel: mongoose.Types.ObjectId; status: PaymentStatus }>>()
      .exec(),
  )
  return new Map(rows.map((r) => [r.parcel.toString(), r.status]))
}

/**
 * The per-agent COD table.
 *
 * Every column is counted from Payment documents at read time. `collected`
 * means the rider has the cash; `settled` means the office does. Uncollectable
 * is reported rather than dropped, so the row explains why a rider who
 * delivered five COD parcels is only holding four parcels' worth.
 */
export const codReconciliation = async (): Promise<{
  rows: CodReconciliationRow[]
  totals: { outstanding: number; settled: number; uncollectable: number }
}> => {
  const payments = await runAsSystem('payments: reconciliation', async () =>
    PaymentModel.find({ method: 'cod' })
      .select('collectedBy status amount settledAt')
      .lean<
        Array<{
          collectedBy: mongoose.Types.ObjectId | null
          status: PaymentStatus
          amount: number
          settledAt: Date | null
        }>
      >()
      .exec(),
  )

  /**
   * Uncollectable cash is grouped by the rider who was carrying it, which
   * `collectedBy` does not record — it is only stamped on collection. The
   * delivery holds that fact, so failed COD is attributed through it.
   */
  const failedByAgent = await runAsSystem('payments: failed cod owners', async () => {
    const failed = await PaymentModel.find({ method: 'cod', status: 'failed' })
      .select('parcel amount')
      .lean<Array<{ parcel: mongoose.Types.ObjectId; amount: number }>>()
      .exec()
    if (failed.length === 0) return new Map<string, { amount: number; count: number }>()

    const deliveries = await DeliveryModel.find({
      parcel: { $in: failed.map((f) => f.parcel) },
    })
      .select('parcel agent')
      .lean<
        Array<{ parcel: mongoose.Types.ObjectId; agent: mongoose.Types.ObjectId | null }>
      >()
      .exec()
    const agentByParcel = new Map(
      deliveries.map((d) => [d.parcel.toString(), d.agent?.toString() ?? null]),
    )

    const out = new Map<string, { amount: number; count: number }>()
    for (const f of failed) {
      const agentId = agentByParcel.get(f.parcel.toString())
      if (!agentId) continue
      const current = out.get(agentId) ?? { amount: 0, count: 0 }
      out.set(agentId, { amount: current.amount + f.amount, count: current.count + 1 })
    }
    return out
  })

  interface Bucket {
    outstanding: number
    outstandingCount: number
    settled: number
    settledCount: number
    lastSettledAt: Date | null
  }
  const byAgent = new Map<string, Bucket>()
  const bucket = (id: string): Bucket => {
    const existing = byAgent.get(id)
    if (existing) return existing
    const fresh: Bucket = {
      outstanding: 0,
      outstandingCount: 0,
      settled: 0,
      settledCount: 0,
      lastSettledAt: null,
    }
    byAgent.set(id, fresh)
    return fresh
  }

  for (const p of payments) {
    if (!p.collectedBy) continue
    const b = bucket(p.collectedBy.toString())
    if (p.status === 'collected') {
      b.outstanding += p.amount
      b.outstandingCount += 1
    } else if (p.status === 'settled') {
      b.settled += p.amount
      b.settledCount += 1
      if (p.settledAt && (!b.lastSettledAt || p.settledAt > b.lastSettledAt)) {
        b.lastSettledAt = p.settledAt
      }
    }
  }
  for (const agentId of failedByAgent.keys()) bucket(agentId)

  const names = await riderNames([...byAgent.keys()])

  const rows: CodReconciliationRow[] = [...byAgent.entries()]
    .map(([agentId, b]) => {
      const failed = failedByAgent.get(agentId) ?? { amount: 0, count: 0 }
      return {
        agentId,
        agentName: names.get(agentId) ?? 'Unknown rider',
        deliveredCount: b.outstandingCount + b.settledCount,
        outstanding: b.outstanding,
        outstandingCount: b.outstandingCount,
        settled: b.settled,
        settledCount: b.settledCount,
        uncollectable: failed.amount,
        uncollectableCount: failed.count,
        lastSettledAt: b.lastSettledAt,
      }
    })
    // Whoever is holding the most cash first: that is the row an admin is
    // looking for when they open this screen.
    .sort((a, b) => b.outstanding - a.outstanding || a.agentName.localeCompare(b.agentName))

  return {
    rows,
    totals: {
      outstanding: rows.reduce((sum, r) => sum + r.outstanding, 0),
      settled: rows.reduce((sum, r) => sum + r.settled, 0),
      uncollectable: rows.reduce((sum, r) => sum + r.uncollectable, 0),
    },
  }
}

const riderNames = async (
  agentIds: readonly string[],
): Promise<Map<string, string>> => {
  if (agentIds.length === 0) return new Map()
  return runAsSystem('payments: rider names', async () => {
    const agents = await AgentModel.find({
      _id: { $in: agentIds.map((id) => new mongoose.Types.ObjectId(id)) },
    })
      .select('user')
      .lean<Array<{ _id: mongoose.Types.ObjectId; user: mongoose.Types.ObjectId }>>()
      .exec()
    const users = await UserModel.find({ _id: { $in: agents.map((a) => a.user) } })
      .select('name')
      .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>()
      .exec()
    const nameByUser = new Map(users.map((u) => [u._id.toString(), u.name]))
    return new Map(
      agents.map((a) => [a._id.toString(), nameByUser.get(a.user.toString()) ?? 'Rider']),
    )
  })
}

/**
 * Settle everything one rider is holding.
 *
 * Order matters: the payments are read, then flipped conditionally on still
 * being 'collected', and the Settlement records exactly the ids that moved. So
 * two admins settling the same rider at once produce one settlement with the
 * money and one with nothing, rather than two settlements for the same cash.
 */
export const settleAgent = async (args: {
  agentId: string
  actor: Actor
  note?: string
}): Promise<Settlement> => {
  if (!mongoose.Types.ObjectId.isValid(args.agentId)) {
    throw new HttpError(400, 'not a valid agent id')
  }
  const agentId = new mongoose.Types.ObjectId(args.agentId)

  const outstanding = await runAsSystem('payments: outstanding for settle', async () =>
    PaymentModel.find({ collectedBy: agentId, method: 'cod', status: 'collected' })
      .select('amount')
      .lean<Array<{ _id: mongoose.Types.ObjectId; amount: number }>>()
      .exec(),
  )

  if (outstanding.length === 0) {
    throw new HttpError(422, 'this rider is not holding any collected cash')
  }

  const at = new Date()
  const settled: mongoose.Types.ObjectId[] = []
  let amount = 0

  for (const p of outstanding) {
    const result = await runAsSystem('payments: settle one', async () =>
      PaymentModel.updateOne(
        { _id: p._id, status: 'collected' },
        { $set: { status: 'settled', settledAt: at } },
      ).exec(),
    )
    if (result.modifiedCount === 1) {
      settled.push(p._id)
      amount += p.amount
    }
  }

  if (settled.length === 0) {
    throw new HttpError(409, 'that cash was just settled by someone else — reload')
  }

  const record = await runAsSystem('payments: write settlement', async () =>
    SettlementModel.create({
      agent: agentId,
      amount,
      payments: settled,
      settledBy: new mongoose.Types.ObjectId(args.actor.id),
      at,
      ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    }),
  )

  const names = await riderNames([args.agentId])
  const admin = await runAsSystem('payments: settling admin name', async () =>
    UserModel.findById(args.actor.id).select('name').lean<{ name: string } | null>().exec(),
  )

  return {
    _id: record._id.toString(),
    agent: args.agentId,
    agentName: names.get(args.agentId) ?? 'Unknown rider',
    amount,
    paymentCount: settled.length,
    settledBy: args.actor.id,
    settledByName: admin?.name ?? 'Administrator',
    at,
    ...(record.note ? { note: record.note } : {}),
  }
}

/**
 * The settlement trail, newest first.
 *
 * The `agentId` filter is applied for every role and left to compose with the
 * model's own scoping. That is safe since M6 fixed the scope plugin to merge
 * with `$and`: a rider asking for another rider's trail now gets a filter that
 * requires both agent ids at once, which matches nothing. Before that fix the
 * scope condition replaced this one and they got their own trail back under
 * someone else's filter — the M5 workaround here was to honour the filter for
 * admins only, and it is no longer needed.
 */
export const settlementHistory = async (args: {
  agentId?: string
}): Promise<Settlement[]> => {
  const { agentId } = args
  const filter =
    agentId && mongoose.Types.ObjectId.isValid(agentId)
      ? { agent: new mongoose.Types.ObjectId(agentId) }
      : {}

  const rows = await SettlementModel.find(filter)
    .sort({ at: -1 })
    .limit(100)
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId
        agent: mongoose.Types.ObjectId
        amount: number
        payments: mongoose.Types.ObjectId[]
        settledBy: mongoose.Types.ObjectId
        at: Date
        note?: string
      }>
    >()

  if (rows.length === 0) return []

  const names = await riderNames([...new Set(rows.map((r) => r.agent.toString()))])
  const admins = await runAsSystem('payments: settlement admins', async () =>
    UserModel.find({ _id: { $in: rows.map((r) => r.settledBy) } })
      .select('name')
      .lean<Array<{ _id: mongoose.Types.ObjectId; name: string }>>()
      .exec(),
  )
  const adminName = new Map(admins.map((a) => [a._id.toString(), a.name]))

  return rows.map((r) => ({
    _id: r._id.toString(),
    agent: r.agent.toString(),
    agentName: names.get(r.agent.toString()) ?? 'Unknown rider',
    amount: r.amount,
    paymentCount: r.payments.length,
    settledBy: r.settledBy.toString(),
    settledByName: adminName.get(r.settledBy.toString()) ?? 'Administrator',
    at: r.at,
    ...(r.note ? { note: r.note } : {}),
  }))
}
