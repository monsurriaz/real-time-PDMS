import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { deliveriesKey } from '../deliveries/useDeliveries'

/**
 * M8: "show remaining time on an offer so a rider knows it expires."
 *
 * Ticks once a second while a deadline is live. Milliseconds rather than a
 * pre-formatted string, so the caller decides how to show it (DeliveryDetail
 * wants "Xm Ys left"; a future caller might want something else).
 *
 * When the countdown reaches zero, it invalidates the deliveries query
 * exactly once — the expiry itself is evaluated on read, server-side (see
 * lifecycle.ts), so this is what turns "the clock ran out on screen" into an
 * actual read that catches it, rather than a rider staring at "Expired" next
 * to a live Accept button until they happen to navigate away and back.
 */
export const useOfferCountdown = (deadline: Date | string | null): number | null => {
  const qc = useQueryClient()
  const [now, setNow] = useState(() => Date.now())
  const invalidatedRef = useRef(false)

  useEffect(() => {
    invalidatedRef.current = false
    if (!deadline) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [deadline])

  if (!deadline) return null

  const remaining = Math.max(0, new Date(deadline).getTime() - now)

  if (remaining === 0 && !invalidatedRef.current) {
    invalidatedRef.current = true
    void qc.invalidateQueries({ queryKey: deliveriesKey })
  }

  return remaining
}

/** "12m 03s" while there's time left, "less than a minute" under one, else "Expired". */
export const formatOfferCountdown = (remainingMs: number): string => {
  if (remainingMs <= 0) return 'Expired'
  const totalSeconds = Math.ceil(remainingMs / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  if (m === 0) return `${s}s left`
  return `${m}m ${String(s).padStart(2, '0')}s left`
}
