import { usePublicPricingSummary } from '../usePublicStats'

/**
 * v4 section 2 — the metrics strip beneath the hero. Bordered cells rather
 * than naked floating numbers, per the v3.1 addendum's own reasoning for the
 * hero's stat band, extended here to a second row of facts about the system
 * itself rather than its pricing.
 *
 * Zone count is the one figure that can drift from an admin's own data, so
 * it reads from the same `/pricing/summary` query the hero already fetches
 * (TanStack Query dedupes the two calls into one request). The other three
 * are structural facts about this build, not admin-editable config: the
 * lifecycle ramp is five states and frozen there (CLAUDE.md section 4), proof
 * of delivery has exactly three methods (PodCapture: photo, OTP, signature),
 * and booking/tracking have no operating hours because nothing about them
 * depends on a person being on shift.
 */
const CELLS = (zoneCount: number | undefined) => [
  { v: zoneCount ?? '—', k: 'Dhaka zones covered' },
  { v: '5', k: 'Lifecycle stages tracked' },
  { v: '3', k: 'Ways to prove delivery' },
  { v: '24/7', k: 'Booking and tracking' },
]

export const MetricsStrip = () => {
  const summary = usePublicPricingSummary()

  return (
    <div className="landing-metrics border-y border-border bg-surface">
      <div className="max-w-[1200px] mx-auto grid grid-cols-2 sm:grid-cols-4">
        {CELLS(summary.data?.zoneCount).map((c, i) => (
          <div
            key={c.k}
            className={`px-30px py-26px ${i < 3 ? 'sm:border-r border-border' : ''} ${i % 2 === 0 ? 'border-r sm:border-r-0 border-border' : ''}`}
          >
            {/* text-figure-xl (27px): the closest existing token to the
                reference's 28px — CLAUDE.md rule 1 forbids a raw bracket. */}
            <div className="mono text-figure-xl font-medium tracking-[-0.045em]">{c.v}</div>
            <div className="text-sm text-muted mt-3px">{c.k}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
