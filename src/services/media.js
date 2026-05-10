// src/services/media.js — Sprint 22.X: visão multimodal para mídia recebida pelo TOM
//
// Fluxo:
//   1. Download da mídia via UAZAPI /message/download (server-side decrypt)
//   2. Upload pro bucket privado tom-incoming-media no Supabase Storage
//   3. Análise via Anthropic API (claude-haiku-4-5) com base64 — imagem ou PDF
//   4. Retorna texto descritivo para o engine processar como mensagem

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const { extractMessageId, downloadMediaFromUazapi } = require('./audio');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const VISION_MODEL = process.env.VISION_MODEL || 'claude-haiku-4-5-20251001';

function getServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

async function callAnthropicVision(base64Data, mime, caption) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não configurada');

  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';

  let contentBlock;
  if (isImage) {
    contentBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mime, data: base64Data },
    };
  } else if (isPdf) {
    contentBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
    };
  } else {
    throw new Error(`MIME não suportado para visão: ${mime}`);
  }

  const prompt = caption
    ? `O usuário enviou esta mídia com a legenda: "${caption}". Descreva o conteúdo da mídia e extraia todo texto visível. Responda em português, de forma direta e útil.`
    : 'Descreva o conteúdo desta mídia e extraia todo texto visível. Responda em português, de forma direta e útil.';

  const body = JSON.stringify({
    model: VISION_MODEL,
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        contentBlock,
        { type: 'text', text: prompt },
      ],
    }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 45000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          return reject(new Error(`Anthropic vision HTTP ${res.statusCode}: ${raw.slice(0, 200)}`));
        }
        try {
          const j = JSON.parse(raw);
          const text = j.content?.[0]?.text || '';
          resolve(text.trim());
        } catch (e) {
          reject(new Error('Anthropic vision JSON inválido: ' + raw.slice(0, 200)));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Anthropic vision timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function uploadToStorage(buffer, mime, collaboratorPhone) {
  const sb = getServiceClient();
  if (!sb) return null;
  try {
    const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';
    const path = `incoming/${collaboratorPhone.slice(-8)}/${Date.now()}.${ext}`;
    const { error } = await sb.storage
      .from('tom-incoming-media')
      .upload(path, buffer, { contentType: mime, upsert: false });
    if (error) {
      console.warn('[Media] storage upload err:', error.message);
      return null;
    }
    return path;
  } catch (e) {
    console.warn('[Media] storage upload exc:', e.message);
    return null;
  }
}

/**
 * Processa mídia recebida pelo TOM (imagem ou PDF).
 *
 * Returns: { ok: bool, text?: string, storagePath?: string, reason?: string }
 * - text: string descritivo para o engine tratar como mensagem
 * - reason: motivo de falha (no_provider, no_message_id, download_error, vision_error, unsupported_mime)
 */
async function processIncomingMedia(body, phone, mimeHint = '') {
  if (!ANTHROPIC_API_KEY) {
    console.log('[Media] ANTHROPIC_API_KEY ausente — visão desabilitada');
    return { ok: false, reason: 'no_provider' };
  }

  const messageId = extractMessageId(body);
  if (!messageId) {
    console.warn('[Media] sem message_id para download');
    return { ok: false, reason: 'no_message_id' };
  }

  let buffer, mime;
  try {
    const r = await downloadMediaFromUazapi(messageId);
    buffer = r.buffer;
    mime = r.mime || mimeHint || 'image/jpeg';
    console.log(`[Media] download OK — ${buffer.length} bytes mime=${mime}`);
  } catch (err) {
    console.error('[Media] download err:', err.message);
    return { ok: false, reason: 'download_error', error: err.message };
  }

  const isImage = mime.startsWith('image/');
  const isPdf = mime === 'application/pdf';
  if (!isImage && !isPdf) {
    return { ok: false, reason: 'unsupported_mime', mime };
  }

  // Upload ao Storage (best-effort, não bloqueia visão)
  const storagePath = await uploadToStorage(buffer, mime, phone);

  // Caption vinda do webhook (se o user enviou texto junto com a imagem)
  const caption = body?.message?.content?.caption
    || body?.message?.caption
    || body?.caption
    || body?.data?.caption
    || null;

  let description;
  try {
    const base64 = buffer.toString('base64');
    description = await callAnthropicVision(base64, mime, caption);
    console.log(`[Media] visão OK (${description.length} chars): ${description.slice(0, 80)}`);
  } catch (err) {
    console.error('[Media] visão err:', err.message);
    return { ok: false, reason: 'vision_error', error: err.message, storagePath };
  }

  return { ok: true, text: description, storagePath, mime, caption };
}

module.exports = { processIncomingMedia };
