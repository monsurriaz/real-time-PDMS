import mongoose, { Schema } from 'mongoose'
import type { Types } from 'mongoose'
import { DENY_ALL, roleScopePlugin } from './plugins/roleScope'

/**
 * One row per provider callback we have already applied.
 *
 * This is the idempotency mechanism, and it is a unique index rather than a
 * check-then-write: Stripe retries until it gets a 2xx, and two retries can
 * arrive concurrently. `insertOne` on a unique key lets the DATABASE decide
 * which one is first — a read-then-write would let both pass the check.
 *
 * A double-credited payment is worse than a missed one, so the insert happens
 * BEFORE the ledger is touched. The cost of that ordering is that a crash
 * between insert and apply would drop an event; the benefit is that no event
 * can ever apply twice. Given the choice, dropping is recoverable by replaying
 * from the provider's dashboard and double-crediting is not.
 */
export interface ProviderEventDoc {
  _id: Types.ObjectId
  /** The provider's event id — `evt_...` for Stripe. */
  eventId: string
  provider: string
  type: string
  /** Our Payment document, when the event named one. */
  payment: Types.ObjectId | null
  /** What applying it did, for reading the trail back later. */
  outcome: string
  receivedAt: Date
}

const providerEventSchema = new Schema<ProviderEventDoc>(
  {
    eventId: { type: String, required: true, unique: true },
    provider: { type: String, required: true },
    type: { type: String, required: true },
    payment: {
      type: Schema.Types.ObjectId,
      ref: 'Payment',
      required: false,
      default: null,
      index: true,
    },
    outcome: { type: String, required: true },
    receivedAt: { type: Date, required: true },
  },
  { timestamps: true },
)

/**
 * Nobody reads this over HTTP. The webhook route runs outside any request
 * context (it authenticates by signature, not by cookie), which the scope
 * plugin already treats as system — so denying every role here costs nothing
 * and means a future handler cannot expose the ledger's plumbing by accident.
 */
roleScopePlugin<ProviderEventDoc>(providerEventSchema, {
  admin: () => DENY_ALL,
  customer: () => DENY_ALL,
  agent: () => DENY_ALL,
})

export const ProviderEventModel = mongoose.model<ProviderEventDoc>(
  'ProviderEvent',
  providerEventSchema,
)
