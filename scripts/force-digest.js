'use strict';
// Força o envio do digest financeiro pra UM colaborador (teste manual ao vivo).
// Semântica de --force: ignora claim/quiet e NÃO grava ritual_logs (igual aos outros --force).
//   cd /opt/LA-Organizer && node --env-file=.env scripts/force-digest.js --phone=5521981278047
const f = require('../src/services/financeiro-service');
const { buildFinanceDigest } = require('../src/finance/finance-digest');
const whatsapp = require('../src/services/whatsapp');

const arg = (k) => { const a = process.argv.find((s) => s.startsWith('--' + k + '=')); return a ? a.split('=')[1] : null; };

(async () => {
  const phone = arg('phone');
  const cid = arg('cid');
  if (!phone && !cid) { console.error('uso: --phone=XXXX ou --cid=XXXX'); process.exit(1); }
  const list = await f.collaboratorsWithActiveBills();
  const collab = list.find((c) => (cid && c.id === cid) || (phone && String(c.phone) === String(phone)));
  if (!collab) { console.error('colaborador não encontrado entre os com contas ativas'); process.exit(1); }

  const ymd = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10); // SP ≈ UTC-3
  const dom = Number(ymd.slice(8, 10));
  const items = await f.dueItemsForDigest(collab.id, { dom, ymd });
  const n = items.atrasadas.length + items.hoje.length + items.emBreve.length;
  const nome = String(collab.full_name || '').split(' ')[0];
  if (!n) { console.log(`(vazio — ${nome} não tem nada vencendo hoje; nada enviado)`); return; }
  const msg = buildFinanceDigest({ nome, ...items });
  await whatsapp.sendMessage(collab.phone, msg);
  console.log(`ENVIADO pra ${nome} (${collab.phone}):\n\n` + msg);
})().catch((e) => { console.error('FORCE ERR:', e.message); process.exit(1); });
