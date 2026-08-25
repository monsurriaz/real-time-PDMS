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

/**
 * `compact` drops the explanatory line to a tooltip. In v3 this sits in the
 * app header beside the tracking ID, where a second line would push the whole
 * header taller on every screen — the detail is still there on hover and for
 * a screen reader, which is where it was doing its work anyway.
 */
export const ConnectionPill = ({
  mode,
  compact = false,
}: {
  mode: ConnectionMode
  compact?: boolean
}) => {
  const c = COPY[mode]
  const pill = (
    <span
      className={`inline-flex items-center gap-6px rounded-pill py-1 pr-11px pl-9px text-meta font-medium ${c.tone}`}
      role="status"
      aria-live="polite"
      title={compact ? c.detail : undefined}
    >
      <i className="w-[5.5px] h-[5.5px] rounded-full bg-current flex-none" />
      {c.label}
      {compact ? <span className="sr-only"> — {c.detail}</span> : null}
    </span>
  )

  if (compact) return pill

  return (
    <div>
      {pill}
      <p className="text-tiny text-muted mt-1.5">{c.detail}</p>
    </div>
  )
}
