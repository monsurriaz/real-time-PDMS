import { useState } from 'react'
import {
  advanceStatusInputSchema,
  type DeliveryListItem,
  type DeliveryStatus,
} from '@pdms/shared'
import { Button } from '@/components/Button'
import { ApiError } from '@/lib/api'
import { formatTaka } from '@/lib/format'
import { currentPosition, useAdvanceStatus, useDeclineOffer } from '../deliveries/useDeliveries'
import { PodCapture } from './PodCapture'

/**
 * The right half of the workspace: everything that MOVES the selected
 * delivery forward — the COD amount, proof of delivery, and the one
 * enormous button.
 *
 * The reference's own note: "this button only ever offers the one legal next
 * transition." That next step comes from the server's allowedTransitions, so
 * the client renders authority rather than deciding it (CLAUDE.md rule 3).
 *
 * No padded wrapper of its own — the caller (RiderWorkspace) puts this and
 * RunQueue inside one shared `p-[18px]` box, so the two don't stack their
 * own padding into a double gap between them.
 *
 * M8: while `status === 'Assigned'` (offered, awaiting a response),
 * `allowedTransitions` for an agent is `['Accepted', 'Booked']` — `Accepted`
 * becomes the one enormous button exactly like any other next step, and
 * `Booked` (declining) gets its own reveal-and-confirm block, the same
 * pattern `Failed` already uses, so a mis-tap can't silently bounce the
 * parcel back to the pool.
 */

const ADVANCE_LABEL: Record<string, string> = {
  Accepted: 'Accept',
  PickedUp: 'Picked up',
  InTransit: 'Start delivery',
  Delivered: 'Mark delivered',
}

const CAPS = 'text-eyebrow font-semibold uppercase tracking-[0.13em] text-ink-2'

export const DeliveryActions = ({ d }: { d: DeliveryListItem }) => {
  const advance = useAdvanceStatus()
  const decline = useDeclineOffer()
  const [failureNote, setFailureNote] = useState('')
  const [showFail, setShowFail] = useState(false)
  const [declineReason, setDeclineReason] = useState('')
  const [showDecline, setShowDecline] = useState(false)

  /**
   * The single next step. Failed and Booked are excluded: Failed is the
   * exception path, not the next step, and Booked (M8) means declining —
   * its own block below, not the primary button.
   */
  const nextStep = d.allowedTransitions.find(
    (t): t is DeliveryStatus => t !== 'Failed' && t !== 'Cancelled' && t !== 'Booked',
  )
  const canFail = d.allowedTransitions.includes('Failed')
  const canDecline = d.allowedTransitions.includes('Booked')
  const needsProof = nextStep === 'Delivered' && !d.hasProofOfDelivery
  const busy = advance.isPending || decline.isPending

  const err =
    advance.error instanceof ApiError
      ? advance.error.message
      : decline.error instanceof ApiError
        ? decline.error.message
        : null

  const move = async (to: DeliveryStatus, note?: string): Promise<void> => {
    const point = await currentPosition()
    // Validated with the same schema the server uses (rule 4). The server
    // re-validates regardless — this only catches a malformed payload early.
    const parsed = advanceStatusInputSchema.safeParse({
      to,
      ...(point ? { point } : {}),
      ...(note ? { note } : {}),
    })
    if (!parsed.success) return
    advance.mutate({ deliveryId: d._id, ...parsed.data })
  }

  return (
    <>
      {d.isCod ? (
        <div className="p-4 bg-surface-sunk rounded-md">
          <div className={CAPS}>
            {/*
              The same figure means two things over a delivery's life: money
              to collect, then money the rider is carrying. Saying which is
              the difference between a rider asking for cash twice and not.
            */}
            {d.codStatus === 'collected'
              ? 'Cash collected · hand in at the office'
              : d.codStatus === 'settled'
                ? 'Cash handed in'
                : d.codStatus === 'failed'
                  ? 'Not collected'
                  : 'Collect on delivery'}
          </div>
          {/* The largest thing on the screen, per the reference's rationale:
              this is the number that gets a rider in trouble. */}
          <div className="mono text-figure-xl font-medium tracking-[-0.035em] mt-1">
            {formatTaka(d.codAmount)}
          </div>
        </div>
      ) : null}

      {/* ---- proof of delivery ---- */}
      {nextStep === 'Delivered' || d.hasProofOfDelivery ? <PodCapture d={d} /> : null}

      {err ? (
        <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mt-4">
          {err}
        </p>
      ) : null}

      {/* ---- the one enormous button ---- */}
      {nextStep ? (
        <>
          <Button
            variant="primary"
            size="lg"
            className="w-full mt-5"
            disabled={busy || needsProof}
            onClick={() => void move(nextStep)}
          >
            {advance.isPending ? 'Saving…' : (ADVANCE_LABEL[nextStep] ?? nextStep)}
          </Button>
          {needsProof ? (
            // All three proof methods are live, so the line names all three.
            <p className="text-tiny text-muted text-center mt-11px">
              Needs a photo, code, or signature first
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted text-center mt-5">
          Nothing left to do on this one.
        </p>
      )}

      {/* ---- the quiet exception path ---- */}
      {canFail ? (
        showFail ? (
          <div className="mt-5 pt-4 border-t border-border">
            <label htmlFor={`fn-${d._id}`} className="block text-small font-medium text-ink-2 mb-1.5">
              What went wrong?
            </label>
            <input
              id={`fn-${d._id}`}
              value={failureNote}
              placeholder="Recipient not reachable"
              onChange={(e) => setFailureNote(e.target.value)}
              className="w-full min-h-12 font-sans text-control text-ink px-13px py-11px mb-3
                         border border-border-strong rounded-sm bg-surface outline-none
                         focus:border-accent focus:ring-[3px] focus:ring-accent-tint"
            />
            <Button
              className="w-full min-h-12"
              disabled={failureNote.trim().length < 3 || busy}
              onClick={() => void move('Failed', failureNote.trim())}
            >
              Confirm failure
            </Button>
            <button
              type="button"
              onClick={() => setShowFail(false)}
              className="w-full min-h-12 text-meta text-muted hover:text-ink mt-3"
            >
              Back
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowFail(true)}
            className="w-full min-h-12 text-small font-medium text-muted hover:text-ink mt-4 py-2"
          >
            Can&apos;t deliver
          </button>
        )
      ) : null}

      {/* ---- M8: decline an offer — its own confirm step, same shape as Failed ---- */}
      {canDecline ? (
        showDecline ? (
          <div className="mt-5 pt-4 border-t border-border">
            <label htmlFor={`dr-${d._id}`} className="block text-small font-medium text-ink-2 mb-1.5">
              Why decline? (optional)
            </label>
            <input
              id={`dr-${d._id}`}
              value={declineReason}
              placeholder="Too far, already on a job…"
              onChange={(e) => setDeclineReason(e.target.value)}
              className="w-full min-h-12 font-sans text-control text-ink px-13px py-11px mb-3
                         border border-border-strong rounded-sm bg-surface outline-none
                         focus:border-accent focus:ring-[3px] focus:ring-accent-tint"
            />
            <Button
              className="w-full min-h-12"
              disabled={busy}
              onClick={() =>
                decline.mutate(
                  { deliveryId: d._id, ...(declineReason.trim() ? { reason: declineReason.trim() } : {}) },
                  { onSuccess: () => setShowDecline(false) },
                )
              }
            >
              {decline.isPending ? 'Declining…' : 'Confirm decline'}
            </Button>
            <button
              type="button"
              onClick={() => setShowDecline(false)}
              className="w-full min-h-12 text-meta text-muted hover:text-ink mt-3"
            >
              Back
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowDecline(true)}
            className="w-full min-h-12 text-small font-medium text-muted hover:text-ink mt-4 py-2"
          >
            Decline this job
          </button>
        )
      ) : null}
    </>
  )
}
