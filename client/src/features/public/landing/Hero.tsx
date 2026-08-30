import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Badge } from '@/components/Badge'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import { LifecycleRail } from '@/components/LifecycleRail'
import { Avatar } from '@/components/Table'
import { formatTaka } from '@/lib/format'
import type { SelfUser } from '@pdms/shared'
import { homeForRole } from '../../auth/roles'
import { usePublicPricingSummary } from '../usePublicStats'
import { SHOWCASE_DROP, SHOWCASE_PICKUP, SHOWCASE_RIDER, SHOWCASE_ROUTE, SHOWCASE_TRACKING_ID } from './demoShowcase'
import { HERO_FLEET } from './heroFleet'

/**
 * v4 hero (M9.5) — the map IS the background, not a card beside the copy.
 * A real MapLibre instance (LazyTrackingMap -> TrackingMap, the exact
 * component every tracking screen uses) sits full-bleed behind a floating
 * pill nav and the hero copy, with a radial veil over it for text contrast.
 *
 * That veil is a gradient, which CLAUDE.md section 4 forbids everywhere
 * else — it is allowed here, and at the login left panel, ONLY because it
 * exists to keep text legible over imagery rather than as decoration. See
 * `.hero-veil` in app.css for the one place the exception is implemented.
 */

const Wordmark = ({ dark = false }: { dark?: boolean }) => (
  <Link
    to="/"
    className={`flex items-center gap-9px font-bold text-md tracking-[-0.03em] ${dark ? 'text-chrome-ink' : ''}`}
  >
    <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
    ParcelDelivery
  </Link>
)

const NAV_LINKS = [
  { href: '#track', label: 'Track a parcel' },
  { href: '#how', label: 'How it works' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#riders', label: 'For riders' },
] as const

/** The floating pill nav — blurred translucent chrome over the map. */
const PillNav = ({ me }: { me: SelfUser | undefined }) => (
  <nav className="relative z-10 px-4 sm:px-8 pt-22px">
    <div className="max-w-[1200px] mx-auto flex items-center gap-6 bg-chrome/70 backdrop-blur-md border border-white/10 rounded-pill pl-5 pr-3 py-10px">
      <Wordmark dark />
      <div className="ml-auto flex items-center gap-5">
        {me ? (
          <Link
            to={homeForRole(me.role)}
            className="font-sans font-semibold text-body px-17px py-10px rounded-sm bg-accent text-white hover:bg-accent-hover whitespace-nowrap"
          >
            Go to my dashboard
          </Link>
        ) : (
          <>
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="hidden md:inline text-body text-chrome-muted hover:text-chrome-ink"
              >
                {l.label}
              </a>
            ))}
            <Link to="/login" className="text-body text-chrome-muted hover:text-chrome-ink whitespace-nowrap">
              Sign in
            </Link>
            <Link
              to="/signup"
              className="font-sans font-semibold text-body px-17px py-10px rounded-sm bg-accent text-white hover:bg-accent-hover whitespace-nowrap"
            >
              Send a parcel
            </Link>
          </>
        )}
      </div>
    </div>
  </nav>
)

/** The hero's tracking-by-ID shortcut — wired to the same public lookup /track/:id already serves. */
const TrackByIdForm = () => {
  const [value, setValue] = useState('')
  const navigate = useNavigate()

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const id = value.trim()
    if (id) navigate(`/track/${id}`)
  }

  return (
    <form
      id="track"
      onSubmit={submit}
      className="flex gap-7px max-w-[452px] mt-30px scroll-mt-28 bg-chrome-2/75 backdrop-blur-md border border-white/10 rounded-lg p-7px"
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="PD-XXXX-XX — track without an account"
        aria-label="Tracking ID"
        className="mono flex-1 min-w-0 bg-transparent border-0 text-chrome-ink placeholder:text-chrome-faint px-14px py-3 text-body outline-none"
      />
      <button
        type="submit"
        className="font-sans font-semibold text-body px-5 py-3 rounded-sm bg-accent text-white hover:bg-accent-hover cursor-pointer whitespace-nowrap"
      >
        Track
      </button>
    </form>
  )
}

/**
 * The floating product card — a live product view built from the real
 * TrackingMap, Badge and LifecycleRail components, fed the same fabricated
 * demo delivery the bento grid's map cell shows, so it can never visually
 * drift from the product. Unchanged in spirit from the v3.1/M6.96 showcase
 * card; only its border now reads against the map behind it instead of a
 * flat chrome background.
 */
const ProductShowcase = () => (
  <div className="bg-surface rounded-xl overflow-hidden border border-white/10">
    <div className="h-[194px] bg-map-ground">
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
    <div className="px-19px py-17px">
      <div className="flex items-center gap-9px">
        <span className="mono text-meta text-muted">{SHOWCASE_TRACKING_ID}</span>
        <Badge status="InTransit" />
        <span className="mono text-sm ml-auto">{formatTaka(1240)}</span>
      </div>
      <div className="mt-13px">
        <LifecycleRail status="InTransit" />
      </div>
      <div className="flex items-center gap-11px mt-14px">
        <Avatar size="md" />
        <div className="flex-1 min-w-0">
          <div className="text-body font-semibold tracking-[-0.015em] truncate">Rakib Hasan</div>
          <div className="text-meta text-muted">1.2 km away · arriving ~14:38</div>
        </div>
      </div>
    </div>
  </div>
)

export const Hero = ({ me }: { me: SelfUser | undefined }) => {
  const summary = usePublicPricingSummary()

  return (
    <div className="relative bg-night overflow-hidden min-h-[660px] flex flex-col on-chrome">
      {/* the real map, full-bleed, decorative fleet — see heroFleet.ts */}
      <div className="absolute inset-0">
        <LazyTrackingMap className="h-full opacity-60" riders={HERO_FLEET} animate={false} follow={false} />
      </div>
      {/* the one documented gradient exception — see app.css .hero-veil */}
      <div className="absolute inset-0 hero-veil" aria-hidden="true" />

      <PillNav me={me} />

      <div className="relative z-10 flex-1 grid min-[940px]:grid-cols-[1.02fr_0.98fr] gap-9 min-[940px]:gap-13 items-center max-w-[1200px] w-full mx-auto px-4 sm:px-8 pt-11 pb-14">
        <div>
          <div className="inline-flex items-center gap-2 text-tiny font-semibold uppercase tracking-[0.1em] text-accent-on-dark bg-accent/[0.13] border border-accent/30 px-13px py-6px rounded-pill mb-22px">
            <i className="w-1.5 h-1.5 rounded-full bg-accent-on-dark" />
            Live in {summary.data ? summary.data.zoneCount : 'six'} Dhaka zones
          </div>
          <h1 className="text-hero font-semibold tracking-[-0.048em] leading-[1.02] text-chrome-ink max-w-[16ch]">
            Every parcel, live on a map.
          </h1>
          <p className="text-base text-chrome-muted mt-19px max-w-[44ch] leading-relaxed">
            Book a pickup anywhere in Dhaka, watch your rider move in real
            time, and pay online or on delivery. For couriers who&rsquo;d
            rather not answer &ldquo;where is it?&rdquo; on the phone.
          </p>

          <TrackByIdForm />

          <div className="flex gap-6 sm:gap-26px mt-26px flex-wrap">
            <div className="flex items-baseline gap-7px">
              <span className="mono text-mark text-chrome-ink tracking-[-0.03em]">~3s</span>
              <span className="text-small text-chrome-faint">location latency</span>
            </div>
            <div className="flex items-baseline gap-7px">
              <span className="mono text-mark text-chrome-ink tracking-[-0.03em]">
                {summary.data ? formatTaka(summary.data.floorFee) : '—'}
              </span>
              <span className="text-small text-chrome-faint">from, up to 1 kg</span>
            </div>
            <div className="flex items-baseline gap-7px">
              <span className="mono text-mark text-chrome-ink tracking-[-0.03em]">
                {summary.data ? `${summary.data.weightCapKg}kg` : '—'}
              </span>
              <span className="text-small text-chrome-faint">max parcel</span>
            </div>
          </div>
        </div>

        <ProductShowcase />
      </div>
    </div>
  )
}
