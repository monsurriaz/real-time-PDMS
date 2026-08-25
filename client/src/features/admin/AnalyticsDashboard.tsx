import { Link } from 'react-router-dom'
import type { DelayedParcel } from '@pdms/shared'
import { Badge, Pill } from '@/components/Badge'
import { Button } from '@/components/Button'
import { Card, Eyebrow, Note } from '@/components/Card'
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
  <div className="flex items-start justify-between gap-4 py-3 border-b border-border last:border-b-0">
    <div className="min-w-0">
      <Link
        to={`/track/${p.parcelId}`}
        className="mono text-small font-medium underline decoration-border-strong hover:decoration-ink"
      >
        {p.trackingId}
      </Link>
      <div className="text-meta text-muted mt-0.5">
        {p.dropZone} · {p.agentName ?? 'unassigned'}
        {p.isCod ? ` · COD ${formatTaka(p.codAmount)}` : ''}
      </div>
    </div>
    <div className="text-right flex-none">
      <Badge status={p.status} />
      <div className="mono text-tiny text-failed-ink mt-1">
        {lateness(p.minutesLate)}
      </div>
      <div className="mono text-eyebrow text-faint">
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
        <Card>
          <p className="text-body text-muted">Counting deliveries…</p>
        </Card>
        <Card>
          <p className="text-body text-muted">Measuring the zones…</p>
        </Card>
      </div>
    )
  }

  if (analytics.isError) {
    return (
      <Card title="Analytics">
        <p
          role="alert"
          className="text-sm text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2"
        >
          {analytics.error instanceof ApiError
            ? analytics.error.message
            : 'The dashboard could not be loaded.'}
        </p>
        <p className="text-small text-muted mt-3">
          The board and the map are unaffected — this screen only reads figures.
        </p>
      </Card>
    )
  }

  const d = analytics.data
  const deltaLabel = `vs the previous ${d.comparisonWindowHours} h`
  const nothingYet = d.totalDeliveries.value === 0

  return (
    <div className="grid gap-5">
      {/* ---- the stat strip: one card per figure, per v3's .g4 ---- */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <StatCard
            label="Total deliveries"
            value={d.totalDeliveries.value}
            icon={StatIcons.parcel}
            stat={d.totalDeliveries}
            deltaLabel={deltaLabel}
          />
        </Card>
        <Card>
          {/* The accent chip: parcels in flight is what this screen is about. */}
          <StatCard
            accent
            label="Active now"
            value={d.activeDeliveries.value}
            icon={StatIcons.clock}
            stat={d.activeDeliveries}
            deltaLabel={deltaLabel}
          />
        </Card>
        <Card>
          <StatCard
            label="Riders on shift"
            value={d.activeAgents.value}
            icon={StatIcons.rider}
            stat={d.activeAgents}
          />
        </Card>
        <Card>
          <StatCard
            label={`Revenue · ${d.comparisonWindowHours} h`}
            value={formatTaka(d.revenue.value)}
            icon={StatIcons.taka}
            stat={d.revenue}
            deltaLabel={deltaLabel}
          />
        </Card>
      </div>

      {nothingYet ? (
        <Card title="Nothing to measure yet">
          <p className="text-body text-muted mb-2">
            No parcels have been booked, so there is nothing to chart. Run{' '}
            <span className="mono text-small">npm run seed</span> for the demo
            data, or book a parcel as a customer.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_290px] items-start">
          <Card
            title="Zone performance"
            action={
              <span className="text-tiny text-faint">Delivered · still moving</span>
            }
          >
            <ZonePerformanceChart zones={d.zones} />
          </Card>

          <div className="grid gap-4">
            {/* ---- delayed alerts ---- */}
            <Card
              title="Delayed"
              action={
                d.delayed.count > 0 ? (
                  <Pill tone="failed">{d.delayed.count}</Pill>
                ) : (
                  <span className="text-tiny text-faint">none</span>
                )
              }
            >
              {d.delayed.count === 0 ? (
                <p className="text-body text-muted">
                  Nothing is past its promised time. Parcels appear here once
                  they are overdue and still moving.
                </p>
              ) : (
                <>
                  {d.delayed.parcels.map((p) => (
                    <DelayedRow key={p.deliveryId} p={p} />
                  ))}
                  {d.delayed.count > d.delayed.parcels.length ? (
                    <p className="text-tiny text-faint mt-3">
                      Showing the {d.delayed.parcels.length} latest of{' '}
                      {d.delayed.count}.
                    </p>
                  ) : null}
                </>
              )}
            </Card>

            <Card title="Cash on delivery">
              <Eyebrow>Held by riders</Eyebrow>
              <div className="mono text-figure-lg font-medium tracking-[-0.04em] mt-1">
                {formatTaka(d.codOutstanding)}
              </div>
              <Link to="/admin/cod" className="inline-flex mt-11px">
                <Button size="sm">Reconcile</Button>
              </Link>
            </Card>
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
