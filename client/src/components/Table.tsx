import type { ReactNode } from 'react'

/**
 * The data-table pieces from docs/design-system-v3-meridian.html.
 *
 * v3's own note: "the pieces missing from the old build — filter bars, avatars
 * in tables, row actions, pagination. This is most of what made the reference
 * screenshots feel finished." They live here as one set rather than as classes
 * copied into five screens, because the thing that made the old tables read as
 * unfinished was each of them inventing its own header size and row padding.
 */

/** A cell whose content must never break — tracking IDs, money, timestamps. */
export const NoWrap = ({ children }: { children: ReactNode }) => (
  <span className="whitespace-nowrap">{children}</span>
)

/** Wraps a table so wide content scrolls inside its own box, never the page. */
export const TableScroll = ({
  children,
  min = 720,
}: {
  children: ReactNode
  /** Below this the table scrolls rather than crushing its columns. */
  min?: number
}) => (
  <div className="overflow-x-auto">
    <table className="w-full border-collapse" style={{ minWidth: `${min}px` }}>
      {children}
    </table>
  </div>
)

/**
 * A header row from a list of labels. An empty string makes an unlabelled
 * column, which is what the row-actions column is.
 */
export const Thead = ({ cols }: { cols: readonly string[] }) => (
  <thead>
    <tr>
      {cols.map((c, i) => (
        <th
          key={c || `blank-${i}`}
          className={[
            'text-left text-micro font-semibold uppercase tracking-[0.09em]',
            /**
             * --muted, not v3's --faint. Measured: --faint on --surface is
             * 2.62:1, and a column header is content — it is the label a reader
             * needs in order to know what the column under it means. --muted is
             * 4.83:1 and comes from the same palette, so this narrows which
             * token is used rather than inventing one. Everything decorative
             * (em-dashes, placeholders) keeps --faint.
             */
            'text-muted px-18px py-11px border-b border-border whitespace-nowrap',
            // The actions column is right-aligned, and it is always the last.
            i === cols.length - 1 && c === '' ? 'text-right' : '',
          ].join(' ')}
        >
          {c}
        </th>
      ))}
    </tr>
  </thead>
)

export const Tr = ({ children }: { children: ReactNode }) => (
  <tr className="hover:bg-page">{children}</tr>
)

export const Td = ({
  children,
  className = '',
  align,
}: {
  children: ReactNode
  className?: string
  align?: 'right'
}) => (
  <td
    className={[
      'px-18px py-3 border-b border-border text-body align-middle',
      // `last:border-b-0` on the ROW's cells, so the final row has no rule
      // under it and the card's own border does that work instead.
      align === 'right' ? 'text-right whitespace-nowrap' : '',
      className,
    ].join(' ')}
  >
    {children}
  </td>
)

/**
 * `.who` — an avatar beside a name and a secondary line. The avatar is a plain
 * tinted circle: there are no uploaded profile images in this build, and a
 * generated initial would imply an identity the record does not carry.
 */
export const Who = ({
  name,
  sub,
  size = 'sm',
}: {
  name: string
  sub?: string
  size?: 'sm' | 'md'
}) => (
  <div className="flex items-center gap-9px">
    <Avatar size={size} />
    <div className="min-w-0">
      <div className="font-semibold text-body tracking-[-0.01em] truncate">{name}</div>
      {/* Same reasoning as the column headers: a route is content, not chrome. */}
      {sub ? <div className="text-tiny text-muted truncate">{sub}</div> : null}
    </div>
  </div>
)

const AVATAR_SIZE = {
  sm: 'w-7 h-7',
  md: 'w-[34px] h-[34px]',
  lg: 'w-15 h-15',
} as const

export const Avatar = ({ size = 'sm' }: { size?: keyof typeof AVATAR_SIZE }) => (
  <span
    className={`${AVATAR_SIZE[size]} rounded-full bg-surface-sunk border border-border flex-none`}
    aria-hidden="true"
  />
)

/** `.filterbar` — the strip of dropdowns above a table, with actions trailing. */
export const FilterBar = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap gap-9px items-center px-18px py-14px border-b border-border">
    {children}
  </div>
)

const CHEVRON = (
  <svg viewBox="0 0 24 24" className="w-13px h-13px flex-none" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/**
 * `.selectish` — v3 draws these as static chips, but a filter that cannot be
 * changed is decoration. This is a real <select> wearing the chip's clothes:
 * the chevron is ours, the native menu is the browser's, and no dependency or
 * popover machinery is involved.
 */
export const SelectFilter = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  /** Shown when nothing is chosen — "All statuses", "All zones". */
  label: string
  value: T | ''
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (next: T | '') => void
}) => (
  <div className="relative inline-flex items-center">
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T | '')}
      aria-label={label}
      className={[
        'appearance-none cursor-pointer',
        'text-sm text-ink-2 bg-surface-sunk border border-border rounded-sm',
        'pl-3 pr-8 py-2 outline-none',
        'focus:border-accent focus:ring-[3px] focus:ring-accent-tint',
      ].join(' ')}
    >
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
    <span className="pointer-events-none absolute right-2.5 text-muted">{CHEVRON}</span>
  </div>
)

/**
 * `.pager`. Page numbers are elided with an ellipsis past five pages, so the
 * control keeps a fixed footprint however long the list gets.
 */
export const Pager = ({
  page,
  pageCount,
  total,
  from,
  to,
  onPage,
}: {
  page: number
  pageCount: number
  total: number
  from: number
  to: number
  onPage: (next: number) => void
}) => {
  if (total === 0) return null

  const numbers: Array<number | 'gap'> = []
  for (let i = 1; i <= pageCount; i += 1) {
    if (i === 1 || i === pageCount || Math.abs(i - page) <= 1) numbers.push(i)
    else if (numbers.at(-1) !== 'gap') numbers.push('gap')
  }

  const step = (n: number): void => onPage(Math.min(pageCount, Math.max(1, n)))

  return (
    <div className="flex items-center gap-6px px-18px py-13px border-t border-border">
      <span className="text-small text-muted">
        Showing <span className="mono">{from}</span>–<span className="mono">{to}</span> of{' '}
        <span className="mono">{total}</span>
      </span>
      {pageCount > 1 ? (
        <div className="ml-auto flex gap-5px">
          <PageButton onClick={() => step(page - 1)} disabled={page === 1} label="Previous page">
            ‹
          </PageButton>
          {numbers.map((n, i) =>
            n === 'gap' ? (
              <span key={`gap-${i}`} className="w-[29px] h-[29px] grid place-items-center text-small text-faint">
                …
              </span>
            ) : (
              <PageButton
                key={n}
                onClick={() => step(n)}
                current={n === page}
                label={`Page ${n}`}
              >
                {n}
              </PageButton>
            ),
          )}
          <PageButton
            onClick={() => step(page + 1)}
            disabled={page === pageCount}
            label="Next page"
          >
            ›
          </PageButton>
        </div>
      ) : null}
    </div>
  )
}

const PageButton = ({
  children,
  onClick,
  current,
  disabled,
  label,
}: {
  children: ReactNode
  onClick: () => void
  current?: boolean
  disabled?: boolean
  label: string
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    aria-current={current ? 'page' : undefined}
    className={[
      'w-[29px] h-[29px] rounded-sm grid place-items-center text-small border',
      current
        ? 'bg-ink text-white border-ink'
        : 'text-muted border-border hover:bg-surface-sunk',
      disabled ? 'opacity-40 cursor-not-allowed hover:bg-transparent' : 'cursor-pointer',
    ].join(' ')}
  >
    {children}
  </button>
)

/** Client-side paging for a list the server already returned in full. */
export const paginate = <T,>(
  rows: readonly T[],
  page: number,
  perPage: number,
): { slice: T[]; page: number; pageCount: number; from: number; to: number } => {
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage))
  // A filter change can strand the viewer past the end of the new list.
  const safe = Math.min(page, pageCount)
  const start = (safe - 1) * perPage
  const slice = rows.slice(start, start + perPage)
  return {
    slice,
    page: safe,
    pageCount,
    from: rows.length === 0 ? 0 : start + 1,
    to: start + slice.length,
  }
}
