import { Link } from 'react-router-dom'
import type { SelfUser } from '@pdms/shared'
import { homeForRole } from '../../auth/roles'

/** v4 section 8 — the closing CTA band. */
export const CtaBand = ({ me }: { me: SelfUser | undefined }) => (
  <section className="bg-page py-22">
    <div className="max-w-[1200px] mx-auto px-4 sm:px-8">
      <div className="bg-accent rounded-xl p-11 flex flex-wrap items-center gap-8">
        <div>
          <h2 className="text-h2 sm:text-hero font-bold tracking-[-0.04em] leading-[1.1] text-white max-w-[16ch]">
            Send your first parcel today.
          </h2>
          <p className="text-md text-white/80 mt-10px max-w-[44ch]">
            Book in under a minute. Pay online or let the rider collect at
            the door.
          </p>
        </div>
        <div className="ml-auto flex gap-11px flex-wrap">
          <Link
            to={me ? homeForRole(me.role) : '/signup'}
            className="inline-flex items-center justify-center font-sans font-semibold text-base px-22px py-13px rounded-md bg-white text-accent hover:bg-accent-tint"
          >
            Send a parcel
          </Link>
          <a
            href="#track"
            className="inline-flex items-center justify-center font-sans font-semibold text-base px-22px py-13px rounded-md bg-white/10 text-white border border-white/20 hover:bg-white/15"
          >
            Track with an ID
          </a>
        </div>
      </div>
    </div>
  </section>
)
