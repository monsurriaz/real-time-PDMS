import { Suspense, lazy } from 'react'
import type { ComponentProps } from 'react'
import type { TrackingMap as TrackingMapType } from './TrackingMap'

/**
 * MapLibre, loaded only by the screens that draw a map.
 *
 * It is 1.05 MB of the client bundle — two thirds of everything we ship — and
 * three of the five screens never touch it. A rider opening their run list on a
 * Dhaka mobile connection was paying for a renderer they were not going to see.
 *
 * `lazy` wants a default export and TrackingMap is named, so the promise is
 * mapped rather than the component being re-exported: one indirection here
 * beats changing an export shape every other file depends on.
 */
const TrackingMap = lazy(async () => {
  const mod = await import('./TrackingMap')
  return { default: mod.TrackingMap }
})

type Props = ComponentProps<typeof TrackingMapType>

/**
 * The fallback deliberately fills the same box the map will. A collapsing
 * container is what M4's blank-map bug was made of, and a fallback that does
 * not reserve the space would reintroduce the same class of layout shift.
 */
export const LazyTrackingMap = (props: Props) => (
  <Suspense
    fallback={
      <div
        className={`grid place-items-center bg-map-ground ${props.className ?? ''}`}
      >
        <p className="text-small text-muted">Loading the map…</p>
      </div>
    }
  >
    <TrackingMap {...props} />
  </Suspense>
)
