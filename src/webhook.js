const express = require('express');
const { processMessage } = require('./engine');
const whatsapp = require('./services/whatsapp');
const router = express.Router();

router.post('/webhook', async (req, res) => {
  res.status(200).json({ status: 'received' });
  try {
    const body = req.body; console.log("[DEBUG] Body:", JSON.stringify(body).substring(0, 300));
    if (whatsapp.isIgnorable(body)) return;
    const phone = whatsapp.extractPhone(body);
    const text = whatsapp.extractText(body);
    if (!phone || !text) return;
    console.log(`[Webhook] Mensagem de ${phone.slice(-4)}: ${text.substring(0,50)}`);
    await processMessage(phone, text, body);
  } catch (err) {
    console.error('[Webhook] Erro:', err.message);
  }
});

router.get('/health', (req, res) => res.json({ status: 'ok', agent: 'TOM', uptime: Math.floor(process.uptime()) }));
router.get('/', (req, res) => res.json({ agent: 'TOM — LA Organizer', status: 'running' }));

module.exports = router;
