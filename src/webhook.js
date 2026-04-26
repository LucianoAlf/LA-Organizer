// src/webhook.js — Handler do webhook da UAZAPI
// Formato: { event: "message", instance: "uuid", data: { chatid, sender, text, fromMe, isGroup, messageType, ... } }

const express = require('express');
const { processMessage } = require('./engine');
const whatsapp = require('./services/whatsapp');

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
    if (!text) {
      console.log('[Webhook] SKIP: no text extracted', JSON.stringify(body).substring(0, 500));
      return;
    }

    console.log(`[Webhook] Mensagem de ${phone.slice(-4)}: ${text.substring(0, 50)}`);

    // Processar mensagem (async, não bloqueia o webhook)
    await processMessage(phone, text, body);

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
