import { useState } from 'react'
import type { CodReconciliationRow } from '@pdms/shared'
import { Button } from '@/components/Button'
import { Eyebrow, Note, Panel } from '@/components/Panel'
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

const TH =
  'text-left text-[11px] font-semibold uppercase tracking-[0.13em] text-faint pb-3 border-b border-hairline'

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
      'mono text-[13px] tabular-nums',
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
    return <span className="text-[11.5px] text-faint">nothing to settle</span>
  }

  if (settle.isError) {
    return (
      <span role="alert" className="text-[11.5px] text-failed-ink">
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
        className="text-[12px] text-muted hover:text-ink"
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
      <Panel>
        <p className="text-[13.5px] text-muted">Counting the cash…</p>
      </Panel>
    )
  }

  if (data.isError) {
    return (
      <Panel>
        <p
          role="alert"
          className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
        >
          {data.error instanceof ApiError
            ? data.error.message
            : 'The reconciliation table could not be loaded.'}
        </p>
      </Panel>
    )
  }

  const { rows, totals } = data.data

  return (
    <div className="grid gap-5">
      {/* The statstrip cell from the reference, as three key figures. */}
      <Panel>
        <div className="grid sm:grid-cols-3 gap-5 sm:gap-0">
          {[
            { k: 'COD outstanding', v: totals.outstanding, hint: 'held by riders' },
            { k: 'Settled', v: totals.settled, hint: 'handed in' },
            { k: 'Uncollectable', v: totals.uncollectable, hint: 'failed or cancelled' },
          ].map((cell, i) => (
            <div
              key={cell.k}
              className={i < 2 ? 'sm:border-r sm:border-hairline sm:pr-5' : 'sm:pl-5'}
            >
              <Eyebrow>{cell.k}</Eyebrow>
              <div className="mono text-[20px] font-medium tracking-[-0.025em]">
                {formatTaka(cell.v)}
              </div>
              <div className="text-[11.5px] text-faint mt-0.5">{cell.hint}</div>
            </div>
          ))}
        </div>
      </Panel>

      {rows.length === 0 ? (
        <Panel title="Per rider">
          <p className="text-[13.5px] text-muted">
            No COD has been collected yet. Deliver a cash-on-delivery parcel and
            the rider appears here.
          </p>
        </Panel>
      ) : (
        <Panel title={`Per rider · ${rows.length}`}>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[720px]">
              <thead>
                <tr>
                  <th className={TH}>Rider</th>
                  <th className={TH}>COD delivered</th>
                  <th className={TH}>Outstanding</th>
                  <th className={TH}>Settled</th>
                  <th className={TH}>Uncollectable</th>
                  <th className={TH}>Last settled</th>
                  <th className={TH} />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.agentId} className="border-b border-hairline last:border-b-0">
                    <td className="py-3 pr-4 text-[13px] font-medium">{r.agentName}</td>
                    <td className="py-3 pr-4">
                      <span className="mono text-[13px]">{r.deliveredCount}</span>
                      <span className="text-[11.5px] text-faint">
                        {r.deliveredCount === 1 ? ' parcel' : ' parcels'}
                      </span>
                    </td>
                    <td className="py-3 pr-4">
                      <Amount value={r.outstanding} strong />
                      {r.outstandingCount > 0 ? (
                        <span className="block text-[11px] text-faint mono">
                          {r.outstandingCount} unsettled
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <Amount value={r.settled} faint />
                    </td>
                    <td className="py-3 pr-4">
                      {/*
                        Reported, not hidden. A failed delivery's COD is not
                        collectable — showing it is how the row explains why a
                        rider who "delivered" five parcels holds four parcels'
                        worth of cash.
                      */}
                      <Amount value={r.uncollectable} faint />
                      {r.uncollectableCount > 0 ? (
                        <span className="block text-[11px] text-failed-ink">
                          {r.uncollectableCount} failed
                        </span>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <span className="mono text-[12px] text-muted">
                        {r.lastSettledAt ? formatDateTime(r.lastSettledAt) : '—'}
                      </span>
                    </td>
                    <td className="py-3">
                      <SettleRow row={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* ---- the audit trail ---- */}
      <Panel title="Settlement history">
        {trail.isPending ? (
          <p className="text-[13px] text-muted">Loading the trail…</p>
        ) : trail.isError ? (
          <p role="alert" className="text-[12.5px] text-failed-ink">
            {trail.error instanceof ApiError
              ? trail.error.message
              : 'The settlement trail could not be loaded.'}
          </p>
        ) : trail.data.length === 0 ? (
          <p className="text-[13.5px] text-muted">
            Nothing settled yet. Each hand-in is recorded here with what it
            covered — totals are never edited in place.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse min-w-[620px]">
              <thead>
                <tr>
                  <th className={TH}>When</th>
                  <th className={TH}>Rider</th>
                  <th className={TH}>Amount</th>
                  <th className={TH}>Parcels</th>
                  <th className={TH}>Taken by</th>
                </tr>
              </thead>
              <tbody>
                {trail.data.map((s) => (
                  <tr key={s._id} className="border-b border-hairline last:border-b-0">
                    <td className="py-3 pr-4">
                      <span className="mono text-[12px] text-muted">{formatDateTime(s.at)}</span>
                    </td>
                    <td className="py-3 pr-4 text-[13px]">{s.agentName}</td>
                    <td className="py-3 pr-4">
                      <Amount value={s.amount} strong />
                    </td>
                    <td className="py-3 pr-4">
                      <span className="mono text-[13px]">{s.paymentCount}</span>
                    </td>
                    <td className="py-3 pr-4 text-[13px] text-ink-2">{s.settledByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Note>
        Every figure here is <b>counted from payment records</b> on each load.
        Marking a rider settled writes an audit record naming the exact parcels
        it covered — no running total is edited.
      </Note>
    </div>
  )
}
