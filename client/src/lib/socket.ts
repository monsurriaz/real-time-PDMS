import { io, type Socket } from 'socket.io-client'
import { SOCKET_EVENTS, type ConnectionMode, type JoinResult } from '@pdms/shared'

/**
 * One socket for the whole app.
 *
 * Authentication is the httpOnly JWT cookie the browser already holds — the
 * handshake carries it automatically, which is why there is no token to pass
 * here (CLAUDE.md section 7: no second auth mechanism).
 */

/**
 * In development the socket must reach the API directly. Vite's /api proxy
 * handles HTTP, but websockets need their own origin, so this points at the
 * server's port rather than the dev server's.
 */
const socketUrl = (): string => {
  const configured = import.meta.env?.VITE_SOCKET_URL
  if (configured) return configured
  // Deployed, client and API share nothing but the configured base URL.
  return import.meta.env?.VITE_API_BASE_URL ?? window.location.origin
}

let socket: Socket | null = null

export const getSocket = (): Socket => {
  if (socket) return socket
  socket = io(socketUrl(), {
    withCredentials: true,
    // Socket.io reconnects on its own with backoff; section 6's REST polling
    // covers the gap in between rather than replacing it.
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 5_000,
    transports: ['websocket', 'polling'],
  })
  return socket
}

/** Closes the shared socket. Used on sign-out, so the next user re-handshakes. */
export const closeSocket = (): void => {
  socket?.close()
  socket = null
}

export const joinParcelRoom = (parcelId: string): Promise<JoinResult> =>
  new Promise((resolve) => {
    const s = getSocket()
    s.emit(SOCKET_EVENTS.join, parcelId, (result: JoinResult) => resolve(result))
    // A refused or lost handshake must not leave the caller hanging.
    setTimeout(
      () => resolve({ parcelId, ok: false, reason: 'join timed out' }),
      6_000,
    )
  })

export const leaveParcelRoom = (parcelId: string): void => {
  socket?.emit(SOCKET_EVENTS.leave, parcelId)
}

/** Maps socket.io's state onto the mode the UI shows the user. */
export const modeFor = (
  connected: boolean,
  everConnected: boolean,
  pollingWorks: boolean,
): ConnectionMode => {
  if (connected) return 'live'
  if (!everConnected) return 'connecting'
  return pollingWorks ? 'polling' : 'offline'
}
