import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'LA Organizer',
        short_name: 'LA Organizer',
        description: 'PWA operacional do TOM — LA Music School',
        theme_color: '#0A0A0A',
        background_color: '#0A0A0A',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Sprint 11.2 hotfix — força novo SW a ativar imediatamente sem aguardar
        // todas as abas fecharem. Casado com PWAUpdatePrompt que avisa o user e
        // chama updateServiceWorker(true) pra recarregar com bundle novo.
        // Sem isso, o user fica em bundle ANTIGO mesmo após `autoUpdate` instalar.
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gfonts',
              expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5173, host: true },
  // `vite preview` blocks unknown hosts by default. Whitelist:
  //  - `.vercel.app` for production deploys (la-organizer.vercel.app + previews)
  //  - `localhost` for local preview / IDE workflows
  // Cloudflare quick tunnel (`.trycloudflare.com`) usado nas Sprints 2–6 foi
  // descontinuado quando a Vercel virou hosting oficial (Sprint 6 hot-fix +
  // produção em 28/04/2026).
  preview: {
    port: 4173,
    host: true,
    allowedHosts: ['.vercel.app', 'localhost'],
  },
  build: { sourcemap: false, target: 'es2020' },
});
