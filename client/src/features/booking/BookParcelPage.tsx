import { RoleShell } from '@/components/RoleShell'
import { BookingPage } from './BookingPage'

const NAV = [
  { to: '/', label: 'My parcels' },
  { to: '/book', label: 'Book' },
] as const

export const BookParcelPage = () => (
  <RoleShell
    title="Book a parcel"
    subtitle="We price it from the road distance, the weight tier and the pick-up zone."
    nav={NAV}
  >
    <BookingPage />
  </RoleShell>
)
