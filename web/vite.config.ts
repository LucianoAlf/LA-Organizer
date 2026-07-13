import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';
import type { IncomingMessage, ServerResponse } from 'http';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const TOM_API_BASE = env.TOM_API_BASE || '';
  const TOM_INTERNAL_SECRET = env.TOM_INTERNAL_SECRET || '';

  // Selo de versão (build stamp): injeta versão + short SHA + timestamp no bundle
  // via `define` (substituição literal em build-time), pra dar pra bater o olho em
  // Configurações e saber em que build o usuário está ("novo ou velho?").
  //  - versão: npm_package_version (o build SEMPRE roda via `npm run build`)
  //  - SHA:    VERCEL_GIT_COMMIT_SHA em produção (Vercel injeta); local = 'dev'
  //  - build:  timestamp do momento do build (muda o hash do chunk a cada deploy — é o ponto)
  const __pkgVersion = process.env.npm_package_version || '0.0.0';
  const __buildSha = (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev';
  const __buildTime = new Date().toISOString();

  // Custom plugin: middleware que emula a serverless function /api/lareport/* localmente.
  // Em vez de usar proxy config do vite (que não tava interceptando), faço HTTP request
  // direto pra TOM e devolvo a resposta. Equivalente ao web/api/lareport/[...path].ts.
  // Debug trace: confirma se a callback do defineConfig roda
  try {
    require('fs').writeFileSync('/tmp/vite-cfg-trace.log',
      `${new Date().toISOString()} mode=${mode} TOM_API_BASE=${TOM_API_BASE ? 'SET' : 'EMPTY'} SECRET=${TOM_INTERNAL_SECRET ? 'SET' : 'EMPTY'}\n`,
      { flag: 'a' });
  } catch (e) { /* ignore */ }
  // Lê body completo do request (POST/PUT/etc) — Node streams.
  const readBody = (req: IncomingMessage): Promise<Buffer> => new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

  const proxyHandler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/api/lareport')) return next();
    const sub = req.url.replace(/^\/api\/lareport\/?/, '');
    const url = `${TOM_API_BASE}/internal/lareport/${sub}`;
    const method = req.method || 'GET';
    try {
      const fetchInit: RequestInit = {
        method,
        headers: {
          'x-internal-secret': TOM_INTERNAL_SECRET,
          ...(req.headers['content-type'] ? { 'Content-Type': String(req.headers['content-type']) } : {}),
        },
      };
      // Repassa body em POST/PUT/PATCH/DELETE como string UTF-8.
      if (method !== 'GET' && method !== 'HEAD') {
        const body = await readBody(req);
        if (body.length) fetchInit.body = body.toString('utf8');
      }
      const upstream = await fetch(url, fetchInit);
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.end(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'upstream_failed', detail: msg }));
    }
  };

  // Proxy local de /internal/* → VPS (dev + preview). Em produção quem faz isso é o
  // rewrite do vercel.json. Encaminha o x-internal-secret que o PWA já manda (fallback no env).
  const internalProxyHandler = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url || !req.url.startsWith('/internal/')) return next();
    const url = `${TOM_API_BASE}${req.url}`;
    const method = req.method || 'GET';
    try {
      const secret = String(req.headers['x-internal-secret'] || TOM_INTERNAL_SECRET);
      const fetchInit: RequestInit = {
        method,
        headers: {
          'x-internal-secret': secret,
          ...(req.headers['content-type'] ? { 'Content-Type': String(req.headers['content-type']) } : {}),
        },
      };
      if (method !== 'GET' && method !== 'HEAD') {
        const body = await readBody(req);
        if (body.length) fetchInit.body = body.toString('utf8');
      }
      const upstream = await fetch(url, fetchInit);
      const text = await upstream.text();
      res.statusCode = upstream.status;
      res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
      res.end(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: 'upstream_failed', detail: msg }));
    }
  };

  const lareportProxyPlugin = () => ({
    name: 'lareport-local-proxy',
    configureServer(server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      if (TOM_API_BASE) server.middlewares.use(internalProxyHandler);
      if (!TOM_API_BASE || !TOM_INTERNAL_SECRET) return;
      server.middlewares.use(proxyHandler);
    },
    configurePreviewServer(server: { middlewares: { use: (handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      if (TOM_API_BASE) server.middlewares.use(internalProxyHandler);
      if (!TOM_API_BASE || !TOM_INTERNAL_SECRET) return;
      server.middlewares.use(proxyHandler);
    },
  });

  return {
    plugins: [
      react(),
      lareportProxyPlugin(),
      VitePWA({
        // 'prompt' (não 'autoUpdate'): o PWAUpdatePrompt escuta onNeedRefresh e mostra
        // "Nova versão — Atualizar agora". Com 'autoUpdate' o onNeedRefresh NUNCA dispara
        // (SW-STALE-AUTOUPDATE-VS-PROMPT, 07/07: prompt existia mas config contradizia).
        registerType: 'prompt',
        includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'og-image.png'],
        manifest: {
          name: 'LA Organizer',
          short_name: 'LA Organizer',
          description: 'Seu assistente operacional',
          theme_color: '#0A0A0A',
          background_color: '#0A0A0A',
          display: 'standalone',
          orientation: 'portrait',
          id: '/',
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
          // skipWaiting FALSE p/ o modo 'prompt': o SW novo fica em "waiting" (dispara
          // onNeedRefresh → o prompt aparece). O clique em "Atualizar agora" chama
          // updateServiceWorker(true) que faz o skipWaiting sob demanda + reload.
          skipWaiting: false,
          clientsClaim: true,
          // DOCUMENTO SEMPRE FRESCO (mata o "corrige e não muda"): a navegação vai NetworkFirst —
          // um reload/reabrir busca o HTML novo → puxa os bundles novos SOZINHO, sem esperar o clique
          // no banner. Pra isso o index.html NÃO entra no precache (senão o precache serviria '/'
          // cache-first) e o navigateFallback (nav-route cache-first do precache) fica desligado.
          // Offline: cai no cache do último load (html-shell). O banner (skipWaiting sob demanda)
          // segue existindo pra atualizar NO MEIO da sessão sem perder estado.
          navigateFallback: '',
          globIgnores: ['**/index.html'],
          runtimeCaching: [
            {
              // Navegação (document) → NetworkFirst com fallback offline no cache.
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-shell',
                networkTimeoutSeconds: 3,
                expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
                cacheableResponse: { statuses: [200] },
              },
            },
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
    define: {
      __APP_VERSION__: JSON.stringify(__pkgVersion),
      __BUILD_SHA__: JSON.stringify(__buildSha),
      __BUILD_TIME__: JSON.stringify(__buildTime),
    },
    server: { port: 5173, host: true },
    preview: {
      port: 4173,
      host: true,
      allowedHosts: ['.vercel.app', 'localhost'],
    },
    build: { sourcemap: false, target: 'es2020' },
  };
});
