import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Read PORT from .env too, so the proxy follows the API server's port.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      },
    },
    server: {
      // Listen on the LAN so phones and tablets can reach the dev server.
      host: true,
      proxy: {
        '/api': `http://localhost:${env.PORT || 3000}`,
      },
    },
  }
})
