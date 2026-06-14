const { test } = require('node:test');
const assert = require('node:assert');
const { buildReconcileReport, buildNoonNudge, emojiForPluggyCat, cleanLabel, ddmm } = require('./reconcile-report');

test('helpers: emoji por categoria, label limpo, data DD/MM', () => {
  assert.equal(emojiForPluggyCat('Food delivery', 'out'), '🍔');
  assert.equal(emojiForPluggyCat('Transfers', 'in'), '💰'); // entrada sempre 💰
  assert.equal(emojiForPluggyCat(null, 'in'), '💰');
  assert.equal(emojiForPluggyCat(null, 'out'), '💸');
  assert.equal(cleanLabel('Transferência enviada|ANNE SUSAN COR'), 'ANNE SUSAN COR');
  assert.equal(cleanLabel('Compra no débito|PLEIDISCO'), 'PLEIDISCO');
  assert.equal(cleanLabel('IFD*JATOBA BOUTIQUE LA'), 'JATOBA BOUTIQUE LA');
  assert.equal(ddmm('2026-04-28'), '28/04');
});

test('relatório completo: conciliados + pendentes + backlog + coaching + saldo', () => {
  const m = buildReconcileReport({
    nome: 'Alf', conciliadoCount: 29,
    pendentes: [
      { emoji: '💸', amount: 8350, direction: 'out', label: 'Anne Susan', date: '28/04' },
      { emoji: '💰', amount: 3600, direction: 'in', label: 'Escola de Música', date: '22/05' },
    ],
    backlogExtra: 433,
    healthLine: '🩺 *Saúde financeira: 18/100* 🔴\nMaior alavanca: você fechou o mês no vermelho.',
    saldoReal: 10193,
  });
  assert.match(m, /fechamento do dia/);
  assert.match(m, /29/);
  assert.match(m, /8\.350,00/);
  assert.match(m, /Anne Susan/);
  assert.match(m, /Escola de Música/);
  assert.match(m, /433/);
  assert.match(m, /18\/100/);
  assert.match(m, /10\.193,00/);
  assert.match(m, /Responde/);
});

test('sem conciliados e sem pendentes → vazio (não envia)', () => {
  assert.equal(buildReconcileReport({ nome: 'Alf', conciliadoCount: 0, pendentes: [], backlogExtra: 0 }), '');
});

test('só conciliados (nada pendente) → mostra ✅, sem a seção ❌ nem "Responde"', () => {
  const m = buildReconcileReport({ nome: 'Alf', conciliadoCount: 5, pendentes: [], backlogExtra: 0, saldoReal: 100 });
  assert.match(m, /tudo certo/i);
  assert.doesNotMatch(m, /Me conta/);
  assert.doesNotMatch(m, /Responde/);
});

test('relatório mostra divergência de saldo (app × real)', () => {
  const m = buildReconcileReport({ nome: 'Alf', conciliadoCount: 0, pendentes: [], divergencias: [{ conta: 'Nubank', saldoApp: 1000, saldoReal: 1200, diff: -200 }] });
  assert.match(m, /Saldo não bate/);
  assert.match(m, /Nubank/);
  assert.match(m, /faltam R\$ 200,00 no app/);
});

test('buildNoonNudge: com pendentes lista; sem → vazio', () => {
  const m = buildNoonNudge({ nome: 'Alf', pendentes: [{ emoji: '💸', amount: 500, direction: 'out', label: 'Loja X', date: '14/06' }] });
  assert.match(m, /500,00/);
  assert.match(m, /Loja X/);
  assert.equal(buildNoonNudge({ nome: 'Alf', pendentes: [] }), '');
});
