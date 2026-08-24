import { Link } from 'react-router-dom'
import type { DelayedParcel } from '@pdms/shared'
import { Badge } from '@/components/Badge'
import { Eyebrow, Note, Panel } from '@/components/Panel'
import { StatCard, StatIcons } from '@/components/StatCard'
import { ApiError } from '@/lib/api'
import { formatDateTime, formatTaka } from '@/lib/format'
import { useAnalytics } from '../analytics/useAnalytics'
import { ZonePerformanceChart } from './ZonePerformanceChart'

/**
 * The admin analytics screen (CLAUDE.md M6): stat cards, one chart, zone-wise
 * performance and the delayed-parcel alert.
 *
 * Every component here already existed — Panel, Badge, Eyebrow, Note, and the
 * StatCard the design system has always specified. The only new thing is the
 * chart, and that is the reference's own `.ramp-bar` treatment.
 */

/** "2 h 15 m late" — hours only once it stops being minutes. */
const lateness = (minutes: number): string => {
  if (minutes < 60) return `${minutes} min late`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h late` : `${hours} h ${rest} m late`
}

const DelayedRow = ({ p }: { p: DelayedParcel }) => (
  <div className="flex items-start justify-between gap-4 py-3 border-b border-hairline last:border-b-0">
    <div className="min-w-0">
      <Link
        to={`/track/${p.parcelId}`}
        className="mono text-[12.5px] font-medium underline decoration-hairline-strong hover:decoration-ink"
      >
        {p.trackingId}
      </Link>
      <div className="text-[12px] text-muted mt-0.5">
        {p.dropZone} · {p.agentName ?? 'unassigned'}
        {p.isCod ? ` · COD ${formatTaka(p.codAmount)}` : ''}
      </div>
    </div>
    <div className="text-right flex-none">
      <Badge status={p.status} />
      <div className="mono text-[11.5px] text-failed-ink mt-1">
        {lateness(p.minutesLate)}
      </div>
      <div className="mono text-[11px] text-faint">
        due {formatDateTime(p.expectedBy)}
      </div>
    </div>
  </div>
)

export const AnalyticsDashboard = () => {
  const analytics = useAnalytics()

  if (analytics.isPending) {
    return (
      <div className="grid gap-5">
        <Panel>
          <p className="text-[13.5px] text-muted">Counting deliveries…</p>
        </Panel>
        <Panel>
          <p className="text-[13.5px] text-muted">Measuring the zones…</p>
        </Panel>
      </div>
    )
  }

  if (analytics.isError) {
    return (
      <Panel title="Analytics">
        <p
          role="alert"
          className="text-[13px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
        >
          {analytics.error instanceof ApiError
            ? analytics.error.message
            : 'The dashboard could not be loaded.'}
        </p>
        <p className="text-[12.5px] text-muted mt-3">
          The board and the map are unaffected — this screen only reads figures.
        </p>
      </Panel>
    )
  }

  const d = analytics.data
  const deltaLabel = `vs the previous ${d.comparisonWindowHours} h`
  const nothingYet = d.totalDeliveries.value === 0

  return (
    <div className="grid gap-5">
      {/* ---- the stat strip ---- */}
      <Panel>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Total deliveries"
            value={d.totalDeliveries.value}
            icon={StatIcons.parcel}
            stat={d.totalDeliveries}
            deltaLabel={deltaLabel}
          />
          <StatCard
            label="Active right now"
            value={d.activeDeliveries.value}
            icon={StatIcons.clock}
            stat={d.activeDeliveries}
            deltaLabel={deltaLabel}
          />
          <StatCard
            label="Riders on shift"
            value={d.activeAgents.value}
            icon={StatIcons.rider}
            stat={d.activeAgents}
          />
          <StatCard
            label={`Revenue · last ${d.comparisonWindowHours} h`}
            value={formatTaka(d.revenue.value)}
            icon={StatIcons.taka}
            stat={d.revenue}
            deltaLabel={deltaLabel}
          />
        </div>
      </Panel>

      {nothingYet ? (
        <Panel title="Nothing to measure yet">
          <p className="text-[13.5px] text-muted mb-2">
            No parcels have been booked, so there is nothing to chart. Run{' '}
            <span className="mono text-[12.5px]">npm run seed</span> for the demo
            data, or book a parcel as a customer.
          </p>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_360px] items-start">
          <Panel title="Zone performance">
            <ZonePerformanceChart zones={d.zones} />
          </Panel>

          <div className="grid gap-5">
            {/* ---- delayed alerts ---- */}
            <Panel
              title={
                d.delayed.count === 0
                  ? 'Delayed parcels'
                  : `Delayed · ${d.delayed.count}`
              }
            >
              {d.delayed.count === 0 ? (
                <p className="text-[13.5px] text-muted">
                  Nothing is past its promised time. Parcels appear here once
                  they are overdue and still moving.
                </p>
              ) : (
                <>
                  {d.delayed.parcels.map((p) => (
                    <DelayedRow key={p.deliveryId} p={p} />
                  ))}
                  {d.delayed.count > d.delayed.parcels.length ? (
                    <p className="text-[11.5px] text-faint mt-3">
                      Showing the {d.delayed.parcels.length} latest of{' '}
                      {d.delayed.count}.
                    </p>
                  ) : null}
                </>
              )}
            </Panel>

            <Panel title="Cash on delivery">
              <Eyebrow>Held by riders</Eyebrow>
              <div className="mono text-[22px] font-medium tracking-[-0.03em]">
                {formatTaka(d.codOutstanding)}
              </div>
              <Link
                to="/admin/cod"
                className="inline-block text-[12.5px] font-medium text-ink underline decoration-hairline-strong hover:decoration-ink mt-3"
              >
                Reconcile
              </Link>
            </Panel>
          </div>
        </div>
      )}

      <Note>
        Every figure is <b>counted at read time</b> from deliveries, parcels and
        payments — nothing here is a stored total. Refreshed each minute.
        Measured {formatDateTime(d.generatedAt)}.
      </Note>
    </div>
  )
}
