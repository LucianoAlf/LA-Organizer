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

function findAudioUrl(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
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

async function whisperTranscribe(buffer, filename = 'audio.ogg') {
  // Build multipart/form-data manually (no external dep).
  const boundary = '----TOM-' + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n` +
    `whisper-1\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: audio/ogg\r\n\r\n`
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
async function transcribeAudio(body) {
  if (!PROVIDER_KEY) {
    return { ok: false, reason: 'no_provider' };
  }
  const url = findAudioUrl(body);
  if (!url) {
    console.warn('[Audio] no audio URL found in webhook payload — sample:',
      JSON.stringify(body).slice(0, 400));
    return { ok: false, reason: 'no_audio_url' };
  }
  try {
    const buf = await fetchBuffer(url);
    if (!buf || !buf.length) return { ok: false, reason: 'empty_audio' };
    const text = await whisperTranscribe(buf);
    if (!text || !text.trim()) return { ok: false, reason: 'transcription_empty' };
    return { ok: true, text: text.trim() };
  } catch (err) {
    console.error('[Audio] transcription err:', err.message);
    return { ok: false, reason: 'transcription_error', error: err.message };
  }
}

function isProviderConfigured() {
  return Boolean(PROVIDER_KEY);
}

module.exports = { transcribeAudio, findAudioUrl, isProviderConfigured };
