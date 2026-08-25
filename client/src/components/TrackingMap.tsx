import { useEffect, useRef, useState } from 'react'
import maplibregl, { type LngLatLike, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoPoint } from '@pdms/shared'
import { coolMapStyle } from '@/lib/mapStyle'

/**
 * The tracking map. MapLibre GL JS over OpenFreeMap's positron style (CLAUDE.md
 * section 2) — no key, no quota — recoloured onto v3's cool greys at load
 * (see lib/mapStyle.ts).
 *
 * The design brief for this screen is that the map is the only place saturated
 * colour appears: the base stays muted and the route line and rider marker are
 * the only strong elements. positron is already a pale basemap, so nothing is
 * restyled — the markers carry the accent.
 */

const STYLE_URL =
  import.meta.env?.VITE_MAP_STYLE_URL ??
  'https://tiles.openfreemap.org/styles/positron'

/** Dhaka, for the initial viewport before anything is known. */
/**
 * The route colour, read from the stylesheet rather than repeated here.
 *
 * MapLibre paints into a canvas and cannot resolve a CSS variable, so the value
 * has to be handed over as a literal — but taking it from the computed style
 * means the map and `--s-transit` cannot drift apart, and v3's rule that "in
 * transit IS the accent" holds on the map as well as in the badge.
 */
const ROUTE_COLOUR =
  typeof window === 'undefined'
    ? '#3b4ef0'
    : getComputedStyle(document.documentElement)
        .getPropertyValue('--s-transit')
        .trim() || '#3b4ef0'

const DHAKA: LngLatLike = [90.4074, 23.7808]

export interface MapRider {
  id: string
  point: GeoPoint
  label: string
  sublabel?: string
}

interface Props {
  riders: MapRider[]
  route?: Array<[number, number]>
  pickup?: GeoPoint | null
  drop?: GeoPoint | null
  follow?: boolean
  className?: string
  animate?: boolean
}

type LngLat = [number, number]

/** Squared distance — comparing it is enough, and it skips a sqrt per call. */
const distance2 = (a: LngLat, b: LngLat): number => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  return dx * dx + dy * dy
}

/** The nearest point ON THE SEGMENT a→b to `p`. */
const projectOntoSegment = (p: LngLat, a: LngLat, b: LngLat): LngLat => {
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const lenSq = abx * abx + aby * aby
  if (lenSq === 0) return a
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lenSq))
  return [a[0] + abx * t, a[1] + aby * t]
}

/**
 * Splits a planned route into what's behind the rider and what's ahead of
 * them, by finding the point ON THE ROUTE closest to the rider's current
 * position and cutting there.
 *
 * This is the actual fix for the v3.1 addendum's map bug — see the file
 * header comment above the layer setup for what was wrong before. Distances
 * are compared in raw lng/lat degrees rather than metres: Dhaka's whole
 * service area is a few hundredths of a degree wide, so the distortion from
 * skipping a proper projection is well under what a route line's width can
 * even show, and it keeps this synchronous and dependency-free for something
 * that reruns on every location tick.
 */
const splitRouteByProgress = (
  route: readonly LngLat[],
  at: LngLat | null,
): { completed: LngLat[]; remaining: LngLat[] } => {
  if (!at || route.length < 2) return { completed: [], remaining: [...route] }

  let bestDist = Infinity
  let bestIndex = 0
  let bestPoint: LngLat = route[0] ?? [0, 0]
  for (let i = 0; i < route.length - 1; i += 1) {
    const a = route[i]
    const b = route[i + 1]
    if (!a || !b) continue
    const point = projectOntoSegment(at, a, b)
    const d = distance2(at, point)
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
      bestPoint = point
    }
  }

  return {
    completed: [...route.slice(0, bestIndex + 1), bestPoint],
    remaining: [bestPoint, ...route.slice(bestIndex + 1)],
  }
}

/** ms to glide between two received positions — just under the 3s cadence. */
const GLIDE_MS = 2_600

interface MarkerState {
  marker: maplibregl.Marker
  from: [number, number]
  to: [number, number]
  startedAt: number
}

const riderElement = (label: string): HTMLElement => {
  const el = document.createElement('div')
  el.className = 'pdms-rider'
  el.innerHTML = `
    <span class="pdms-rider__halo"></span>
    <span class="pdms-rider__dot"></span>
    <span class="pdms-rider__label"></span>
  `
  // textContent, not innerHTML: a rider's name is user data.
  const labelEl = el.querySelector('.pdms-rider__label')
  if (labelEl) labelEl.textContent = label
  return el
}

/**
 * Drop-off is a real pin shape (a rounded teardrop), not a circle — see the
 * v3.1 addendum's bug report: the old `.pdms-pin--drop` was a white-filled
 * circle with an ink ring, which reads as a hollow, disabled-looking marker
 * rather than a placed location. The fill is solid ink with a small white
 * dot at its head, same idea as the pickup dot's white centre.
 */
const DROP_PIN_SVG = `
  <svg viewBox="0 0 22 28" width="22" height="28" xmlns="http://www.w3.org/2000/svg">
    <path class="pdms-pin-body" d="M11 1a9 9 0 0 1 9 9c0 6.4-9 17-9 17S2 16.4 2 10a9 9 0 0 1 9-9z" />
    <circle class="pdms-pin-hole" cx="11" cy="10" r="3.2" />
  </svg>
`

const endpointElement = (kind: 'pickup' | 'drop'): HTMLElement => {
  const el = document.createElement('div')
  if (kind === 'drop') {
    el.className = 'pdms-pin pdms-pin--drop'
    el.innerHTML = DROP_PIN_SVG
    return el
  }
  el.className = 'pdms-pin pdms-pin--pickup'
  return el
}

export const TrackingMap = ({
  riders,
  route,
  pickup,
  drop,
  follow = false,
  className = '',
  animate = true,
}: Props) => {
  const holder = useRef<HTMLDivElement | null>(null)
  const map = useRef<MapLibreMap | null>(null)
  const ready = useRef(false)
  const markers = useRef(new Map<string, MarkerState>())
  const endpoints = useRef<maplibregl.Marker[]>([])
  const raf = useRef<number | null>(null)

  /**
   * Bumped every time a map instance is created.
   *
   * React StrictMode mounts, unmounts and remounts in development, so the
   * first map is built and torn down before the real one. The effects below
   * depend on props that do not change across that remount, so without this
   * they would apply the route and endpoints to the *discarded* map and never
   * to the live one — leaving a map with no route line, no pins and no
   * fitBounds.
   */
  const [mapVersion, setMapVersion] = useState(0)
  const [failed, setFailed] = useState<string | null>(null)

  // ---- create the map ----
  useEffect(() => {
    if (!holder.current || map.current) return

    /**
     * A WebGL-less environment doesn't fail asynchronously through the map's
     * own event system below — MapLibre THROWS synchronously, straight out of
     * the constructor, before there is a map to attach an 'error' listener
     * to. That exception was escaping this effect uncaught, which in React 18
     * unmounts the entire tree on the next commit — not just this component,
     * every screen the map happened to sit on. So this is where "a WebGL-less
     * browser fails silently otherwise" (the comment below, describing the
     * one thing this component exists to prevent) turned out not to be
     * covered: the try/catch is what actually delivers on it.
     */
    let m: maplibregl.Map
    try {
      m = new maplibregl.Map({
        container: holder.current,
        style: STYLE_URL,
        center: DHAKA,
        zoom: 11.5,
        /**
         * OpenFreeMap's licence requires credit, and it renders: the style's
         * TileJSON supplies "OpenFreeMap © OpenMapTiles Data from OpenStreetMap",
         * confirmed in a real browser rather than assumed. An earlier version
         * added the same credits via customAttribution as insurance, which
         * printed them twice — so the control is left to the style.
         */
        attributionControl: { compact: true },
      })
    } catch (err) {
      console.error('[map]', err)
      setFailed(err instanceof Error ? err.message : 'the map failed to load')
      return
    }

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    /**
     * Surface failures instead of leaving a blank rectangle. A bad style URL
     * or a blocked tile host fail silently otherwise — a WebGL-less browser
     * is caught above, before there is a map to listen on.
     */
    m.on('error', (e) => {
      const message = e.error?.message ?? 'the map failed to load'
      // Tile-level errors are transient and not worth blanking the panel for.
      if (/tile|abort/i.test(message)) return
      console.error('[map]', message)
      setFailed(message)
    })

    m.on('load', () => {
      ready.current = true
      /**
       * Cool the tile style before anything is drawn on top of it. positron
       * ships a warm-neutral ground and v3's map area is cool — see
       * lib/mapStyle.ts for why the style is recoloured rather than swapped.
       */
      coolMapStyle(m)
      /**
       * ONE route, split into two layers by how far the rider has actually
       * got — not two independently-sourced lines. See splitRouteByProgress
       * above for why, and the effect below for how the split is computed.
       *
       * Layer order matters: 'remaining' is added first so 'completed' paints
       * on top of it at the cut point, the same way the mock draws one path
       * that changes from solid to dashed partway along.
       */
      m.addSource('pdms-route-remaining', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      })
      m.addSource('pdms-route-completed', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      })
      m.addLayer({
        id: 'pdms-route-remaining-line',
        type: 'line',
        source: 'pdms-route-remaining',
        paint: {
          // What's still ahead of the rider: the accent, dashed and held
          // back, so the completed line below reads as the solid one.
          'line-color': ROUTE_COLOUR,
          'line-width': 3,
          'line-opacity': 0.45,
          'line-dasharray': [2, 8],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      m.addLayer({
        id: 'pdms-route-completed-line',
        type: 'line',
        source: 'pdms-route-completed',
        // What the rider has already covered: solid, full opacity, no dash —
        // this is the layer the v3.1 addendum's bug report was about.
        paint: { 'line-color': ROUTE_COLOUR, 'line-width': 4 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      // Re-run the data effects now that sources exist.
      setMapVersion((v) => v + 1)
    })

    map.current = m
    setMapVersion((v) => v + 1)

    /**
     * MapLibre measures its container once, at construction. This container is
     * `absolute inset-0` inside a grid cell whose height comes from a sibling
     * column, so the first measurement can legitimately be 0 — and a 0x0
     * canvas never recovers on its own, which renders as a blank panel.
     *
     * A ResizeObserver fixes both that and ordinary window resizing, which
     * would otherwise leave the canvas at its original size forever.
     */
    const observer = new ResizeObserver(() => {
      m.resize()
    })
    observer.observe(holder.current)

    return () => {
      observer.disconnect()
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      m.remove()
      map.current = null
      ready.current = false
      markers.current.clear()
      endpoints.current = []
    }
  }, [])

  // ---- endpoints + camera ----
  // Deliberately NOT keyed on `riders`: this is the effect that calls
  // fitBounds, and re-framing the camera every ~3s as a location tick arrives
  // would fight the separate follow/easeTo behaviour below and read as the
  // map yanking itself around. Endpoints and the frame only move when the
  // journey itself changes.
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return

    for (const marker of endpoints.current) marker.remove()
    endpoints.current = []
    if (pickup) {
      endpoints.current.push(
        new maplibregl.Marker({ element: endpointElement('pickup'), anchor: 'center' })
          .setLngLat(pickup.coordinates)
          .addTo(m),
      )
    }
    if (drop) {
      endpoints.current.push(
        // 'bottom': a pin's TIP marks the location, not its centre — unlike
        // the plain pickup dot, which stays anchor:'center'.
        new maplibregl.Marker({ element: endpointElement('drop'), anchor: 'bottom' })
          .setLngLat(drop.coordinates)
          .addTo(m),
      )
    }

    // Frame the whole journey.
    const pts: Array<[number, number]> = [
      ...(route ?? []),
      ...(pickup ? [pickup.coordinates] : []),
      ...(drop ? [drop.coordinates] : []),
    ]
    const first = pts[0]
    if (pts.length >= 2 && first) {
      const bounds = pts.reduce(
        (b, p) => b.extend(p),
        new maplibregl.LngLatBounds(first, first),
      )
      m.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 })
    }
  }, [route, pickup, drop, mapVersion])

  // ---- the route, split into what's behind the rider and what's ahead ----
  // Kept separate from the effect above so a location tick (which changes
  // `riders`) only ever rewrites two GeoJSON sources — cheap, no camera
  // movement — rather than re-running marker teardown and fitBounds too.
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return

    /**
     * The split point is the rider's own position — the same point that
     * places their marker, kept in step automatically as it moves. Only
     * defined for the single-delivery screens (exactly one rider): the fleet
     * board passes many riders and no route at all, so there is nothing to
     * split there.
     */
    const riderPoint: LngLat | null =
      riders.length === 1 && riders[0] ? riders[0].point.coordinates : null
    const { completed, remaining } = splitRouteByProgress(route ?? [], riderPoint)

    const completedSrc = m.getSource('pdms-route-completed') as
      | maplibregl.GeoJSONSource
      | undefined
    completedSrc?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: completed },
    })
    const remainingSrc = m.getSource('pdms-route-remaining') as
      | maplibregl.GeoJSONSource
      | undefined
    remainingSrc?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: remaining },
    })
  }, [route, riders, mapVersion])

  // ---- riders, eased between positions ----
  useEffect(() => {
    const m = map.current
    /**
     * `!ready.current`, not just `!m`. `map.current` is assigned
     * synchronously right after construction — before the map's own 'load'
     * fires, before the endpoints+camera effect has run at all (it correctly
     * waits on `ready.current`). Without this guard, a rider's marker could
     * be inserted into the DOM on the very first mapVersion bump, ahead of
     * pickup/drop — and since z-index only breaks that tie by class now (see
     * app.css), insertion order stopped mattering for THAT, but a marker
     * added before the map is ready is still one MapLibre may reposition
     * incorrectly once the style actually loads. Matching the other two
     * effects' own guard.
     */
    if (!m || !ready.current) return

    const seen = new Set<string>()
    for (const rider of riders) {
      seen.add(rider.id)
      const existing = markers.current.get(rider.id)

      if (!existing) {
        const marker = new maplibregl.Marker({
          element: riderElement(rider.label),
          anchor: 'center',
        })
          .setLngLat(rider.point.coordinates)
          .addTo(m)
        markers.current.set(rider.id, {
          marker,
          from: rider.point.coordinates,
          to: rider.point.coordinates,
          startedAt: performance.now(),
        })
        continue
      }

      const target = rider.point.coordinates
      if (existing.to[0] === target[0] && existing.to[1] === target[1]) continue

      if (animate) {
        // Start from where the marker actually is, so a mid-glide update does
        // not snap backwards to the previous target.
        const current = existing.marker.getLngLat()
        existing.from = [current.lng, current.lat]
        existing.to = target
        existing.startedAt = performance.now()
      } else {
        existing.marker.setLngLat(target)
        existing.from = target
        existing.to = target
      }
    }

    for (const [id, state] of markers.current) {
      if (!seen.has(id)) {
        state.marker.remove()
        markers.current.delete(id)
      }
    }

    if (follow && riders.length === 1 && riders[0]) {
      m.easeTo({ center: riders[0].point.coordinates, duration: GLIDE_MS })
    }
  }, [riders, animate, follow, mapVersion])

  // ---- one animation loop for every marker ----
  useEffect(() => {
    if (!animate) return
    const step = (): void => {
      const now = performance.now()
      for (const state of markers.current.values()) {
        const t = Math.min(1, (now - state.startedAt) / GLIDE_MS)
        if (t >= 1) continue
        // easeOutQuad: quick off the mark, settling into the new position.
        const e = 1 - (1 - t) * (1 - t)
        state.marker.setLngLat([
          state.from[0] + (state.to[0] - state.from[0]) * e,
          state.from[1] + (state.to[1] - state.from[1]) * e,
        ])
      }
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
    }
  }, [animate])

  /**
   * The wrapper must be a containing block for the holder and the failure
   * overlay, but callers pass their own positioning — and `relative absolute`
   * would be two `position` declarations whose winner depends on CSS source
   * order rather than class order. So `relative` is added only when the caller
   * has not positioned it already.
   */
  const positioned = /(^|\s)(absolute|fixed|relative|sticky)(\s|$)/.test(className)

  return (
    <div className={`${positioned ? '' : 'relative'} ${className}`}>
      {/*
        `w-full h-full`, deliberately NOT `absolute inset-0`.

        MapLibre stamps `.maplibregl-map { position: relative }` onto whatever
        element it is given. In a production build Tailwind's utilities happen
        to come after that rule and `absolute` wins — but in dev Vite injects
        maplibre's stylesheet when this module loads, i.e. AFTER the entry CSS,
        so `position: relative` wins instead. `inset-0` then stops stretching
        the box, it collapses to height 0, and the map renders as a blank
        rectangle. Sizing by width/height instead is immune to that ordering.
      */}
      <div ref={holder} className="w-full h-full" />
      {failed ? (
        <div className="absolute inset-0 grid place-items-center p-4 bg-surface-sunk">
          <p
            role="alert"
            className="text-small text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 max-w-[280px] text-center"
          >
            The map could not load. Tracking still works — the details beside it
            are live.
          </p>
        </div>
      ) : null}
    </div>
  )
}
