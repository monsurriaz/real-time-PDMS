import type { LocationBroadcast, MessageBroadcast, StatusChanged } from '@pdms/shared'

/**
 * A one-slot registry so the lifecycle service can announce a status change
 * without importing the socket server.
 *
 * The alternative — lifecycle.ts importing sockets/index.ts, which imports
 * lifecycle.ts — is a cycle. It would also drag a Socket.io server into every
 * unit test and into the seed script, neither of which has one. The default
 * implementation does nothing, so advanceStatus behaves identically whether a
 * socket layer is running or not.
 */

export interface Broadcaster {
  statusChanged: (payload: StatusChanged) => void
  location: (payload: LocationBroadcast) => void
  /** M9: a customer or rider posted into a delivery's message thread. */
  message: (payload: MessageBroadcast) => void
}

const noop: Broadcaster = {
  statusChanged: () => undefined,
  location: () => undefined,
  message: () => undefined,
}

let current: Broadcaster = noop

export const registerBroadcaster = (b: Broadcaster): void => {
  current = b
}

/** Used by tests to put the registry back to inert. */
export const resetBroadcaster = (): void => {
  current = noop
}

export const broadcast: Broadcaster = {
  statusChanged: (payload) => {
    current.statusChanged(payload)
  },
  location: (payload) => {
    current.location(payload)
  },
  message: (payload) => {
    current.message(payload)
  },
}
