import type { DeliveryListItem } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { LifecycleRail } from '@/components/LifecycleRail'
import { MessageThread } from '../messaging/MessageThread'
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
        {d.recipientPhone ? (
          <div className="mono text-small text-ink-2 mt-1">{d.recipientPhone}</div>
        ) : null}

        {d.recipientPhone ? (
          <div className="flex gap-9px mt-14px">
            {/*
              M9: the recipient has no account of their own, so a rider at
              the door has to be able to reach them by phone — the number now
              reaches THIS view precisely because it's the currently assigned
              rider's (routes/deliveries.ts scopes it there, never wider).
              Navigate needed the drop coordinates, which CLAUDE.md section 7
              still keeps off this payload — a permanently dead control is
              worse than an absent one (the same call already made for the
              removed header avatar), so it's gone rather than left disabled.
            */}
            {/* min-h-12: section 4's 48px floor for anything a rider taps. */}
            <Button href={`tel:${d.recipientPhone}`} className="flex-1 min-h-12">
              Call
            </Button>
          </div>
        ) : null}

        {/*
          M9: the customer <-> rider thread. Opens at PickedUp, closes at
          any terminal state — the server decides which state applies, this
          just renders it.
        */}
        <MessageThread deliveryId={d._id} parcelId={d.parcelId} />
      </div>
    </div>
  )
}
