import { useSyncExternalStore } from 'react'

/**
 * Whether the idle background watcher (useIdleLocationWatcher, mounted once
 * in ShiftRail — see its own note on why not ShiftEditor) currently holds a
 * live `watchPosition`, and whether geolocation permission has come back
 * denied. ShiftEditor reads this to show "updating automatically" and to
 * explain a denied permission, without running a second watcher of its own.
 *
 * A plain external store via `useSyncExternalStore` (built into React 18) —
 * not Zustand. CLAUDE.md names Zustand as the project's client-state choice,
 * but it was never actually added as a dependency, and rule 2 (of section
 * "Never add a dependency without asking") means this — the one piece of
 * cross-component state this feature needs — isn't reason enough to ask for
 * one.
 */
interface LocationWatcherState {
  isWatching: boolean
  permissionDenied: boolean
}

let state: LocationWatcherState = { isWatching: false, permissionDenied: false }
const listeners = new Set<() => void>()

export const setLocationWatcherState = (patch: Partial<LocationWatcherState>): void => {
  const next = { ...state, ...patch }
  if (next.isWatching === state.isWatching && next.permissionDenied === state.permissionDenied) {
    return
  }
  state = next
  listeners.forEach((l) => l())
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = (): LocationWatcherState => state

export const useLocationWatcherState = (): LocationWatcherState =>
  useSyncExternalStore(subscribe, getSnapshot)
