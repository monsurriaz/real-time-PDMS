import { RETRYABLE, type LookupFailure } from '@pdms/shared'

/**
 * A geocode or routing failure the booking form can act on.
 *
 * Deliberately not an HttpError: the lib layer should not know about status
 * codes. The route maps `reason` to a status, which keeps the mapping in one
 * readable place instead of scattered through the providers.
 */
export class LookupError extends Error {
  readonly reason: LookupFailure
  /** Which address failed, when the caller submitted two. */
  readonly field?: 'pickup' | 'drop'

  constructor(reason: LookupFailure, message: string, field?: 'pickup' | 'drop') {
    super(message)
    this.name = 'LookupError'
    this.reason = reason
    this.field = field
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.reason)
  }
}

/** 422 for "your input is wrong", 503 for "we are having trouble". */
export const statusForLookup = (reason: LookupFailure): number => {
  switch (reason) {
    case 'address_not_found':
    case 'outside_service_area':
    case 'no_route':
      return 422
    case 'provider_rejected':
    case 'provider_unavailable':
      return 503
  }
}
