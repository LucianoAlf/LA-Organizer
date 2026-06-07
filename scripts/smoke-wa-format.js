const assert = require('assert');
const wa = require('../src/finance/wa-format');

assert.strictEqual(wa.header('📋', 'Contas a Pagar'), '📋 *Contas a Pagar*');
assert.strictEqual(wa.header('📋', 'Contas', 'abril'), '📋 *Contas* — abril');
assert.strictEqual(wa.totalHighlight('pendente', 1390), '💰 *Total pendente: R$ 1.390,00*');
assert.strictEqual(wa.tomTip('Saldo saudável.'), '💡 *Dica do TOM*\nSaldo saudável.');
assert.strictEqual(wa.quickActions(['resumo do mês', 'extrato']), '⚡ _"resumo do mês"_ · _"extrato"_');

// severityTiers: só mostra tiers não-vazios, com contagem.
const tiers = { urgente: [{ name:'Aluguel' }], importante: [], atencao: [{ name:'Luz' }], ok: [] };
const out = wa.severityTiers(tiers, { urgente:'🔴 *Mais urgentes*', atencao:'🟡 *Atenção*' });
assert.ok(out.includes('🔴 *Mais urgentes* (1)'));
assert.ok(out.includes('🟡 *Atenção* (1)'));
assert.ok(!out.includes('importante'), 'tier vazio não aparece');

// billItem: nome — valor (rel)
assert.strictEqual(
  wa.billItem({ name:'Netflix', amount:57, rel:'há 1d' }),
  '• Netflix — R$ 57,00 _(há 1d)_'
);
// assemble intercala SEP entre blocos não-vazios; ignora vazios.
assert.strictEqual(wa.assemble(['A', '', 'B']), 'A\n━━━━━━━━━━━━━━━\nB');

const { renderFixedBills, renderBillsToPay } = require('../src/finance/wa-format');
const fixed = {
  groups: {
    vencidas: [{ name:'Aluguel', amount:1500, due_day:10, rel:'há 1d' }],
    pendentes: [{ name:'Internet', amount:120, due_day:25, rel:'em 15d' }],
    pagas: [{ name:'Luz', amount:200, due_day:10 }],
    semValor: [{ name:'Gás', amount:0, due_day:25 }],
  },
  totals: { vencidas:1500, pendentes:120, pagas:200, aPagar:1620 }, count:4,
};
const rf = renderFixedBills(fixed);
assert.ok(rf.startsWith('📋 *Suas Contas Fixas*'));
assert.ok(rf.includes('🔴 *Vencidas* (1)'));
assert.ok(rf.includes('✅ *Pagas* (1)'));
assert.ok(rf.includes('⚠️ *Sem valor* (1)'));
assert.ok(rf.includes('💰 *Total a pagar: R$ 1.620,00*'));

const pay = { vencidas:[{name:'Aluguel',amount:1500,rel:'há 1d'}], proximos7:[], restanteMes:[{name:'Internet',amount:120,rel:'em 15d'}], cards:[{name:'Fatura Nubank',amount:2579}], totalPendente:4199 };
const rp = renderBillsToPay(pay);
assert.ok(rp.startsWith('📋 *Suas Contas a Pagar*'));
assert.ok(rp.includes('🔴 *Vencidas* (1)'));
assert.ok(rp.includes('💳 *Faturas* (1)'));
assert.ok(rp.includes('💰 *Total pendente: R$ 4.199,00*'));
// filtro por dia
const rpDia = renderBillsToPay({ filtered:[{name:'Aluguel',amount:1500,due_day:10}], totalPendente:1500, dueDay:10 });
assert.ok(rpDia.includes('vencem dia 10'));
assert.ok(rpDia.includes('💰 *Total: R$ 1.500,00*'));
// vazio
assert.ok(renderBillsToPay({ vencidas:[],proximos7:[],restanteMes:[],cards:[],totalPendente:0 }).includes('Tá tudo pago'));

// Fix C: empty-state de renderFixedBills.
assert.ok(renderFixedBills({ groups:{ vencidas:[],pendentes:[],pagas:[],semValor:[] }, totals:{ aPagar:0 }, count:0 }).includes('ainda não cadastrou'));

console.log('PASS — wa-format kit OK.');
