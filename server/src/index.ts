import { createApp } from './app'
import { connectDb, disconnectDb } from './lib/db'
import { env } from './lib/env'
import { createSocketServer } from './sockets'

const main = async (): Promise<void> => {
  await connectDb()
  console.log('[db] connected')

  const app = createApp()
  const server = app.listen(env.PORT, () => {
    console.log(`[server] http://localhost:${env.PORT}  (${env.NODE_ENV})`)
    console.log(`[server] cors origin: ${env.CLIENT_ORIGIN}`)
  })

  // Shares the HTTP server, so one port serves REST and websockets both.
  const io = createSocketServer(server)
  io.on('connection', (socket) => {
    console.log(`[socket] connected ${socket.id}`)
    socket.on('disconnect', (reason) => {
      console.log(`[socket] disconnected ${socket.id} (${reason})`)
    })
  })
  console.log('[socket] listening on the same port')

  /**
   * Render sends SIGTERM on redeploy. Closing the HTTP server before the
   * database avoids in-flight requests failing against a dead connection.
   */
  const shutdown = (signal: string): void => {
    console.log(`\n[server] ${signal} — shutting down`)
    server.close(() => {
      void disconnectDb().then(() => process.exit(0))
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  console.error('[server] failed to start:', err)
  process.exit(1)
})
