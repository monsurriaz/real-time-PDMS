import { useParams } from 'react-router-dom'
import type { DeliveryStatus } from '@pdms/shared'
import { AppShell, PageHead } from '@/components/AppShell'
import { Card } from '@/components/Card'
import { ApiError } from '@/lib/api'
import { WelcomeNotice } from '../auth/WelcomeNotice'
import { useDeliveries } from '../deliveries/useDeliveries'
import { DeliveryActions } from './DeliveryActions'
import { DeliveryDetail } from './DeliveryDetail'
import { RunQueue } from './RunQueue'

/**
 * /agent/runs and /agent/runs/:id — the rider workspace, rebuilt per v3's
 * Agent section. The worst screen in the old build: one narrow column of
 * stacked cards down the middle of a 1400px window, shift controls pushing
 * real work below the fold. Now: the route map beside the active delivery,
 * the run queue as a compact list, shift status folded into the rail
 * (ShiftRail, in AppShell) instead of living here at all.
 *
 * `:id` names which of the rider's ACTIVE runs is showing on the left; the
 * queue on the right is how that changes. `/agent/runs` with no id defaults
 * to the first one. An id that isn't (or is no longer) one of the rider's
 * active runs falls back the same way rather than 404ing — a rider is never
 * looking at nothing just because a bookmark outlived the delivery it named.
 *
 * The 900px split below is v3's own number for THIS workspace grid, not the
 * rail's — the rail already collapses to icons at 768px for every role
 * (see AppShell), and that is a separate, pre-existing breakpoint.
 */

const ACTIVE: readonly DeliveryStatus[] = ['Assigned', 'PickedUp', 'InTransit']

export const RiderWorkspace = () => {
  const { id } = useParams<{ id: string }>()
  const deliveries = useDeliveries()

  if (deliveries.isPending) {
    return (
      <AppShell title="Today's runs">
        <Card>
          <p className="text-body text-muted">Loading your runs…</p>
        </Card>
      </AppShell>
    )
  }

  if (deliveries.isError) {
    return (
      <AppShell title="Today's runs">
        <Card>
          <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
            {deliveries.error instanceof ApiError
              ? deliveries.error.message
              : 'Your runs could not be loaded.'}
          </p>
        </Card>
      </AppShell>
    )
  }

  const active = deliveries.data.filter((d) => ACTIVE.includes(d.status))
  const finishedCount = deliveries.data.length - active.length
  const current = (id ? active.find((d) => d._id === id) : undefined) ?? active[0] ?? null

  return (
    <AppShell title="Today's runs">
      <PageHead
        title="Today's runs"
        sub={`${active.length} active · ${finishedCount} finished today`}
      />

      {/*
        The approval welcome, once per rider. This screen is the right place
        for it precisely because only an approved rider reaches it — a pending
        one is redirected to /agent/pending by RequireRole — so "the first time
        this renders" and "their first visit after approval" are the same
        moment. See WelcomeNotice.
      */}
      <WelcomeNotice>
        <p className="font-semibold text-ink">You're approved.</p>
        <p className="mt-0.5">
          Go available from the shift panel and set your location — jobs in
          your zone will start arriving.
        </p>
      </WelcomeNotice>

      {current ? (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {/*
            One column under 900px — map, then the active delivery's own
            content, then the queue — because that is the order a rider on a
            phone actually wants them in. Two columns at 900px and up: the
            grid does this on its own; nothing here branches on width in JS.
          */}
          <div className="grid min-[900px]:grid-cols-[1fr_320px]">
            <div className="min-[900px]:border-r border-border">
              <DeliveryDetail d={current} />
            </div>
            <div className="p-18px">
              <DeliveryActions d={current} />
              {active.length > 0 ? <RunQueue deliveries={active} currentId={current._id} /> : null}
            </div>
          </div>
        </div>
      ) : (
        <Card>
          <p className="text-body text-muted">
            Nothing to carry right now. Go available and set your location —
            new bookings are assigned by proximity.
          </p>
        </Card>
      )}
    </AppShell>
  )
}
