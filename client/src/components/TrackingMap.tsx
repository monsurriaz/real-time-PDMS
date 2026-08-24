import { useEffect, useRef } from 'react'
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
 * restyled — the markers simply carry the accent.
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
  /** Riders to draw. One for the customer screen, many for the admin board. */
  riders: MapRider[]
  /** Road line from pickup to drop, as [lng, lat] pairs. */
  route?: Array<[number, number]>
  pickup?: GeoPoint | null
  drop?: GeoPoint | null
  /** The travelled trail, from the socket history. */
  trail?: GeoPoint[]
  /** Follow the single rider as it moves. Off for the fleet board. */
  follow?: boolean
  className?: string
  /**
   * Smoothly interpolate markers between updates. A marker that jumps every
   * three seconds looks broken; this eases it along instead.
   */
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
  // A halo plus a solid dot, matching the reference's rider marker.
  el.innerHTML = `
    <span class="pdms-rider__halo"></span>
    <span class="pdms-rider__dot"></span>
    <span class="pdms-rider__label">${label.replace(/[<>&]/g, '')}</span>
  `
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

  // ---- create the map once ----
  useEffect(() => {
    if (!holder.current || map.current) return

    const m = new maplibregl.Map({
      container: holder.current,
      style: STYLE_URL,
      center: DHAKA,
      zoom: 11.5,
      /**
       * Default control off, replaced below by one with explicit attribution.
       *
       * OpenFreeMap's licence requires credit, and the positron style declares
       * none inline — it points at a TileJSON that is meant to supply it. That
       * makes rendering depend on an upstream field this app cannot verify or
       * control, so the credit is stated here outright instead. Anything the
       * style does provide is still merged in and shown alongside.
       */
      attributionControl: false,
    })
    m.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution: [
          '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a>',
          '<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a>',
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
        ],
      }),
      'bottom-right',
    )
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
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
      // Planned route: dashed, so it reads as "not yet travelled".
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
      // Travelled trail: solid.
      m.addLayer({
        id: 'pdms-trail-line',
        type: 'line',
        source: 'pdms-trail',
        paint: { 'line-color': '#EA4E1B', 'line-width': 4 },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
    })

    map.current = m
    return () => {
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
    if (!m) return

    const apply = (): void => {
      const src = m.getSource('pdms-route') as maplibregl.GeoJSONSource | undefined
      if (src && route) {
        src.setData({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: route },
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

      // Frame the whole journey on first paint.
      const pts: Array<[number, number]> = [
        ...(route ?? []),
        ...(pickup ? [pickup.coordinates] : []),
        ...(drop ? [drop.coordinates] : []),
      ]
      if (pts.length >= 2) {
        const bounds = pts.reduce(
          (b, p) => b.extend(p),
          new maplibregl.LngLatBounds(pts[0], pts[0]),
        )
        m.fitBounds(bounds, { padding: 56, maxZoom: 14, duration: 0 })
      }
    }

    if (ready.current) apply()
    else m.once('load', apply)
  }, [route, pickup, drop])

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
  }, [trail])

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
        // Start the glide from wherever the marker currently is, not from the
        // previous target — otherwise a mid-glide update snaps backwards.
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

    // Drop markers for riders no longer present.
    for (const [id, state] of markers.current) {
      if (!seen.has(id)) {
        state.marker.remove()
        markers.current.delete(id)
      }
    }

    if (follow && riders.length === 1 && riders[0]) {
      m.easeTo({ center: riders[0].point.coordinates, duration: GLIDE_MS })
    }
  }, [riders, animate, follow])

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

  return <div ref={holder} className={className} />
}
