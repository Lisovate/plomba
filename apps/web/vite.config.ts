import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** The API server during development (see apps/server). */
const apiTarget = process.env.PLOMBA_API ?? 'http://127.0.0.1:8787';

// Phones only allow the camera on secure origins, so `HTTPS=1 npm run dev:web`
// serves a self-signed certificate for testing on a phone over the LAN.
const https = process.env.HTTPS === '1';

export default defineConfig({
  plugins: [
    react(),
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.svg'],
      manifest: {
        id: '/',
        name: 'Plomba: container handover inspection',
        short_name: 'Plomba',
        description: "A digital seal on a shipping container's condition at every handover.",
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b1d33',
        theme_color: '#0b1d33',
        categories: ['business', 'productivity', 'utilities'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/media\//],
        runtimeCaching: [
          {
            // Let video range requests reach the server, even if a full clip was cached.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/media/') && !request.headers.has('range'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'media',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
          {
            // Inspection data must be current.
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    host: true,
    proxy: {
      '/api': apiTarget,
      '/media': apiTarget,
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
