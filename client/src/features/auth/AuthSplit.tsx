import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { LifecycleRail } from '@/components/LifecycleRail'
import { PublicFooter } from '@/components/PublicFooter'

/**
 * The shared shell behind /login and /signup — v3.1 addendum, "auth split".
 *
 * A lone form centred on an empty page read as unfinished. This is one layout
 * component for both screens rather than two page designs: a chrome-dark left
 * panel carrying the proposition (wordmark, headline, the same LifecycleRail
 * the rest of the app uses, a pull-quote), a white right panel centring the
 * form at a fixed column width. Signup reuses this exact shell with its role
 * picker on the right — the two pages differ only in what `children` is.
 *
 * Below 860px (the addendum's own breakpoint, not one of Tailwind's) the left
 * panel collapses to a slim wordmark-only band rather than re-flowing its full
 * content above the form. The mock's own responsive rule only changes the
 * grid to one column, which — stacked with its headline, proposition, rail
 * and quote all still present — would still be tall enough on a phone to make
 * someone scroll past a hero to reach a password field, the exact failure
 * this addendum item exists to fix. Hiding everything but the wordmark below
 * 860px is what actually delivers "a slim band."
 */

interface Props {
  /** The left panel's headline. Keep it near the mock's own ~20ch. */
  heading: string
  /** The left panel's one paragraph of proposition copy. */
  body: string
  children: ReactNode
}

const QUOTE = {
  text: 'Every figure on the admin board is counted at read time — nothing here is a stored total.',
  who: 'From the design principles',
}

export const AuthSplit = ({ heading, body, children }: Props) => (
  <main className="min-h-dvh bg-page flex flex-col">
    <div className="grid min-[860px]:grid-cols-2 flex-1">
      {/* ---------- left: the proposition ---------- */}
      <div
        className={[
          'on-chrome bg-chrome text-chrome-ink',
          'px-34px py-10 flex flex-col justify-between',
          // Slim band below 860px: wordmark only, no headline/body/rail/quote.
          'max-[859px]:px-22px max-[859px]:py-6 max-[859px]:flex-row max-[859px]:items-center',
        ].join(' ')}
      >
        <Link
          to="/"
          className="flex items-center gap-9px font-bold text-md tracking-[-0.03em] mb-30px max-[859px]:mb-0"
        >
          <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
          ParcelDelivery
        </Link>

        <div className="max-[859px]:hidden">
          <h3 className="text-h2 font-semibold tracking-[-0.035em] leading-[1.15] max-w-[20ch]">
            {heading}
          </h3>
          <p className="text-control text-chrome-muted mt-11px max-w-[38ch]">{body}</p>

          {/* the lifecycle rail, exactly the component the app uses elsewhere */}
          <div className="mt-26px max-w-[290px]">
            <LifecycleRail status="Delivered" />
          </div>
        </div>

        <div className="border-l-2 border-accent pl-14px mt-auto max-[859px]:hidden">
          <p className="text-control text-chrome-ink leading-normal">{QUOTE.text}</p>
          <p className="text-eyebrow text-chrome-faint mt-7px normal-case tracking-normal font-normal">
            {QUOTE.who}
          </p>
        </div>
      </div>

      {/* ---------- right: the form ---------- */}
      <div className="bg-surface flex items-center justify-center px-30px py-10">
        <div className="w-full max-w-[352px]">{children}</div>
      </div>
    </div>

    <PublicFooter />
  </main>
)
