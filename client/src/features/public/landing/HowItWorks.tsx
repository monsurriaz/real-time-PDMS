import { Badge } from '@/components/Badge'
import { LifecycleRail } from '@/components/LifecycleRail'
import { Avatar } from '@/components/Table'
import { formatTaka } from '@/lib/format'

/** v4 section 3 — three steps, each with a small worked visual beneath it. */
const STEPS = [
  {
    n: '01',
    title: 'Book a pickup',
    body: 'Enter both addresses and the weight. We measure the real road distance and price it before you commit — that price is locked at booking.',
  },
  {
    n: '02',
    title: 'Nearest rider accepts',
    body: "We offer it to the closest available rider covering your pickup zone. If they don't accept, it goes to the next one — no dispatcher phoning around.",
  },
  {
    n: '03',
    title: 'Watch it move',
    body: "The rider's position streams to your map every few seconds. Proof of delivery — photo, code, or signature — is recorded the moment it's handed over.",
  },
] as const

/** Step 1's visual: the exact worked example CLAUDE.md section 5 documents. */
const PriceWorked = () => (
  <div className="mt-18px bg-page border border-border rounded-md p-13px">
    <div className="flex justify-between text-meta text-muted py-3px">
      <span>Distance · 3.0 km</span>
      <span className="mono">{formatTaka(36)}</span>
    </div>
    <div className="flex justify-between text-meta text-muted py-3px">
      <span>1–3 kg</span>
      <span className="mono">{formatTaka(90)}</span>
    </div>
    <div className="flex justify-between text-sm font-semibold border-t border-border mt-6px pt-7px">
      <span>Total</span>
      <span className="mono">{formatTaka(126)}</span>
    </div>
  </div>
)

/** Step 2's visual: the same offer shape ForRiders shows, at rest (no live countdown here). */
const OfferWorked = () => (
  <div className="mt-18px bg-page border border-border rounded-md p-13px flex items-center gap-9px">
    <Avatar size="sm" />
    <div className="flex-1 min-w-0">
      <div className="text-small font-semibold truncate">Rakib Hasan</div>
      <div className="text-tiny text-faint">1.4 km · motorcycle</div>
    </div>
    <Badge status="Assigned" />
  </div>
)

/** Step 3's visual: the real LifecycleRail, mid-transit — the same component the app uses everywhere. */
const RailWorked = () => (
  <div className="mt-18px bg-page border border-border rounded-md p-13px">
    <LifecycleRail status="InTransit" labels />
  </div>
)

const VISUALS = [<PriceWorked key="p" />, <OfferWorked key="o" />, <RailWorked key="r" />]

export const HowItWorks = () => (
  <section id="how" className="bg-page py-22 scroll-mt-20">
    <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
      <div className="max-w-[600px] mb-11">
        <div className="text-eyebrow font-semibold uppercase tracking-[0.11em] text-accent mb-3">
          How it works
        </div>
        <h2 className="text-h2 sm:text-hero font-bold tracking-[-0.04em] leading-[1.1]">
          Three steps, and you never phone anyone.
        </h2>
        <p className="text-md text-muted mt-13px leading-relaxed">
          The whole point is that nobody has to chase an update — the parcel
          reports its own position.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {STEPS.map((s, i) => (
          <div key={s.n} className="bg-surface border border-border rounded-lg p-26px">
            <div className="w-8 h-8 rounded-sm bg-ink text-white grid place-items-center mono text-sm mb-18px">
              {s.n}
            </div>
            <h3 className="text-lg font-semibold tracking-[-0.025em] mb-7px">{s.title}</h3>
            <p className="text-body text-muted leading-relaxed">{s.body}</p>
            {VISUALS[i]}
          </div>
        ))}
      </div>
    </div>
  </section>
)
