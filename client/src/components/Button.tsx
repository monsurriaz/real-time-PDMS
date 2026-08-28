import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'ink' | 'quiet' | 'ghost'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  /**
   * Renders as an `<a>` instead of a `<button>`, same look — a `tel:` link
   * needs real anchor semantics (long-press, share sheet), not a button that
   * fakes one with an onClick. No other props apply in this mode.
   */
  href?: string
}

/**
 * `.btn` from docs/design-system-v3-meridian.html — same padding, radius,
 * weight and tracking. No shadow, no gradient.
 *
 * `primary` is ultramarine and means "this moves a parcel forward"; a view gets
 * at most one. `ink` is for administrative actions, `quiet` for everything
 * else, `ghost` for the ones that should barely register.
 */
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
  ink: 'bg-ink text-white hover:bg-chrome border-transparent',
  quiet: 'bg-surface text-ink-2 border-border-strong hover:bg-surface-sunk',
  ghost: 'bg-transparent text-muted border-transparent hover:text-ink',
}

const SIZES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'px-3 py-6px text-small rounded-sm',
  md: 'px-17px py-10px text-body rounded-sm',
  lg: 'px-22px py-13px text-base rounded-md',
}

/**
 * Disabled is NEUTRAL, never a faded accent.
 *
 * v3 is explicit about this and it fixes a real complaint: the old build
 * dimmed the accent to 55% opacity, and a washed-out orange "Mark delivered"
 * read as broken rather than as unavailable. Grey on sunk grey reads as "not
 * yet", which is what it means.
 */
const DISABLED =
  'disabled:bg-surface-sunk disabled:text-faint disabled:border-border ' +
  'disabled:cursor-not-allowed disabled:hover:bg-surface-sunk'

export const Button = ({
  variant = 'quiet',
  size = 'md',
  className = '',
  children,
  href,
  ...rest
}: Props) => {
  const classes = [
    'inline-flex items-center justify-center gap-7px font-sans font-semibold',
    'border cursor-pointer transition-colors duration-100 tracking-[-0.01em]',
    SIZES[size],
    VARIANTS[variant],
    DISABLED,
    className,
  ].join(' ')

  if (href !== undefined) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    )
  }

  return (
    <button className={classes} {...rest}>
      {children}
    </button>
  )
}
