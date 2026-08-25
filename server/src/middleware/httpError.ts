import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { isProd } from '../lib/env'
import { LookupError, statusForLookup } from '../lib/lookupError'

/** An error whose status and message are safe to show a client. */
export class HttpError extends Error {
  readonly status: number
  readonly details?: unknown
  /**
   * A machine-readable tag for the cases where the UI must do something
   * specific rather than just print the message — the same job `reason` does
   * on a LookupError below. Optional, because most errors are only ever read
   * by a person.
   */
  readonly reason?: string

  constructor(status: number, message: string, details?: unknown, reason?: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.details = details
    this.reason = reason
  }
}

export const badRequest = (message: string, details?: unknown): HttpError =>
  new HttpError(400, message, details)
export const unauthorized = (message = 'authentication required'): HttpError =>
  new HttpError(401, message)
export const forbidden = (message = 'not allowed'): HttpError =>
  new HttpError(403, message)
export const notFound = (message = 'not found'): HttpError =>
  new HttpError(404, message)
export const conflict = (message: string): HttpError =>
  new HttpError(409, message)

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({ error: `no route for ${req.method} ${req.path}` })
}

/**
 * One error shape for the whole API: `{ error, details? }`. The client's
 * fetch wrapper relies on that being consistent, and consistency here is why
 * error states are cheap to build in the UI.
 */
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error middleware by arity, so `next` must stay even
  // though it is unused.
  _next: NextFunction,
): void => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'validation failed',
      details: err.issues.map((i) => ({
        path: i.path.join('.'),
        message: i.message,
      })),
    })
    return
  }

  /**
   * Geocoding and routing failures carry a machine-readable reason and, when
   * two addresses were submitted, which one failed. The booking form needs
   * both to point at the right field and to decide whether to offer a retry —
   * so they are passed through rather than flattened into a generic 4xx.
   */
  if (err instanceof LookupError) {
    res.status(statusForLookup(err.reason)).json({
      error: err.message,
      reason: err.reason,
      retryable: err.retryable,
      ...(err.field ? { field: err.field } : {}),
    })
    return
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      ...(err.details === undefined ? {} : { details: err.details }),
      ...(err.reason === undefined ? {} : { reason: err.reason }),
    })
    return
  }

  // Anything unrecognised is a bug. Log it in full, tell the client nothing.
  console.error('[unhandled]', err)
  res.status(500).json({
    error: isProd ? 'internal server error' : String(err),
  })
}
