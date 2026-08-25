import type { ReactNode } from 'react'
import type { StatCard as StatCardData } from '@pdms/shared'

/**
 * The `.stat` pattern from docs/design-system-v3-meridian.html: a 38px chip at
 * radius-11 holding an 18px icon, beside a 12px muted label and a 21px mono
 * value with an optional delta.
 *
 * v3 gives one chip per screen the accent fill (`.chip.acc`) — the figure the
 * screen is actually about. Everything else is ink, so the accent still means
 * "this is the thing that moves".
 */

interface Props {
  label: string
  /** Already formatted — money through formatTaka, counts as plain numerals. */
  value: ReactNode
  icon: ReactNode
  /** The server's comparison against the previous window, when it made one. */
  stat?: StatCardData
  /** What the delta is measured against, e.g. "vs yesterday". */
  deltaLabel?: string
  /**
   * Whether a rise is good news. Delayed parcels going UP is bad, revenue going
   * up is good — so direction alone cannot pick the colour.
   */
  riseIsGood?: boolean
  /** The one figure this screen is about. At most one per view. */
  accent?: boolean
}

export const StatCard = ({
  label,
  value,
  icon,
  stat,
  deltaLabel,
  riseIsGood = true,
  accent = false,
}: Props) => {
  const delta = stat?.deltaPct ?? null
  const rising = delta !== null && delta > 0
  const good = delta === null || delta === 0 ? null : rising === riseIsGood

  return (
    <div className="flex items-center gap-3">
      <span
        className={[
          'w-[38px] h-[38px] rounded-chip text-white flex items-center justify-center flex-none',
          accent ? 'bg-accent' : 'bg-ink',
        ].join(' ')}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-meta text-muted font-medium">{label}</div>
        <div className="mono text-title font-medium tracking-[-0.04em] leading-[1.2]">
          {value}
          {delta !== null && delta !== 0 ? (
            <span
              className={[
                'text-eyebrow font-semibold ml-1.5 font-sans',
                good ? 'text-delivered' : 'text-failed',
              ].join(' ')}
            >
              {/* The reference's own glyphs: ▲ up, ▼ down. */}
              {rising ? '▲' : '▼'} {Math.abs(delta)}%
            </span>
          ) : null}
        </div>
        {deltaLabel && delta !== null ? (
          <div className="text-eyebrow text-faint">{deltaLabel}</div>
        ) : null}
      </div>
    </div>
  )
}

/** The four icons the dashboard uses, kept beside the component that draws them. */
const stroke = {
  viewBox: '0 0 24 24',
  width: 18,
  height: 18,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export const StatIcons = {
  /** The reference's own box glyph, used for deliveries. */
  parcel: (
    <svg {...stroke}>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  ),
  clock: (
    <svg {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  rider: (
    <svg {...stroke}>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M17 9h4M19 7v4" />
    </svg>
  ),
  taka: (
    <svg {...stroke}>
      <path d="M12 2v20" />
      <path d="M17 6.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
} as const
