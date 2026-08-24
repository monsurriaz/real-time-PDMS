import type { ConnectionMode } from '@pdms/shared'
import { REST_POLL_INTERVAL_MS } from '@pdms/shared'

/**
 * Says which mode tracking is in, honestly (CLAUDE.md section 6's fallback).
 *
 * A stale position that looks current is the failure this exists to prevent,
 * so "polling" is stated plainly rather than dressed up as live — and it names
 * the interval, because "10s behind" is the thing the user needs to know.
 */

const COPY: Record<ConnectionMode, { label: string; detail: string; tone: string }> = {
  live: {
    label: 'Live',
    detail: 'Updating as the rider moves',
    tone: 'bg-delivered-bg text-delivered-ink',
  },
  connecting: {
    label: 'Connecting',
    detail: 'Opening the live connection',
    tone: 'bg-booked-bg text-booked-ink',
  },
  polling: {
    label: 'Reconnecting',
    detail: `Live connection lost — refreshing every ${REST_POLL_INTERVAL_MS / 1000}s`,
    tone: 'bg-transit-bg text-transit-ink',
  },
  offline: {
    label: 'Offline',
    detail: 'Cannot reach the server — the position below may be old',
    tone: 'bg-failed-bg text-failed-ink',
  },
}

export const ConnectionPill = ({ mode }: { mode: ConnectionMode }) => {
  const c = COPY[mode]
  return (
    <div>
      <span
        className={`inline-flex items-center gap-7px rounded-pill py-5px pr-3 pl-10px text-[12.5px] font-medium ${c.tone}`}
        role="status"
        aria-live="polite"
      >
        <i className="w-1.5 h-1.5 rounded-full bg-current flex-none" />
        {c.label}
      </span>
      <p className="text-[11.5px] text-faint mt-1.5">{c.detail}</p>
    </div>
  )
}
