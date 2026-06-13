// src/services/media.js — Sprint 22.X: visão multimodal para mídia recebida pelo TOM
//
// Fluxo:
//   1. UAZAPI /message/download com return_link=true → URL pública + mime
//   2. Passa a URL pública diretamente pro OpenAI vision (sem re-upload)
//   3. Retorna texto descritivo para o engine processar como mensagem normal
//
// Model: gpt-5.4-mini-2026-03-17 (suporta Text + Image, $0.75 input / $4.5 output MTok)
// Requisito: OPENAI_API_KEY (mesma usada pelo Whisper de áudio)

const https = require('https');
const http = require('http');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.TRANSCRIPTION_API_KEY || '';
const UAZAPI_URL = (process.env.UAZAPI_URL || '').replace(/\/+$/, '');
const UAZAPI_TOKEN = process.env.UAZAPI_TOKEN || '';
const VISION_MODEL = process.env.VISION_MODEL || 'gpt-5.4-mini-2026-03-17';

function extractMessageId(body) {
  return (
    body?.message?.id ||
    body?.message?.key?.id ||
    body?.id ||
    body?.data?.id ||
    null
  );
}

/**
 * Chama UAZAPI /message/download com return_link=true.
 * Retorna { url, mime, base64Data? } — url é URL pública acessível pela OpenAI.
 */
async function getMediaFromUazapi(messageId, timeoutMs = 30000) {
  if (!UAZAPI_URL || !UAZAPI_TOKEN) throw new Error('UAZAPI_URL ou UAZAPI_TOKEN ausente');

  const u = new URL(UAZAPI_URL + '/message/download');
  const payload = JSON.stringify({
    id: messageId,
    return_link: true,   // URL pública — passa direto pra OpenAI
    return_base64: false,
    generate_mp3: false,
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
          if (!j.url && !j.base64Data) {
            return reject(new Error('UAZAPI download: sem url nem base64Data na resposta'));
          }
          resolve({ url: j.url || null, mime: j.mimetype || 'image/jpeg', base64Data: j.base64Data || null });
        } catch (e) {
          reject(new Error('UAZAPI download JSON inválido: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('UAZAPI download timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Chama OpenAI vision (gpt-5.4-mini-2026-03-17) com URL pública da imagem.
 * Para PDF (não suportado como URL pelo OpenAI), passa base64 se disponível.
 */
async function callOpenAIVision(mediaUrl, mime, caption, base64Data) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY não configurada');

  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';

  if (!isImage && !isPdf) {
    throw new Error(`MIME não suportado para visão: ${mime}`);
  }

  const base = 'Descreva o conteúdo desta mídia e extraia TODO o texto visível. Se for uma fatura, extrato ou lista de transações, liste TODAS as linhas uma a uma (data · descrição · valor · parcela X/Y se houver), sem resumir nem omitir nenhuma. Responda em português, direto e útil.';
  const promptText = caption
    ? `O usuário enviou esta mídia com a legenda: "${caption}". ${base}`
    : base;

  let imageContent;
  if (isImage && mediaUrl) {
    imageContent = { type: 'image_url', image_url: { url: mediaUrl } };
  } else if (base64Data) {
    imageContent = {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${base64Data}` },
    };
  } else {
    throw new Error('Sem URL pública nem base64 para enviar ao OpenAI');
  }

  const body = JSON.stringify({
    model: VISION_MODEL,
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: [
        imageContent,
        { type: 'text', text: promptText },
      ],
    }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 45000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          return reject(new Error(`OpenAI vision HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          const j = JSON.parse(raw);
          const text = j.choices?.[0]?.message?.content || '';
          resolve(text.trim());
        } catch (e) {
          reject(new Error('OpenAI vision JSON inválido: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('OpenAI vision timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Entry point: processa imagem/PDF recebida pelo TOM.
 * Returns: { ok: bool, text?: string, reason?: string }
 */
async function processIncomingMedia(body, phone) {
  if (!OPENAI_API_KEY) {
    console.log('[Media] OPENAI_API_KEY ausente — visão desabilitada');
    return { ok: false, reason: 'no_provider' };
  }

  const messageId = extractMessageId(body);
  if (!messageId) {
    console.warn('[Media] sem message_id no payload');
    return { ok: false, reason: 'no_message_id' };
  }

  let mediaUrl, mime, base64Data;
  try {
    const r = await getMediaFromUazapi(messageId);
    mediaUrl = r.url;
    mime = r.mime;
    base64Data = r.base64Data;
    console.log(`[Media] UAZAPI download OK — mime=${mime} url=${mediaUrl ? mediaUrl.slice(0, 60) : 'null'}`);
  } catch (err) {
    console.error('[Media] download err:', err.message);
    return { ok: false, reason: 'download_error', error: err.message };
  }

  if (!mime.startsWith('image/') && mime !== 'application/pdf') {
    return { ok: false, reason: 'unsupported_mime', mime };
  }

  const caption = body?.message?.content?.caption
    || body?.message?.caption
    || body?.caption
    || body?.data?.caption
    || null;

  try {
    const description = await callOpenAIVision(mediaUrl, mime, caption, base64Data);
    console.log(`[Media] visão OK (${description.length} chars): ${description.slice(0, 80)}`);
    return { ok: true, text: description, mime, caption };
  } catch (err) {
    console.error('[Media] visão err:', err.message);
    return { ok: false, reason: 'vision_error', error: err.message };
  }
}

module.exports = { processIncomingMedia, extractMessageId };
