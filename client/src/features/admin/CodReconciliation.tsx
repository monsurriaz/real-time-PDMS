import { useState } from 'react'
import type { CodReconciliationRow } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Card, Eyebrow, Note } from '@/components/Card'
import { TableScroll, Td, Thead, Tr, Who } from '@/components/Table'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatTaka } from '@/lib/format'
import {
  useCodReconciliation,
  useSettleAgent,
  useSettlements,
} from '../payments/usePayments'

/**
 * Per-agent COD reconciliation.
 *
 * Every figure is derived from Payment documents on each read — there is no
 * stored running total anywhere in this feature. Settling writes a Settlement
 * record naming the exact payments it closed and flips those payments; it never
 * decrements a number. So a disagreement between this table and reality is a
 * bug you can find, rather than a total somebody has to trust.
 *
 * Money is mono with tabular figures throughout (CLAUDE.md section 4). This is
 * the screen the design system singles out: "misaligned money in the
 * reconciliation table is the fastest way to look untrustworthy."
 */

/** Right-aligned money cell — the `.amt` column from the reference. */
const Amount = ({
  value,
  strong,
  faint,
}: {
  value: number
  strong?: boolean
  faint?: boolean
}) => (
  <span
    className={[
      'mono text-sm tabular-nums',
      strong ? 'font-medium' : '',
      faint && value === 0 ? 'text-faint' : '',
    ].join(' ')}
  >
    {value === 0 && faint ? '—' : formatTaka(value)}
  </span>
)

const SettleRow = ({ row }: { row: CodReconciliationRow }) => {
  const settle = useSettleAgent()
  const [armed, setArmed] = useState(false)

  if (row.outstanding === 0) {
    return <span className="text-tiny text-faint">nothing to settle</span>
  }

  if (settle.isError) {
    return (
      <span role="alert" className="text-tiny text-failed-ink">
        {settle.error instanceof ApiError ? settle.error.message : 'Could not settle'}
      </span>
    )
  }

  /**
   * Two taps. Taking cash off a rider's ledger is not reversible from this
   * screen — the audit trail would need a counter-entry — so the confirm step
   * states the amount rather than just asking "sure?".
   */
  return armed ? (
    <span className="flex items-center gap-2">
      <Button
        variant="ink"
        disabled={settle.isPending}
        onClick={() => settle.mutate({ agentId: row.agentId }, { onSuccess: () => setArmed(false) })}
      >
        {settle.isPending ? 'Settling…' : `Confirm ${formatTaka(row.outstanding)}`}
      </Button>
      <button
        type="button"
        onClick={() => setArmed(false)}
        className="text-meta text-muted hover:text-ink"
      >
        Cancel
      </button>
    </span>
  ) : (
    <Button onClick={() => setArmed(true)} aria-label={`Settle cash held by ${row.agentName}`}>
      Mark settled
    </Button>
  )
}

export const CodReconciliation = () => {
  const data = useCodReconciliation()
  const trail = useSettlements()

  if (data.isPending) {
    return (
      <Card>
        <p className="text-body text-muted">Counting the cash…</p>
      </Card>
    )
  }

  if (data.isError) {
    return (
      <Card>
        <p
          role="alert"
          className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
        >
          {data.error instanceof ApiError
            ? data.error.message
            : 'The reconciliation table could not be loaded.'}
        </p>
      </Card>
    )
  }

  const { rows, totals } = data.data

  return (
    <div className="grid gap-5">
      {/* The statstrip cell from the reference, as three key figures. */}
      <Card>
        <div className="grid sm:grid-cols-3 gap-5 sm:gap-0">
          {[
            { k: 'COD outstanding', v: totals.outstanding, hint: 'held by riders' },
            { k: 'Settled', v: totals.settled, hint: 'handed in' },
            { k: 'Uncollectable', v: totals.uncollectable, hint: 'failed or cancelled' },
          ].map((cell, i) => (
            <div
              key={cell.k}
              className={i < 2 ? 'sm:border-r sm:border-border sm:pr-5' : 'sm:pl-5'}
            >
              <Eyebrow>{cell.k}</Eyebrow>
              <div className="mono text-figure-lg font-medium tracking-[-0.04em]">
                {formatTaka(cell.v)}
              </div>
              <div className="text-tiny text-faint mt-0.5">{cell.hint}</div>
            </div>
          ))}
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card title="Per rider">
          <p className="text-body text-muted">
            No COD has been collected yet. Deliver a cash-on-delivery parcel and
            the rider appears here.
          </p>
        </Card>
      ) : (
        <Card title={`Per rider · ${rows.length}`} pad={false}>
          <TableScroll min={860}>
            <Thead
              cols={[
                'Rider',
                'COD delivered',
                'Outstanding',
                'Settled',
                'Uncollectable',
                'Last settled',
                '',
              ]}
            />
            <tbody>
              {rows.map((r) => (
                <Tr key={r.agentId}>
                  <Td>
                    <Who name={r.agentName} sub={`${r.deliveredCount} COD delivered`} />
                  </Td>
                  <Td>
                    <span className="mono text-small">{r.deliveredCount}</span>
                    <span className="text-tiny text-faint">
                      {r.deliveredCount === 1 ? ' parcel' : ' parcels'}
                    </span>
                  </Td>
                  <Td>
                    <Amount value={r.outstanding} strong />
                    {r.outstandingCount > 0 ? (
                      <span className="block text-eyebrow text-faint mono">
                        {r.outstandingCount} unsettled
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <Amount value={r.settled} faint />
                  </Td>
                  <Td>
                    {/*
                      Reported, not hidden. A failed delivery's COD is not
                      collectable — showing it is how the row explains why a
                      rider who "delivered" five parcels holds four parcels'
                      worth of cash.
                    */}
                    <Amount value={r.uncollectable} faint />
                    {r.uncollectableCount > 0 ? (
                      <span className="block text-eyebrow text-failed-ink">
                        {r.uncollectableCount} failed
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    <span className="mono text-meta text-muted">
                      {r.lastSettledAt ? formatDateTime(r.lastSettledAt) : '—'}
                    </span>
                  </Td>
                  <Td align="right">
                    <SettleRow row={r} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </TableScroll>
        </Card>
      )}

      {/* ---- the audit trail ---- */}
      <Card title="Settlement history" pad={false}>
        {trail.isPending ? (
          <p className="text-sm text-muted">Loading the trail…</p>
        ) : trail.isError ? (
          <p role="alert" className="text-small text-failed-ink">
            {trail.error instanceof ApiError
              ? trail.error.message
              : 'The settlement trail could not be loaded.'}
          </p>
        ) : trail.data.length === 0 ? (
          <p className="text-body text-muted">
            Nothing settled yet. Each hand-in is recorded here with what it
            covered — totals are never edited in place.
          </p>
        ) : (
          <TableScroll min={640}>
            <Thead cols={['When', 'Rider', 'Amount', 'Parcels', 'Taken by']} />
            <tbody>
              {trail.data.map((st) => (
                <Tr key={st._id}>
                  <Td>
                    <span className="mono text-meta text-muted">{formatDateTime(st.at)}</span>
                  </Td>
                  <Td>{st.agentName}</Td>
                  <Td>
                    <Amount value={st.amount} strong />
                  </Td>
                  <Td>
                    <span className="mono text-small">{st.paymentCount}</span>
                  </Td>
                  <Td className="text-ink-2">{st.settledByName}</Td>
                </Tr>
              ))}
            </tbody>
          </TableScroll>
        )}
      </Card>

      <Note>
        Every figure here is <b>counted from payment records</b> on each load.
        Marking a rider settled writes an audit record naming the exact parcels
        it covered — no running total is edited.
      </Note>
    </div>
  )
}
