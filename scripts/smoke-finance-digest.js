'use strict';
// Smoke do digest financeiro matinal — roda na VPS:
//   cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-finance-digest.js
// Pega colaboradores com contas ativas, roda dueItemsForDigest + buildFinanceDigest
// e imprime a mensagem (ou "(vazio)"). NÃO envia nada no WhatsApp.
const f = require('../src/services/financeiro-service');
const { buildFinanceDigest } = require('../src/finance/finance-digest');

(async () => {
  const collabs = await f.collaboratorsWithActiveBills();
  if (!collabs.length) { console.log('nenhum colaborador com contas ativas'); return; }
  // data de São Paulo (UTC-3) aproximada
  const ymd = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const dom = Number(ymd.slice(8, 10));
  console.log(`hoje=${ymd} (dom=${dom}) — ${collabs.length} colaborador(es) com contas\n`);
  for (const c of collabs.slice(0, 5)) {
    const items = await f.dueItemsForDigest(c.id, { dom, ymd });
    const n = items.atrasadas.length + items.hoje.length + items.emBreve.length;
    const nome = String(c.full_name || '').split(' ')[0];
    console.log(`=== ${nome} — ${n} item(ns) (atr=${items.atrasadas.length} hoje=${items.hoje.length} breve=${items.emBreve.length}) ===`);
    console.log(n ? buildFinanceDigest({ nome, ...items }) : '(vazio → não envia)');
    console.log('');
  }
})().catch((e) => { console.error('SMOKE ERR:', e.message); process.exit(1); });
