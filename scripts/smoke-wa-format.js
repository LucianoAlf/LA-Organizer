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

console.log('PASS — wa-format kit OK.');
