import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { DeliveryStatus, Role } from '@pdms/shared'
import { useLogout, useMe } from '@/features/auth/useAuth'
import { useRailCounts, type RailCounts } from '@/features/shell/useRailCounts'
import { HeaderSearchContext } from '@/features/shell/useHeaderSearch'
import {
  getLastSeenAt,
  markNotificationsSeen,
  useNotifications,
} from '@/features/shell/useNotifications'
import { homeForRole } from '@/features/auth/roles'
import { ShiftRail } from '@/features/agent/ShiftRail'
import { formatRelativeTime } from '@/lib/format'
import { Avatar } from './Table'

/**
 * The v3 app shell: a persistent dark rail beside a white header.
 *
 * v3's own note — "this is the single biggest change from the old build; it
 * turns a stack of pages into a tool." The old build had a header and nothing
 * else, so every screen had to re-state where you were and what else existed.
 * Here the rail states it once, carries the counts that say what needs
 * attention, and holds the account menu at its foot rather than in the header.
 *
 * The chrome is the ONLY dark surface in the product. Everything to the right
 * of the rail is the workspace, and the workspace is never dark.
 */

const ICON = {
  parcel: (
    <>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  pin: (
    <>
      <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  chart: (
    <>
      <path d="M3 3v18h18" />
      <path d="m7 14 4-4 3 3 5-6" />
    </>
  ),
  coins: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M9.5 9.5h5M9.5 14.5h5" />
    </>
  ),
  riders: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M17 9h4M19 7v4" />
    </>
  ),
  taka: (
    <>
      <path d="M12 3v18" />
      <path d="M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </>
  ),
  runs: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 4v16" />
    </>
  ),
  check: <path d="M20 6 9 17l-5-5" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.4" />
      <path d="M18 14.6A6 6 0 0 1 21 20" />
    </>
  ),
} as const

type IconName = keyof typeof ICON

const NavIcon = ({ name }: { name: IconName }) => (
  <svg
    viewBox="0 0 24 24"
    className="w-17px h-17px flex-none"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {ICON[name]}
  </svg>
)

interface NavItem {
  to: string
  label: string
  icon: IconName
  /** Which rail count belongs beside it, if any. */
  count?: keyof RailCounts
  /** `end` so a parent path does not stay highlighted on its children. */
  end?: boolean
  /**
   * The screen lands in a later session. Rendered as a dimmed row that still
   * carries its count, rather than as a link — the catch-all route would bounce
   * a click straight back to the dashboard, and a nav item that silently
   * returns you to where you were is worse than one that says "not yet".
   */
  soon?: string
}

interface NavGroup {
  /** Absent on the customer rail, which is short enough not to need headings. */
  title?: string
  items: readonly NavItem[]
}

/**
 * The rail's items map one-to-one onto v3's route table. Each role's first
 * item is also its post-login default (see roles.ts) — one list, so the rail
 * and the redirect cannot disagree about where "home" is.
 */
const NAV: Record<Role, readonly NavGroup[]> = {
  customer: [
    {
      items: [
        { to: '/customer/parcels', label: 'My parcels', icon: 'parcel', count: 'active' },
        { to: '/customer/book', label: 'Book a parcel', icon: 'plus' },
      ],
    },
  ],
  agent: [
    {
      items: [
        { to: '/agent/runs', label: "Today's runs", icon: 'runs', count: 'active' },
        { to: '/agent/finished', label: 'Finished', icon: 'check', count: 'finished' },
      ],
    },
  ],
  admin: [
    {
      title: 'Operations',
      items: [
        { to: '/admin/board', label: 'Live board', icon: 'board', count: 'active' },
        { to: '/admin/analytics', label: 'Analytics', icon: 'chart' },
        { to: '/admin/cod', label: 'Cash on delivery', icon: 'coins', count: 'codRiders' },
      ],
    },
    {
      title: 'Manage',
      items: [
        { to: '/admin/agents', label: 'Riders', icon: 'riders', count: 'pendingRiders' },
        /*
          No count. v3's rule is that a count means "needs attention", and a
          suspended account needs nothing — an admin suspended it on purpose
          and it stays that way until they say otherwise. The screen's own
          header carries the number for whoever opens it.
        */
        { to: '/admin/customers', label: 'Customers', icon: 'people' },
        { to: '/admin/pricing', label: 'Pricing', icon: 'taka' },
      ],
    },
  ],
}

const ROLE_LABEL: Record<Role, string> = {
  customer: 'Customer',
  agent: 'Delivery agent',
  admin: 'Administrator',
}

const PROFILE_PATH: Record<Role, string> = {
  customer: '/customer/profile',
  agent: '/agent/profile',
  admin: '/admin/profile',
}

/** The wordmark: v3's rotated accent square beside the name, in Inter Tight. */
const Wordmark = ({ to }: { to: string }) => (
  <Link
    to={to}
    className="flex items-center gap-9px px-2 pt-5px pb-18px text-chrome-ink font-bold text-md tracking-[-0.03em]"
  >
    <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
    <span className="truncate max-md:hidden">ParcelDelivery</span>
  </Link>
)

/**
 * --chrome-muted rather than v3's --chrome-faint. Measured: --chrome-faint on
 * --chrome is 3.04:1, and v3's own note says the counts are the reason the rail
 * exists ("an admin sees what needs attention without opening anything"). A
 * number nobody can read does not do that. --chrome-muted is 5.24:1 and comes
 * from the same palette.
 */
const Count = ({ value }: { value: number | null }) =>
  value === null || value === 0 ? null : (
    <span className="ml-auto mono text-eyebrow text-chrome-muted group-aria-[current=page]:text-accent-on-dark">
      {value}
    </span>
  )

/**
 * The account menu, at the FOOT OF THE RAIL rather than in the header — v3 is
 * explicit about the placement, and it puts signing out as far as possible
 * from the actions that move parcels.
 */
const AccountMenu = ({
  name,
  role,
  touch,
}: {
  name: string
  role: Role
  touch: boolean
}) => {
  const [open, setOpen] = useState(false)
  const logout = useLogout()
  const navigate = useNavigate()
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const signOut = (): void => {
    logout.mutate(undefined, {
      onSuccess: () => navigate('/login', { replace: true }),
    })
  }

  return (
    <div ref={box} className="relative">
      {open ? (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 bg-chrome-2 border border-chrome-3 rounded-sm p-1"
          role="menu"
        >
          <Link
            to={PROFILE_PATH[role]}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-body text-chrome-ink rounded-sm hover:bg-chrome-3"
          >
            Profile
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={logout.isPending}
            className="w-full text-left px-3 py-2 text-body text-chrome-ink rounded-sm hover:bg-chrome-3 disabled:text-chrome-faint"
          >
            {logout.isPending ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`w-full flex items-center gap-9px px-2 py-7px rounded-sm hover:bg-chrome-2 ${touch ? 'min-h-12' : 'min-h-11'}`}
      >
        <Avatar size="sm" />
        <span className="min-w-0 text-left max-md:hidden">
          <span className="block text-chrome-ink text-sm font-semibold tracking-[-0.01em] truncate">
            {name}
          </span>
          <span className="block text-chrome-muted text-eyebrow">{ROLE_LABEL[role]}</span>
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`w-3.5 h-3.5 ml-auto flex-none text-chrome-muted transition-transform max-md:hidden ${open ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
    </div>
  )
}

const BELL = (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
)

/** The dot colour for a notification — overdue is always the failed red, a
 *  status change carries its own lifecycle colour. */
const DOT_COLOUR: Record<DeliveryStatus, string> = {
  Booked: 'bg-booked',
  Assigned: 'bg-assigned',
  PickedUp: 'bg-picked',
  InTransit: 'bg-transit',
  Delivered: 'bg-delivered',
  Cancelled: 'bg-cancelled',
  Failed: 'bg-failed',
}

/**
 * The header bell — v3.1 addendum. Built from data that already exists:
 * recent delivery status changes on whatever this actor can see, plus
 * overdue alerts for admins (routes/notifications.ts does the scoping, the
 * same role rules as everything else). The unread dot compares the newest
 * notification's timestamp against when this browser last opened the
 * dropdown, so it only ever appears when something is genuinely unread.
 */
const NotificationsBell = () => {
  const notifications = useNotifications()
  const [open, setOpen] = useState(false)
  const [lastSeenAt, setLastSeenAt] = useState(() => getLastSeenAt())
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const rows = notifications.data ?? []
  const newest = rows[0]?.at
  const unread = Boolean(newest && new Date(newest).getTime() > lastSeenAt)

  const toggle = (): void => {
    setOpen((v) => !v)
    if (!open) {
      markNotificationsSeen()
      setLastSeenAt(Date.now())
    }
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={unread ? 'Notifications, unread' : 'Notifications'}
        className="w-11 h-11 md:w-[33px] md:h-[33px] rounded-sm border border-border grid place-items-center text-ink-2 relative hover:bg-surface-sunk"
      >
        {BELL}
        {unread ? (
          <span
            aria-hidden="true"
            className="absolute top-5px right-6px w-6px h-6px rounded-full bg-failed border-[1.5px] border-surface"
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-[296px] bg-surface border border-border rounded-md p-1 z-10"
        >
          <div className="px-10px pt-8px pb-6px text-micro font-semibold uppercase tracking-[0.11em] text-faint">
            Notifications
          </div>
          {notifications.isPending ? (
            <p className="px-10px py-3 text-small text-muted">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-10px py-3 text-small text-muted">Nothing new.</p>
          ) : (
            rows.map((n) => (
              <div key={n.id} className="flex gap-10px px-10px py-9px rounded-sm items-start hover:bg-page">
                <span
                  className={`w-6px h-6px rounded-full mt-5px flex-none ${
                    n.kind === 'overdue' ? 'bg-failed' : DOT_COLOUR[n.status] ?? 'bg-booked'
                  }`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{n.title}</div>
                  <div className="text-tiny text-muted truncate">{n.subtitle}</div>
                </div>
                <span className="mono text-micro text-faint ml-auto whitespace-nowrap">
                  {formatRelativeTime(n.at)}
                </span>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

interface Props {
  /** The header's title. The page's own <h1> lives in `children`. */
  title: string
  /** Right of the title — a status Pill on the tracking screen. */
  titleAside?: ReactNode
  children: ReactNode
}

export const AppShell = ({ title, titleAside, children }: Props) => {
  const me = useMe()
  const role = me.data?.role
  const counts = useRailCounts(role)
  const groups = role ? NAV[role] : []

  /**
   * CLAUDE.md section 4 puts a 48px floor on anything a RIDER taps, and the
   * rail is part of the rider's UI. v3's own nav items are ~36px, which is
   * right for a desktop console and wrong for a phone in one hand — so the
   * floor is applied for that role rather than to everyone's chrome.
   */
  const touch = role === 'agent'

  /**
   * The header search — v3.1 addendum. AppShell owns the query text and the
   * one `<input>`; whichever screen has a searchable table claims it via
   * `useSearchable` (see useHeaderSearch.ts), setting `placeholder` and
   * reading `query` back. `placeholder === null` is the honest "nothing to
   * search on this screen" state, which is why the input stays disabled
   * until a page claims it, rather than sitting there enabled and silently
   * doing nothing.
   */
  const [query, setQuery] = useState('')
  const [placeholder, setPlaceholder] = useState<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)

  // Cmd+K / Ctrl+K focuses the search box, from anywhere on the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchInput.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="min-h-dvh grid grid-cols-[64px_1fr] md:grid-cols-[216px_1fr] bg-page">
      {/* ---------- the rail ---------- */}
      {/*
        `sticky top-0 h-dvh`, not just a tall block in the grid flow.
        The grid row auto-sizes to its tallest cell, and on a page whose main
        content runs past one screen that cell is `<main>`'s — so without this
        the whole rail grew past the viewport too and scrolled away with the
        page, dragging the account block down with it. Pinning the aside to
        the viewport and letting only the nav list beneath scroll internally
        (via `overflow-y-auto` + `min-h-0` below) keeps the account block at
        the foot of the screen no matter how long the page gets.
      */}
      <aside className="on-chrome bg-chrome px-3 py-4 flex flex-col sticky top-0 h-dvh">
        <Wordmark to={role ? homeForRole(role) : '/'} />

        <div className="flex-1 min-h-0 overflow-y-auto">
          {groups.map((group, gi) => (
            <div key={group.title ?? `group-${gi}`}>
              {group.title ? (
                <div className="text-rail font-semibold uppercase tracking-[0.12em] text-chrome-muted px-2.5 pt-3.5 pb-6px max-md:hidden">
                  {group.title}
                </div>
              ) : null}
              <nav className="flex flex-col gap-px">
                {group.items.map((item) => {
                  const shared = [
                    'group flex items-center gap-10px px-2.5 py-9px rounded-sm',
                    'text-body font-medium max-md:justify-center',
                    touch ? 'min-h-12' : 'min-h-11',
                  ].join(' ')

                  const inner = (
                    <>
                      <NavIcon name={item.icon} />
                      <span className="truncate max-md:hidden">{item.label}</span>
                      <span className="max-md:hidden contents">
                        <Count value={item.count ? counts[item.count] : null} />
                      </span>
                    </>
                  )

                  if (item.soon) {
                    return (
                      <span
                        key={item.to}
                        title={`${item.label} — arriving in ${item.soon}`}
                        aria-disabled="true"
                        className={`${shared} text-chrome-faint cursor-not-allowed`}
                      >
                        {inner}
                      </span>
                    )
                  }

                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      title={item.label}
                      className={({ isActive }) =>
                        [
                          shared,
                          isActive
                            ? 'bg-chrome-3 text-white'
                            : 'text-chrome-muted hover:text-chrome-ink hover:bg-chrome-2',
                        ].join(' ')
                      }
                    >
                      {inner}
                    </NavLink>
                  )
                })}
              </nav>
            </div>
          ))}

          {role === 'agent' ? <ShiftRail /> : null}
        </div>

        <div className="mt-auto border-t border-chrome-3 pt-3">
          {me.data ? (
            <AccountMenu name={me.data.name} role={me.data.role} touch={touch} />
          ) : null}
        </div>
      </aside>

      {/* ---------- the workspace ---------- */}
      <div className="flex flex-col min-w-0">
        <header className="flex items-center gap-13px px-22px py-13px bg-surface border-b border-border min-h-[65px]">
          <span className="text-lg font-semibold tracking-[-0.025em] truncate">{title}</span>
          {titleAside}

          {/*
            Real now — v3.1 addendum. `placeholder === null` means no screen
            below has claimed the box yet (useSearchable hasn't run), which is
            the honest "nothing to search here" state; it stays disabled
            rather than sitting there enabled and doing nothing. Once a page
            claims it, the placeholder names what IT searches — not a generic
            "Search" implying a reach this box doesn't have.
          */}
          {placeholder !== null ? 
            <label className="hidden lg:flex items-center gap-2 bg-surface-sunk border border-border rounded-pill px-15px py-7px ml-18px min-w-[230px]">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-none text-faint" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                ref={searchInput}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={placeholder === null}
                placeholder={placeholder ?? 'Nothing to search on this screen'}
                aria-label={placeholder ?? 'Search (nothing to search on this screen)'}
                className="bg-transparent outline-none text-sm text-ink placeholder:text-faint w-full disabled:cursor-not-allowed"
              />
              {placeholder !== null ? (
                <span className="mono text-micro text-faint bg-surface border border-border rounded-[4px] px-5px py-0.5 flex-none">
                  ⌘K
                </span>
              ) : null}
            </label>
          : null }

          <div className="ml-auto flex items-center gap-11px">
            {/*
              The header avatar is gone, not wired up — the rail's account
              block at its foot already owns identity, Profile and Sign out.
              A second account menu here would be two doors to one room.
            */}
            <NotificationsBell />
          </div>
        </header>

        <main className="p-22px overflow-auto">
          <HeaderSearchContext.Provider value={{ query, setPlaceholder }}>
            {children}
          </HeaderSearchContext.Provider>
        </main>
      </div>
    </div>
  )
}

/**
 * The page's own heading block, inside the shell's main area. Separate from
 * the header title because v3 shows both: the header names the screen in 16px,
 * the body opens with the 21px page title and a line of context under it.
 */
export const PageHead = ({
  title,
  sub,
  action,
}: {
  title: string
  sub?: string
  action?: ReactNode
}) => (
  <div className="flex items-start gap-4 mb-5">
    <div className="min-w-0">
      <h1 className="text-title font-semibold tracking-[-0.03em]">{title}</h1>
      {sub ? <p className="text-body text-muted mt-0.5">{sub}</p> : null}
    </div>
    {action ? <div className="ml-auto flex items-center gap-2">{action}</div> : null}
  </div>
)
