import mongoose, { Schema } from 'mongoose'
import {
  paymentMethodSchema,
  paymentStatusSchema,
  type Payment,
} from '@pdms/shared'
import type { Doc } from './types'
import { ALLOW_ALL, roleScopePlugin } from './plugins/roleScope'

export type PaymentDoc = Doc<Payment, 'parcel' | 'customer' | 'collectedBy'>

const paymentMongooseSchema = new Schema<PaymentDoc>(
  {
    parcel: { type: Schema.Types.ObjectId, ref: 'Parcel', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    collectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Agent',
      required: false,
      default: null,
      index: true,
    },
    method: { type: String, required: true, enum: paymentMethodSchema.options },
    status: {
      type: String,
      required: true,
      enum: paymentStatusSchema.options,
      default: 'pending',
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    /**
     * A provider-side id only. CLAUDE.md section 7 forbids storing or sending
     * payment secrets, so no client_secret ever lands here.
     */
    providerRef: { type: String, required: false, default: null },
    paidAt: { type: Date, required: false, default: null },
    settledAt: { type: Date, required: false, default: null },
  },
  { timestamps: true },
)

/** Drives M5's per-agent COD reconciliation table. */
paymentMongooseSchema.index({ collectedBy: 1, status: 1 })

roleScopePlugin<PaymentDoc>(paymentMongooseSchema, {
  admin: () => ALLOW_ALL,
  customer: (actor) => ({ customer: new mongoose.Types.ObjectId(actor.id) }),
  /**
   * An agent sees only cash they themselves collected. collectedBy points at
   * the Agent document, so this resolves the actor's User id through it.
   */
  agent: async (actor) => {
    const AgentModel = mongoose.model('Agent')
    const agent = await AgentModel.findOne({
      user: new mongoose.Types.ObjectId(actor.id),
    })
      .select('_id')
      .lean<{ _id: mongoose.Types.ObjectId } | null>()
    return agent ? { collectedBy: agent._id } : { _id: { $exists: false } }
  },
})

export const PaymentModel = mongoose.model<PaymentDoc>(
  'Payment',
  paymentMongooseSchema,
)
