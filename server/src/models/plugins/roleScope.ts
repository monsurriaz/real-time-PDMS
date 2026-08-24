import type { FilterQuery, Query, Schema } from 'mongoose'
import type { Role } from '@pdms/shared'
import { currentActor, isSystemContext, type Actor } from '../../lib/context'
import { isProd } from '../../lib/env'

/**
 * Role scoping as query middleware (CLAUDE.md section 7).
 *
 * Each model declares, once, how each role may narrow it. Every find/count/
 * update then has that filter merged in automatically, so a route handler
 * cannot forget it — the worst a careless handler can do is return fewer
 * documents than intended, never more.
 *
 * A rule returns:
 *   - an object -> merged into the query as an additional condition
 *   - DENY_ALL  -> matches nothing (fail closed)
 *   - ALLOW_ALL -> no restriction, for admins
 */

export const ALLOW_ALL = Symbol('allow-all')
export const DENY_ALL = Symbol('deny-all')

export type ScopeResult<T> =
  | FilterQuery<T>
  | typeof ALLOW_ALL
  | typeof DENY_ALL

export type ScopeRule<T> = (
  actor: Actor,
) => ScopeResult<T> | Promise<ScopeResult<T>>

/**
 * Roles absent from this map are denied. Defaulting to deny means adding a
 * fourth role later cannot accidentally grant it blanket read access.
 */
export type ScopeRules<T> = Partial<Record<Role, ScopeRule<T>>>

/** Read and count operations. */
const READ_HOOKS = [
  'find',
  'findOne',
  'findOneAndUpdate',
  'findOneAndDelete',
  'findOneAndReplace',
  'countDocuments',
  'distinct',
] as const

/**
 * Writes are scoped too. Without this, an agent could not *read* another
 * agent's delivery but could still blind-update it by _id.
 */
const WRITE_HOOKS = [
  'updateOne',
  'updateMany',
  'deleteOne',
  'deleteMany',
  'replaceOne',
] as const

/** A filter that can never match — Mongo has no false literal. */
const IMPOSSIBLE = { _id: { $exists: false } } as const

/**
 * Add a condition to a query so it ANDs with whatever the handler already asked
 * for.
 *
 * `Query.where` is the obvious call and the wrong one: it assigns into the
 * condition object, so a scope condition on a path the handler had already
 * constrained REPLACES it rather than narrowing it. `Query.and` appends to
 * `$and`, which is the only merge that cannot silently drop either side.
 *
 * That distinction was a live authorisation bug, not a theoretical one. Socket
 * room joins authorise with `ParcelModel.exists({ _id: parcelId })` inside the
 * joiner's context, and Parcel's rule for an agent is `{ _id: { $in: theirs } }`
 * — same path. With `where`, the requested id was overwritten by the list of
 * their own, so ANY agent holding at least one assignment could join ANY
 * parcel's room and receive its position stream.
 */
const narrow = <T>(query: Query<unknown, T>, condition: FilterQuery<T>): void => {
  query.and([condition])
}

/**
 * The applier each schema was given, so a test can invoke exactly what runs in
 * production. A WeakMap rather than a field on the schema: nothing outside the
 * test has any business reaching for it.
 */
const scopeAppliers = new WeakMap<
  Schema<never>,
  (this: Query<unknown, never>) => Promise<void>
>()

export const scopeApplierFor = <T>(
  schema: Schema<T>,
): ((this: Query<unknown, T>) => Promise<void>) | undefined =>
  scopeAppliers.get(schema as unknown as Schema<never>) as
    | ((this: Query<unknown, T>) => Promise<void>)
    | undefined

export const roleScopePlugin = <T>(
  schema: Schema<T>,
  rules: ScopeRules<T>,
): void => {
  const applyScope = async function (
    this: Query<unknown, T>,
  ): Promise<void> {
    // The seed script and pre-auth lookups run unscoped on purpose.
    if (isSystemContext()) return

    const actor = currentActor()
    if (!actor) {
      /**
       * Anonymous request touching a scoped collection. Nothing is public, so
       * this denies everything — which is correct, but it is also exactly what
       * a mislaid runAsSystem looks like: a pre-auth lookup that was meant to
       * be unscoped silently returns zero documents instead. Saying so in
       * development turns a confusing empty result into an obvious one.
       */
      if (!isProd) {
        console.warn(
          `[roleScope] anonymous read of ${this.model.modelName} denied all documents. ` +
            'If this was a pre-auth lookup, it must run inside runAsSystem — ' +
            'and start the query there (.exec()), since a Query is lazy.',
        )
      }
      narrow(this, IMPOSSIBLE as FilterQuery<T>)
      return
    }

    const rule = rules[actor.role]
    if (!rule) {
      narrow(this, IMPOSSIBLE as FilterQuery<T>)
      return
    }

    const result = await rule(actor)
    if (result === ALLOW_ALL) return
    if (result === DENY_ALL) {
      narrow(this, IMPOSSIBLE as FilterQuery<T>)
      return
    }
    narrow(this, result)
  }

  /**
   * Exported for the regression test, which drives it against a real Query and
   * inspects the filter that comes out. Registering the same function the test
   * calls is the point — a test against a re-implementation would not have
   * caught the `where`/`and` distinction above.
   */
  scopeAppliers.set(
    schema as unknown as Schema<never>,
    applyScope as unknown as (this: Query<unknown, never>) => Promise<void>,
  )

  for (const hook of [...READ_HOOKS, ...WRITE_HOOKS]) {
    schema.pre(hook, applyScope)
  }

  /**
   * Aggregation bypasses query middleware entirely, so it is not covered
   * here. M6's analytics must therefore either run as system with an explicit
   * $match, or go through find(). Left as a documented gap rather than a
   * silent one.
   */
}

/** Convenience for the common "admins see everything" arm. */
export const adminSeesAll = (): typeof ALLOW_ALL => ALLOW_ALL
