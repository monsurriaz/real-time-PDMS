import mongoose, { Schema, type Types } from 'mongoose'
import { ALLOW_ALL, DENY_ALL, roleScopePlugin } from './plugins/roleScope'

/**
 * A rider handing collected cash to the office.
 *
 * The audit record CLAUDE.md's M5 scope asks for: settling does not decrement
 * a stored total, it writes one of these and flips the specific payments it
 * names. Two consequences worth keeping:
 *
 *   - every figure in the reconciliation table is re-derivable from Payment
 *     documents, so a wrong total is a bug you can find rather than a number
 *     somebody has to trust;
 *   - the payments settled by each hand-in are recorded, so "which parcels was
 *     that BDT 3,400 for?" has an answer.
 */
export interface SettlementDoc {
  _id: Types.ObjectId
  agent: Types.ObjectId
  amount: number
  /** Exactly the payments this settlement closed. */
  payments: Types.ObjectId[]
  settledBy: Types.ObjectId
  at: Date
  note?: string
}

const settlementSchema = new Schema<SettlementDoc>(
  {
    agent: { type: Schema.Types.ObjectId, ref: 'Agent', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    payments: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Payment' }],
      required: true,
      default: [],
    },
    settledBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    at: { type: Date, required: true },
    note: { type: String, required: false, trim: true },
  },
  { timestamps: true },
)

settlementSchema.index({ agent: 1, at: -1 })

/**
 * Reconciliation is an admin screen. A rider may see their own hand-ins —
 * being told what you were credited with is not a privilege — but the scope
 * resolves through their Agent document, the same indirection Payment uses.
 */
roleScopePlugin<SettlementDoc>(settlementSchema, {
  admin: () => ALLOW_ALL,
  customer: () => DENY_ALL,
  agent: async (actor) => {
    const AgentModel = mongoose.model('Agent')
    const agent = await AgentModel.findOne({
      user: new mongoose.Types.ObjectId(actor.id),
    })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
    return agent ? { agent: agent._id } : DENY_ALL
  },
})

export const SettlementModel = mongoose.model<SettlementDoc>(
  'Settlement',
  settlementSchema,
)
