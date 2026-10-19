import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Read PORT from .env too, so the proxy follows the API server's port.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      vue(),
      VitePWA({
        // Let updates wait until all app windows close; never reload a live monitor.
        registerType: 'prompt',
        injectRegister: 'script',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'Baby Monitor',
          short_name: 'Baby Monitor',
          description: 'Live camera streams and nursery sensor readings.',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#1c1a16',
          theme_color: '#1c1a16',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,woff2,png,ico}'],
          // Cache only the app shell. API responses and streams must stay live.
          navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/assets\//],
          cleanupOutdatedCaches: true,
          skipWaiting: false,
          clientsClaim: false,
        },
      }),
    ],
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
