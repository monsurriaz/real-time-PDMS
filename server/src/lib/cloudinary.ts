import { env } from './env'
import { HttpError } from '../middleware/httpError'

/**
 * A URL is only proof — of a delivery, or now of an avatar — if it is OUR
 * photo.
 *
 * Every upload in this project happens unsigned, straight from the browser
 * (CLAUDE.md section 2), so the URL always arrives FROM the client and
 * cannot be trusted on shape alone. The shared `cloudinaryUrl` schema has
 * already checked it names Cloudinary's delivery host; the cloud name is
 * the part only the server knows, and without this check a caller could
 * submit any image already sitting on Cloudinary — including one uploaded
 * months ago from somewhere else, by someone else.
 *
 * Moved here from services/pod.ts (M9.6), which was its only caller until
 * the avatar upload route needed the exact same check — one function, two
 * callers, rather than a second copy that could drift from it.
 */
export const assertOurCloud = (url: string): void => {
  const cloud = env.CLOUDINARY_CLOUD_NAME
  if (!cloud) {
    throw new HttpError(
      503,
      'photo upload is not configured — CLOUDINARY_CLOUD_NAME is missing from .env',
    )
  }
  if (!url.startsWith(`https://res.cloudinary.com/${cloud}/`)) {
    throw new HttpError(422, 'that photo was not uploaded to this project')
  }
}
