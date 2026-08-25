import { useMemo, useState } from 'react'
import { userStatusSchema, type CustomerRow, type UserStatus } from '@pdms/shared'
import { AppShell, PageHead } from '@/components/AppShell'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { Pill } from '@/components/Badge'
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
import {
  useCustomerRoster,
  useReactivateCustomer,
  useSuspendCustomer,
} from './useCustomers'

/**
 * /admin/customers — the customer roster, with suspend and reactivate.
 *
 * A route v3's table does not list, because customer suspension did not exist
 * when the reference was drawn. Nothing new is invented for it: the filter bar,
 * the avatar rows, the per-row action and the pager are the same components
 * /admin/agents and the customer's own parcel list already use, so the screen
 * belongs to the frozen system rather than sitting beside it.
 */

const STATUS_LABEL: Record<UserStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
}

/**
 * Suspend and Reactivate are ink, not the accent.
 *
 * Same reasoning as the rider approval buttons: the accent is a lifecycle
 * state, and switching an account off does not move a parcel forward. Ink is
 * what an admin action looks like in this system (CLAUDE.md section 4).
 *
 * Suspending takes two taps. It cuts a customer off mid-session — that is the
 * whole point of the server-side check — so it gets the same arm-then-confirm
 * treatment the customer's own Cancel button gets, in a dense row where a
 * mis-tap is easy. Reactivating is one tap: it only ever restores something.
 */
const StatusAction = ({ customer }: { customer: CustomerRow }) => {
  const suspend = useSuspendCustomer()
  const reactivate = useReactivateCustomer()
  const [armed, setArmed] = useState(false)

  const busy = suspend.isPending || reactivate.isPending
  const failure = suspend.error ?? reactivate.error
  const err = failure instanceof ApiError ? failure.message : null

  if (customer.status === 'suspended') {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          variant="ink"
          disabled={busy}
          onClick={() => reactivate.mutate(customer._id)}
        >
          {reactivate.isPending ? 'Reactivating…' : 'Reactivate'}
        </Button>
        {err ? <span className="text-eyebrow text-failed-ink">{err}</span> : null}
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {armed ? (
        <span className="inline-flex items-center gap-2">
          <Button
            size="sm"
            variant="ink"
            disabled={busy}
            onClick={() =>
              suspend.mutate(customer._id, { onSuccess: () => setArmed(false) })
            }
          >
            {suspend.isPending ? 'Suspending…' : 'Confirm'}
          </Button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            className="text-meta text-muted hover:text-ink"
          >
            Keep
          </button>
        </span>
      ) : (
        <Button
          size="sm"
          onClick={() => setArmed(true)}
          aria-label={`Suspend ${customer.name}`}
        >
          Suspend
        </Button>
      )}
      {err ? <span className="text-eyebrow text-failed-ink">{err}</span> : null}
    </div>
  )
}

const PER_PAGE = 10

export const AdminCustomersPage = () => {
  const roster = useCustomerRoster()
  const [status, setStatus] = useState<UserStatus | ''>('')
  const [page, setPage] = useState(1)

  const rows = useMemo(
    () => (roster.data ?? []).filter((c) => status === '' || c.status === status),
    [roster.data, status],
  )

  const suspendedCount = (roster.data ?? []).filter(
    (c) => c.status === 'suspended',
  ).length

  if (roster.isPending) {
    return (
      <AppShell title="Customers">
        <PageHead title="Customers" />
        <Card>
          <p className="text-body text-muted">Loading customers…</p>
        </Card>
      </AppShell>
    )
  }

  if (roster.isError) {
    return (
      <AppShell title="Customers">
        <PageHead title="Customers" />
        <Card>
          <p
            role="alert"
            className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
          >
            {roster.error instanceof ApiError
              ? roster.error.message
              : 'Customers could not be loaded.'}
          </p>
        </Card>
      </AppShell>
    )
  }

  const view = paginate(rows, page, PER_PAGE)

  return (
    <AppShell title="Customers">
      <PageHead
        title="Customers"
        sub="Everyone who can book a parcel, and whether their account is still allowed to."
        action={
          suspendedCount > 0 ? (
            <Pill tone="failed">{suspendedCount} suspended</Pill>
          ) : undefined
        }
      />

      <Card pad={false}>
        <FilterBar>
          <SelectFilter
            label="All accounts"
            value={status}
            onChange={(next) => {
              setStatus(next)
              setPage(1)
            }}
            options={userStatusSchema.options.map((s) => ({
              value: s,
              label: STATUS_LABEL[s],
            }))}
          />
        </FilterBar>

        {(roster.data ?? []).length === 0 ? (
          <div className="px-18px py-8 text-center">
            <p className="text-body text-muted">
              No customer accounts yet. One appears here as soon as somebody
              signs up.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-18px py-8 text-center">
            <p className="text-body text-muted">
              No account matches that filter.{' '}
              <button
                type="button"
                onClick={() => setStatus('')}
                className="text-accent font-medium hover:text-accent-hover"
              >
                Clear it
              </button>
              .
            </p>
          </div>
        ) : (
          <TableScroll min={780}>
            <Thead cols={['Customer', 'Parcels', 'Joined', 'Account', '']} />
            <tbody>
              {view.slice.map((c) => (
                <Tr key={c._id}>
                  <Td>
                    <Who name={c.name} sub={c.email} />
                  </Td>
                  <Td>
                    <span className="mono text-small">{c.parcelCount}</span>
                  </Td>
                  <Td>
                    <span className="mono text-meta text-muted">
                      {formatDateTime(c.joinedAt)}
                    </span>
                  </Td>
                  <Td>
                    {c.status === 'suspended' ? (
                      <Pill tone="failed">Suspended</Pill>
                    ) : (
                      <span className="text-ink-2">Active</span>
                    )}
                    {/*
                      The trail, one line of it. The full history is on the
                      record; what an admin scanning this column wants is
                      "when did somebody last touch this account".
                    */}
                    {c.lastDecision ? (
                      <span className="block text-eyebrow text-faint mono">
                        {formatDateTime(c.lastDecision.at)}
                      </span>
                    ) : null}
                  </Td>
                  <Td align="right">
                    <StatusAction customer={c} />
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
    </AppShell>
  )
}
