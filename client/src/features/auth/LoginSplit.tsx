import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '@/components/Badge'
import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import { LifecycleRail } from '@/components/LifecycleRail'
import { PublicFooter } from '@/components/PublicFooter'
import {
  SHOWCASE_DROP,
  SHOWCASE_PICKUP,
  SHOWCASE_RIDER,
  SHOWCASE_ROUTE,
  SHOWCASE_TRACKING_ID,
} from '../public/landing/demoShowcase'

/**
 * `/login`'s v4 shell (M9.5) — NOT a change to `AuthSplit`, which `/signup`
 * keeps unchanged this session (the brief's own instruction). The two
 * diverge enough that forcing one shared shell to do both jobs would mean
 * `AuthSplit` growing a real-map mode, a veil, and a three-anchor layout
 * `/signup` never uses — a second small component here is the honest
 * version of "the shared shell would diverge," reported rather than done
 * silently.
 *
 * The left panel replaces AuthSplit's flat chrome background with the same
 * full-bleed map + radial veil treatment as the v4 hero (`.login-veil` —
 * the second and last surface the CLAUDE.md section 4 gradient exception
 * covers), and distributes its content across three fixed vertical anchors
 * — wordmark top, headline + live product card middle, pull-quote bottom —
 * instead of AuthSplit's headline-then-quote stack with a dead gap under
 * it, which was the specific defect this session exists to fix.
 */

interface Props {
  heading: string
  body: string
  children: ReactNode
  /** The calling route's own identifying class (M6.97) — always `login` here. */
  pageClass: string
}

const QUOTE = {
  text: 'Every figure on the admin board is counted at read time — nothing here is a stored total.',
  who: 'From the design principles',
}

const LiveProductCard = () => (
  <div className="relative z-10 bg-chrome-2/80 backdrop-blur-md border border-white/10 rounded-lg p-4 max-w-[340px]">
    <div className="flex items-center gap-9px mb-13px">
      <span className="mono text-meta text-chrome-muted">{SHOWCASE_TRACKING_ID}</span>
      <Badge status="InTransit" />
    </div>
    <LifecycleRail status="InTransit" />
    <div className="flex items-center gap-10px mt-14px">
      <span className="w-8 h-8 rounded-full bg-chrome-3 flex-none" aria-hidden="true" />
      <div>
        <div className="text-sm font-semibold text-chrome-ink">Rakib Hasan</div>
        <div className="text-tiny text-chrome-faint">1.2 km away · arriving ~14:38</div>
      </div>
    </div>
  </div>
)

export const LoginSplit = ({ heading, body, children, pageClass }: Props) => (
  <main className={`${pageClass} min-h-dvh bg-page flex flex-col`}>
    <div className="grid min-[900px]:grid-cols-[1.05fr_0.95fr] flex-1">
      {/* ---------- left: map, veil, three anchors ---------- */}
      <div className="on-chrome relative overflow-hidden bg-night px-34px py-10 flex flex-col justify-between max-[899px]:px-22px max-[899px]:py-6 max-[899px]:min-h-[220px]">
        <div className="absolute inset-0">
          <LazyTrackingMap
            className="h-full opacity-40"
            riders={SHOWCASE_RIDER}
            route={SHOWCASE_ROUTE}
            pickup={SHOWCASE_PICKUP}
            drop={SHOWCASE_DROP}
            animate={false}
            follow={false}
          />
        </div>
        {/* the second (and last) gradient exception — see app.css .login-veil */}
        <div className="absolute inset-0 login-veil" aria-hidden="true" />

        {/* anchor 1: wordmark */}
        <Link
          to="/"
          className="relative z-10 flex items-center gap-9px font-bold text-md text-chrome-ink tracking-[-0.03em] max-[899px]:mb-0"
        >
          <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
          ParcelDelivery
        </Link>

        {/* anchor 2: headline + live product card, vertically centred */}
        <div className="relative z-10 my-auto max-[899px]:hidden">
          <h3 className="text-h2 font-semibold tracking-[-0.035em] leading-[1.15] text-chrome-ink max-w-[15ch]">
            {heading}
          </h3>
          <p className="text-md text-chrome-muted mt-14px max-w-[38ch] leading-relaxed">{body}</p>
          <div className="mt-7">
            <LiveProductCard />
          </div>
        </div>

        {/* anchor 3: pull-quote, pinned to the bottom */}
        <div className="relative z-10 border-l-2 border-accent pl-14px max-[899px]:hidden">
          <p className="text-control text-chrome-ink leading-normal">{QUOTE.text}</p>
          <p className="text-eyebrow text-chrome-faint mt-7px normal-case tracking-normal font-normal">
            {QUOTE.who}
          </p>
        </div>
      </div>

      {/* ---------- right: the form, max 368px ---------- */}
      <div className="bg-surface flex items-center justify-center px-30px py-10">
        <div className="w-full max-w-[368px]">{children}</div>
      </div>
    </div>

    <PublicFooter />
  </main>
)
