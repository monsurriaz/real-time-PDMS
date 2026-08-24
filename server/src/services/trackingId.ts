import { randomInt } from 'node:crypto'
import { trackingId as trackingIdSchema } from '@pdms/shared'
import { runAsSystem } from '../lib/context'
import { ParcelModel } from '../models/Parcel'

/**
 * Tracking IDs in the PD-XXXX-XX format from CLAUDE.md section 9.
 *
 * The alphabet omits O, 0, I and 1: these get read aloud over the phone and
 * copied off a printed label, and those four are the pairs people confuse.
 * That leaves 32^6 combinations, so collisions are rare — but "rare" is not
 * "never" at demo scale, so uniqueness is confirmed against the database
 * rather than assumed.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const block = (n: number): string =>
  Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')

const candidate = (): string => `PD-${block(4)}-${block(2)}`

export const generateTrackingId = async (): Promise<string> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = candidate()
    // Parse defensively: if the alphabet or format ever drifts from the shared
    // schema, fail here rather than writing an ID the schema will reject.
    trackingIdSchema.parse(id)

    const taken = await runAsSystem('trackingId: uniqueness', async () =>
      ParcelModel.exists({ trackingId: id }).exec(),
    )
    if (!taken) return id
  }
  throw new Error('could not generate a unique tracking ID after 8 attempts')
}
