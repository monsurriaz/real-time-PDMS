import { useState } from 'react'
import type { DeliveryListItem, DeliveryStatus } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Field } from '@/components/Field'
import { Eyebrow, Panel } from '@/components/Panel'
import { ApiError } from '@/lib/api'
import { formatKg, formatTaka } from '@/lib/format'
import {
  currentPosition,
  useAdvanceStatus,
  useDeliveries,
  useRecordPod,
} from '../deliveries/useDeliveries'

/**
 * The rider's screen. CLAUDE.md section 4: light, large tap targets (48px
 * minimum), one-handed. Riders use this outdoors in daylight, so everything
 * is high-contrast ink on paper with no small controls.
 *
 * The action buttons come from `allowedTransitions`, which the server
 * computes from its own transition map — the client never decides what is
 * legal (rule 3), it only renders what it was told.
 */

const ACTION_LABEL: Record<DeliveryStatus, string> = {
  Booked: 'Book',
  Assigned: 'Assign',
  PickedUp: 'Picked up',
  InTransit: 'Start delivery',
  Delivered: 'Delivered',
  Cancelled: 'Cancel',
  Failed: 'Mark failed',
}

/** Terminal states drop off the run list; these are the live ones. */
const ACTIVE: readonly DeliveryStatus[] = ['Assigned', 'PickedUp', 'InTransit']

const DeliveryCard = ({ d }: { d: DeliveryListItem }) => {
  const advance = useAdvanceStatus()
  const pod = useRecordPod()
  const [receivedBy, setReceivedBy] = useState('')
  const [failureNote, setFailureNote] = useState('')
  const [showFail, setShowFail] = useState(false)

  const busy = advance.isPending || pod.isPending
  const err =
    advance.error instanceof ApiError
      ? advance.error.message
      : pod.error instanceof ApiError
        ? pod.error.message
        : null

  /**
   * Stamp the rider's position onto the transition when the browser will give
   * it. A refusal must not block the delivery, so a null point is fine.
   */
  const move = async (to: DeliveryStatus, note?: string): Promise<void> => {
    const point = await currentPosition()
    advance.mutate({
      deliveryId: d._id,
      to,
      ...(point ? { point } : {}),
      ...(note ? { note } : {}),
    })
  }

  const canDeliver = d.allowedTransitions.includes('Delivered')
  const canFail = d.allowedTransitions.includes('Failed')
  const plainSteps = d.allowedTransitions.filter(
    (t) => t !== 'Delivered' && t !== 'Failed',
  )

  return (
    <Panel className="mb-4">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <span className="mono text-[14px] font-medium block">{d.trackingId}</span>
          <span className="text-[12.5px] text-muted">
            {d.pickupArea} → {d.dropArea}
          </span>
        </div>
        <Badge status={d.status} />
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4 text-[13px]">
        <div>
          <Eyebrow>Recipient</Eyebrow>
          <p className="font-medium">{d.recipientName}</p>
        </div>
        <div>
          <Eyebrow>Weight</Eyebrow>
          <p className="mono">{formatKg(d.weightKg)}</p>
        </div>
        {d.isCod ? (
          <div className="col-span-2 bg-accent-tint border-l-2 border-accent rounded-r-sm px-3 py-2">
            <Eyebrow>Collect on delivery</Eyebrow>
            <p className="mono text-[16px] font-medium">{formatTaka(d.codAmount)}</p>
          </div>
        ) : null}
      </div>

      {err ? (
        <p role="alert" className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
          {err}
        </p>
      ) : null}

      {/* Proof of delivery must exist before Delivered is offered. */}
      {canDeliver && !d.hasProofOfDelivery ? (
        <div className="border-t border-hairline pt-4">
          <Eyebrow>Proof of delivery</Eyebrow>
          <Field
            label="Received by"
            placeholder={d.recipientName}
            value={receivedBy}
            onChange={(e) => setReceivedBy(e.target.value)}
          />
          <Button
            variant="ink"
            size="lg"
            className="w-full"
            disabled={receivedBy.trim().length < 2 || busy}
            onClick={() => pod.mutate({ deliveryId: d._id, receivedBy: receivedBy.trim() })}
          >
            {pod.isPending ? 'Saving…' : 'Record proof'}
          </Button>
          <p className="text-[11.5px] text-faint mt-2">
            Needed before this can be marked delivered.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2 mt-1">
        {plainSteps.map((to) => (
          <Button
            key={to}
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void move(to)}
          >
            {ACTION_LABEL[to]}
          </Button>
        ))}

        {canDeliver && d.hasProofOfDelivery ? (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void move('Delivered')}
          >
            Delivered
          </Button>
        ) : null}

        {canFail ? (
          showFail ? (
            <div className="border-t border-hairline pt-4 mt-2">
              <Field
                label="What went wrong?"
                placeholder="Recipient not reachable"
                value={failureNote}
                onChange={(e) => setFailureNote(e.target.value)}
              />
              <Button
                size="lg"
                className="w-full"
                disabled={failureNote.trim().length < 3 || busy}
                onClick={() => void move('Failed', failureNote.trim())}
              >
                Confirm failure
              </Button>
              <Button className="w-full mt-2" onClick={() => setShowFail(false)}>
                Back
              </Button>
            </div>
          ) : (
            <Button size="lg" className="w-full" onClick={() => setShowFail(true)}>
              Cannot deliver
            </Button>
          )
        ) : null}
      </div>
    </Panel>
  )
}

export const RunList = () => {
  const deliveries = useDeliveries()

  if (deliveries.isPending) {
    return (
      <Panel>
        <p className="text-[13.5px] text-muted">Loading your runs…</p>
      </Panel>
    )
  }

  if (deliveries.isError) {
    return (
      <Panel>
        <p role="alert" className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
          {deliveries.error instanceof ApiError
            ? deliveries.error.message
            : 'Your runs could not be loaded.'}
        </p>
      </Panel>
    )
  }

  const active = deliveries.data.filter((d) => ACTIVE.includes(d.status))
  const done = deliveries.data.filter((d) => !ACTIVE.includes(d.status))

  if (deliveries.data.length === 0) {
    return (
      <Panel>
        <p className="text-[13.5px] text-muted">
          Nothing assigned to you yet. An admin assigns work from the operations
          board.
        </p>
      </Panel>
    )
  }

  return (
    <div className="max-w-[560px]">
      {active.length > 0 ? (
        <>
          <Eyebrow>{active.length} active</Eyebrow>
          {active.map((d) => (
            <DeliveryCard key={d._id} d={d} />
          ))}
        </>
      ) : (
        <Panel className="mb-4">
          <p className="text-[13.5px] text-muted">
            No active runs. Completed work is below.
          </p>
        </Panel>
      )}

      {done.length > 0 ? (
        <>
          <Eyebrow>Finished · {done.length}</Eyebrow>
          <Panel>
            {done.map((d) => (
              <div
                key={d._id}
                className="flex items-center justify-between gap-3 py-3 border-b border-hairline last:border-b-0"
              >
                <div>
                  <span className="mono text-[12.5px] font-medium block">
                    {d.trackingId}
                  </span>
                  <span className="text-[12px] text-muted">
                    {d.pickupArea} → {d.dropArea}
                  </span>
                </div>
                <Badge status={d.status} />
              </div>
            ))}
          </Panel>
        </>
      ) : null}
    </div>
  )
}
