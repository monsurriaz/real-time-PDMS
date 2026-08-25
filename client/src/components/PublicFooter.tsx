import { Link } from 'react-router-dom'

/**
 * The public footer — v3.1 addendum. Slim, chrome-coloured, one line, no
 * link farm: a footer exists to carry secondary navigation and legal links
 * when there's nowhere else to put them, and behind the rail there always is
 * somewhere else. So this renders on the four public pages only (`/`,
 * `/login`, `/signup`, `/track/:id`) — every screen behind AppShell gets
 * none, and does not import this component.
 */
interface Props {
  /**
   * The landing page's own nav already carries Track a parcel / For riders /
   * Sign in — repeating all three at the foot of the SAME page is the kind of
   * redundancy the footer rule exists to avoid elsewhere, so the addendum's
   * own landing composition renders a shorter wordmark-only footer there.
   * Every other public page keeps the full link set.
   */
  minimal?: boolean
}

export const PublicFooter = ({ minimal = false }: Props) => (
  <footer className="on-chrome bg-chrome text-chrome-faint">
    <div className="max-w-[1040px] mx-auto px-22px py-30px flex flex-wrap items-center gap-5">
      <Link
        to="/"
        className="flex items-center gap-9px font-bold text-sm text-chrome-ink tracking-[-0.03em]"
      >
        <span className="w-3.5 h-3.5 bg-accent rounded-mark rotate-45 flex-none" />
        ParcelDelivery
      </Link>

      {minimal ? null : (
        <>
          {/*
            To the landing page, not a `#track` fragment: this footer also
            renders on /login, /signup and /track/:id, none of which have a
            `#track` anchor to land on, and the landing page puts its own
            tracking form right under the fold regardless.
          */}
          <Link to="/" className="text-small hover:text-chrome-ink">
            Track a parcel
          </Link>
          <Link to="/signup?role=agent" className="text-small hover:text-chrome-ink">
            For riders
          </Link>
          <Link to="/login" className="text-small hover:text-chrome-ink">
            Sign in
          </Link>
        </>
      )}

      <span className="text-small ml-auto">CSC 470 · Dhaka</span>
    </div>
  </footer>
)
