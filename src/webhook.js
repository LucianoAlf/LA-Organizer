// src/webhook.js — Handler do webhook da UAZAPI
// Formato: { event: "message", instance: "uuid", data: { chatid, sender, text, fromMe, isGroup, messageType, ... } }

const crypto = require('crypto');
const express = require('express');
const { processMessage } = require('./engine');
const whatsapp = require('./services/whatsapp');
const queue = require('./services/per-user-queue');
const dedupe = require('./services/dedupe');
const audio = require('./services/audio');
const vision = require('./services/vision');
const gemini = require('./services/gemini');

const router = express.Router();

// ---------- Autenticação do webhook ----------
// Modos (controlados por env):
//   - disabled:   WEBHOOK_SECRET vazio → não valida (estado pré-Sprint 4).
//   - permissive: WEBHOOK_SECRET set + WEBHOOK_HMAC_ENFORCE != 'true' → valida e
//                 loga warning se inválido, mas continua processando. Janela de
//                 transição.
//   - strict:     WEBHOOK_SECRET set + WEBHOOK_HMAC_ENFORCE='true' → rejeita 401
//                 quando autenticação ausente ou inválida.
//
// Métodos de autenticação aceitos (em ordem):
//   1) URL token: POST /webhook/<token> — token = WEBHOOK_SECRET no path.
//      Usado pela UAZAPI que não envia headers customizados.
//   2) Static header: WEBHOOK_SIG_HEADER == WEBHOOK_SECRET (constant-time).
//   3) HMAC SHA256: WEBHOOK_SIG_HEADER = 'sha256=<hex>' OU '<hex>' direto,
//      computado sobre o raw body com o secret.
function verifyWebhookSignature(req) {
  const secret = process.env.WEBHOOK_SECRET || '';
  const headerName = (process.env.WEBHOOK_SIG_HEADER || 'x-webhook-signature').toLowerCase();
  const enforce = String(process.env.WEBHOOK_HMAC_ENFORCE || '').toLowerCase() === 'true';

  if (!secret) return { mode: 'disabled', ok: true };

  // 1) URL path token (`/webhook/:token`) — usado pela UAZAPI que não envia headers
  //    customizados. Token vai na URL configurada no painel UAZAPI.
  //    Constant-time comparison contra o secret.
  const urlToken = req.params && typeof req.params.token === 'string' ? req.params.token : '';
  if (urlToken) {
    try {
      const secretBuf = Buffer.from(secret);
      const tokenBuf = Buffer.from(urlToken);
      if (secretBuf.length === tokenBuf.length &&
          crypto.timingSafeEqual(secretBuf, tokenBuf)) {
        return { mode: enforce ? 'strict' : 'permissive', ok: true, method: 'url_token' };
      }
    } catch (_) {}
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'url_token_mismatch' };
  }

  // 2) Header-based validation (futuro: se UAZAPI ou outro provider passar a enviar)
  const provided = req.headers[headerName];
  if (!provided || typeof provided !== 'string') {
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'missing_header' };
  }

  // 2a) Static token no header (constant-time)
  try {
    const secretBuf = Buffer.from(secret);
    const providedBuf = Buffer.from(provided);
    if (secretBuf.length === providedBuf.length &&
        crypto.timingSafeEqual(secretBuf, providedBuf)) {
      return { mode: enforce ? 'strict' : 'permissive', ok: true, method: 'static_header' };
    }
  } catch (_) {}

  // HMAC-SHA256 (formato 'sha256=<hex>' ou '<hex>' direto — compatível com GitHub/Stripe style).
  const sigHex = provided.startsWith('sha256=') ? provided.slice(7) : provided;
  if (!/^[a-f0-9]{64}$/i.test(sigHex)) {
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'malformed' };
  }
  const raw = req.rawBody;
  if (!Buffer.isBuffer(raw) || raw.length === 0) {
    return { mode: enforce ? 'strict' : 'permissive', ok: false, reason: 'no_raw_body' };
  }
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  let match = false;
  try {
    match = crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigHex.toLowerCase(), 'hex'));
  } catch (_) {
    match = false;
  }
  return { mode: enforce ? 'strict' : 'permissive', ok: match, method: 'hmac', reason: match ? null : 'mismatch' };
}

/**
 * POST /webhook (ou /webhook/:token) — Recebe mensagens da UAZAPI.
 *
 * Dois métodos de autenticação suportados:
 *   1. URL token (UAZAPI atual): /webhook/<WEBHOOK_SECRET>
 *      → token vai no path, validado em verifyWebhookSignature.
 *   2. Header HMAC (futuro): X-Webhook-Signature: sha256=<hex>
 *      → suportado para providers que computam HMAC do body.
 */
router.post(['/webhook', '/webhook/:token'], async (req, res) => {
  // 0) HMAC. Em strict mode rejeita ANTES do 200 — UAZAPI deve reenviar até autenticar.
  const sig = verifyWebhookSignature(req);
  if (sig.mode === 'strict' && !sig.ok) {
    console.warn(`[Webhook] REJECT 401 — auth ${sig.reason}`);
    return res.status(401).json({ error: 'invalid_signature' });
  }
  // Responder 200 imediatamente pra UAZAPI não reenviar
  res.status(200).json({ status: 'received' });
  if (sig.mode === 'permissive' && !sig.ok) {
    console.warn(`[Webhook] auth permissive — ${sig.reason} (would-401 in strict mode)`);
  } else if (sig.mode !== 'disabled') {
    console.log(`[Webhook] auth ok (mode=${sig.mode}, method=${sig.method || '?'})`);
  }

  try {
    const body = req.body;

    console.log('[DEBUG] Body:', JSON.stringify(body).substring(0, 2000));

    // Guard 2: dedupe — descarta reentrega do MESMO evento (UAZAPI retry ou curl duplicado).
    // Chave preferencial é o id da mensagem; fallback é hash(phone+content+minuto+event).
    if (dedupe.isDuplicate(body)) {
      console.log(`[Webhook] SKIP duplicate event key=${dedupe.eventKey(body)}`);
      return;
    }

    // Ignorar mensagens de status, grupo, e do próprio bot
    if (whatsapp.isIgnorable(body)) {
      console.log('[Webhook] SKIP: isIgnorable=true', JSON.stringify(body).substring(0, 300));
      return;
    }

    // Extrair phone e texto
    const phone = whatsapp.extractPhone(body);
    let text = whatsapp.extractText(body);

    if (!phone) {
      console.log('[Webhook] SKIP: no phone extracted', JSON.stringify(body).substring(0, 500));
      return;
    }

    // ---- Audio handling: try transcription, fall back gracefully ----
    if ((!text || typeof text !== 'string') && whatsapp.isAudioMessage(body)) {
      console.log(`[Webhook] audio detected from ${phone.slice(-4)} — attempting transcription`);
      const r = await audio.transcribeAudio(body);
      if (r.ok && r.text) {
        // Prefix signals downstream pickSkill + Claude that the input came
        // from audio — `tratamento-audio` skill is loaded, which mandates
        // confirmation before any action marker is emitted.
        text = `[áudio transcrito] ${r.text}`;
        console.log(`[Webhook] audio transcribed (${r.text.length} chars): ${r.text.slice(0, 80)}`);
      } else {
        const reasons = {
          no_provider: 'recebi seu áudio. Por enquanto eu não tô processando áudio aqui — me manda o mesmo recado em texto, por favor?',
          no_audio_url: 'recebi seu áudio mas não consegui baixar o arquivo. Tenta de novo, ou me manda em texto?',
          empty_audio: 'o áudio veio vazio. Manda de novo?',
          transcription_empty: 'não consegui entender o áudio. Pode mandar de novo, ou em texto?',
          transcription_error: 'tive um erro tentando entender o áudio. Pode mandar em texto?',
        };
        const fallback = reasons[r.reason] || 'recebi seu áudio mas não consegui processar. Manda em texto?';
        whatsapp.sendMessage(phone, fallback).catch(e => console.error('[Webhook] audio-fallback send err:', e.message));
        return;
      }
    }

    // ---- Sprint 22.X — Imagem: análise via vision e injeção como texto ----
    if (whatsapp.isImageMessage(body)) {
      const caption = (typeof text === 'string' && text.trim()) ? text.trim() : '';
      console.log(`[Webhook] image detected from ${phone.slice(-4)} caption="${caption.slice(0, 60)}"`);
      const messageId = audio.extractMessageId(body);
      let buf = null, mime = 'image/jpeg';
      if (messageId) {
        try {
          const r = await audio.downloadMediaFromUazapi(messageId);
          buf = r.buffer; mime = r.mime || mime;
        } catch (err) {
          console.warn('[Webhook] image download falhou:', err.message);
        }
      }
      if (!buf) {
        whatsapp.sendMessage(phone, 'recebi sua imagem mas não consegui baixar. Tenta enviar de novo?').catch(() => {});
        return;
      }
      const r = await vision.analyzeImage(buf, mime, caption);
      if (r.ok) {
        const captionLine = caption ? `Legenda do usuário: "${caption}"\n` : '';
        text = `[imagem analisada] ${captionLine}Descrição: ${r.text}`;
        console.log(`[Webhook] image analyzed (${r.text.length} chars)`);
      } else {
        const reasons = {
          no_provider: 'recebi sua imagem, mas ainda não tô analisando imagens aqui. Me conta em texto o que tá nela?',
          unsupported_mime: 'recebi um formato de imagem que ainda não consigo ler. Pode mandar como JPG ou PNG?',
        };
        const fallback = reasons[r.reason] || 'recebi sua imagem mas tive um problema pra analisar. Pode descrever em texto?';
        whatsapp.sendMessage(phone, fallback).catch(() => {});
        return;
      }
    }
    // ---- Sprint 22.X — Vídeo: análise via Gemini 3.1 Flash Lite ----
    else if (whatsapp.isVideoMessage(body)) {
      const caption = (typeof text === 'string' && text.trim()) ? text.trim() : '';
      console.log(`[Webhook] video detected from ${phone.slice(-4)} caption="${caption.slice(0, 60)}"`);
      const messageId = audio.extractMessageId(body);
      let buf = null, mime = 'video/mp4';
      if (messageId) {
        try {
          const r = await audio.downloadMediaFromUazapi(messageId);
          buf = r.buffer; mime = r.mime || mime;
        } catch (err) {
          console.warn('[Webhook] video download falhou:', err.message);
        }
      }
      if (!buf) {
        whatsapp.sendMessage(phone, 'recebi seu vídeo mas não consegui baixar. Tenta enviar de novo?').catch(() => {});
        return;
      }
      const r = await gemini.analyzeMedia(buf, mime, caption);
      if (r.ok) {
        const captionLine = caption ? `Legenda: "${caption}"\n` : '';
        text = `[vídeo analisado] ${captionLine}Descrição: ${r.text}`;
        console.log(`[Webhook] video analyzed (${r.text.length} chars)`);
      } else {
        const reasons = {
          no_provider: 'recebi seu vídeo, mas análise de vídeo ainda não tá configurada aqui.',
          file_too_large: 'recebi seu vídeo, mas ele tá maior do que consigo processar. Tenta um trecho menor?',
          unsupported_mime: 'recebi um formato de vídeo que ainda não consigo analisar.',
        };
        const fallback = reasons[r.reason] || 'recebi seu vídeo mas tive um problema pra analisar. Pode descrever em texto o que precisa?';
        whatsapp.sendMessage(phone, fallback).catch(() => {});
        return;
      }
    }
    // ---- Sprint 22.X — Documento (PDF): análise via Gemini 3.1 Flash Lite ----
    else if (whatsapp.isDocumentMessage(body)) {
      const caption = (typeof text === 'string' && text.trim()) ? text.trim() : '';
      console.log(`[Webhook] document detected from ${phone.slice(-4)} caption="${caption.slice(0, 60)}"`);
      const messageId = audio.extractMessageId(body);
      let buf = null, mime = 'application/pdf';
      if (messageId) {
        try {
          const r = await audio.downloadMediaFromUazapi(messageId);
          buf = r.buffer; mime = r.mime || mime;
        } catch (err) {
          console.warn('[Webhook] document download falhou:', err.message);
        }
      }
      if (!buf || mime !== 'application/pdf') {
        whatsapp.sendMessage(phone, 'recebi seu documento. Me conta em texto o que precisa que eu faça com ele?').catch(() => {});
        return;
      }
      const r = await gemini.analyzeMedia(buf, mime, caption);
      if (r.ok) {
        const captionLine = caption ? `Legenda: "${caption}"\n` : '';
        text = `[PDF analisado] ${captionLine}Conteúdo: ${r.text}`;
        console.log(`[Webhook] PDF analyzed (${r.text.length} chars)`);
      } else {
        whatsapp.sendMessage(phone, 'recebi seu PDF mas tive um problema pra ler. Me conta em texto o que precisa?').catch(() => {});
        return;
      }
    }

    if (!text || typeof text !== 'string') {
      console.log('[Webhook] SKIP: no text or non-string text', JSON.stringify(body).substring(0, 500));
      return;
    }

    console.log(`[Webhook] Mensagem de ${phone.slice(-4)}: ${text.substring(0, 50)}`);

    // UX: dispara "digitando..." imediatamente, em paralelo ao engine (Claude leva 6-30s).
    // Fire-and-forget — nunca bloqueia o fluxo principal.
    whatsapp.setTyping(`${phone}@s.whatsapp.net`).catch(() => {});

    // Guard 1: serializa por phone — duas mensagens do mesmo usuário NÃO rodam em
    // paralelo (evita corrida no Supabase, no histórico, e na detecção de skill).
    // Usuários diferentes continuam em paralelo. Não bloqueia o webhook (já respondemos 200 acima).
    queue.enqueue(phone, () => processMessage(phone, text, body));

  } catch (err) {
    console.error(`[Webhook] Erro ao processar: ${err.message}`);
  }
});

/**
 * GET /health — Healthcheck
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    agent: 'TOM',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()),
  });
});

/**
 * GET / — Info
 */
router.get('/', (req, res) => {
  res.json({
    agent: '👽 TOM — LA Organizer',
    status: 'running',
    docs: 'https://github.com/LucianoAlf/LA-Organizer',
  });
});

module.exports = router;
