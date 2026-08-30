import { tierFloor } from '@pdms/shared'
import { formatTaka } from '@/lib/format'
import { usePublicPricingTiers } from '../usePublicStats'

/**
 * v4 section 5 — the tier ladder, read live from `GET /pricing/tiers` rather
 * than hard-coded (CLAUDE.md section 5: an admin edits these from the
 * dashboard, and a visitor must never be quoted stale copy). Renders
 * whatever tiers PricingConfig actually holds, in order — including a
 * formula tier like the seeded 5-20kg one, which has no single price to
 * print and needs its own "+ ৳X per kg over Y" line instead of the flat
 * tiers' "+ ৳X per km".
 */
export const PricingSection = () => {
  const tiers = usePublicPricingTiers()

  return (
    <section id="pricing" className="bg-page py-22 scroll-mt-20">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
        <div className="max-w-[600px] mb-11">
          <div className="text-eyebrow font-semibold uppercase tracking-[0.11em] text-accent mb-3">
            Pricing
          </div>
          <h2 className="text-h2 sm:text-hero font-bold tracking-[-0.04em] leading-[1.1]">
            Distance, weight, zone. Nothing else.
          </h2>
          <p className="text-md text-muted mt-13px leading-relaxed">
            Rates are set by the operator and locked onto your parcel the
            moment you book — a later price change never reaches back.
          </p>
        </div>

        {tiers.isPending ? (
          <p className="text-body text-muted">Loading rates…</p>
        ) : tiers.isError ? (
          <p role="alert" className="text-body text-failed-ink">
            Rates could not be loaded.
          </p>
        ) : (
          <div className="grid gap-px bg-border border border-border rounded-lg overflow-hidden [grid-template-columns:repeat(auto-fit,minmax(190px,1fr))]">
            {tiers.data.weightTiers.map((t, i) => {
              const floor = tierFloor(tiers.data.weightTiers, i)
              return (
                <div key={t.label} className="bg-surface p-24px">
                  <div className="text-sm text-muted font-medium">{t.label}</div>
                  <div className="mono text-figure-lg font-medium tracking-[-0.05em] my-7px">
                    {formatTaka(t.baseFee)}
                  </div>
                  <div className="text-meta text-faint">
                    {t.perKgOver
                      ? `+ ${formatTaka(t.perKgOver)} per kg over ${floor}`
                      : `+ ${formatTaka(tiers.data.perKmRate)} per km`}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <p className="text-sm text-faint mt-4">
          Cash on delivery available on every tier. Card payment is handled
          by a PCI-compliant gateway — we never see the card.
        </p>
      </div>
    </section>
  )
}
