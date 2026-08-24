import { useEffect, useRef, useState } from 'react'
import maplibregl, { type LngLatLike, type Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { GeoPoint } from '@pdms/shared'

/**
 * The tracking map. MapLibre GL JS over OpenFreeMap's positron style (CLAUDE.md
 * section 2) — no key, no quota.
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
  trail?: GeoPoint[]
  follow?: boolean
  className?: string
  animate?: boolean
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

const endpointElement = (kind: 'pickup' | 'drop'): HTMLElement => {
  const el = document.createElement('div')
  el.className = `pdms-pin pdms-pin--${kind}`
  return el
}

export const TrackingMap = ({
  riders,
  route,
  pickup,
  drop,
  trail,
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

    const m = new maplibregl.Map({
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

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')

    /**
     * Surface failures instead of leaving a blank rectangle. A bad style URL, a
     * blocked tile host or a WebGL-less browser all fail silently otherwise,
     * which is exactly the state this component was found in.
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
      m.addSource('pdms-route', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      })
      m.addSource('pdms-trail', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      })
      m.addLayer({
        id: 'pdms-route-line',
        type: 'line',
        source: 'pdms-route',
        paint: {
          'line-color': '#EA4E1B',
          'line-width': 3,
          'line-opacity': 0.35,
          'line-dasharray': [2, 2.5],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      m.addLayer({
        id: 'pdms-trail-line',
        type: 'line',
        source: 'pdms-trail',
        paint: { 'line-color': '#EA4E1B', 'line-width': 4 },
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

  // ---- route + endpoints ----
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current) return

    const src = m.getSource('pdms-route') as maplibregl.GeoJSONSource | undefined
    if (src) {
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: route ?? [] },
      })
    }

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
        new maplibregl.Marker({ element: endpointElement('drop'), anchor: 'center' })
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

  // ---- the travelled trail ----
  useEffect(() => {
    const m = map.current
    if (!m || !ready.current || !trail || trail.length < 2) return
    const src = m.getSource('pdms-trail') as maplibregl.GeoJSONSource | undefined
    src?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: trail.map((p) => p.coordinates) },
    })
  }, [trail, mapVersion])

  // ---- riders, eased between positions ----
  useEffect(() => {
    const m = map.current
    if (!m) return

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
            className="text-[12.5px] text-failed-ink bg-failed-bg border border-failed/25 rounded-sm px-3 py-2 max-w-[280px] text-center"
          >
            The map could not load. Tracking still works — the details beside it
            are live.
          </p>
        </div>
      ) : null}
    </div>
  )
}
