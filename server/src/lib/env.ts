import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { z } from 'zod'

/**
 * One .env at the repo root serves client and server both, so resolve it
 * relative to this file rather than to process.cwd() — otherwise `npm run
 * dev` from the root and `tsx` from /server would read different files.
 */
const here = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(here, '../../../.env') })

/**
 * Env is validated at boot, not at first use. A missing JWT_SECRET should
 * refuse to start the process, not surface as a 500 on the first login three
 * hours into the demo.
 *
 * Only M1's keys are required. Cloudinary and Stripe arrive in M5, so they
 * stay optional — this must boot on a machine that has never seen them.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  /**
   * 5001 rather than the conventional 5000: on macOS, AirPlay Receiver
   * (ControlCenter) already listens on 5000, so a default of 5000 fails with
   * EADDRINUSE on a stock Mac — and answers proxied requests with a
   * confusing 403 before it does.
   */
  PORT: z.coerce.number().int().positive().default(5001),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),

  MONGODB_URI: z
    .string()
    .min(1, 'MONGODB_URI is required — copy .env.example to .env and fill it in'),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 chars — generate with: openssl rand -base64 48'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // ---- not required until later milestones ----
  NOMINATIM_BASE_URL: z.string().url().optional(),
  NOMINATIM_USER_AGENT: z.string().optional(),
  ORS_API_KEY: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const lines = parsed.error.issues.map(
    (i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`,
  )
  // Fail loudly and readably. This is the first thing a teammate sees when
  // their .env is wrong, so it should say exactly which key and why.
  console.error(`\nInvalid environment:\n${lines.join('\n')}\n`)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env

export const isProd = env.NODE_ENV === 'production'
