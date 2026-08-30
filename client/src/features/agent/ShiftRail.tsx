import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { Eyebrow } from '@/components/Card'
import { ShiftEditor } from './ShiftEditor'
import { useAgentSelf } from './useAgentSelf'
import { useIdleLocationWatcher } from './useIdleLocationWatcher'

/**
 * The rail's "Shift" block, from v3's Shell section: a compact status
 * readout plus a control that opens the same availability/location form the
 * old build gave a whole Card at the top of the run list. Folding it into
 * the rail is the point of the rebuild — it must not cost the workspace any
 * vertical space, on a 1400px desktop OR a 375px phone.
 *
 * The editor opens in the shared `Modal` (M6.98) rather than a rail-anchored
 * popover. It used to be a `fixed left-[220px]` panel floating past the
 * 216px rail — the offset only ever cleared the rail by a few px, so on a
 * wide desktop viewport it sat directly ON TOP of the run detail card
 * (map, status badge, LifecycleRail) instead of beside it, hiding exactly
 * the delivery status a rider would open it while still wanting to see. A
 * real modal with a backdrop makes "this is temporarily covering the page"
 * the honest, visible state instead of an accidental one, and it needs no
 * width-specific positioning: `Modal` already centres itself and scrolls
 * internally at every viewport, including the 64px-collapsed rail below
 * 768px this used to special-case.
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

  // Called every render regardless of loading state — rules of hooks — with
  // `active` folding in "loaded, and actually available" so it starts out
  // false rather than undefined while `me` is still pending.
  useIdleLocationWatcher(me.data?.status === 'available')

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
      <button
        type="button"
        onClick={() => setOpen(true)}
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

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={
          <>
            <Eyebrow>Shift</Eyebrow>
            <p className="text-base font-semibold tracking-[-0.015em]">
              {STATUS_LABEL[agent.status] ?? agent.status}
            </p>
          </>
        }
      >
        <ShiftEditor onLocationSaved={() => setOpen(false)} />
      </Modal>
    </div>
  )
}
