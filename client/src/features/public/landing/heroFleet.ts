import type { MapRider } from '@/components/TrackingMap'

/**
 * Decorative pins for the hero's full-bleed background map (M9.5, item 2).
 *
 * DELIBERATELY STATIC, not live fleet positions. Two reasons: there is no
 * unauthenticated route that returns real-time rider locations — the admin
 * fleet map (FleetMap.tsx) is behind `requireRole('admin')`, and CLAUDE.md
 * section 7 is about narrowing who sees live position data, not widening it
 * to an anonymous visitor — and a hero that only looks alive when a real
 * rider happens to be on shift would make the page's first impression
 * depend on the demo database's current state rather than the product.
 * Same reasoning DEFERRED.md already records for the showcase card's
 * fabricated delivery (M6.96): illustrative, not a claim about right now.
 *
 * The six points are the real seeded zone centres (scripts/seed.ts) rather
 * than invented coordinates, so the map reads as Dhaka rather than as a
 * generic city — and one rider per lifecycle colour, so the hero itself
 * demonstrates the five-colour ramp CLAUDE.md section 4 freezes.
 */
export const HERO_FLEET: MapRider[] = [
  {
    id: 'hero-dhanmondi',
    point: { type: 'Point', coordinates: [90.3742, 23.7461] },
    label: 'Dhanmondi',
    tone: 'Booked',
    busy: true,
  },
  {
    id: 'hero-mirpur',
    point: { type: 'Point', coordinates: [90.3654, 23.8223] },
    label: 'Mirpur',
    tone: 'Assigned',
    busy: true,
  },
  {
    id: 'hero-uttara',
    point: { type: 'Point', coordinates: [90.3983, 23.8759] },
    label: 'Uttara',
    tone: 'PickedUp',
    busy: true,
  },
  {
    id: 'hero-bashundhara',
    point: { type: 'Point', coordinates: [90.4264, 23.8203] },
    label: 'Bashundhara',
    tone: 'InTransit',
    busy: true,
  },
  {
    id: 'hero-gulshan',
    point: { type: 'Point', coordinates: [90.4152, 23.7925] },
    label: 'Gulshan',
    tone: 'Delivered',
    busy: true,
  },
  {
    id: 'hero-mohammadpur',
    point: { type: 'Point', coordinates: [90.3596, 23.7639] },
    label: 'Mohammadpur',
    tone: 'InTransit',
    busy: true,
  },
]
