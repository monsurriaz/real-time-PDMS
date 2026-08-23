import mongoose from 'mongoose'
import { env } from './env'

/**
 * Atlas free tier: keep the pool small. The default of 100 sockets is far
 * more than an M0 cluster wants, and CLAUDE.md section 6 is explicit that the
 * free tier is a real constraint.
 */
/**
 * Atlas refuses the TLS handshake outright when the caller's IP is not in the
 * project's access list, which surfaces as an opaque OpenSSL alert rather
 * than anything mentioning permissions. Translating it here saves the next
 * person half an hour of chasing a certificate problem that isn't one.
 */
/**
 * Mongoose reports a connection failure as ReplicaSetNoPrimary and buries the
 * real cause in per-server descriptions, so the useful text is never on the
 * top-level message. Collect everything before matching.
 */
const errorText = (err: unknown): string => {
  const parts: string[] = []
  if (err instanceof Error) parts.push(err.message)

  const reason = (err as { reason?: { servers?: Map<string, { error?: Error }> } })
    .reason
  const servers = reason?.servers
  if (servers instanceof Map) {
    for (const desc of servers.values()) {
      if (desc.error?.message) parts.push(desc.error.message)
    }
  }
  return parts.join(' | ')
}

const explain = (err: unknown): string | null => {
  const text = errorText(err)

  if (text.includes('SSL alert number 80') || text.includes('tlsv1 alert internal error')) {
    return [
      'Atlas rejected the TLS handshake. This is almost always the IP access list,',
      'not a bad password — the handshake is refused before credentials are read.',
      '',
      '  Fix: Atlas -> Network Access -> Add IP Address -> add this machine.',
      '  Check your current IP with: curl https://api.ipify.org',
    ].join('\n')
  }

  if (text.includes('bad auth') || text.includes('Authentication failed')) {
    return [
      'Atlas rejected the credentials in MONGODB_URI.',
      '',
      '  If the password was recently rotated, update .env to match.',
      '  Special characters in a password must be percent-encoded.',
    ].join('\n')
  }

  if (text.includes('ENOTFOUND') || text.includes('querySrv')) {
    return 'Could not resolve the cluster hostname — check MONGODB_URI, and that you are online.'
  }

  return null
}

export const connectDb = async (): Promise<void> => {
  mongoose.set('strictQuery', true)

  try {
    await mongoose.connect(env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10_000,
    })
  } catch (err) {
    const hint = explain(err)
    if (hint) {
      console.error(`\n[db] cannot connect.\n\n${hint}\n`)
      // The stack trace adds nothing once the cause is named.
      process.exit(1)
    }
    throw err
  }

  /**
   * Indexes are declared on the schemas; this makes sure they actually exist.
   * The 2dsphere indexes are load-bearing for assignment, and a missing one
   * fails as a confusing query error rather than an obvious startup error.
   */
  await Promise.all(mongoose.modelNames().map((n) => mongoose.model(n).syncIndexes()))
}

export const disconnectDb = async (): Promise<void> => {
  await mongoose.disconnect()
}
