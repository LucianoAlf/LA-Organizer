// src/services/audio.js — audio transcription pipeline
//
// Tries to transcribe an inbound WhatsApp audio message via OpenAI Whisper
// (requires OPENAI_API_KEY). When no provider is configured, returns a
// structured "no_provider" reason so the webhook can fall back gracefully.
//
// To enable transcription:
//   1. Provision an OpenAI API key (Whisper is cheap: $0.006/min).
//   2. Add `OPENAI_API_KEY=sk-...` to /opt/LA-Organizer/.env.
//   3. pm2 reload tom.
//
// UAZAPI audio payload: the webhook body typically carries audio in one of:
//   - body.message.audioMessage.url  (Baileys-style)
//   - body.audioUrl
//   - body.media.url
//   - body.message.url + body.messageType in {audio,ptt,myaudio}
// The fetcher tries these in order and logs the actual payload structure
// when it can't find one (so we can adjust quickly when seeing real traffic).

const https = require('https');
const http = require('http');

const PROVIDER_KEY = process.env.OPENAI_API_KEY || process.env.TRANSCRIPTION_API_KEY || '';
const UAZAPI_URL = (process.env.UAZAPI_URL || '').replace(/\/+$/, '');
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || '';

// Sprint 9 hotfix-3: UAZAPI moved to E2E-encrypted CDN URLs (mmg.whatsapp.net/...enc).
// Direct fetch returns ciphertext that Whisper can't transcribe. UAZAPI offers
// POST /message/download which decrypts server-side and returns base64 + mime.
// Spec: { id, return_base64, generate_mp3, return_link, transcribe? }
// Auth: header `token: <UAZAPI_TOKEN>`.
function extractMessageId(body) {
  return (
    body?.message?.id ||
    body?.message?.key?.id ||
    body?.id ||
    body?.data?.id ||
    null
  );
}

async function downloadFromUazapi(messageId, timeoutMs = 30000) {
  if (!UAZAPI_URL || !UAZAPI_TOKEN) {
    throw new Error('UAZAPI_URL or UAZAPI_TOKEN missing');
  }
  const u = new URL(UAZAPI_URL + '/message/download');
  const payload = JSON.stringify({
    id: messageId,
    return_base64: true,
    generate_mp3: true,
    return_link: false,
  });
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        token: UAZAPI_TOKEN,
      },
      timeout: timeoutMs,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          return reject(new Error(`UAZAPI download HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          const j = JSON.parse(raw);
          if (!j.base64Data) {
            return reject(new Error('UAZAPI download: no base64Data in response'));
          }
          const buf = Buffer.from(j.base64Data, 'base64');
          const mime = j.mimetype || 'audio/mpeg';
          resolve({ buffer: buf, mime });
        } catch (e) {
          reject(new Error('UAZAPI download bad JSON: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('UAZAPI download timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function findAudioUrl(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    // Sprint 9 hotfix-3: UAZAPI atual coloca URL aqui.
    body?.message?.content?.URL,
    body?.message?.content?.url,
    // Variantes legacy / alternativas de provider
    body?.message?.audioMessage?.url,
    body?.message?.media?.url,
    body?.message?.url,
    body?.audioUrl,
    body?.media?.url,
    body?.mediaUrl,
    body?.data?.audioUrl,
    body?.data?.media?.url,
    body?.data?.url,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && /^https?:\/\//i.test(c)) return c;
  }
  return null;
}

async function fetchBuffer(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https://') ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, res => {
      if ((res.statusCode || 0) >= 400) {
        return reject(new Error(`HTTP ${res.statusCode} fetching audio`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => { req.destroy(new Error('timeout fetching audio')); });
    req.on('error', reject);
  });
}

async function whisperTranscribe(buffer, filename = 'audio.mp3', mime = 'audio/mpeg') {
  // Build multipart/form-data manually (no external dep).
  const boundary = '----TOM-' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${mime}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buffer, tail]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.openai.com',
      path: '/v1/audio/transcriptions',
      headers: {
        'Authorization': `Bearer ${PROVIDER_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
      },
      timeout: 60000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          return reject(new Error(`whisper HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          const j = JSON.parse(raw);
          resolve(j.text || '');
        } catch (e) {
          reject(new Error('whisper bad JSON: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('whisper timeout')));
    req.write(body);
    req.end();
  });
}

// Main entry. Returns { ok: bool, text?: string, reason?: string }.
// Sprint 9 hotfix-3: prioriza POST /message/download da UAZAPI (decripta
// server-side). Fallback pra fetchBuffer da URL legacy se faltar message_id.
async function transcribeAudio(body) {
  if (!PROVIDER_KEY) {
    return { ok: false, reason: 'no_provider' };
  }

  let buf = null;
  let mime = 'audio/mpeg';
  let filename = 'audio.mp3';

  const messageId = extractMessageId(body);
  if (messageId && UAZAPI_URL && UAZAPI_TOKEN) {
    try {
      const r = await downloadFromUazapi(messageId);
      buf = r.buffer;
      mime = r.mime || mime;
      console.log(`[Audio] UAZAPI download OK — ${buf.length} bytes mime=${mime}`);
    } catch (err) {
      console.warn(`[Audio] UAZAPI download falhou (${err.message}); tentando URL direta...`);
    }
  }

  if (!buf) {
    // Fallback legacy: tenta URL plain do webhook (provavelmente encriptada
    // mas não custa tentar pra payloads de outro provider).
    const url = findAudioUrl(body);
    if (!url) {
      console.warn('[Audio] no message_id e no audio URL — payload sample:',
        JSON.stringify(body).slice(0, 400));
      return { ok: false, reason: 'no_audio_url' };
    }
    try {
      buf = await fetchBuffer(url);
      mime = 'audio/ogg'; filename = 'audio.ogg';
    } catch (err) {
      console.error('[Audio] fetchBuffer fallback falhou:', err.message);
      return { ok: false, reason: 'transcription_error', error: err.message };
    }
  }

  if (!buf || !buf.length) return { ok: false, reason: 'empty_audio' };

  try {
    const text = await whisperTranscribe(buf, filename, mime);
    if (!text || !text.trim()) return { ok: false, reason: 'transcription_empty' };
    return { ok: true, text: text.trim() };
  } catch (err) {
    console.error('[Audio] whisper err:', err.message);
    return { ok: false, reason: 'transcription_error', error: err.message };
  }
}

function isProviderConfigured() {
  return Boolean(PROVIDER_KEY);
}

// Sprint 22.X — Mídia bidirecional: utilitário compartilhado para download
// de qualquer mídia (imagem, documento, áudio) via UAZAPI /message/download.
// Reusa o mesmo decrypt server-side que o transcribeAudio já usa.
async function downloadMediaFromUazapi(messageId, opts = {}) {
  return downloadFromUazapi(messageId, opts.timeoutMs || 30000);
}

module.exports = { transcribeAudio, findAudioUrl, isProviderConfigured, downloadMediaFromUazapi, extractMessageId };
