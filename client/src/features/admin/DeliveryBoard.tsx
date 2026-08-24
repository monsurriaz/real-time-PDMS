import { useState } from 'react'
import {
  assignInputSchema,
  deliveryStatusSchema,
  type DeliveryStatus,
} from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Eyebrow, Panel } from '@/components/Panel'
import { ApiError } from '@/lib/api'
import { formatKm, formatTaka } from '@/lib/format'
import {
  useAssign,
  useCandidates,
  useDeliveries,
} from '../deliveries/useDeliveries'

/**
 * The admin operations board: every delivery, with assignment.
 *
 * Assignment offers the nearest available rider by default and lets the admin
 * override with anyone in the zone (CLAUDE.md section 5). The panel states
 * which strategy produced the list, because "nearest within 5 km" and "anyone
 * in this zone" are materially different recommendations.
 */

const FILTERS: ReadonlyArray<DeliveryStatus | 'all'> = [
  'all',
  ...deliveryStatusSchema.options,
]

const STRATEGY_NOTE: Record<string, string> = {
  near: 'Nearest available riders within 5 km of the pick-up.',
  'zone-only': 'Nobody available within 5 km — showing every available rider in the zone.',
  none: 'No available rider covers this zone.',
}

const AssignPanel = ({
  deliveryId,
  currentAgentId,
  onClose,
}: {
  deliveryId: string
  currentAgentId: string | null
  onClose: () => void
}) => {
  const candidates = useCandidates(deliveryId)
  const assign = useAssign()

  const err = assign.error instanceof ApiError ? assign.error.message : null

  return (
    <div className="bg-surface-sunk border border-hairline rounded-md p-4 mt-3">
      <div className="flex items-baseline justify-between mb-3">
        <Eyebrow>{currentAgentId ? 'Reassign' : 'Assign'}</Eyebrow>
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] text-muted hover:text-ink"
        >
          Close
        </button>
      </div>

      {err ? (
        <p role="alert" className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
          {err}
        </p>
      ) : null}

      {candidates.isPending ? (
        <p className="text-[13px] text-muted">Finding riders…</p>
      ) : candidates.isError ? (
        <p className="text-[12.5px] text-failed-ink">
          {candidates.error instanceof ApiError
            ? candidates.error.message
            : 'Could not look up riders.'}
        </p>
      ) : candidates.data ? (
        <>
          <p className="text-[12px] text-muted mb-3">
            {STRATEGY_NOTE[candidates.data.strategy] ?? ''}
            {!candidates.data.hasPickupPoint
              ? ' This parcel has no geocoded pick-up point, so distance is unknown.'
              : ''}
          </p>

          {candidates.data.candidates.length === 0 ? (
            <p className="text-[13px] text-muted">
              No available rider covers {candidates.data.zone}. Bring an agent
              online first.
            </p>
          ) : (
            <>
              {candidates.data.strategy !== 'none' && !currentAgentId ? (
                <Button
                  variant="ink"
                  className="w-full mb-3"
                  disabled={assign.isPending}
                  onClick={() => assign.mutate({ deliveryId }, { onSuccess: onClose })}
                >
                  {assign.isPending ? 'Assigning…' : 'Auto-assign nearest'}
                </Button>
              ) : null}

              <div className="grid gap-2">
                {candidates.data.candidates.map((c) => (
                  <div
                    key={c.agentId}
                    className="flex items-center justify-between gap-3 bg-surface border border-hairline rounded-sm px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-[13px] font-medium block truncate">
                        {c.name}
                        {c.agentId === currentAgentId ? (
                          <span className="text-muted font-normal"> · current</span>
                        ) : null}
                      </span>
                      <span className="text-[11.5px] text-muted">
                        {c.vehicle}
                        {c.distanceMetres !== null
                          ? ` · ${formatKm(c.distanceMetres / 1000)}`
                          : ' · zone match'}
                      </span>
                    </div>
                    <Button
                      disabled={assign.isPending || c.agentId === currentAgentId}
                      onClick={() => {
                        // Shared schema, same as the server's (rule 4).
                        const parsed = assignInputSchema.safeParse({
                          agentId: c.agentId,
                        })
                        if (!parsed.success) return
                        assign.mutate(
                          { deliveryId, agentId: parsed.data.agentId },
                          { onSuccess: onClose },
                        )
                      }}
                    >
                      {c.agentId === currentAgentId ? 'Assigned' : 'Choose'}
                    </Button>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}

export const DeliveryBoard = () => {
  const [filter, setFilter] = useState<DeliveryStatus | 'all'>('all')
  const [openFor, setOpenFor] = useState<string | null>(null)
  const deliveries = useDeliveries(filter)

  return (
    <div>
      {/* Status filter — quiet buttons, no new component pattern. */}
      <div className="flex flex-wrap gap-2 mb-5">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={[
              'text-[12.5px] font-medium px-3 py-1.5 rounded-pill border',
              filter === f
                ? 'bg-ink text-white border-transparent'
                : 'bg-surface text-ink-2 border-hairline-strong hover:bg-surface-sunk',
            ].join(' ')}
          >
            {f === 'all' ? 'All' : f}
          </button>
        ))}
      </div>

      {deliveries.isPending ? (
        <Panel>
          <p className="text-[13.5px] text-muted">Loading deliveries…</p>
        </Panel>
      ) : deliveries.isError ? (
        <Panel>
          <p role="alert" className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
            {deliveries.error instanceof ApiError
              ? deliveries.error.message
              : 'Deliveries could not be loaded.'}
          </p>
        </Panel>
      ) : deliveries.data.length === 0 ? (
        <Panel>
          <p className="text-[13.5px] text-muted">
            {filter === 'all'
              ? 'No deliveries yet. Run the seed script or book a parcel.'
              : `Nothing is ${filter}.`}
          </p>
        </Panel>
      ) : (
        <Panel title={`${deliveries.data.length} deliveries`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr>
                  {['Tracking', 'Route', 'Status', 'Rider', 'Value', ''].map((h) => (
                    <th
                      key={h}
                      className="text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-faint pb-3 border-b border-hairline"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {deliveries.data.map((d) => (
                  <tr key={d._id} className="border-b border-hairline last:border-b-0 align-top">
                    <td className="py-3 pr-4">
                      <span className="mono text-[12.5px] font-medium">{d.trackingId}</span>
                      {d.isOverdue ? (
                        <span className="block text-[11px] text-failed-ink font-medium">
                          overdue
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4 text-[13px] text-ink-2">
                      {d.pickupArea} → {d.dropArea}
                      <span className="block text-[11.5px] text-faint">
                        {d.pickupZone} → {d.dropZone}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Badge status={d.status} />
                    </td>
                    <td className="py-3 pr-4 text-[13px]">
                      {d.agentName ?? <span className="text-faint">unassigned</span>}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="mono text-[13px]">{formatTaka(d.total)}</span>
                      {d.isCod ? (
                        <span
                          className={[
                            'block text-[11px] mono',
                            // Cash a rider is still carrying is the figure an
                            // admin is scanning for; settled cash is history.
                            d.codStatus === 'collected'
                              ? 'text-transit-ink'
                              : d.codStatus === 'failed'
                                ? 'text-failed-ink'
                                : 'text-faint',
                          ].join(' ')}
                        >
                          COD {formatTaka(d.codAmount)}
                          {d.codStatus === 'collected'
                            ? ' · held'
                            : d.codStatus === 'settled'
                              ? ' · settled'
                              : d.codStatus === 'failed'
                                ? ' · not collected'
                                : ''}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3">
                      {/*
                        Assignment is only offered while it is legal — before
                        pickup (section 5). The server refuses regardless.
                      */}
                      {d.status === 'Booked' || d.status === 'Assigned' ? (
                        <Button
                          onClick={() =>
                            setOpenFor(openFor === d._id ? null : d._id)
                          }
                        >
                          {d.agentId ? 'Reassign' : 'Assign'}
                        </Button>
                      ) : (
                        <span className="text-[11.5px] text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {openFor ? (
            <AssignPanel
              deliveryId={openFor}
              currentAgentId={
                deliveries.data.find((d) => d._id === openFor)?.agentId ?? null
              }
              onClose={() => setOpenFor(null)}
            />
          ) : null}
        </Panel>
      )}
    </div>
  )
}
