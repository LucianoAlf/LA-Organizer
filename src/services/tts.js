// src/services/tts.js — Sprint 28
// ──────────────────────────────────────────────────────────────────────
// Wrapper ElevenLabs Text-to-Speech.
// Converte texto → buffer MP3 pra mandar como mensagem de voz (PTT) no
// WhatsApp via UAZAPI.
//
// Config via .env:
//   - ELEVENLABS_API_KEY        (obrigatória)
//   - ELEVENLABS_VOICE_ID       (default voz Adam pNInz6obpgDQGcFmaJgB)
//   - ELEVENLABS_MODEL_ID       (default eleven_multilingual_v2)
//
// Características:
// - Timeout 20s (TTS de 30s de áudio costuma demorar 5-10s).
// - Não lança erro custoso: logger + reject limpo; chamador decide fallback.
// - Limit hard de 800 chars por chamada — áudio >40s vira fadiga, não voz.

const https = require('https');

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const ELEVEN_MODEL_ID = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
const MAX_CHARS = 800; // ~40s áudio — qualquer coisa maior vira chato

function isConfigured() {
  return Boolean(ELEVEN_API_KEY && ELEVEN_API_KEY.length > 10);
}

async function textToSpeech(text) {
  if (!isConfigured()) {
    throw new Error('ELEVENLABS_API_KEY não configurada');
  }
  const trimmed = String(text || '').trim();
  if (!trimmed) throw new Error('TTS: texto vazio');
  // Cap o texto — áudios muito longos viram cansativo + caro
  const finalText = trimmed.length > MAX_CHARS
    ? trimmed.slice(0, MAX_CHARS - 3) + '...'
    : trimmed;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      text: finalText,
      model_id: ELEVEN_MODEL_ID,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.4,
        use_speaker_boost: true,
      },
    });

    const req = https.request({
      hostname: 'api.elevenlabs.io',
      path: `/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
      method: 'POST',
      headers: {
        'xi-api-key': ELEVEN_API_KEY,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 20000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const errBody = Buffer.concat(chunks).toString('utf-8').slice(0, 300);
          return reject(new Error(`ElevenLabs HTTP ${res.statusCode}: ${errBody}`));
        }
        const buf = Buffer.concat(chunks);
        console.log(`[TTS] ${finalText.length} chars → ${buf.length} bytes MP3`);
        resolve(buf);
      });
    });
    req.on('error', (e) => reject(new Error(`ElevenLabs net err: ${e.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('ElevenLabs timeout (>20s)'));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { textToSpeech, isConfigured, MAX_CHARS };
