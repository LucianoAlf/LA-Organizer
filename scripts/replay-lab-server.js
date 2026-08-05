#!/usr/bin/env node
// scripts/replay-lab-server.js
// Instância efêmera do TOM para provar o VERIFICADOR REAL do webhook.
//
// SOBE O MESMO ROUTER (`src/webhook.js`) e a MESMA configuração de rawBody do
// `src/index.js` — é o verificador de produção sendo exercitado, não uma reimplementação.
//
// NÃO SOBE: crons, realtime, watcher de grupo e replayPending. Não é economia, é
// segurança: o `src/index.js` completo dispara startCrons(), startRealtime(),
// startGroupChatWatcher() e o replay de webhooks pendentes — todos contra o banco de
// PRODUÇÃO. Com UAZAPI_URL apontando para um sink, nada sairia; mas o banco seria
// mutado (reminded_at, status, marker_logs), e uma bateria de autenticação não pode
// deixar rastro em dado de gente.
//
// Isto é declarado, não escondido: o que este harness prova é a AUTENTICAÇÃO. Cron e
// realtime têm cenários próprios (passo 5 da spec), com relógio controlado.
'use strict';

const express = require('express');
const webhook = require('../src/webhook');

const app = express();
// Idêntico ao src/index.js — sem o mesmo `verify`, o rawBody não existe e todo HMAC
// falharia por `no_raw_body`, dando um verde/vermelho que não diz nada sobre o produto.
app.use(express.json({
  limit: '5mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(webhook);

app.get('/health', (_req, res) => res.json({
  ok: true,
  hmacOnly: String(process.env.WEBHOOK_HMAC_ONLY || '').toLowerCase() === 'true',
}));

const porta = Number(process.env.PORT || 3199);
app.listen(porta, '127.0.0.1', () => {
  console.log(`[replay-lab] verificador no ar em 127.0.0.1:${porta} · HMAC_ONLY=${process.env.WEBHOOK_HMAC_ONLY} · UAZAPI=${process.env.UAZAPI_URL}`);
});
