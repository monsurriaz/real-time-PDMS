import type { ReactNode } from 'react'

/**
 * `.card` from docs/design-system-v3-meridian.html: a white surface on a 1px
 * border at radius-lg, on the cool page. No shadow — separation is the border.
 *
 * This replaces the old `Panel`. The difference is not cosmetic: v3 separates
 * the padded body (`.cardpad`) from a bordered header strip (`.cardhead`), so
 * a card with a title has a rule under it and a card without one does not.
 */
interface CardProps {
  /** Rendered in the bordered header strip. */
  title?: string
  /** Right-aligned in the header — a Pill, an Export button, a count. */
  action?: ReactNode
  children: ReactNode
  className?: string
  /**
   * Off when the card's body supplies its own padding — a table runs edge to
   * edge, and 22px of card padding around it would break the header's rule.
   */
  pad?: boolean
}

export const Card = ({
  title,
  action,
  children,
  className = '',
  pad = true,
}: CardProps) => (
  <section className={`bg-surface border border-border rounded-lg ${className}`}>
    {title || action ? (
      <div className="flex items-center gap-10px px-5 py-15px border-b border-border">
        {title ? (
          <h3 className="text-base font-semibold tracking-[-0.015em]">{title}</h3>
        ) : null}
        {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
      </div>
    ) : null}
    {pad ? <div className="px-22px py-5">{children}</div> : children}
  </section>
)

/**
 * The `.eyebrow` label — 10.5px, uppercase, wide tracking, faint.
 *
 * `tone="strong"` swaps --faint for --muted, and the reason survived the
 * palette change: v3's --faint is 2.63:1 on white, which is legible on a desk
 * and genuinely is not on a phone in Dhaka daylight. The rider screens ask for
 * it; every other screen keeps the reference appearance.
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
      'text-micro font-semibold uppercase tracking-[0.11em]',
      // --ink-2, not --muted: at 10.5px, --muted measures 4.34:1 — just under
      // AA — and this tone exists precisely for the screens a rider reads
      // outdoors. --ink-2 is 9.5:1 and is still a v3 token.
      tone === 'strong' ? 'text-ink-2' : 'text-faint',
    ].join(' ')}
  >
    {children}
  </p>
)

/**
 * The `.kv` row — label left, value right, border underneath, none on the
 * last. Used for the price breakdown and the tracking detail column.
 */
export const KeyValue = ({ k, children }: { k: string; children: ReactNode }) => (
  <div className="flex justify-between items-baseline py-2 border-b border-border last:border-b-0">
    <span className="text-small text-muted">{k}</span>
    <span className="text-sm">{children}</span>
  </div>
)

/**
 * The `.note` callout — accent left rule on accent-tint. Used sparingly; it is
 * one of the few places the accent appears outside a primary button and the
 * in-transit state.
 */
export const Note = ({ children }: { children: ReactNode }) => (
  <div className="mt-5 py-14px px-4 border-l-2 border-accent bg-accent-tint rounded-r-sm text-body text-ink-2">
    {children}
  </div>
)
