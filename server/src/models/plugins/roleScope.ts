import type { FilterQuery, Query, Schema } from 'mongoose'
import type { Role } from '@pdms/shared'
import { currentActor, isSystemContext, type Actor } from '../../lib/context'

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
      // Anonymous request touching a scoped collection. Nothing is public.
      this.where(IMPOSSIBLE as FilterQuery<T>)
      return
    }

    const rule = rules[actor.role]
    if (!rule) {
      this.where(IMPOSSIBLE as FilterQuery<T>)
      return
    }

    const result = await rule(actor)
    if (result === ALLOW_ALL) return
    if (result === DENY_ALL) {
      this.where(IMPOSSIBLE as FilterQuery<T>)
      return
    }
    // `where` merges rather than replaces, so a handler's own conditions and
    // this scope both apply.
    this.where(result)
  }

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
