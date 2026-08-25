import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LifecycleRail } from '@/components/LifecycleRail'
import { formatTaka } from '@/lib/format'
import { homeForRole } from '../auth/roles'
import { useMe } from '../auth/useAuth'
import { usePublicPricingSummary } from './usePublicStats'

/**
 * `/` — v3's Landing section. Dark hero carrying the chrome colour so the
 * public face and the product read as one thing; the lifecycle rail is the
 * hero graphic, the SAME component the app uses everywhere else, so it can
 * never drift into its own illustration.
 *
 * A signed-in visitor sees this exact page, not a redirect — v3's own note:
 * "a signed-in user is still allowed to read the public page." The only
 * thing that changes is the nav's right-hand cluster, which collapses to one
 * link to their own dashboard.
 */

const FEATURES = [
  {
    icon: (
      <>
        <path d="M12 21s7-5.7 7-11a7 7 0 1 0-14 0c0 5.3 7 11 7 11z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    accent: true,
    title: 'Watch it move',
    body: 'Your rider’s position streams every few seconds. If the connection drops, we say so rather than showing a stale dot.',
  },
  {
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    accent: false,
    title: 'Nearest rider, automatically',
    body: 'Bookings go to the closest available rider covering your pickup zone. No dispatcher phoning around.',
  },
  {
    icon: (
      <>
        <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z" />
        <circle cx="12" cy="13" r="3.4" />
      </>
    ),
    accent: false,
    title: 'Proof at the door',
    body: 'A photo, a one-time code, or a signature — recorded against the delivery the moment it’s handed over.',
  },
] as const

/** The hero's own tracking-by-ID shortcut — v3's "Track with an ID" CTA
 *  paired with a real input, not a decorative label. */
const TrackByIdForm = () => {
  const [value, setValue] = useState('')
  const navigate = useNavigate()

  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const id = value.trim()
    if (id) navigate(`/track/${id}`)
  }

  return (
    <form onSubmit={submit} id="track" className="flex gap-9px max-w-[420px] scroll-mt-24">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="PD-XXXX-XX"
        aria-label="Tracking ID"
        className="mono flex-1 min-w-0 bg-chrome-2 border border-chrome-3 text-chrome-ink placeholder:text-chrome-faint rounded-sm px-4 py-13px text-base outline-none focus-visible:border-accent-on-dark"
      />
      <button
        type="submit"
        className="font-sans font-semibold text-base px-22px py-13px rounded-md bg-chrome-3 text-white hover:bg-chrome-2 cursor-pointer whitespace-nowrap"
      >
        Track with an ID
      </button>
    </form>
  )
}

export const LandingPage = () => {
  const me = useMe()
  const stats = usePublicPricingSummary()

  return (
    <div className="min-h-dvh bg-page">
      {/* ---------- dark hero ---------- */}
      <div className="on-chrome bg-chrome text-chrome-ink">
        <div className="max-w-[1040px] mx-auto px-22px">
          <nav className="flex items-center gap-5 py-18px">
            <Link to="/" className="flex items-center gap-9px font-bold text-md tracking-[-0.03em]">
              <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
              ParcelDelivery
            </Link>

            <div className="ml-auto flex items-center gap-5">
              {me.data ? (
                <Link
                  to={homeForRole(me.data.role)}
                  className="font-sans font-semibold text-body px-17px py-10px rounded-sm bg-accent text-white hover:bg-accent-hover"
                >
                  Go to my dashboard
                </Link>
              ) : (
                <>
                  {/*
                    Both stay reachable at 375px through the page itself —
                    the hero's own tracking form, and the role picker on
                    /signup — so only Sign in needs to survive next to the
                    primary button on a narrow nav.
                  */}
                  <a
                    href="#track"
                    className="hidden sm:inline text-body text-chrome-muted hover:text-chrome-ink"
                  >
                    Track a parcel
                  </a>
                  <Link
                    to="/signup?role=agent"
                    className="hidden sm:inline text-body text-chrome-muted hover:text-chrome-ink"
                  >
                    For riders
                  </Link>
                  <Link to="/login" className="text-body text-chrome-muted hover:text-chrome-ink">
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
          </nav>

          <div className="pt-14 pb-16 max-w-[640px]">
            <h1 className="text-hero font-semibold tracking-[-0.03em] leading-[1.1]">
              Every parcel, live on a map.
            </h1>
            <p className="text-base text-chrome-muted mt-4 max-w-[560px]">
              Book a pickup anywhere in Dhaka, watch your rider move in real
              time, and pay online or on delivery. For couriers who&rsquo;d
              rather not answer &ldquo;where is it?&rdquo; on the phone.
            </p>

            <div className="flex flex-wrap gap-9px mt-7">
              <Link
                to={me.data ? homeForRole(me.data.role) : '/signup'}
                className="font-sans font-semibold text-base px-22px py-13px rounded-md bg-accent text-white hover:bg-accent-hover"
              >
                Send a parcel
              </Link>
            </div>
            <div className="mt-7">
              <TrackByIdForm />
            </div>

            {/* the lifecycle rail, exactly the component the app uses */}
            <div className="mt-11 max-w-[620px]">
              <LifecycleRail status="InTransit" />
              <div className="flex mt-2">
                {['Booked', 'Assigned', 'Picked up', 'In transit', 'Delivered'].map((l) => (
                  <span
                    key={l}
                    className={`flex-1 text-eyebrow ${l === 'In transit' ? 'text-accent-on-dark' : 'text-chrome-faint'}`}
                  >
                    {l}
                  </span>
                ))}
              </div>
            </div>

            {/* stat band */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 mt-10 pt-8 border-t border-chrome-3">
              <div>
                <div className="mono text-figure-lg font-medium tracking-[-0.03em]">
                  {stats.data ? stats.data.zoneCount : '—'}
                </div>
                <div className="text-tiny text-chrome-muted mt-0.5">Dhaka zones</div>
              </div>
              <div>
                <div className="mono text-figure-lg font-medium tracking-[-0.03em]">~3s</div>
                <div className="text-tiny text-chrome-muted mt-0.5">Location latency</div>
              </div>
              <div>
                <div className="mono text-figure-lg font-medium tracking-[-0.03em]">
                  {stats.data ? formatTaka(stats.data.floorFee) : '—'}
                </div>
                <div className="text-tiny text-chrome-muted mt-0.5">From, up to 1 kg</div>
              </div>
              <div>
                <div className="mono text-figure-lg font-medium tracking-[-0.03em]">
                  {stats.data ? `${stats.data.weightCapKg}kg` : '—'}
                </div>
                <div className="text-tiny text-chrome-muted mt-0.5">Maximum weight</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- feature band, back on the workspace ---------- */}
      <div className="max-w-[1040px] mx-auto px-22px py-16">
        <div className="grid sm:grid-cols-3 gap-8">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <div
                className={`w-9 h-9 rounded-sm grid place-items-center mb-3 ${
                  f.accent ? 'bg-accent-tint text-accent' : 'bg-surface-sunk text-ink-2'
                }`}
              >
                <svg viewBox="0 0 24 24" className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  {f.icon}
                </svg>
              </div>
              <div className="text-md font-semibold tracking-[-0.02em]">{f.title}</div>
              <p className="text-body text-muted mt-5px">{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
