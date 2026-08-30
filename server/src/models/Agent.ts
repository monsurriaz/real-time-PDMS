import mongoose, { Schema } from 'mongoose'
import {
  agentApprovalStatusSchema,
  agentStatusSchema,
  vehicleSchema,
  zoneName,
  type Agent,
} from '@pdms/shared'
import type { Doc } from './types'
import { optionalPoint } from './geo'
import { ALLOW_ALL, DENY_ALL, roleScopePlugin } from './plugins/roleScope'

export type AgentDoc = Doc<Agent, 'user'>

const approvalEventSchema = new Schema(
  {
    status: { type: String, required: true, enum: ['approved', 'rejected'] },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { _id: false },
)

const agentMongooseSchema = new Schema<AgentDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    zones: {
      type: [String],
      required: true,
      enum: zoneName.options,
      validate: {
        validator: (v: string[]) => v.length > 0,
        message: 'an agent must cover at least one zone',
      },
    },
    vehicle: { type: String, required: true, enum: vehicleSchema.options },
    status: {
      type: String,
      required: true,
      enum: agentStatusSchema.options,
      default: 'offline',
      index: true,
    },
    /**
     * A self-registered rider starts pending and is invisible to assignment
     * (services/assignment.ts filters on this directly — see the tests
     * there) until an admin approves them from /admin/agents.
     */
    approvalStatus: {
      type: String,
      required: true,
      enum: agentApprovalStatusSchema.options,
      default: 'pending',
      index: true,
    },
    nid: { type: String, required: true, trim: true },
    /** Append-only, per approve/reject decision. Never edited in place. */
    approvalHistory: { type: [approvalEventSchema], required: true, default: [] },
    currentLocation: optionalPoint,
    locationUpdatedAt: { type: Date, required: false },
    /** M9.7: a readable label for currentLocation — see shared/schemas/agent.ts. */
    locationLabel: { type: String, required: false },
  },
  { timestamps: true },
)

/**
 * The index that makes nearest-agent assignment possible (CLAUDE.md section
 * 5). Sparse because an offline agent who has never reported a position has
 * no currentLocation, and a 2dsphere index rejects null geometry.
 */
agentMongooseSchema.index({ currentLocation: '2dsphere' }, { sparse: true })

/** Compound: assignment always filters status + approval + zone before going geo. */
agentMongooseSchema.index({ status: 1, approvalStatus: 1, zones: 1 })

/**
 * An agent reads only their own record. Customers get DENY_ALL here — during
 * tracking they see a *projection* of the assigned rider (name, vehicle,
 * position) built server-side from the delivery, never this document, because
 * section 7 forbids exposing another user's contact details.
 */
roleScopePlugin<AgentDoc>(agentMongooseSchema, {
  admin: () => ALLOW_ALL,
  agent: (actor) => ({ user: new mongoose.Types.ObjectId(actor.id) }),
  customer: () => DENY_ALL,
})

export const AgentModel = mongoose.model<AgentDoc>('Agent', agentMongooseSchema)
