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
    build: { sourcemap: false, target: 'es2020' },
});
