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
 * So this is the emphasis form: the measure that matters (completed) in ink,
 * everything still open as a recessive track, and every other number printed
 * beside the bar as a mono figure. Nobody has to distinguish two hues to read
 * it, which also means it survives a rider's phone in daylight and a printout.
 *
 * Horizontal because the categories are long-named Dhaka zones, and no reader
 * should have to tilt their head to find Mohammadpur.
 */

interface Props {
  zones: readonly ZonePerformance[]
}

/** The bar itself. A 2px surface gap keeps the two segments from touching. */
const Bar = ({
  completed,
  open,
  max,
}: {
  completed: number
  open: number
  max: number
}) => {
  const pct = (n: number): string => `${max > 0 ? (n / max) * 100 : 0}%`
  return (
    <div className="flex items-center gap-[2px] h-[10px]" aria-hidden="true">
      {completed > 0 ? (
        <span
          className="h-full bg-ink rounded-pill"
          style={{ width: pct(completed) }}
        />
      ) : null}
      {open > 0 ? (
        <span
          className="h-full bg-hairline-strong rounded-pill"
          style={{ width: pct(open) }}
        />
      ) : null}
    </div>
  )
}

const Swatch = ({ className, label }: { className: string; label: string }) => (
  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
    <span className={`w-[10px] h-[10px] rounded-pill ${className}`} />
    {label}
  </span>
)

export const ZonePerformanceChart = ({ zones }: Props) => {
  const [hovered, setHovered] = useState<string | null>(null)
  const max = zones.reduce((m, z) => Math.max(m, z.total), 0)

  if (zones.length === 0 || max === 0) {
    return (
      <p className="text-[13.5px] text-muted">
        No parcels have been booked into any zone yet. Book one, or run the seed
        script, and the zones appear here.
      </p>
    )
  }

  return (
    <div>
      {/* Two segments, so a legend is present — identity is never colour-alone. */}
      <div className="flex flex-wrap gap-4 mb-5">
        <Swatch className="bg-ink" label="Delivered" />
        <Swatch className="bg-hairline-strong" label="Still moving" />
        <span className="text-[11.5px] text-faint">
          Failed and cancelled parcels are counted in the numbers, not the bar.
        </span>
      </div>

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
              <span className="text-[13px] font-medium">{z.zone}</span>
              {/* Direct-labelled, so the recessive track never has to carry
                  meaning on contrast alone. */}
              {z.total > 0 ? (
                <span className="mono text-[12.5px] text-muted">
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
              <p className="text-[11.5px] text-faint">
                No parcels booked into this zone yet.
              </p>
            ) : (
              <Bar completed={z.completed} open={z.open} max={max} />
            )}

            <div
              className={[
                'flex flex-wrap items-baseline gap-x-4 gap-y-0.5 mt-1.5 text-[11.5px]',
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
