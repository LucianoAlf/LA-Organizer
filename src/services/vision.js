// src/services/vision.js — análise de imagem via OpenAI gpt-4o-mini.
// Sprint 22.X — Mídia bidirecional. Recebe um Buffer + mime e devolve uma
// descrição em pt-BR útil pra TOM tratar como contexto da conversa.
//
// Pipeline:
//   buffer → base64 data URL → POST /v1/chat/completions com gpt-4o-mini
//   → texto descritivo (objetos, pessoas, números, contexto)
//
// PDF: gpt-4o-mini chat completions NÃO aceita PDFs diretamente. Pra PDF,
// retornamos { ok: false, reason: 'pdf_not_supported_inline' } e o webhook
// faz fallback educado ("recebi o PDF, descreve aí o que precisa").

const https = require('https');

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const VISION_MODEL = process.env.TOM_VISION_MODEL || 'gpt-5.4-mini-2026-03-17';

function isImageMime(mime) {
  return /^image\/(jpeg|png|webp|gif)$/i.test(String(mime || ''));
}

/**
 * Analisa uma imagem e retorna descrição textual em pt-BR.
 * Returns { ok: bool, text?: string, reason?: string, error?: string }.
 */
// Monta o prompt de visão. Quando a imagem for comprovante/nota, pede extração
// financeira estruturada (transcrição literal) + sinal pra skill financeira carregar.
function buildVisionPrompt(userCaption = '') {
  const parts = [];
  if (userCaption && userCaption.trim()) {
    parts.push(`O usuário enviou esta imagem com a legenda: "${userCaption.trim()}".`);
  }
  parts.push(
    'Descreve em português, em até 4 frases, o que aparece na imagem ' +
    '(objetos, pessoas, texto visível, números, contexto). Se houver texto, ' +
    'transcreve literalmente. Se for um documento ou tabela, lista os campos. ' +
    'Não comente além da descrição factual.'
  );
  parts.push(
    'IMPORTANTE — se a imagem for uma nota fiscal, cupom fiscal, comprovante de ' +
    'pagamento, recibo ou tela de compra de app (iFood, Uber, etc.): comece a ' +
    'resposta com a linha "COMPROVANTE FINANCEIRO:" e logo em seguida transcreve ' +
    'LITERALMENTE (sem arredondar nem inferir): valor total (R$), estabelecimento/' +
    'loja/app, data (se visível), forma de pagamento (crédito, débito, PIX, ' +
    'dinheiro, ou o nome do cartão/banco), e os itens principais resumidos. Se ' +
    'algum campo não estiver legível, escreve "ilegível" nesse campo — não chute.'
  );
  return parts.join(' ');
}

async function analyzeImage(buffer, mime = 'image/jpeg', userCaption = '') {
  if (!OPENAI_KEY) return { ok: false, reason: 'no_provider' };
  if (!buffer || !buffer.length) return { ok: false, reason: 'empty_buffer' };
  if (!isImageMime(mime)) return { ok: false, reason: 'unsupported_mime', error: mime };

  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const userText = buildVisionPrompt(userCaption);

  const payload = JSON.stringify({
    model: VISION_MODEL,
    max_completion_tokens: 600,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return new Promise((resolve) => {
    const req = https.request({
      method: 'POST',
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      headers: {
        'Authorization': `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 60000,
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        if ((res.statusCode || 0) >= 400) {
          console.error(`[Vision] HTTP ${res.statusCode}: ${raw.slice(0, 300)}`);
          return resolve({ ok: false, reason: 'api_error', error: `HTTP ${res.statusCode}` });
        }
        try {
          const j = JSON.parse(raw);
          const text = j.choices?.[0]?.message?.content?.trim() || '';
          if (!text) return resolve({ ok: false, reason: 'empty_response' });
          resolve({ ok: true, text });
        } catch (e) {
          resolve({ ok: false, reason: 'bad_json', error: e.message });
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('vision timeout')));
    req.on('error', err => {
      console.error('[Vision] req err:', err.message);
      resolve({ ok: false, reason: 'transport_error', error: err.message });
    });
    req.write(payload);
    req.end();
  });
}

function isProviderConfigured() {
  return Boolean(OPENAI_KEY);
}

module.exports = { analyzeImage, isProviderConfigured, isImageMime, buildVisionPrompt };
