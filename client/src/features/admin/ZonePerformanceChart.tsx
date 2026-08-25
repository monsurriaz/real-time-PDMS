import { useState } from 'react'
import type { ZonePerformance } from '@pdms/shared'
import { formatTaka } from '@/lib/format'

/**
 * Zone-wise performance: one horizontal bar per zone, drawn as the design
 * system's `.ramp-bar` (10px, pill radius, flex segments).
 *
 * WHY IT IS SINGLE-HUE. The obvious chart here is a stacked bar coloured by
 * lifecycle status, and it is the wrong one. Run the lifecycle ramp through a
 * colour-vision check and the reserved statuses fail as an adjacent categorical
 * set: transit orange against failed red is ΔE 8.7 for a reader with *normal*
 * vision, and orange against delivered green falls to 5.9 under protanopia.
 * The design system is frozen (CLAUDE.md rule 2), so the palette cannot be
 * fixed — the form has to change instead.
 *
 * So this is the emphasis form: the measure that matters (completed) as an ink
 * fill in a sunk track, and every other number printed beside the bar as a mono
 * figure. Nobody has to distinguish two hues to read it, which also means it
 * survives a printout — and it is why v3 kept the form when the palette
 * changed underneath it.
 *
 * Horizontal because the categories are long-named Dhaka zones, and no reader
 * should have to tilt their head to find Mohammadpur.
 */

interface Props {
  zones: readonly ZonePerformance[]
}

/**
 * v3's zone bar: a 7px sunk track with an ink fill for the delivered share.
 *
 * The old build drew two abutting segments and needed a 2px gap between them
 * to stay readable. A filled track says the same thing with one shape, and it
 * stays legible at 7px where two segments did not.
 */
const Bar = ({ completed, total }: { completed: number; total: number }) => (
  <div
    className="flex h-[7px] rounded-pill overflow-hidden bg-surface-sunk"
    aria-hidden="true"
  >
    <span
      className="bg-ink"
      style={{ width: `${total > 0 ? (completed / total) * 100 : 0}%` }}
    />
  </div>
)

export const ZonePerformanceChart = ({ zones }: Props) => {
  const [hovered, setHovered] = useState<string | null>(null)
  const max = zones.reduce((m, z) => Math.max(m, z.total), 0)

  if (zones.length === 0 || max === 0) {
    return (
      <p className="text-body text-muted">
        No parcels have been booked into any zone yet. Book one, or run the seed
        script, and the zones appear here.
      </p>
    )
  }

  return (
    <div>
      <p className="text-tiny text-faint mb-4">
        The bar is the delivered share of each zone. Failed and cancelled
        parcels are counted in the numbers beside it, not in the bar.
      </p>

      <div className="grid gap-4">
        {zones.map((z) => (
          <div
            key={z.zone}
            onMouseEnter={() => setHovered(z.zone)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(z.zone)}
            onBlur={() => setHovered(null)}
            tabIndex={0}
            className="rounded-sm focus-visible:outline-none"
          >
            <div className="flex items-baseline justify-between gap-4 mb-1.5">
              <span className="text-sm font-medium">{z.zone}</span>
              {/* Direct-labelled, so the recessive track never has to carry
                  meaning on contrast alone. */}
              {z.total > 0 ? (
                <span className="mono text-small text-muted">
                  <span className="text-ink font-medium">{z.completed}</span>
                  {' / '}
                  {z.total}
                  <span className="text-faint"> delivered</span>
                </span>
              ) : null}
            </div>

            {z.total === 0 ? (
              // A serviceable zone with no parcels. An empty bar reads as a
              // rendering fault; saying so reads as a fact about the business.
              <p className="text-tiny text-faint">
                No parcels booked into this zone yet.
              </p>
            ) : (
              <Bar completed={z.completed} total={z.total} />
            )}

            <div
              className={[
                'flex flex-wrap items-baseline gap-x-4 gap-y-0.5 mt-1.5 text-tiny',
                z.total === 0 ? 'hidden' : '',
              ].join(' ')}
            >
              <span className="text-muted">
                Success{' '}
                <span className="mono text-ink">
                  {z.successRate === null ? '—' : `${Math.round(z.successRate * 100)}%`}
                </span>
              </span>
              <span className="text-muted">
                Median{' '}
                <span className="mono text-ink">
                  {z.medianMinutes === null
                    ? '—'
                    : z.medianMinutes >= 60
                      ? `${(z.medianMinutes / 60).toFixed(1)} h`
                      : `${z.medianMinutes} min`}
                </span>
              </span>
              <span className="text-muted">
                Revenue <span className="mono text-ink">{formatTaka(z.revenue)}</span>
              </span>
              {z.delayed > 0 ? (
                <span className="text-failed-ink font-medium">
                  {z.delayed} delayed
                </span>
              ) : null}
              {z.failed > 0 ? (
                <span className="text-muted">
                  Failed <span className="mono">{z.failed}</span>
                </span>
              ) : null}
              {hovered === z.zone && z.cancelled > 0 ? (
                <span className="text-faint">
                  {z.cancelled} cancelled before pickup
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
