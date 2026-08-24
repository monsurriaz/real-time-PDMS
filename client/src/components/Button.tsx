import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ink' | 'quiet'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Agent UI needs 48px minimum tap targets (CLAUDE.md section 4). */
  size?: 'md' | 'lg'
  children: ReactNode
}

/**
 * Ported from .btn in docs/design-system.html — same padding, radius,
 * weight and transition. No shadow, no gradient.
 *
 * `primary` is the orange one and means "moving"; a screen gets at most one.
 * Admin actions use `ink` (section 4).
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-press border-transparent',
  ink: 'bg-ink text-white hover:bg-black border-transparent',
  quiet:
    'bg-surface text-ink border-hairline-strong hover:bg-surface-sunk',
}

export const Button = ({
  variant = 'quiet',
  size = 'md',
  className = '',
  children,
  ...rest
}: Props) => (
  <button
    className={[
      'inline-flex items-center justify-center gap-2 font-sans font-semibold',
      'border cursor-pointer transition-colors duration-100',
      'disabled:opacity-55 disabled:cursor-not-allowed',
      size === 'lg'
        ? 'min-h-12 rounded-md px-22px py-4 text-[15.5px]'
        : 'rounded-sm px-5 py-11px text-sm',
      VARIANTS[variant],
      className,
    ].join(' ')}
    {...rest}
  >
    {children}
  </button>
)
