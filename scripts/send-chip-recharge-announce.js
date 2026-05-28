#!/usr/bin/env node
// Script de uso único — anuncia o novo lembrete mensal de recarga de chip
// para Jereh (Campo Grande) e Krissya (Barra).
const path = require('path');
const fs   = require('fs');
const root = path.join(__dirname, '..');
process.chdir(root);

// Carrega .env
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2];
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

const w = require(path.join(root, 'src/services/whatsapp'));

const RECIPIENTS = [
  {
    phone: '5521985525984',
    name: 'Jereh',
    chip: '(21) 96552-9851',
    device: 'Tel. Jereh',
  },
  {
    phone: '5521966875271',
    name: 'Krissya',
    chip: '(21) 96957-5619',
    device: 'Tablet Barra',
  },
];

(async () => {
  for (const r of RECIPIENTS) {
    const msg =
      `🤖 *TOM aqui!*\n\n` +
      `A partir de agora, todo dia 7 de cada mês às 14h você vai receber um lembrete automático meu para recarregar o chip da secretaria:\n` +
      `📱 *${r.chip} — ${r.device}*\n\n` +
      `Assim a gente não esquece mais de fazer antes do dia 10! 😊`;
    try {
      await w.sendMessage(r.phone, msg);
      console.log(`✅ Mensagem enviada para ${r.name}`);
    } catch (err) {
      console.error(`❌ Erro ao enviar para ${r.name}:`, err.message);
    }
  }
  process.exit(0);
})();
