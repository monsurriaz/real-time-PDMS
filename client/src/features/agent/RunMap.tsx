import { LazyTrackingMap } from '@/components/LazyTrackingMap'
import type { MapRider } from '@/components/TrackingMap'
import { useDeliveryRoute } from './useDeliveryRoute'

/**
 * The compact route map on the rider's active-delivery card — v3's Agent
 * section: pickup pin, the road line, and where the rider is now, at 170px
 * tall. This is the current delivery only, never the fleet — that map is
 * FleetMap, and it is an admin screen.
 *
 * Static (`animate={false}`): a rider does not need their own dot to glide
 * smoothly toward itself. What matters is the shape of the journey, at a
 * glance, beside the button that advances it.
 */
export const RunMap = ({ parcelId }: { parcelId: string }) => {
  const route = useDeliveryRoute(parcelId)
  const snap = route.data

  const riders: MapRider[] = snap?.delivery.lastKnownLocation
    ? [{ id: parcelId, point: snap.delivery.lastKnownLocation, label: 'You' }]
    : []

  return (
    <div className="relative h-[350px] bg-map-ground">
      <LazyTrackingMap
        className="absolute inset-0"
        riders={riders}
        route={snap?.route}
        pickup={snap?.parcel.pickup.point}
        drop={snap?.parcel.drop.point}
        animate={false}
      />
      {route.isError ? (
        <div className="absolute inset-0 grid place-items-center pointer-events-none p-2">
          <p className="text-tiny text-muted bg-surface/[0.92] border border-border rounded-sm px-2 py-1 text-center">
            Route unavailable
          </p>
        </div>
      ) : null}
    </div>
  )
}
