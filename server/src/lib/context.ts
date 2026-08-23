import { AsyncLocalStorage } from 'node:async_hooks'
import type { Role } from '@pdms/shared'

/**
 * Who is making the current request, carried implicitly so that Mongoose
 * query middleware can scope reads without every route handler remembering
 * to pass a user down (CLAUDE.md section 7).
 *
 * The alternative — threading `currentUser` through every service call — is
 * exactly the pattern section 7 rules out, because the day someone forgets
 * an argument is the day a customer sees another customer's parcel.
 */
export interface Actor {
  id: string
  role: Role
}

interface RequestStore {
  kind: 'request'
  /** Null while the request is unauthenticated. */
  actor: Actor | null
}

interface SystemStore {
  kind: 'system'
  reason: string
}

type Store = RequestStore | SystemStore

const storage = new AsyncLocalStorage<Store>()

/**
 * Wraps one HTTP request. Mounted globally in app.ts, so inside any route
 * there is always a store — which is what lets "no store at all" safely mean
 * "not an HTTP request" (the seed script, a cron job) rather than "a request
 * that forgot the middleware".
 */
export const runInRequestContext = <T>(
  actor: Actor | null,
  fn: () => T,
): T => storage.run({ kind: 'request', actor }, fn)

/**
 * Trusted, unscoped execution — the seed script, and the few server-side
 * lookups that must see records the caller cannot (finding a user by email
 * during login, before anyone is authenticated).
 *
 * `reason` is required so these show up as a grep-able list rather than
 * accumulating silently.
 */
export const runAsSystem = <T>(reason: string, fn: () => T): T =>
  storage.run({ kind: 'system', reason }, fn)

export const getStore = (): Store | undefined => storage.getStore()

/** The authenticated actor, or null when anonymous or running as system. */
export const currentActor = (): Actor | null => {
  const store = storage.getStore()
  return store?.kind === 'request' ? store.actor : null
}

/**
 * True when queries should bypass role scoping. Outside a request there is no
 * caller to scope to, so the seed script and other non-HTTP entry points run
 * unscoped by design.
 */
export const isSystemContext = (): boolean => {
  const store = storage.getStore()
  return store === undefined || store.kind === 'system'
}
