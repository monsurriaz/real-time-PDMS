import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  assignInputSchema,
  deliveryStatusSchema,
  zoneName,
  type DeliveryListItem,
  type DeliveryStatus,
} from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card, Eyebrow } from '@/components/Card'
import { LifecycleRail } from '@/components/LifecycleRail'
import { Modal } from '@/components/Modal'
import {
  FilterBar,
  Pager,
  SelectFilter,
  TableScroll,
  Td,
  Thead,
  Tr,
  Who,
  paginate,
} from '@/components/Table'
import { useSearchable } from '@/features/shell/useHeaderSearch'
import { MessageThread } from '@/features/messaging/MessageThread'
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
    <>
      {err ? (
        <p role="alert" className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 mb-3">
          {err}
        </p>
      ) : null}

      {candidates.isPending ? (
        <p className="text-sm text-muted">Finding riders…</p>
      ) : candidates.isError ? (
        <p className="text-small text-failed-ink">
          {candidates.error instanceof ApiError
            ? candidates.error.message
            : 'Could not look up riders.'}
        </p>
      ) : candidates.data ? (
        <>
          <p className="text-meta text-muted mb-3">
            {STRATEGY_NOTE[candidates.data.strategy] ?? ''}
            {!candidates.data.hasPickupPoint
              ? ' This parcel has no geocoded pick-up point, so distance is unknown.'
              : ''}
          </p>

          {candidates.data.candidates.length === 0 ? (
            <p className="text-sm text-muted">
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
                    className="flex items-center justify-between gap-3 bg-surface border border-border rounded-sm px-3 py-2"
                  >
                    <div className="min-w-0">
                      <span className="text-sm font-medium block truncate">
                        {c.name}
                        {c.agentId === currentAgentId ? (
                          <span className="text-muted font-normal"> · current</span>
                        ) : null}
                      </span>
                      <span className="text-tiny text-muted">
                        {c.vehicle}
                        {c.distanceMetres !== null
                          ? ` · ${formatKm(c.distanceMetres / 1000)}`
                          : ' · zone match'}
                        {/* Why this rider is where they are in the list. */}
                        {c.activeDeliveries > 0
                          ? ` · carrying ${c.activeDeliveries}`
                          : ' · free'}
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
    </>
  )
}

const PER_PAGE = 10

export const DeliveryBoard = () => {
  const [filter, setFilter] = useState<DeliveryStatus | 'all'>('all')
  const [zone, setZone] = useState<string>('')
  const [rider, setRider] = useState<string>('')
  const [page, setPage] = useState(1)
  const [openFor, setOpenFor] = useState<string | null>(null)
  const [messagesFor, setMessagesFor] = useState<string | null>(null)
  const deliveries = useDeliveries(filter)
  // Claims the header's search box for this screen — v3.1 addendum. Filters
  // the rows useDeliveries already fetched; no new request.
  const search = useSearchable('Search tracking ID, recipient or rider…')

  /** Rider names come from the rows themselves — no extra request to fill a filter. */
  const riderOptions = useMemo(() => {
    const names = new Set<string>()
    for (const d of deliveries.data ?? []) if (d.agentName) names.add(d.agentName)
    return [...names].sort().map((n) => ({ value: n, label: n }))
  }, [deliveries.data])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (deliveries.data ?? []).filter(
      (d) =>
        (zone === '' || d.pickupZone === zone || d.dropZone === zone) &&
        (rider === '' || d.agentName === rider) &&
        (q === '' ||
          d.trackingId.toLowerCase().includes(q) ||
          d.recipientName.toLowerCase().includes(q) ||
          (d.agentName?.toLowerCase().includes(q) ?? false)),
    )
  }, [deliveries.data, zone, rider, search])

  const view = paginate(rows, page, PER_PAGE)
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    setPage(1)
  }
  /** The row the assign modal is open for — its tracking ID/recipient are the
   * modal's header context, so which parcel is being (re)assigned is never
   * ambiguous. */
  const openForRow = rows.find((d) => d._id === openFor) ?? null
  /** M9: which row's read-only thread the admin has open. */
  const messagesForRow = rows.find((d) => d._id === messagesFor) ?? null

  if (deliveries.isPending) {
    return (
      <Card>
        <p className="text-body text-muted">Loading deliveries…</p>
      </Card>
    )
  }

  if (deliveries.isError) {
    return (
      <Card>
        <p
          role="alert"
          className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
        >
          {deliveries.error instanceof ApiError
            ? deliveries.error.message
            : 'Deliveries could not be loaded.'}
        </p>
      </Card>
    )
  }

  return (
    <Card pad={false}>
      <FilterBar>
        <SelectFilter
          label="All statuses"
          value={filter === 'all' ? '' : filter}
          onChange={resetPage((v: DeliveryStatus | '') => setFilter(v === '' ? 'all' : v))}
          options={deliveryStatusSchema.options.map((o) => ({ value: o, label: o }))}
        />
        <SelectFilter
          label="All zones"
          value={zone}
          onChange={resetPage(setZone)}
          options={zoneName.options.map((z) => ({ value: z, label: z }))}
        />
        <SelectFilter
          label="All riders"
          value={rider}
          onChange={resetPage(setRider)}
          options={riderOptions}
        />
        <Button
          size="sm"
          variant="ink"
          className="ml-auto"
          onClick={() => exportCsv(rows)}
          disabled={rows.length === 0}
        >
          Export
        </Button>
      </FilterBar>

      {rows.length === 0 ? (
        <div className="px-18px py-8 text-center">
          <p className="text-body text-muted">
            {(deliveries.data ?? []).length === 0
              ? 'No deliveries yet. Run the seed script or book a parcel.'
              : 'Nothing matches those filters.'}
          </p>
        </div>
      ) : (
        <TableScroll min={940}>
          <Thead
            cols={['Tracking', 'Recipient', 'Progress', 'Rider', 'Zone', 'COD', 'Status', '']}
          />
          <tbody>
            {view.slice.map((d) => (
              <Tr key={d._id}>
                <Td>
                  <Link
                    to={`/customer/track/${d.parcelId}`}
                    className="mono text-small font-medium hover:text-accent whitespace-nowrap inline-flex items-center min-h-6"
                  >
                    {d.trackingId}
                  </Link>
                  {d.isOverdue ? (
                    <span className="block text-eyebrow text-failed-ink font-medium">
                      overdue
                    </span>
                  ) : null}
                </Td>
                <Td>
                  <Who name={d.recipientName} sub={`${d.pickupArea} → ${d.dropArea}`} />
                </Td>
                <Td>
                  {/*
                    Compact: at this 86px width, five discrete segments read
                    as an ellipsis rather than progress (v3.1 addendum).
                  */}
                  <div className="w-[86px]">
                    <LifecycleRail status={d.status} rail="compact" />
                  </div>
                </Td>
                <Td>
                  {d.agentName ?? <span className="text-muted">Unassigned</span>}
                </Td>
                <Td className="text-ink-2">{d.dropZone}</Td>
                <Td>
                  {d.isCod ? (
                    <>
                      <span className="mono text-small">{formatTaka(d.codAmount)}</span>
                      <span
                        className={[
                          'block text-eyebrow',
                          // Cash a rider is still carrying is the figure an
                          // admin is scanning for; settled cash is history.
                          d.codStatus === 'collected'
                            ? 'text-transit-ink'
                            : d.codStatus === 'failed'
                              ? 'text-failed-ink'
                              : 'text-faint',
                        ].join(' ')}
                      >
                        {d.codStatus === 'collected'
                          ? 'held'
                          : d.codStatus === 'settled'
                            ? 'settled'
                            : d.codStatus === 'failed'
                              ? 'not collected'
                              : 'on delivery'}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td>
                  <Badge status={d.status} />
                </Td>
                <Td align="right">
                  {/*
                    Assignment is only offered while it is legal — before
                    pickup (section 5, extended by M8 to also cover Accepted:
                    a rider who's accepted but not yet picked up can still be
                    reassigned). The server refuses regardless.
                  */}
                  {['Booked', 'Assigned', 'Accepted'].includes(d.status) ? (
                    <Button
                      size="sm"
                      variant={d.agentId ? 'quiet' : 'primary'}
                      onClick={() => setOpenFor(d._id)}
                    >
                      {d.agentId ? 'Reassign' : 'Assign'}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      <Link to={`/customer/track/${d.parcelId}`} className="inline-flex">
                        <Button size="sm">View</Button>
                      </Link>
                      {/*
                        M9: an admin can read a delivery's thread but never
                        post to it — the same window (PickedUp onward) that
                        makes Assign/Reassign unavailable is exactly when a
                        thread might have anything in it.
                      */}
                      <Button size="sm" onClick={() => setMessagesFor(d._id)}>
                        Messages
                      </Button>
                    </span>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableScroll>
      )}

      {messagesForRow ? (
        <Modal
          open
          onClose={() => setMessagesFor(null)}
          title={
            <>
              <Eyebrow>Messages</Eyebrow>
              <p className="text-base font-semibold tracking-[-0.015em] truncate">
                {messagesForRow.trackingId}
                <span className="text-muted font-normal"> · {messagesForRow.recipientName}</span>
              </p>
            </>
          }
        >
          <MessageThread deliveryId={messagesForRow._id} parcelId={messagesForRow.parcelId} />
        </Modal>
      ) : null}

      {openForRow ? (
        <Modal
          open
          onClose={() => setOpenFor(null)}
          title={
            <>
              <Eyebrow>{openForRow.agentId ? 'Reassign' : 'Assign'}</Eyebrow>
              <p className="text-base font-semibold tracking-[-0.015em] truncate">
                {openForRow.trackingId}
                <span className="text-muted font-normal"> · {openForRow.recipientName}</span>
              </p>
            </>
          }
        >
          <AssignPanel
            deliveryId={openForRow._id}
            currentAgentId={openForRow.agentId}
            onClose={() => setOpenFor(null)}
          />
        </Modal>
      ) : null}

      <Pager
        page={view.page}
        pageCount={view.pageCount}
        total={rows.length}
        from={view.from}
        to={view.to}
        onPage={setPage}
      />
    </Card>
  )
}

/**
 * Export what is on screen, filters included.
 *
 * A Blob and an <a download>, so no dependency and no server round trip — the
 * rows are already in the browser. Exporting the FILTERED set rather than
 * everything is the point: an admin who narrowed to one rider's failed COD
 * parcels wants those, not all 412.
 */
const exportCsv = (rows: readonly DeliveryListItem[]): void => {
  const head = ['Tracking', 'Recipient', 'Status', 'Rider', 'Pickup zone', 'Drop zone', 'Total', 'COD', 'COD status']
  const cell = (v: string | number | null): string => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = [
    head.join(','),
    ...rows.map((d) =>
      [
        d.trackingId,
        d.recipientName,
        d.status,
        d.agentName,
        d.pickupZone,
        d.dropZone,
        d.total,
        d.isCod ? d.codAmount : '',
        d.isCod ? (d.codStatus ?? '') : '',
      ]
        .map(cell)
        .join(','),
    ),
  ].join('\n')

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `deliveries-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
