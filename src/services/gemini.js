// src/services/gemini.js — Sprint 22.X: análise de vídeo, PDF e áudio via Gemini 3.1 Flash Lite
//
// gemini-3.1-flash-lite: multimodal (texto, imagem, vídeo, áudio, PDF) — barato e rápido.
//
// Estratégia híbrida (suporta arquivos grandes):
//   • Arquivos pequenos (< 19MB): inline base64 — uma única chamada, mais rápido
//   • Arquivos grandes (>= 19MB) ou vídeos: Files API — upload prévio + poll + generateContent
//
// Files API:
//   - POST /upload/v1beta/files (multipart) → recebe { uri, name, state }
//   - GET /v1beta/files/{name} → polling até state === 'ACTIVE'
//   - Limite: 2 GB por arquivo, retidos por 48h
//
// Requisito: GEMINI_API_KEY no .env

const https = require('https');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const MAX_INLINE_BYTES = 19 * 1024 * 1024;          // 19 MB — abaixo disso, inline base64
const MAX_FILES_API_BYTES = 1900 * 1024 * 1024;     // ~1.9 GB — limite seguro Files API
const FILE_PROCESSING_TIMEOUT_MS = 90000;            // 90s pra Gemini processar vídeo
const FILE_POLL_INTERVAL_MS = 2000;                  // 2s entre polls

/**
 * Upload de mídia via Files API (multipart). Retorna { uri, name, mimeType, state }.
 */
async function uploadFile(buffer, mime) {
  const boundary = '----TOM-' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ file: { display_name: 'tom-incoming-' + Date.now() } });

  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${meta}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mime}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buffer, tail]);

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'generativelanguage.googleapis.com',
      path: `/upload/v1beta/files?key=${GEMINI_API_KEY}`,
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'Content-Length': body.length,
        'X-Goog-Upload-Protocol': 'multipart',
      },
      timeout: 180000, // 3 min pra upload de arquivo grande
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          return reject(new Error(`Gemini Files upload HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
        }
        try {
          const j = JSON.parse(raw);
          const file = j.file;
          if (!file || !file.uri || !file.name) {
            return reject(new Error('Files API: resposta sem uri/name'));
          }
          resolve(file);
        } catch (e) {
          reject(new Error('Files API JSON inválido: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Files API upload timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Polling do estado do arquivo até ACTIVE (ou FAILED).
 * Files API retorna state=PROCESSING para vídeos enquanto Gemini processa.
 */
async function waitForActive(fileName) {
  const start = Date.now();
  while (Date.now() - start < FILE_PROCESSING_TIMEOUT_MS) {
    const file = await new Promise((resolve, reject) => {
      const req = https.request({
        method: 'GET',
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/${fileName}?key=${GEMINI_API_KEY}`,
        timeout: 15000,
      }, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          if ((res.statusCode || 0) >= 400) {
            return reject(new Error(`Files GET HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
          }
          try { resolve(JSON.parse(raw)); }
          catch (e) { reject(new Error('Files GET JSON inválido')); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Files GET timeout')));
      req.end();
    });

    if (file.state === 'ACTIVE') return file;
    if (file.state === 'FAILED') throw new Error('Files API: state=FAILED — Gemini não conseguiu processar');
    await new Promise(r => setTimeout(r, FILE_POLL_INTERVAL_MS));
  }
  throw new Error(`Files API: timeout aguardando state=ACTIVE após ${FILE_PROCESSING_TIMEOUT_MS}ms`);
}

/**
 * Chama generateContent com a parte de mídia (inline OU fileData) + texto.
 */
async function callGenerateContent(mediaPart, promptText) {
  const body = JSON.stringify({
    contents: [{
      parts: [
        mediaPart,
        { text: promptText },
      ],
    }],
    generationConfig: { maxOutputTokens: 8192 },
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 120000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          return reject(new Error(`Gemini generateContent HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
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
    req.on('timeout', () => req.destroy(new Error('Gemini generateContent timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function buildPrompt(mime, caption) {
  const isVideo = mime.startsWith('video/');
  const isPdf = mime === 'application/pdf';
  const isAudio = mime.startsWith('audio/');

  if (isVideo) {
    return caption
      ? `O usuário enviou este vídeo com a legenda: "${caption}". Descreva o que acontece no vídeo: pessoas, ações, texto visível, áudio transcrito se houver. Responda em português, diretamente.`
      : 'Descreva o que acontece neste vídeo: pessoas, ações, texto visível, áudio se houver. Responda em português, de forma direta e útil.';
  }
  if (isPdf) {
    const base = 'Extraia o conteúdo COMPLETO deste PDF. Se for fatura, extrato bancário ou lista de transações, liste TODAS as linhas uma a uma (data · descrição · valor · e a parcela X/Y se houver) — NÃO resuma, NÃO agrupe, NÃO omita nenhuma, vá até a ÚLTIMA transação da última página. Inclua também o total e o vencimento se aparecerem. Responda em português.';
    return caption ? `O usuário enviou este PDF com a legenda: "${caption}". ${base}` : base;
  }
  if (isAudio) {
    return 'Transcreva o áudio para português. Se já estiver em português, transcreva literalmente. Se estiver em outro idioma, transcreva e traduza.';
  }
  return null;
}

/**
 * Analisa vídeo, PDF ou áudio via Gemini.
 * Roteia automaticamente: inline base64 (pequenos) ou Files API (grandes/vídeos).
 *
 * @param {Buffer} buffer    - Bytes da mídia baixada via UAZAPI
 * @param {string} mime      - MIME type
 * @param {string} caption   - Legenda opcional do usuário
 * @returns {Promise<{ok: boolean, text?: string, reason?: string, error?: string}>}
 */
async function analyzeMedia(buffer, mime, caption = '') {
  if (!GEMINI_API_KEY) return { ok: false, reason: 'no_provider' };
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_buffer' };

  if (buffer.length > MAX_FILES_API_BYTES) {
    return {
      ok: false,
      reason: 'file_too_large',
      error: `${(buffer.length / 1024 / 1024).toFixed(1)} MB > limite de ${MAX_FILES_API_BYTES / 1024 / 1024} MB`,
    };
  }

  const promptText = buildPrompt(mime, caption);
  if (!promptText) return { ok: false, reason: 'unsupported_mime', error: mime };

  const isVideo = mime.startsWith('video/');
  const useFilesApi = isVideo || buffer.length >= MAX_INLINE_BYTES;
  const sizeMb = (buffer.length / 1024 / 1024).toFixed(1);

  try {
    let mediaPart;
    if (useFilesApi) {
      console.log(`[Gemini] uploading ${sizeMb} MB via Files API (mime=${mime})`);
      const file = await uploadFile(buffer, mime);
      console.log(`[Gemini] uploaded name=${file.name} state=${file.state} — aguardando ACTIVE...`);
      const ready = await waitForActive(file.name);
      console.log(`[Gemini] file ACTIVE — chamando generateContent`);
      mediaPart = { fileData: { fileUri: ready.uri, mimeType: mime } };
    } else {
      console.log(`[Gemini] inline base64 ${sizeMb} MB (mime=${mime})`);
      mediaPart = { inlineData: { mimeType: mime, data: buffer.toString('base64') } };
    }

    const text = await callGenerateContent(mediaPart, promptText);
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
