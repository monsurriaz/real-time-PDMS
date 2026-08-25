import { useEffect, useRef, useState } from 'react'
import { ShiftEditor } from './ShiftEditor'
import { useAgentSelf } from './useAgentSelf'

/**
 * The rail's "Shift" block, from v3's Shell section: a compact status
 * readout plus a control that opens the same availability/location form the
 * old build gave a whole Card at the top of the run list. Folding it into
 * the rail is the point of the rebuild — it must not cost the workspace any
 * vertical space, on a 1400px desktop OR a 375px phone.
 *
 * The popover is `fixed`, not `absolute`. Below 768px the rail collapses to
 * a 64px icon strip (an existing, pre-M6.5b convention — see AppShell), and
 * a form with a zone select and two coordinate fields cannot fit anchored to
 * a 64px box without being clipped off-screen. Fixed positioning lets the
 * same trigger and the same editor work at every width, instead of this
 * screen needing a second, phone-only copy of the control.
 */

const STATUS_LABEL: Record<string, string> = {
  available: 'Available',
  on_delivery: 'On a delivery',
  offline: 'Off shift',
}

/** available reuses the "delivered" green (good to go); on_delivery is the
 * exact dot v3's own mockup draws for this state, --s-transit. */
const STATUS_DOT: Record<string, string> = {
  available: 'bg-delivered',
  on_delivery: 'bg-transit',
  offline: 'bg-chrome-faint',
}

export const ShiftRail = () => {
  const me = useAgentSelf()
  const [open, setOpen] = useState(false)
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

  const heading = (
    <div className="text-rail font-semibold uppercase tracking-[0.12em] text-chrome-muted px-2.5 pt-3.5 pb-6px max-md:hidden">
      Shift
    </div>
  )

  if (me.isPending) {
    return (
      <div>
        {heading}
        <div className="h-12 rounded-sm bg-chrome-2 animate-pulse" />
      </div>
    )
  }

  if (me.isError || !me.data) {
    return (
      <div>
        {heading}
        <p className="text-eyebrow text-chrome-faint px-2.5 max-md:hidden">
          Shift status unavailable
        </p>
      </div>
    )
  }

  const agent = me.data
  const zoneLabel = agent.zones[0] ?? null
  const sub = agent.locationUpdatedAt
    ? `${zoneLabel ?? 'No zone'} · set ${new Date(agent.locationUpdatedAt).toLocaleTimeString('en-BD', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
    : 'Location not set'

  return (
    <div>
      {heading}
      <div ref={box} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Your shift"
          className="w-full min-h-12 flex items-center gap-9px rounded-sm bg-chrome-2 hover:bg-chrome-3 px-2.5 py-9px max-md:justify-center max-md:px-0"
        >
          <span
            className={`w-7px h-7px rounded-full flex-none ${STATUS_DOT[agent.status] ?? 'bg-chrome-faint'}`}
          />
          <span className="min-w-0 text-left max-md:hidden">
            <span className="block text-chrome-ink text-small font-semibold truncate">
              {STATUS_LABEL[agent.status] ?? agent.status}
            </span>
            <span className="block text-chrome-faint text-eyebrow truncate">{sub}</span>
          </span>
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label="Your shift"
            className="fixed z-30 left-3 right-3 bottom-3 md:left-[220px] md:right-auto md:bottom-16 md:w-[300px] bg-surface border border-border rounded-md p-4 max-h-[75vh] overflow-y-auto"
          >
            <ShiftEditor onLocationSaved={() => setOpen(false)} />
          </div>
        ) : null}
      </div>
    </div>
  )
}
