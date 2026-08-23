import { z } from 'zod'
import { objectId, taka, timestamps, zoneName } from './common'

/**
 * A delivery zone. `centre` drives the map's initial viewport and the
 * zone-only assignment fallback in CLAUDE.md section 5; `baseFare` is the
 * zoneBase term of the pricing formula.
 */
export const zoneSchema = z.object({
  _id: objectId,
  name: zoneName,
  /** Human-facing label, e.g. "Dhanmondi, Dhaka". */
  label: z.string().min(2).max(120),
  centre: z.object({
    type: z.literal('Point'),
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  }),
  baseFare: taka,
  isServiceable: z.boolean().default(true),
  ...timestamps,
})
export type Zone = z.infer<typeof zoneSchema>
