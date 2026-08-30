import type { ReactNode } from 'react'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import { Badge } from '@/components/Badge'
import { SHOWCASE_DROP, SHOWCASE_PICKUP, SHOWCASE_RIDER, SHOWCASE_ROUTE } from './demoShowcase'

/**
 * v4 section 4 — an asymmetric 6-column bento, not a uniform row of equal
 * cards. One wide dark cell (span 4) carries its own small map; the rest
 * pair up as two narrow (span 2) and two half (span 3) cells. Collapses to
 * 2 columns below 980px and 1 below 600px — the asymmetry itself stays until
 * there is no longer room for it, rather than normalising into equal cards
 * at the first breakpoint.
 *
 * The wide cell's map reuses the exact same fabricated delivery
 * (demoShowcase.ts) as the hero's floating card — the same MapLibre chunk
 * LazyTrackingMap already lazy-loads, mounted a second time, not a second
 * chunk (see the M9.5 bundle-size note in DEFERRED.md).
 */

const ICON_CLASS = 'w-4.5 h-4.5'

const Icon = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" className={ICON_CLASS} fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
)

const CellIcon = ({ accent, children }: { accent?: boolean; children: ReactNode }) => (
  <div className={`w-[38px] h-[38px] rounded-chip grid place-items-center mb-4 flex-none ${accent ? 'bg-accent' : 'bg-ink'}`}>
    <Icon>{children}</Icon>
  </div>
)

const SPAN = {
  wide: 'col-span-4 max-[980px]:col-span-2 max-[600px]:col-span-1',
  half: 'col-span-3 max-[980px]:col-span-2 max-[600px]:col-span-1',
  third: 'col-span-2 max-[600px]:col-span-1',
} as const

export const BentoGrid = () => (
  <section className="bg-surface py-22">
    <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
      <div className="max-w-[600px] mb-11">
        <div className="text-eyebrow font-semibold uppercase tracking-[0.11em] text-accent mb-3">
          What&rsquo;s inside
        </div>
        <h2 className="text-h2 sm:text-hero font-bold tracking-[-0.04em] leading-[1.1]">
          Built like an operations tool, not a form.
        </h2>
        <p className="text-md text-muted mt-13px leading-relaxed">
          Everything below is running in the product today — no waitlists, no
          &ldquo;coming soon&rdquo; tiles.
        </p>
      </div>

      <div className="grid grid-cols-6 max-[980px]:grid-cols-2 max-[600px]:grid-cols-1 gap-18px">
        {/* wide, dark, its own small map */}
        <div className={`${SPAN.wide} bg-chrome border border-chrome-3 rounded-lg overflow-hidden flex flex-col`}>
          <div className="p-6 pb-0">
            <CellIcon accent>
              <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
              <circle cx="12" cy="10" r="2.5" />
            </CellIcon>
            <h3 className="text-lg font-semibold tracking-[-0.025em] text-chrome-ink mb-6px">
              Real-time tracking that admits when it&rsquo;s stale
            </h3>
            <p className="text-body text-chrome-muted leading-relaxed">
              Positions arrive over a socket every few seconds. If the
              connection drops, the interface says &ldquo;reconnecting&rdquo;
              instead of leaving a dot sitting on a road it left ten minutes
              ago.
            </p>
          </div>
          <div className="mt-5 mx-6 rounded-t-lg overflow-hidden h-33 bg-map-ground">
            <LazyTrackingMap
              className="h-full"
              riders={SHOWCASE_RIDER}
              route={SHOWCASE_ROUTE}
              pickup={SHOWCASE_PICKUP}
              drop={SHOWCASE_DROP}
              animate={false}
              follow={false}
            />
          </div>
        </div>

        {/* proof at the door */}
        <div className={`${SPAN.third} bg-surface border border-border rounded-lg p-6 flex flex-col`}>
          <CellIcon>
            <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
            <circle cx="12" cy="13" r="3.4" />
          </CellIcon>
          <h3 className="text-lg font-semibold tracking-[-0.025em] mb-6px">Proof at the door</h3>
          <p className="text-body text-muted leading-relaxed">
            A photo, a one-time code, or a signature — recorded against the
            delivery, not taken on trust.
          </p>
          <div className="flex gap-7px mt-auto pt-18px flex-wrap">
            <Badge status="Delivered" />
            <span className="text-meta font-medium bg-surface-sunk text-muted rounded-pill px-11px py-1">
              OTP
            </span>
            <span className="text-meta font-medium bg-surface-sunk text-muted rounded-pill px-11px py-1">
              Signature
            </span>
          </div>
        </div>

        {/* cash on delivery, reconciled */}
        <div className={`${SPAN.third} bg-surface border border-border rounded-lg p-6 flex flex-col`}>
          <CellIcon>
            <path d="M12 3v18" />
            <path d="M17 7H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </CellIcon>
          <h3 className="text-lg font-semibold tracking-[-0.025em] mb-6px">
            Cash on delivery, reconciled
          </h3>
          <p className="text-body text-muted leading-relaxed">
            Every taka a rider is holding is tied to a real Payment record.
            Handing it in writes a Settlement naming exactly which ones it
            closed — an audit trail, not an edited total.
          </p>
        </div>

        {/* riders vetted, matched by distance */}
        <div className={`${SPAN.half} bg-surface border border-border rounded-lg p-6`}>
          <CellIcon>
            <circle cx="9" cy="8" r="3.2" />
            <path d="M3 20a6 6 0 0 1 12 0" />
            <path d="M17 9h4M19 7v4" />
          </CellIcon>
          <h3 className="text-lg font-semibold tracking-[-0.025em] mb-6px">
            Riders are vetted, then matched by distance
          </h3>
          <p className="text-body text-muted leading-relaxed">
            Applications are reviewed before anyone carries a parcel. After
            that, assignment is a geospatial query against who&rsquo;s
            actually on shift and nearby — with workload as the tie-breaker.
          </p>
        </div>

        {/* numbers you can defend */}
        <div className={`${SPAN.half} bg-surface border border-border rounded-lg p-6`}>
          <CellIcon>
            <path d="M3 3v18h18" />
            <path d="m7 14 4-4 3 3 5-6" />
          </CellIcon>
          <h3 className="text-lg font-semibold tracking-[-0.025em] mb-6px">Numbers you can defend</h3>
          <p className="text-body text-muted leading-relaxed">
            Zone performance, delayed-parcel alerts and revenue are counted at
            read time from deliveries and payments. Nothing on the dashboard
            is a stored total that drifted.
          </p>
        </div>
      </div>
    </div>
  </section>
)
