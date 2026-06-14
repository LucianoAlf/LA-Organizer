// Smoke do delete_bill: cria conta fixa descartável -> deactivateBill -> confirma que sumiu de findBills.
// Uso na VPS: cd /opt/LA-Organizer && node --env-file=.env scripts/smoke-delete-bill.js
const fin = require('/opt/LA-Organizer/src/services/financeiro-service');
const CID = '0576f4b6-183d-4cf1-980e-5c8d5da0177f'; // Luciano Alf
(async () => {
  const b = await fin.createBill(CID, { name: 'ZZ-TESTE-DELETE', amount: 1, due_day: 1, category: 'moradia' });
  console.log('[smoke] criada:', b.name, b.id);
  const before = await fin.findBills(CID, 'ZZ-TESTE');
  console.log('[smoke] findBills antes (deve ser 1):', before.length);
  await fin.deactivateBill(CID, b.id);
  const after = await fin.findBills(CID, 'ZZ-TESTE');
  console.log('[smoke] findBills depois (deve ser 0):', after.length);
  console.log(before.length === 1 && after.length === 0 ? '[smoke] ✅ delete_bill OK' : '[smoke] ❌ FALHOU');
})().catch((e) => console.log('[smoke] ERR', e.message));
