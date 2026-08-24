import { useState } from 'react'
import {
  advanceStatusInputSchema,
  type DeliveryListItem,
  type DeliveryStatus,
} from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { LifecycleRail } from '@/components/LifecycleRail'
import { ApiError } from '@/lib/api'
import { formatTaka } from '@/lib/format'
import {
  currentPosition,
  useAdvanceStatus,
  useRecordPod,
} from '../deliveries/useDeliveries'

/**
 * The agent active-delivery card, ported from the phone mockup in
 * docs/design-system.html: a 372px frame at 26px radius, tracking ID and badge
 * above the lifecycle rail in the head, then the recipient, Call/Navigate, the
 * COD amount as the largest thing on screen, the proof-of-delivery row, and
 * ONE enormous button.
 *
 * The reference's own note: "This button only ever offers the one legal next
 * transition." That next step comes from the server's allowedTransitions, so
 * the client renders authority rather than deciding it (CLAUDE.md rule 3).
 */

const ADVANCE_LABEL: Record<string, string> = {
  PickedUp: 'Picked up',
  InTransit: 'Start delivery',
  Delivered: 'Mark delivered',
}

const CAPS = 'text-[11px] font-semibold uppercase tracking-[0.13em] text-faint'

/**
 * The dashed `.pod` tiles from the reference. Photo and OTP are M5, so those
 * two are inert and say so; the working signature capture lives in the same
 * row rather than as another full-width button competing with the primary.
 */
const PodTile = ({
  label,
  hint,
  onClick,
  active,
  children,
}: {
  label: string
  hint?: string
  onClick?: () => void
  active?: boolean
  children: React.ReactNode
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={!onClick}
    className={[
      'flex-1 border border-dashed rounded-md py-4 px-3 text-center',
      'text-[12.5px] font-medium transition-colors duration-100',
      onClick
        ? active
          ? 'border-accent bg-accent-tint text-ink cursor-pointer'
          : 'border-hairline-strong text-ink-2 hover:bg-surface-sunk cursor-pointer'
        : 'border-hairline text-faint cursor-not-allowed',
    ].join(' ')}
  >
    <span className="flex justify-center mb-1.5">{children}</span>
    {label}
    {hint ? <span className="block text-[10.5px] font-normal mt-0.5">{hint}</span> : null}
  </button>
)

export const ActiveDelivery = ({ d }: { d: DeliveryListItem }) => {
  const advance = useAdvanceStatus()
  const pod = useRecordPod()
  const [capturing, setCapturing] = useState(false)
  const [receivedBy, setReceivedBy] = useState('')
  const [failureNote, setFailureNote] = useState('')
  const [showFail, setShowFail] = useState(false)

  /**
   * The single next step. Failed is excluded: it is the exception, not the
   * next step, and the mockup gives the one big button to progress.
   */
  const nextStep = d.allowedTransitions.find(
    (t): t is DeliveryStatus => t !== 'Failed' && t !== 'Cancelled',
  )
  const canFail = d.allowedTransitions.includes('Failed')
  const needsProof = nextStep === 'Delivered' && !d.hasProofOfDelivery
  const busy = advance.isPending || pod.isPending

  const err =
    advance.error instanceof ApiError
      ? advance.error.message
      : pod.error instanceof ApiError
        ? pod.error.message
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
    <div className="w-[372px] max-w-full mx-auto border border-hairline rounded-[26px] bg-surface overflow-hidden mb-5">
      {/* ---- head ---- */}
      <div className="px-[18px] pt-4 pb-3 border-b border-hairline">
        <div className="flex items-center justify-between gap-3">
          <span className="mono text-[12.5px] font-medium">{d.trackingId}</span>
          <Badge status={d.status} />
        </div>
        <div className="mt-14px">
          <LifecycleRail status={d.status} />
        </div>
      </div>

      {/* ---- body ---- */}
      <div className="p-[18px]">
        <div className={CAPS}>Deliver to</div>
        <div className="text-[17px] font-semibold mt-5px tracking-[-0.015em]">
          {d.recipientName}
        </div>
        <div className="text-[13.5px] text-muted mt-0.5">
          {d.dropArea}, {d.dropZone}
        </div>

        <div className="flex gap-9px mt-14px">
          {/*
            Both are in the reference. Navigate needs the drop coordinates,
            which the list projection does not carry, and Call needs the
            recipient's number, which section 7 keeps off this payload — so
            both are present and disabled rather than pretending to work.
          */}
          <Button className="flex-1" disabled>
            Call
          </Button>
          <Button className="flex-1" disabled>
            Navigate
          </Button>
        </div>

        {d.isCod ? (
          <div className="mt-22px p-4 bg-surface-sunk rounded-md">
            <div className={CAPS}>Collect on delivery</div>
            {/* The largest thing on the screen, per the reference's rationale:
                this is the number that gets a rider in trouble. */}
            <div className="mono text-[29px] font-medium tracking-[-0.035em] mt-1">
              {formatTaka(d.codAmount)}
            </div>
          </div>
        ) : null}

        {/* ---- proof of delivery row ---- */}
        {nextStep === 'Delivered' ? (
          <>
            <div className={`${CAPS} mt-6`}>Proof of delivery</div>
            <div className="flex gap-10px mt-14px">
              <PodTile label="Photo" hint="M5">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
                  <circle cx="12" cy="13" r="3.5" />
                </svg>
              </PodTile>
              <PodTile label="OTP" hint="M5">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="4" y="10" width="16" height="11" rx="2" />
                  <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                </svg>
              </PodTile>
              <PodTile
                label="Signature"
                active={capturing || d.hasProofOfDelivery}
                onClick={
                  d.hasProofOfDelivery ? undefined : () => setCapturing((v) => !v)
                }
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 17c3-1 4-8 7-8s2 6 5 6 3-3 6-3" />
                </svg>
              </PodTile>
            </div>

            {capturing && !d.hasProofOfDelivery ? (
              <div className="mt-14px">
                <label htmlFor={`rb-${d._id}`} className="block text-[12.5px] font-medium text-ink-2 mb-1.5">
                  Received by
                </label>
                <div className="flex gap-2">
                  <input
                    id={`rb-${d._id}`}
                    value={receivedBy}
                    placeholder={d.recipientName}
                    onChange={(e) => setReceivedBy(e.target.value)}
                    className="flex-1 min-w-0 font-sans text-[14.5px] text-ink px-13px py-11px
                               border border-hairline-strong rounded-sm bg-surface outline-none
                               focus:border-accent focus:ring-[3px] focus:ring-accent-tint"
                  />
                  <Button
                    disabled={receivedBy.trim().length < 2 || busy}
                    onClick={() =>
                      pod.mutate(
                        { deliveryId: d._id, receivedBy: receivedBy.trim() },
                        { onSuccess: () => setCapturing(false) },
                      )
                    }
                  >
                    {pod.isPending ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {err ? (
          <p role="alert" className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mt-4">
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
              <p className="text-[11.5px] text-faint text-center mt-11px">
                Needs a signature first
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-[13px] text-muted text-center mt-5">
            Nothing left to do on this one.
          </p>
        )}

        {/* ---- the quiet exception path ---- */}
        {canFail ? (
          showFail ? (
            <div className="mt-5 pt-4 border-t border-hairline">
              <label htmlFor={`fn-${d._id}`} className="block text-[12.5px] font-medium text-ink-2 mb-1.5">
                What went wrong?
              </label>
              <input
                id={`fn-${d._id}`}
                value={failureNote}
                placeholder="Recipient not reachable"
                onChange={(e) => setFailureNote(e.target.value)}
                className="w-full font-sans text-[14.5px] text-ink px-13px py-11px mb-3
                           border border-hairline-strong rounded-sm bg-surface outline-none
                           focus:border-accent focus:ring-[3px] focus:ring-accent-tint"
              />
              <Button
                className="w-full"
                disabled={failureNote.trim().length < 3 || busy}
                onClick={() => void move('Failed', failureNote.trim())}
              >
                Confirm failure
              </Button>
              <button
                type="button"
                onClick={() => setShowFail(false)}
                className="w-full text-[12px] text-muted hover:text-ink mt-3"
              >
                Back
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowFail(true)}
              className="w-full text-[12.5px] font-medium text-muted hover:text-ink mt-4 py-2"
            >
              Can&apos;t deliver
            </button>
          )
        ) : null}
      </div>
    </div>
  )
}
