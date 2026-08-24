import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { useId } from 'react'

/**
 * The `.field` pattern from docs/design-system.html: 12.5px label in ink-2,
 * 14.5px input, hairline-strong border, accent focus ring. Shared by the
 * booking form and the admin pricing editor so neither invents its own.
 */

const CONTROL = [
  'w-full font-sans text-[14.5px] text-ink px-13px py-11px',
  'border rounded-sm bg-surface outline-none',
  'focus:border-accent focus:ring-[3px] focus:ring-accent-tint',
].join(' ')

/** Invalid state is a border colour, not a shadow — the system has no shadows. */
const errorBorder = (invalid: boolean): string =>
  invalid ? 'border-failed' : 'border-hairline-strong'

interface BaseProps {
  label: string
  hint?: string
  /** Rendered under the control and announced to screen readers. */
  error?: string | null
  /**
   * Rider-facing sizing: a 48px minimum control (CLAUDE.md section 4's tap
   * target floor) and a hint in --muted rather than --faint, which is 2.88:1 on
   * white and unreadable in daylight. Off by default so the desk-bound screens
   * keep the reference appearance exactly.
   */
  touch?: boolean
}

interface FieldProps
  extends BaseProps,
    Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
  suffix?: ReactNode
}

export const Field = ({ label, hint, error, suffix, touch, ...rest }: FieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="mb-15px">
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink-2 mb-1.5">
        {label}
      </label>
      <div className={suffix ? 'flex items-center gap-2' : undefined}>
        <input
          id={id}
          className={`${CONTROL} ${touch ? 'min-h-12' : ''} ${errorBorder(Boolean(error))}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
        {suffix ? (
          <span className="text-[13px] text-muted flex-none">{suffix}</span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-[11.5px] text-failed-ink mt-1.5">
          {error}
        </p>
      ) : hint ? (
        <p className={`text-[11.5px] mt-1.5 ${touch ? 'text-muted' : 'text-faint'}`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface SelectFieldProps
  extends BaseProps,
    Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> {
  children: ReactNode
}

export const SelectField = ({
  label,
  hint,
  error,
  children,
  touch,
  ...rest
}: SelectFieldProps) => {
  const id = useId()
  const errorId = `${id}-error`
  return (
    <div className="mb-15px">
      <label htmlFor={id} className="block text-[12.5px] font-medium text-ink-2 mb-1.5">
        {label}
      </label>
      <select
        id={id}
        className={`${CONTROL} ${touch ? 'min-h-12' : ''} ${errorBorder(Boolean(error))}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...rest}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} role="alert" className="text-[11.5px] text-failed-ink mt-1.5">
          {error}
        </p>
      ) : hint ? (
        <p className={`text-[11.5px] mt-1.5 ${touch ? 'text-muted' : 'text-faint'}`}>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
