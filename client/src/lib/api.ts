import { ACCOUNT_SUSPENDED } from '@pdms/shared'

/**
 * The one place that talks to the server.
 *
 * In development everything goes through Vite's /api proxy, which keeps the
 * browser same-origin so the httpOnly auth cookie needs no CORS or SameSite
 * special-casing. Deployed, client and server are on different hosts (Vercel
 * and Render), so requests must name the API's origin outright — which is
 * also why COOKIE_SECURE flips the cookie to SameSite=None there.
 */
/**
 * Optional chaining because `import.meta.env` exists only under Vite. Without
 * it, importing this module from a plain Node process — a routing test, a
 * script — throws before anything runs. Vite still substitutes the values
 * statically, so the production build is unaffected.
 */
const BASE = import.meta.env?.PROD
  ? (import.meta.env?.VITE_API_BASE_URL ?? '')
  : '/api'

/** Mirrors the server's single error shape from middleware/httpError.ts. */
export interface ApiErrorBody {
  error: string
  details?: Array<{ path: string; message: string }> | unknown
}

export class ApiError extends Error {
  readonly status: number
  readonly details?: ApiErrorBody['details']
  /**
   * The whole parsed body. Some errors carry fields beyond `error` and
   * `details` — a geocoding failure adds `reason`, `field` and `retryable` so
   * the booking form can point at the offending address — and flattening
   * those away would force the UI to re-guess what went wrong.
   */
  readonly body: unknown

  constructor(
    status: number,
    message: string,
    details?: ApiErrorBody['details'],
    body?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
    this.body = body
  }

  /** True when the server says we are not logged in. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }

  /**
   * True when the server refused because the ACCOUNT is suspended, rather
   * than because of anything about this particular request.
   *
   * Read from the body's machine-readable `reason` rather than by matching the
   * message, and distinguished from a plain 403 because the two need opposite
   * responses: a role failure means "you are on the wrong screen", and this
   * means "nothing you do will work until an admin reinstates you".
   */
  get isSuspended(): boolean {
    return (
      this.status === 403 &&
      (this.body as { reason?: string } | undefined)?.reason === ACCOUNT_SUSPENDED
    )
  }
}

const request = async <T>(
  path: string,
  init?: RequestInit,
): Promise<T> => {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      // Without this the auth cookie is neither sent nor stored.
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })
  } catch {
    // fetch only rejects on network failure, which is worth distinguishing
    // from a 500 — the UI can suggest "check your connection".
    throw new ApiError(0, 'cannot reach the server')
  }

  if (res.status === 204) return undefined as T

  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : {}

  if (!res.ok) {
    const err = body as ApiErrorBody
    throw new ApiError(res.status, err.error ?? res.statusText, err.details, body)
  }

  return body as T
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  put: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'PUT',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    request<T>(path, {
      method: 'PATCH',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
}
