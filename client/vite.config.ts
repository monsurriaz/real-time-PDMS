import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig(({ mode }) => {
  /**
   * The repo keeps one .env at the root, shared with the server, so point
   * Vite there instead of expecting a second copy inside /client.
   */
  const rootEnvDir = path.resolve(here, '..')
  const env = loadEnv(mode, rootEnvDir, 'VITE_')

  return {
    envDir: rootEnvDir,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        /**
         * /shared is consumed as TypeScript source rather than a build
         * artifact — there is no compile step between editing a Zod schema
         * and both sides seeing it.
         */
        '@pdms/shared': path.resolve(here, '../shared/index.ts'),
        '@': path.resolve(here, 'src'),
      },
    },
    server: {
      port: 5173,
      /**
       * Proxying /api keeps the browser same-origin in development, so the
       * auth cookie needs no CORS or SameSite special-casing locally.
       */
      proxy: {
        '/api': {
          target: env.VITE_API_BASE_URL ?? 'http://localhost:5001',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ''),
        },
      },
    },
  }
})
