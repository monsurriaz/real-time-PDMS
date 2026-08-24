/**
 * Serialises calls and guarantees a minimum gap between them.
 *
 * Nominatim's usage policy caps us at 1 request per second (CLAUDE.md section
 * 2), and that is an absolute ceiling rather than an average — bursting five
 * requests in a second then idling for four is still a violation. So callers
 * are queued rather than rejected: a booking that needs two addresses geocoded
 * simply takes a second longer instead of failing.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export interface Throttle {
  run: <T>(fn: () => Promise<T>) => Promise<T>
  /** Queue depth, for logging and tests. */
  pending: () => number
}

export const createThrottle = (minIntervalMs: number): Throttle => {
  let lastStartedAt = 0
  let queued = 0
  // The tail of the chain. Every new call links onto it, which is what
  // serialises them without a separate queue structure.
  let tail: Promise<unknown> = Promise.resolve()

  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    queued += 1

    const start = async (): Promise<T> => {
      const wait = minIntervalMs - (Date.now() - lastStartedAt)
      if (wait > 0) await sleep(wait)
      lastStartedAt = Date.now()
      try {
        return await fn()
      } finally {
        queued -= 1
      }
    }

    // Link onto the tail regardless of whether the previous call succeeded —
    // one failed lookup must not stall every later one.
    const result = tail.then(start, start)
    tail = result.catch(() => undefined)
    return result
  }

  return { run, pending: () => queued }
}
