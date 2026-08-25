import type maplibregl from 'maplibre-gl'

/**
 * Cooling the tile style to sit under v3's palette.
 *
 * v3's map area is #E9ECF1 — a cool grey with blue the highest channel. None of
 * OpenFreeMap's four stock styles is cool: positron's land is rgb(242,243,240)
 * and bright/liberty are #F8F4F0, all warm by a few points, and fiord is a DARK
 * style, which v3 rules out ("the workspace is never dark"). Measured, not
 * eyeballed — the numbers came from each style's own background layer.
 *
 * So positron stays — it is the closest to neutral, it is what CLAUDE.md
 * section 2 names, and it needs no key or quota — and its greys are shifted
 * onto the cool axis here, after the style loads. Recolouring in place rather
 * than forking the style JSON keeps the network story identical: same tiles,
 * same URL, same free tier.
 *
 * The rider and the route line stay saturated. They are the only saturated
 * things on the map, which is exactly why the ground has to be desaturated —
 * a warm ground competing with an ultramarine route is what made the old map
 * read as a stock component dropped into the page.
 */

/** What each kind of positron layer becomes. All from the v3 palette. */
const GROUND = '#e9ecf1'
const LAND = '#eef0f4'
const WATER = '#dbe1ea'
const ROAD = '#ffffff'
const ROAD_CASING = '#e2e6ee'
const BUILDING = '#e0e4ec'
const GREEN = '#e6eae8'
const LABEL = '#6c7280'
const LABEL_HALO = '#ffffff'
const BOUNDARY = '#d6d9e0'

/**
 * Which paint property carries a layer's colour depends on its type, and
 * setting the wrong one throws rather than being ignored.
 */
const COLOUR_PROP: Record<string, string> = {
  background: 'background-color',
  fill: 'fill-color',
  line: 'line-color',
  symbol: 'text-color',
}

const classify = (id: string): string | null => {
  const l = id.toLowerCase()
  if (l.includes('water') || l.includes('river') || l.includes('lake')) return WATER
  if (l.includes('building')) return BUILDING
  if (l.includes('park') || l.includes('wood') || l.includes('grass') || l.includes('forest')) {
    return GREEN
  }
  if (l.includes('boundary') || l.includes('admin')) return BOUNDARY
  if (l.includes('casing') || l.includes('outline')) return ROAD_CASING
  if (l.includes('road') || l.includes('bridge') || l.includes('tunnel') || l.includes('transit')) {
    return ROAD
  }
  if (l.includes('landcover') || l.includes('landuse') || l.includes('sand')) return LAND
  return null
}

/**
 * Apply the cool palette to a loaded map.
 *
 * Wrapped per layer: a style can change shape between tile releases, and a
 * single unexpected layer id must not take the whole map down with it. A
 * missing recolour is a slightly warm road; a thrown error is a blank screen.
 */
export const coolMapStyle = (map: maplibregl.Map): void => {
  let layers: maplibregl.LayerSpecification[]
  try {
    layers = map.getStyle().layers ?? []
  } catch {
    return
  }

  for (const layer of layers) {
    const prop = COLOUR_PROP[layer.type]
    if (!prop) continue

    try {
      if (layer.type === 'background') {
        map.setPaintProperty(layer.id, 'background-color', GROUND)
        continue
      }

      if (layer.type === 'symbol') {
        // Labels keep their position and lose their warmth: --muted on a white
        // halo is the same treatment every other secondary label gets.
        map.setPaintProperty(layer.id, 'text-color', LABEL)
        map.setPaintProperty(layer.id, 'text-halo-color', LABEL_HALO)
        continue
      }

      const next = classify(layer.id)
      if (next) map.setPaintProperty(layer.id, prop, next)
    } catch {
      // This layer keeps the style's own colour. See the note above.
    }
  }
}
