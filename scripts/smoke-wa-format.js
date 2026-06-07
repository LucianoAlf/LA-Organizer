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

const { balanceLine, positionBlock, renderBalances } = require('../src/finance/wa-format');
assert.strictEqual(balanceLine({ name:'Nubank', icon:'💜', balance:5221, status:'✅' }), '💜 *Nubank* R$ 5.221,00 ✅');
assert.strictEqual(balanceLine({ name:'Cheque', balance:-30 }), '🏦 *Cheque* R$ -30,00 🔴'); // sem status → deriva 🔴 p/ negativo
assert.ok(positionBlock({ totalSaldo:10161, limiteDisponivel:60121, totalDisponivel:70282 }).includes('Total disponível: R$ 70.282,00'));
const bm = { accounts:[{name:'Nubank',icon:'💜',balance:5221,status:'✅'},{name:'Itau',icon:'🧡',balance:4820,status:'✅'}], totalSaldo:10041, limiteDisponivel:1000, totalDisponivel:11041 };
const rb = renderBalances(bm);
assert.ok(rb.startsWith('💰 *Seus Saldos*'));
assert.ok(rb.includes('💜 *Nubank* R$ 5.221,00 ✅'));
assert.ok(rb.includes('💰 *Total: R$ 10.041,00*'));
assert.ok(rb.includes('💳 Limite disponível: R$ 1.000,00'));
assert.ok(renderBalances({ accounts:[], totalSaldo:0, limiteDisponivel:0, totalDisponivel:0 }).includes('ainda não tem'));

const { renderCheckup } = require('../src/finance/wa-format');
const cm = {
  tiers: {
    urgente: [{ name:'Celular', amount:99, hasValue:true, dueLabel:'05/04', message:"A conta 'Celular' venceu em 05/04 e ainda não tem pagamento registrado." }],
    importante: [{ name:'Gas', amount:0, hasValue:false, dueLabel:'25/04', message:"A conta 'Gas' (vence 25/04) está com valor não informado." }],
    atencao: [], ok: [],
  }, totalRelevante:99, headline:'Encontrei 2 pontos que merecem atenção:', count:2,
};
const rc = renderCheckup(cm);
assert.ok(rc.startsWith('🩺 *Checkup das contas*'));
assert.ok(rc.includes('🔴 *Mais urgentes* (1)'));
assert.ok(rc.includes('🟠 *Importantes* (1)'));
assert.ok(rc.includes('💰 R$ 99,00'));
assert.ok(rc.includes('💰 não informado'));
assert.ok(rc.includes('💬'));
assert.ok(renderCheckup({ tiers:{urgente:[],importante:[],atencao:[],ok:[]}, totalRelevante:0, headline:'Suas contas estão em ordem — nada vencido ou pendente de atenção agora. 👍', count:0 }).includes('em ordem'));

const { renderMonthAnalysis } = require('../src/finance/wa-format');
const mm = {
  monthLabel:'abril', receitas:8000,
  comparativo:{ atual:2759, anterior:2000, variation:{ delta:759, pct:38, label:'⬆️ +38%' } },
  ranking:[{label:'Alimentação',total:2239,count:8,pct:81},{label:'Transporte',total:320,count:4,pct:12}],
  porTipo:{ essenciais:2559, estilo:200, essPct:93, estiloPct:7 },
  projecao:{ saldoAtual:10161, aPagar:4329, saldoProjetado:5832 },
  metas:[{name:'Europa',pct:3,current:500,target:15000}],
  tip:'Saldo saudável!', acoes:['quanto gastei esse mês','extrato'],
};
const rm = renderMonthAnalysis(mm);
assert.ok(rm.startsWith('📊 *Análise de abril*'));
assert.ok(rm.includes('⬆️ +38%'));
assert.ok(rm.includes('🥇 Alimentação: R$ 2.239,00 (81%)'));
assert.ok(rm.includes('🏠 Essenciais: 93%'));
assert.ok(rm.includes('Projetado: R$ 5.832,00 ✅'));
assert.ok(rm.includes('🎯 *Metas*'));
assert.ok(rm.includes('💡 *Dica do TOM*'));

console.log('PASS — wa-format kit OK.');
