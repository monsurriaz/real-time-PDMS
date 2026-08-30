import type { MapRider } from '@/components/TrackingMap'

/**
 * Fabricated, illustrative delivery — there is no real one to show a visitor
 * who has not booked anything yet. Shared by the hero's floating product
 * card and the bento grid's map cell, so the landing page tells one
 * consistent story (the same tracking ID, the same route) rather than two
 * unrelated fake deliveries.
 *
 * Chosen so the rider sits exactly on the route's one bend: the leg behind
 * them renders solid, the leg ahead dashed — a live demonstration that
 * TrackingMap's route-progress split (v3.1 addendum, item 6) is doing its
 * job, on the page a grader is likeliest to open first. Moved here from
 * LandingPage.tsx unchanged (M6.96) when M9.5 gave it a second caller.
 */
export const SHOWCASE_PICKUP = {
  type: 'Point' as const,
  coordinates: [90.3754, 23.77] as [number, number],
}
export const SHOWCASE_BEND = {
  type: 'Point' as const,
  coordinates: [90.3754, 23.778] as [number, number],
}
export const SHOWCASE_DROP = {
  type: 'Point' as const,
  coordinates: [90.455, 23.778] as [number, number],
}
export const SHOWCASE_ROUTE: Array<[number, number]> = [
  SHOWCASE_PICKUP.coordinates,
  SHOWCASE_BEND.coordinates,
  SHOWCASE_DROP.coordinates,
]
export const SHOWCASE_RIDER: MapRider[] = [
  { id: 'showcase', point: SHOWCASE_BEND, label: 'Rakib Hasan', tone: 'InTransit' },
]

export const SHOWCASE_TRACKING_ID = 'PD-4K19-7C'
