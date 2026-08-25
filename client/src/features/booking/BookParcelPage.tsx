import { AppShell, PageHead } from '@/components/AppShell'
import { BookingPage } from './BookingPage'

export const BookParcelPage = () => (
  <AppShell title="Book a parcel">
    <PageHead
      title="Book a parcel"
      sub="We price it from the road distance, the weight tier and the pick-up zone."
    />
    <BookingPage />
  </AppShell>
)
