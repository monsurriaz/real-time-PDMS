import type { DeliveryListItem } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { LifecycleRail } from '@/components/LifecycleRail'
import { RunMap } from './RunMap'
import { formatOfferCountdown, useOfferCountdown } from './useOfferCountdown'

/**
 * The left half of the workspace: the route map above the currently-selected
 * delivery's identity — tracking ID, badge, the lifecycle rail, who it is
 * going to, and Call/Navigate. Everything that MOVES this parcel forward
 * lives across the grid in DeliveryActions; this half is where it is.
 */

const CAPS = 'text-eyebrow font-semibold uppercase tracking-[0.13em] text-ink-2'

export const DeliveryDetail = ({ d }: { d: DeliveryListItem }) => {
  // M8: only meaningful while status is 'Assigned' (offered) — the server
  // already nulls it out otherwise, so this is null for every other state.
  const remaining = useOfferCountdown(d.offerExpiresAt)

  return (
    <div>
      <RunMap parcelId={d.parcelId} />
      <div className="p-18px">
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-small font-medium">{d.trackingId}</span>
          <Badge status={d.status} />
        </div>
        <div className="mt-14px">
          <LifecycleRail status={d.status} />
        </div>

        {remaining !== null ? (
          <p className="text-tiny text-muted mt-9px">
            Offer {formatOfferCountdown(remaining)}
          </p>
        ) : null}

        <div className={`${CAPS} mt-18px`}>Deliver to</div>
        <div className="text-mark font-semibold mt-5px tracking-[-0.015em]">
          {d.recipientName}
        </div>
        <div className="text-body text-muted mt-0.5">
          {d.dropArea}, {d.dropZone}
        </div>

        <div className="flex gap-9px mt-14px">
          {/*
            Both are in the reference. Navigate needs the drop coordinates,
            which this projection does not carry, and Call needs the
            recipient's number, which CLAUDE.md section 7 keeps off this
            payload — so both are present and disabled rather than pretending
            to work.
          */}
          {/* min-h-12: section 4's 48px floor for anything a rider taps. */}
          <Button className="flex-1 min-h-12" disabled>
            Call
          </Button>
          <Button className="flex-1 min-h-12" disabled>
            Navigate
          </Button>
        </div>
      </div>
    </div>
  )
}
