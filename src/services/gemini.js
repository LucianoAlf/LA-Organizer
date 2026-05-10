// src/services/gemini.js — Sprint 22.X: análise de vídeo, PDF e áudio via Gemini 3.1 Flash Lite
//
// gemini-3.1-flash-lite: multimodal (texto, imagem, vídeo, áudio, PDF) — barato e rápido.
// Usado pelo TOM para:
//   • Vídeos recebidos no WhatsApp → descrição do que acontece
//   • PDFs recebidos → extração de texto/resumo
//
// API: REST inline base64 (sem SDK). Limite: ~20MB inline (WhatsApp vídeo máx 16MB → ~21MB base64).
// Requisito: GEMINI_API_KEY no .env
//
// Endpoint: POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=KEY

const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_INLINE_BYTES = 19 * 1024 * 1024; // 19 MB limite seguro pra inline base64

/**
 * Analisa vídeo, PDF ou áudio via Gemini.
 * @param {Buffer} buffer    - Bytes da mídia baixada via UAZAPI
 * @param {string} mime      - MIME type (video/mp4, application/pdf, audio/ogg, etc.)
 * @param {string} caption   - Legenda opcional do usuário
 * @returns {Promise<{ok: boolean, text?: string, reason?: string, error?: string}>}
 */
async function analyzeMedia(buffer, mime, caption = '') {
  if (!GEMINI_API_KEY) {
    return { ok: false, reason: 'no_provider' };
  }
  if (!buffer || !buffer.length) {
    return { ok: false, reason: 'empty_buffer' };
  }
  if (buffer.length > MAX_INLINE_BYTES) {
    return { ok: false, reason: 'file_too_large', error: `${(buffer.length / 1024 / 1024).toFixed(1)} MB > 19 MB limite` };
  }

  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf';
  const isAudio = mime.startsWith('audio/');

  let promptText;
  if (isVideo) {
    promptText = caption
      ? `O usuário enviou este vídeo com a legenda: "${caption}". Descreva o que acontece no vídeo: pessoas, ações, texto visível, áudio transcrito se houver. Responda em português, diretamente.`
      : 'Descreva o que acontece neste vídeo: pessoas, ações, texto visível, áudio se houver. Responda em português, de forma direta e útil.';
  } else if (isPdf) {
    promptText = caption
      ? `O usuário enviou este PDF com a legenda: "${caption}". Extraia e resuma o conteúdo principal. Responda em português.`
      : 'Extraia e resuma o conteúdo principal deste PDF. Responda em português, de forma direta.';
  } else if (isAudio) {
    promptText = 'Transcreva o áudio para português. Se já estiver em português, transcreva literalmente. Se estiver em outro idioma, transcreva e traduza.';
  } else {
    return { ok: false, reason: 'unsupported_mime', error: mime };
  }

  const base64Data = buffer.toString('base64');

  const body = JSON.stringify({
    contents: [{
      parts: [
        {
          inlineData: {
            mimeType: mime,
            data: base64Data,
          },
        },
        { text: promptText },
      ],
    }],
    generationConfig: {
      maxOutputTokens: 1024,
    },
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const parsedUrl = new URL(url);

  try {
    const text = await new Promise((resolve, reject) => {
      const req = https.request({
        method: 'POST',
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 90000, // vídeos podem levar mais tempo
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if ((res.statusCode || 0) >= 400) {
            return reject(new Error(`Gemini HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
          }
          try {
            const j = JSON.parse(raw);
            const content = j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            if (!content) return reject(new Error('Gemini retornou resposta vazia'));
            resolve(content);
          } catch (e) {
            reject(new Error('Gemini JSON inválido: ' + raw.slice(0, 200)));
          }
        });
      });
      req.on('timeout', () => req.destroy(new Error('Gemini timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });

    return { ok: true, text };
  } catch (err) {
    console.error('[Gemini] err:', err.message);
    return { ok: false, reason: 'gemini_error', error: err.message };
  }
}

function isProviderConfigured() {
  return Boolean(GEMINI_API_KEY);
}

module.exports = { analyzeMedia, isProviderConfigured };
