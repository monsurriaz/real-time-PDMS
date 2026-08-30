import { useState } from 'react'

/**
 * v4 section 7 — FAQ, a real accordion (first question open by default).
 *
 * The reference doc only writes out the first answer; the other four are
 * written here from what the system actually does, checked against the
 * code rather than invented as plausible marketing copy:
 *
 *  - "no rider accepts" -> lifecycle.ts's offer/decline/expiry rules
 *    (CLAUDE.md section 5, M8): expiry is evaluated on read, not a
 *    schedule, and a lapsed or declined rider is excluded from being
 *    re-offered that SAME delivery, not the roster.
 *  - "can the price change" -> pricing.ts's computePrice + the parcel price
 *    snapshot (CLAUDE.md section 5): booking computes once and stores the
 *    breakdown; a later PricingConfig edit only affects new bookings.
 *  - "COD reconciliation" -> Settlement.ts + payments.ts: codAmount is
 *    server-set from the price snapshot, and a hand-in writes an
 *    append-only Settlement naming exactly the Payments it closed.
 *  - "connection drops" -> useLiveTracking.ts (CLAUDE.md section 6):
 *    socket-first, REST polling every 10s as the fallback, honest
 *    'reconnecting' state rather than a stale dot.
 */
const FAQS = [
  {
    q: 'Do I need an account to track a parcel?',
    a: 'No. Anyone with the tracking ID can follow it on the map. The public view deliberately withholds the recipient’s details, the addresses and the price — enough to answer “where is it”, not to identify who’s receiving what.',
  },
  {
    q: 'What happens if no rider accepts?',
    a: 'Each booking is offered to one rider at a time — the nearest available one covering the pickup zone. If they decline, or the offer window passes with no answer (checked the moment anyone next looks at the delivery, not on a timer), it falls back to the pool unassigned and that rider is excluded from being offered this SAME delivery again. It’s then eligible for the next assignment attempt, same as any freshly booked parcel, just with one fewer rider in the running.',
  },
  {
    q: 'Can the price change after I book?',
    a: 'No. Price is distance, weight and zone run through the rates in force at the moment you book, and the full breakdown is saved onto your parcel right then — not just the total. If an operator edits a rate afterward, only bookings made after that edit see the new number; yours stays exactly what you were quoted.',
  },
  {
    q: 'How is cash on delivery reconciled?',
    a: 'The amount a rider collects is set by the server from your parcel’s own price snapshot — never something typed in at booking — so it’s always exactly the delivery fee. Every collection is its own record, and handing cash to the office writes a settlement naming precisely which collections it closes: an audit entry, not an edited running total.',
  },
  {
    q: "What if the rider's connection drops mid-delivery?",
    a: 'Tracking is socket-first — your map takes rider positions the instant they arrive. If that connection drops, the screen switches to polling the server every 10 seconds on its own and says so rather than leaving a dot sitting where the rider isn’t anymore. It switches back the moment the socket reconnects.',
  },
] as const

export const Faq = () => {
  const [open, setOpen] = useState(0)

  return (
    <section className="bg-surface py-22">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
        <div className="max-w-[600px] mb-11">
          <div className="text-eyebrow font-semibold uppercase tracking-[0.11em] text-accent mb-3">
            Questions
          </div>
          <h2 className="text-h2 sm:text-hero font-bold tracking-[-0.04em] leading-[1.1]">
            The things people actually ask.
          </h2>
        </div>

        <div className="max-w-[780px]">
          {FAQS.map((f, i) => {
            const expanded = open === i
            return (
              <div key={f.q} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? -1 : i)}
                  aria-expanded={expanded}
                  className="w-full flex items-center gap-14px py-5 text-left text-md font-semibold tracking-[-0.02em] cursor-pointer"
                >
                  <span className="flex-1">{f.q}</span>
                  <svg
                    viewBox="0 0 24 24"
                    className={`w-4 h-4 flex-none stroke-muted transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`}
                    fill="none"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {expanded ? (
                  <p className="text-control text-muted leading-relaxed max-w-[68ch] pb-5 -mt-1">
                    {f.a}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
