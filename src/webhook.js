// src/webhook.js — Handler do webhook da UAZAPI
// Formato: { event: "message", instance: "uuid", data: { chatid, sender, text, fromMe, isGroup, messageType, ... } }

const express = require('express');
const { processMessage } = require('./engine');
const whatsapp = require('./services/whatsapp');
const queue = require('./services/per-user-queue');
const dedupe = require('./services/dedupe');

const router = express.Router();

/**
 * POST /webhook — Recebe mensagens da UAZAPI
 */
router.post('/webhook', async (req, res) => {
  // Responder 200 imediatamente pra UAZAPI não reenviar
  res.status(200).json({ status: 'received' });

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
    const text = whatsapp.extractText(body);

    if (!phone) {
      console.log('[Webhook] SKIP: no phone extracted', JSON.stringify(body).substring(0, 500));
      return;
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
