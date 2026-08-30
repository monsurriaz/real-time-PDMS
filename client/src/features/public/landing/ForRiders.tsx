import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/Button'
import { Avatar } from '@/components/Table'
import { formatOfferCountdown, useOfferCountdown } from '../../agent/useOfferCountdown'

/**
 * v4 section 6 — "for riders". The offer card is real M8 machinery, not a
 * redrawn mock: `useOfferCountdown`/`formatOfferCountdown` are the exact
 * hook and formatter DeliveryDetail ticks against a real
 * `delivery.offerExpiresAt`, fed here a fabricated deadline a few minutes
 * out so a visitor sees the same countdown a rider actually would.
 *
 * The Accept/Decline buttons stay visual-only, styled exactly like
 * DeliveryActions' real ones (Button, same variants) rather than wired to
 * `useAdvanceStatus`/`useDeclineOffer` — those mutate a REAL delivery by id
 * and require a rider session; a public marketing page firing an
 * authenticated mutation at a fabricated id on click would be a bug
 * dressed as a demo, not a working feature. Reported as a deliberate choice
 * per the M9.5 brief.
 */
const DEMO_OFFER_MINUTES = 5

export const ForRiders = () => {
  const [deadline] = useState(() => new Date(Date.now() + DEMO_OFFER_MINUTES * 60_000))
  const remaining = useOfferCountdown(deadline)

  return (
    <section id="riders" className="landing-for-riders bg-chrome text-chrome-ink py-22 on-chrome scroll-mt-20">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="text-eyebrow font-semibold uppercase tracking-[0.11em] text-accent-on-dark mb-3">
              For riders
            </div>
            <h2 className="text-h2 sm:text-hero font-bold tracking-[-0.04em] leading-[1.1]">
              Jobs in your zone, on your shift.
            </h2>
            <p className="text-md text-chrome-muted mt-13px leading-relaxed max-w-[46ch]">
              Apply in two minutes. Once an admin approves you, offers arrive
              for parcels near wherever you&rsquo;ve set your position —
              accept or decline, and go offline whenever you&rsquo;re not
              working.
            </p>
            <Link to="/signup?role=agent" className="inline-block mt-26px">
              <Button variant="primary" size="lg">
                Apply as a rider
              </Button>
            </Link>
          </div>

          <div className="grid gap-3">
            <div className="bg-chrome-2 border border-chrome-3 rounded-md p-4 flex items-center gap-3">
              <Avatar size="md" />
              <div className="flex-1 min-w-0">
                <div className="text-body font-semibold">PD-4K22-B8 · Mirpur → Uttara</div>
                <div className="text-meta text-chrome-muted">2.1 km to pickup · ৳640 COD</div>
              </div>
              {remaining !== null ? (
                <span className="mono text-meta text-accent-on-dark whitespace-nowrap">
                  {formatOfferCountdown(remaining)}
                </span>
              ) : null}
            </div>
            <div className="flex gap-10px">
              <Button variant="primary" className="flex-1" tabIndex={-1} aria-hidden="true">
                Accept
              </Button>
              <Button variant="quiet" className="flex-1 bg-transparent text-white border-white/15 hover:bg-white/10" tabIndex={-1} aria-hidden="true">
                Decline
              </Button>
            </div>
            <p className="text-meta text-chrome-faint text-center mt-0.5">
              Offers expire if nobody answers — the parcel goes back to the
              pool automatically.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
