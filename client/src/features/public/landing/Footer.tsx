import { Link } from 'react-router-dom'

/**
 * v4 section 9 — the landing page's own footer, not the shared
 * `PublicFooter`. v4 supersedes v3/v3.1 for `/` only, and the shared
 * component's minimal wordmark-only variant exists specifically because the
 * landing page's own nav already carries its links (PublicFooter.tsx's own
 * comment) — that reasoning doesn't hold once the page has a real four-column
 * footer as one of its nine sections, so this is a page-local component
 * rather than a further edit to the shell every other public page renders.
 * `/login`, `/signup` and `/track/:id` keep using `PublicFooter` unchanged.
 */
const COLUMNS = [
  {
    title: 'Product',
    links: [
      { to: '#track', label: 'Track a parcel' },
      { to: '/signup', label: 'Book a pickup' },
      { to: '#pricing', label: 'Pricing' },
      { to: '#how', label: 'How it works' },
    ],
  },
  {
    title: 'Riders',
    links: [
      { to: '/signup?role=agent', label: 'Apply as a rider' },
      { to: '/login', label: 'Rider sign in' },
      { to: '#riders', label: 'Zones covered' },
    ],
  },
] as const

/** `#anchor` scrolls within this same page; anything else is a real route. */
const FooterLink = ({ to, children }: { to: string; children: string }) =>
  to.startsWith('#') ? (
    <a href={to} className="block text-body text-chrome-muted hover:text-white py-5px">
      {children}
    </a>
  ) : (
    <Link to={to} className="block text-body text-chrome-muted hover:text-white py-5px">
      {children}
    </Link>
  )

export const Footer = () => (
  <footer className="bg-night text-white on-chrome">
    <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-16">
      <div className="grid sm:grid-cols-[1.5fr_1fr_1fr] gap-8">
        <div>
          <Link to="/" className="flex items-center gap-9px font-bold text-sm mb-14px">
            <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
            ParcelDelivery
          </Link>
          <p className="text-body text-chrome-muted max-w-[34ch] leading-relaxed">
            Real-time parcel delivery across Dhaka. Book, track, and prove
            every handover.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h4 className="text-eyebrow font-semibold uppercase tracking-[0.11em] text-chrome-faint mb-15px">
              {col.title}
            </h4>
            {col.links.map((l) => (
              <FooterLink key={l.label} to={l.to}>
                {l.label}
              </FooterLink>
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-chrome-3 mt-11 pt-22px flex flex-wrap gap-4 text-small text-chrome-faint">
        <span>CSC 470 · Dhaka</span>
        <span className="ml-auto">Maps © OpenFreeMap · OpenMapTiles · data from OpenStreetMap</span>
      </div>
    </div>
  </footer>
)
