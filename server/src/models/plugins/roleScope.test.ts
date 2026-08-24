import assert from 'node:assert/strict'
import { describe, it, before } from 'node:test'
import mongoose, { Schema } from 'mongoose'
import { runInRequestContext, runAsSystem } from '../../lib/context'
import {
  ALLOW_ALL,
  DENY_ALL,
  roleScopePlugin,
  scopeApplierFor,
} from './roleScope'

/**
 * The regression test for the scoping merge bug.
 *
 * What broke: the plugin applied its condition with `Query.where`, which
 * ASSIGNS into the condition object. When the scope constrained a path the
 * handler had already constrained — `_id` most dangerously — the scope replaced
 * the handler's condition instead of narrowing it.
 *
 * The consequence was not cosmetic. Socket room joins authorise with
 * `Parcel.exists({ _id: parcelId })` run inside the joiner's context, and
 * Parcel's agent rule is `{ _id: { $in: theirParcels } }`. The requested id was
 * dropped, so the query became "does this agent have any parcel at all" and any
 * agent with one assignment could join any parcel's room.
 *
 * These tests build real Queries and inspect the filter that comes out, driving
 * the very function the plugin registers — a test against a re-implementation
 * would not have caught this.
 */

const OWNER = '507f1f77bcf86cd799439011'
const OTHER = '507f1f77bcf86cd799439022'
const MINE_A = '507f1f77bcf86cd7994390aa'
const MINE_B = '507f1f77bcf86cd7994390bb'

interface Row {
  _id: mongoose.Types.ObjectId
  customer: mongoose.Types.ObjectId
  label: string
}

/**
 * The applier only ever reads and narrows the query it is bound to, and
 * `find` and `findById` produce differently-parameterised Query types. This is
 * the smallest surface that covers both without reaching for `any`.
 */
interface FilterableQuery {
  getFilter(): Record<string, unknown>
}
type Applier = (this: FilterableQuery) => Promise<void>

let Model: mongoose.Model<Row>
let apply: Applier

before(() => {
  const schema = new Schema<Row>({
    customer: { type: Schema.Types.ObjectId, required: true },
    label: { type: String, required: true },
  })

  // The two shapes that actually collide in this codebase: a scope on an
  // ownership field (Parcel/Payment for a customer) and a scope on `_id`
  // itself (Parcel for an agent).
  roleScopePlugin<Row>(schema, {
    admin: () => ALLOW_ALL,
    customer: (actor) => ({ customer: new mongoose.Types.ObjectId(actor.id) }),
    agent: () => ({
      _id: {
        $in: [new mongoose.Types.ObjectId(MINE_A), new mongoose.Types.ObjectId(MINE_B)],
      },
    }),
  })

  const found = scopeApplierFor(schema)
  assert.ok(found, 'the plugin must expose the applier it registered')
  apply = found as unknown as Applier
  Model = mongoose.model<Row>('ScopeTestRow', schema)
})

/** Build a query, run the real scope applier over it, return its filter. */
const filterFor = async (
  actor: { id: string; role: 'customer' | 'agent' | 'admin' } | null,
  build: () => FilterableQuery,
): Promise<Record<string, unknown>> => {
  const query = runInRequestContext(actor, build)
  await runInRequestContext(actor, async () => apply.call(query))
  return query.getFilter()
}

/** Does this filter still require the path/value the handler asked for? */
const requires = (
  filter: Record<string, unknown>,
  path: string,
  value: unknown,
): boolean => {
  const matches = (obj: Record<string, unknown>): boolean =>
    JSON.stringify(obj[path]) === JSON.stringify(value)
  if (matches(filter)) return true
  const and = filter.$and as Array<Record<string, unknown>> | undefined
  return Array.isArray(and) && and.some(matches)
}

describe('role scoping merges rather than replaces', () => {
  it('keeps a handler _id filter when the scope also constrains _id', async () => {
    // THE bug. `findById(OTHER)` as an agent must not become "any of mine".
    const filter = await filterFor({ id: OWNER, role: 'agent' }, () =>
      Model.findById(OTHER),
    )
    assert.ok(
      requires(filter, '_id', new mongoose.Types.ObjectId(OTHER)),
      `the requested id was dropped: ${JSON.stringify(filter)}`,
    )
    assert.ok(
      JSON.stringify(filter).includes(MINE_A),
      'the scope condition must still be present too',
    )
  })

  it('produces a filter that can never match a parcel that is not theirs', async () => {
    /**
     * The socket-join shape, asserted as arithmetic on the filter rather than
     * against a database: `_id` must equal OTHER *and* be in [MINE_A, MINE_B].
     * Those are disjoint, so the query matches nothing — which is the whole
     * point of the fix.
     */
    const filter = await filterFor({ id: OWNER, role: 'agent' }, () =>
      Model.find({ _id: new mongoose.Types.ObjectId(OTHER) }),
    )
    const conditions = [
      filter,
      ...((filter.$and as Array<Record<string, unknown>> | undefined) ?? []),
    ]
    const wantsExact = conditions.find((c) => c._id instanceof mongoose.Types.ObjectId)
    const wantsOneOfMine = conditions.find(
      (c) => typeof c._id === 'object' && c._id !== null && '$in' in (c._id as object),
    )
    assert.ok(wantsExact, 'the exact id condition survived')
    assert.ok(wantsOneOfMine, 'the ownership condition survived')
    const allowed = (wantsOneOfMine?._id as { $in: mongoose.Types.ObjectId[] }).$in.map(
      (o) => o.toString(),
    )
    assert.ok(
      !allowed.includes(OTHER),
      'and the two are contradictory, so nothing matches',
    )
  })

  it('keeps both conditions when a handler filters the ownership field itself', async () => {
    // The settlements shape: `?agentId=<someone else>` used to return your own
    // rows, filtered by a condition the response no longer reflected.
    const filter = await filterFor({ id: OWNER, role: 'customer' }, () =>
      Model.find({ customer: new mongoose.Types.ObjectId(OTHER) }),
    )
    assert.ok(requires(filter, 'customer', new mongoose.Types.ObjectId(OTHER)))
    assert.ok(JSON.stringify(filter).includes(OWNER))
  })

  it('leaves a handler filter on an unrelated path alone', async () => {
    const filter = await filterFor({ id: OWNER, role: 'customer' }, () =>
      Model.find({ label: 'hello' }),
    )
    assert.equal(filter.label, 'hello')
    assert.ok(JSON.stringify(filter).includes(OWNER))
  })

  it('adds nothing for an admin', async () => {
    const filter = await filterFor({ id: OWNER, role: 'admin' }, () =>
      Model.findById(OTHER),
    )
    assert.deepEqual(Object.keys(filter), ['_id'])
  })

  it('adds nothing when running as the system', async () => {
    const query = Model.findById(OTHER)
    await runAsSystem('test', async () => apply.call(query))
    assert.deepEqual(Object.keys(query.getFilter()), ['_id'])
  })

  it('denies everything for an anonymous caller, without dropping their filter', async () => {
    const filter = await filterFor(null, () => Model.find({ label: 'hello' }))
    assert.equal(filter.label, 'hello')
    assert.ok(JSON.stringify(filter).includes('$exists'))
  })

  it('denies a role with no rule at all', async () => {
    const schema = new Schema<Row>({ label: String })
    roleScopePlugin<Row>(schema, { admin: () => ALLOW_ALL })
    const applyBare = scopeApplierFor(schema) as unknown as Applier | undefined
    assert.ok(applyBare)
    const Bare = mongoose.model<Row>('ScopeTestBare', schema)
    const query = Bare.find({ label: 'x' })
    await runInRequestContext({ id: OWNER, role: 'customer' }, async () =>
      applyBare.call(query),
    )
    assert.ok(JSON.stringify(query.getFilter()).includes('$exists'))
  })

  it('denies a DENY_ALL rule while keeping the handler filter', async () => {
    const schema = new Schema<Row>({ label: String })
    roleScopePlugin<Row>(schema, { customer: () => DENY_ALL })
    const applyDeny = scopeApplierFor(schema) as unknown as Applier | undefined
    assert.ok(applyDeny)
    const Denied = mongoose.model<Row>('ScopeTestDenied', schema)
    const query = Denied.find({ label: 'x' })
    await runInRequestContext({ id: OWNER, role: 'customer' }, async () =>
      applyDeny.call(query),
    )
    const filter = query.getFilter()
    assert.equal(filter.label, 'x')
    assert.ok(JSON.stringify(filter).includes('$exists'))
  })

  it('stacks correctly when two scoped conditions are applied to one query', async () => {
    // A query that passes through the hook twice (find + count on the same
    // builder) must not lose either condition.
    const query = Model.find({ _id: new mongoose.Types.ObjectId(OTHER) })
    await runInRequestContext({ id: OWNER, role: 'agent' }, async () => {
      await apply.call(query)
      await apply.call(query)
    })
    const and = (query.getFilter() as { $and?: unknown[] }).$and
    assert.equal(and?.length, 2, 'both applications are recorded, neither replaced')
  })
})
