const assert = require('assert');
const { diasRestantesDoMes, billDueDeltaDays, billRelativeLabel } = require('../src/finance/report-domain');

// diasRestantesDoMes: dias após hoje até o fim do mês.
assert.strictEqual(diasRestantesDoMes('2026-04-10'), 20, 'abril tem 30 dias → 30-10');
assert.strictEqual(diasRestantesDoMes('2026-02-28'), 0, 'fev/2026 (28 dias)');

// billDueDeltaDays: delta em dias (neg = vencida, 0 = hoje, pos = futuro).
const monthly = { recurrence: 'monthly', due_day: 10 };
assert.strictEqual(billDueDeltaDays(monthly, '2026-04-10'), 0);
assert.strictEqual(billDueDeltaDays(monthly, '2026-04-04'), 6);
assert.strictEqual(billDueDeltaDays(monthly, '2026-04-16'), -6);
const once = { recurrence: 'once', due_date: '2026-04-15' };
assert.strictEqual(billDueDeltaDays(once, '2026-04-10'), 5);

// billRelativeLabel
assert.strictEqual(billRelativeLabel(monthly, '2026-04-10'), 'vence hoje');
assert.strictEqual(billRelativeLabel(monthly, '2026-04-04'), 'em 6d');
assert.strictEqual(billRelativeLabel(monthly, '2026-04-16'), 'há 6d');

const { classifyBillSeverity } = require('../src/finance/report-domain');
const T = '2026-04-10';
// 🔴 urgente: vencida sem pagar OU vence hoje sem pagar
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:5, amount:99, last_paid_at:null }, T), 'urgente');
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:10, amount:99, last_paid_at:null }, T), 'urgente');
// 🟠 importante: vence em 1–7d com valor; OU valor zerado (qualquer prazo)
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:15, amount:250, last_paid_at:null }, T), 'importante');
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:25, amount:0, last_paid_at:null }, T), 'importante');
// 🟡 atenção: vence em 8–15d com valor
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:23, amount:100, last_paid_at:null }, T), 'atencao');
// 🟢 ok: paga no ciclo OU vence >15d com valor
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:10, amount:99, last_paid_at:'2026-04-03' }, T), 'ok');
assert.strictEqual(classifyBillSeverity({ recurrence:'monthly', due_day:28, amount:100, last_paid_at:null }, T), 'ok');

// Fix A: clamp due_day > fim do mês (fev tem 28 dias em 2026 → 31 vira 28).
assert.strictEqual(billDueDeltaDays({ recurrence:'monthly', due_day:31 }, '2026-02-10'), 18);
// Fix A: once sem due_date → null (sem NaN).
assert.strictEqual(billDueDeltaDays({ recurrence:'once', due_date:null }, '2026-04-10'), null);
assert.strictEqual(billRelativeLabel({ recurrence:'once', due_date:null }, '2026-04-10'), '');
assert.strictEqual(classifyBillSeverity({ recurrence:'once', due_date:null, amount:100, last_paid_at:null }, '2026-04-10'), 'importante');

console.log('PASS — report-domain datas/label OK.');
