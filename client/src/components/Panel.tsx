import type { ReactNode } from 'react'

/**
 * The `.panel` pattern from docs/design-system.html: surface on a 1px
 * hairline, radius-lg, 22px padding, with a 13px muted heading. No shadow.
 */
interface PanelProps {
  title?: string
  /** Small right-aligned content in the header row, e.g. a button. */
  action?: ReactNode
  children: ReactNode
  className?: string
}

export const Panel = ({ title, action, children, className = '' }: PanelProps) => (
  <section
    className={`bg-surface border border-hairline rounded-lg p-22px ${className}`}
  >
    {title || action ? (
      <div className="flex items-baseline justify-between gap-4 mb-4">
        {title ? (
          <h3 className="text-[13px] font-semibold text-muted tracking-[-0.005em]">
            {title}
          </h3>
        ) : null}
        {action}
      </div>
    ) : null}
    {children}
  </section>
)

/**
 * The `.eyebrow` label — 11px, uppercase, wide tracking, faint.
 *
 * `tone="strong"` swaps --faint for --muted. Not a restyle: --faint on white is
 * 2.88:1, which is legible on a desk and genuinely is not on a phone in Dhaka
 * daylight, and CLAUDE.md section 4 is explicit that riders work outdoors. The
 * agent screens ask for it; every other screen keeps the reference appearance,
 * because the design system is frozen and this is the one place with a stated
 * reason to differ.
 */
export const Eyebrow = ({
  children,
  tone = 'faint',
}: {
  children: ReactNode
  tone?: 'faint' | 'strong'
}) => (
  <p
    className={[
      'text-[11px] font-semibold uppercase tracking-[0.13em] mb-10px',
      tone === 'strong' ? 'text-muted' : 'text-faint',
    ].join(' ')}
  >
    {children}
  </p>
)

/**
 * The `.kv` row — label left, value right, hairline underneath, none on the
 * last one. Used for the price breakdown and parcel details.
 */
export const KeyValue = ({
  k,
  children,
}: {
  k: string
  children: ReactNode
}) => (
  <div className="flex justify-between items-baseline py-10px border-b border-hairline last:border-b-0">
    <span className="text-[12.5px] text-muted">{k}</span>
    <span className="text-[13.5px]">{children}</span>
  </div>
)

/**
 * The `.note` callout — accent left rule on accent-tint. Used sparingly; it
 * is the only place orange appears outside a primary button.
 */
export const Note = ({ children }: { children: ReactNode }) => (
  <div className="mt-22px py-15px px-17px border-l-2 border-accent bg-accent-tint rounded-r-sm text-[13.5px] text-ink-2">
    {children}
  </div>
)
