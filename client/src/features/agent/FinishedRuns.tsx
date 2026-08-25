import { useMemo, useState } from 'react'
import type { DeliveryStatus } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Card } from '@/components/Card'
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
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { useDeliveries } from '../deliveries/useDeliveries'

/**
 * /agent/finished — every run this rider has closed out, terminal status
 * either way. The rail has carried this count since M6.5a; this is the
 * screen behind it.
 *
 * No detail view: /customer/track/:parcelId exists but is gated to
 * customer/admin, and a finished run has nothing left for a rider to DO —
 * so this is a read-only record, not a launchpad to another screen.
 */

const STATUSES = ['Delivered', 'Cancelled', 'Failed'] as const satisfies readonly DeliveryStatus[]

const POD_LABEL: Record<string, string> = {
  photo: 'Photo',
  otp: 'Code',
  signature: 'Signature',
}

const PER_PAGE = 15

export const FinishedRuns = () => {
  const [status, setStatus] = useState<DeliveryStatus | ''>('')
  const [page, setPage] = useState(1)
  const deliveries = useDeliveries()

  const rows = useMemo(
    () =>
      (deliveries.data ?? []).filter(
        (d) =>
          (STATUSES as readonly string[]).includes(d.status) &&
          (status === '' || d.status === status),
      ),
    [deliveries.data, status],
  )

  const view = paginate(rows, page, PER_PAGE)

  if (deliveries.isPending) {
    return (
      <Card>
        <p className="text-body text-muted">Loading your finished runs…</p>
      </Card>
    )
  }

  if (deliveries.isError) {
    return (
      <Card>
        <p role="alert" className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2">
          {deliveries.error instanceof ApiError
            ? deliveries.error.message
            : 'Your finished runs could not be loaded.'}
        </p>
      </Card>
    )
  }

  return (
    <Card pad={false}>
      <FilterBar>
        <SelectFilter
          label="All statuses"
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          options={STATUSES.map((s) => ({ value: s, label: s }))}
        />
      </FilterBar>

      {rows.length === 0 ? (
        <div className="px-18px py-8 text-center">
          <p className="text-body text-muted">
            {(deliveries.data ?? []).length === 0
              ? "Nothing here yet — today's runs will land here once you finish one."
              : 'Nothing matches that filter.'}
          </p>
        </div>
      ) : (
        <TableScroll min={680}>
          <Thead cols={['Tracking', 'Recipient', 'Status', 'Proof', 'Finished']} />
          <tbody>
            {view.slice.map((d) => (
              <Tr key={d._id}>
                <Td>
                  <span className="mono text-small font-medium">{d.trackingId}</span>
                </Td>
                <Td>
                  <Who name={d.recipientName} sub={`${d.pickupArea} → ${d.dropArea}`} />
                </Td>
                <Td>
                  <Badge status={d.status} />
                </Td>
                <Td>
                  {d.podMethod ? (
                    <span className="text-ink-2">{POD_LABEL[d.podMethod] ?? d.podMethod}</span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
                <Td>
                  <span className="mono text-meta text-muted">{formatDateTime(d.updatedAt)}</span>
                </Td>
              </Tr>
            ))}
          </tbody>
        </TableScroll>
      )}

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
