var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var TOM_API_BASE = env.TOM_API_BASE || '';
    var TOM_INTERNAL_SECRET = env.TOM_INTERNAL_SECRET || '';
    // Custom plugin: middleware que emula a serverless function /api/lareport/* localmente.
    // Em vez de usar proxy config do vite (que não tava interceptando), faço HTTP request
    // direto pra TOM e devolvo a resposta. Equivalente ao web/api/lareport/[...path].ts.
    // Debug trace: confirma se a callback do defineConfig roda
    try {
        require('fs').writeFileSync('/tmp/vite-cfg-trace.log', "".concat(new Date().toISOString(), " mode=").concat(mode, " TOM_API_BASE=").concat(TOM_API_BASE ? 'SET' : 'EMPTY', " SECRET=").concat(TOM_INTERNAL_SECRET ? 'SET' : 'EMPTY', "\n"), { flag: 'a' });
    }
    catch (e) { /* ignore */ }
    // Lê body completo do request (POST/PUT/etc) — Node streams.
    var readBody = function (req) { return new Promise(function (resolve, reject) {
        var chunks = [];
        req.on('data', function (c) { return chunks.push(c); });
        req.on('end', function () { return resolve(Buffer.concat(chunks)); });
        req.on('error', reject);
    }); };
    var proxyHandler = function (req, res, next) { return __awaiter(void 0, void 0, void 0, function () {
        var sub, url, method, fetchInit, body, upstream, text, e_1, msg;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!req.url || !req.url.startsWith('/api/lareport'))
                        return [2 /*return*/, next()];
                    sub = req.url.replace(/^\/api\/lareport\/?/, '');
                    url = "".concat(TOM_API_BASE, "/internal/lareport/").concat(sub);
                    method = req.method || 'GET';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    fetchInit = {
                        method: method,
                        headers: __assign({ 'x-internal-secret': TOM_INTERNAL_SECRET }, (req.headers['content-type'] ? { 'Content-Type': String(req.headers['content-type']) } : {})),
                    };
                    if (!(method !== 'GET' && method !== 'HEAD')) return [3 /*break*/, 3];
                    return [4 /*yield*/, readBody(req)];
                case 2:
                    body = _a.sent();
                    if (body.length)
                        fetchInit.body = body.toString('utf8');
                    _a.label = 3;
                case 3: return [4 /*yield*/, fetch(url, fetchInit)];
                case 4:
                    upstream = _a.sent();
                    return [4 /*yield*/, upstream.text()];
                case 5:
                    text = _a.sent();
                    res.statusCode = upstream.status;
                    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
                    res.end(text);
                    return [3 /*break*/, 7];
                case 6:
                    e_1 = _a.sent();
                    msg = e_1 instanceof Error ? e_1.message : String(e_1);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: false, error: 'upstream_failed', detail: msg }));
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    }); };
    // Proxy local de /internal/* → VPS (dev + preview). Em produção quem faz isso é o
    // rewrite do vercel.json. Encaminha o x-internal-secret que o PWA já manda (fallback no env).
    var internalProxyHandler = function (req, res, next) { return __awaiter(void 0, void 0, void 0, function () {
        var url, method, secret, fetchInit, body, upstream, text, e_2, msg;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    if (!req.url || !req.url.startsWith('/internal/'))
                        return [2 /*return*/, next()];
                    url = "".concat(TOM_API_BASE).concat(req.url);
                    method = req.method || 'GET';
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 6, , 7]);
                    secret = String(req.headers['x-internal-secret'] || TOM_INTERNAL_SECRET);
                    fetchInit = {
                        method: method,
                        headers: __assign({ 'x-internal-secret': secret }, (req.headers['content-type'] ? { 'Content-Type': String(req.headers['content-type']) } : {})),
                    };
                    if (!(method !== 'GET' && method !== 'HEAD')) return [3 /*break*/, 3];
                    return [4 /*yield*/, readBody(req)];
                case 2:
                    body = _a.sent();
                    if (body.length)
                        fetchInit.body = body.toString('utf8');
                    _a.label = 3;
                case 3: return [4 /*yield*/, fetch(url, fetchInit)];
                case 4:
                    upstream = _a.sent();
                    return [4 /*yield*/, upstream.text()];
                case 5:
                    text = _a.sent();
                    res.statusCode = upstream.status;
                    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
                    res.end(text);
                    return [3 /*break*/, 7];
                case 6:
                    e_2 = _a.sent();
                    msg = e_2 instanceof Error ? e_2.message : String(e_2);
                    res.statusCode = 502;
                    res.setHeader('Content-Type', 'application/json');
                    res.end(JSON.stringify({ ok: false, error: 'upstream_failed', detail: msg }));
                    return [3 /*break*/, 7];
                case 7: return [2 /*return*/];
            }
        });
    }); };
    var lareportProxyPlugin = function () { return ({
        name: 'lareport-local-proxy',
        configureServer: function (server) {
            if (TOM_API_BASE)
                server.middlewares.use(internalProxyHandler);
            if (!TOM_API_BASE || !TOM_INTERNAL_SECRET)
                return;
            server.middlewares.use(proxyHandler);
        },
        configurePreviewServer: function (server) {
            if (TOM_API_BASE)
                server.middlewares.use(internalProxyHandler);
            if (!TOM_API_BASE || !TOM_INTERNAL_SECRET)
                return;
            server.middlewares.use(proxyHandler);
        },
    }); };
    return {
        plugins: [
            react(),
            lareportProxyPlugin(),
            VitePWA({
                registerType: 'autoUpdate',
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
        preview: {
            port: 4173,
            host: true,
            allowedHosts: ['.vercel.app', 'localhost'],
        },
        build: { sourcemap: false, target: 'es2020' },
    };
});
