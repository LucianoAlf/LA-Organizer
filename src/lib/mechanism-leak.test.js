// MECHANISM-LEAK (regra 16 — audit 01/07): vocabulário interno em prosa PT que o STACK_LEAK_RE
// não cobre ("o marker vai de verdade", "com bypass_integrity"). Line-level. Rodar:
//   node --test src/lib/mechanism-leak.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { stripMechanismLeak } = require('./mechanism-leak');

test('caso real: "o marker ... com bypass_integrity" some, o card do evento fica', () => {
  const s = 'Alf, dessa vez o marker vai de verdade — com bypass_integrity pra não travar em duplicidade.\n\n📅 *Reunião Time Gestão*\n🗓️ Sexta 03/07 · 9h–10h\n\nTe aviso conforme cada um confirmar.';
  const r = stripMechanismLeak(s);
  assert.strictEqual(r.fired, true);
  assert.ok(!/marker/i.test(r.reply), 'sem "marker"');
  assert.ok(!/bypass_integrity/i.test(r.reply), 'sem "bypass_integrity"');
  assert.match(r.reply, /Reunião Time Gestão/, 'o card do evento permanece');
  assert.match(r.reply, /Te aviso conforme/, 'a prosa boa permanece');
});

test('fragmento de marker <<...>> é removido', () => {
  const r = stripMechanismLeak('Feito!\n<<EVENT_CREATE>> algo <<END>>');
  assert.strictEqual(r.fired, true);
  assert.match(r.reply, /Feito!/);
});

test('nomes de campo interno (to_name/attendees) somem', () => {
  assert.strictEqual(stripMechanismLeak('Usei to_name pra cada um.').fired, true);
  assert.strictEqual(stripMechanismLeak('Passei os attendees no evento.').fired, true);
});

test('caso real 02/07: "o engine confirmar" some, o resto fica', () => {
  const s = 'Dois ajustes na *Reunião Time Gestão*:\n· Modalidade corrigida → online\n· Matheus sendo adicionado — convite sai quando o engine confirmar';
  const r = stripMechanismLeak(s);
  assert.strictEqual(r.fired, true);
  assert.ok(!/engine/i.test(r.reply), 'sem "engine"');
  assert.match(r.reply, /Modalidade corrigida/, 'a linha boa permanece');
});

test('CONTROLE: "marquei"/"marcador"/"esquema"/"engenharia" NÃO disparam (sem falso-positivo)', () => {
  for (const s of ['✅ Marquei a reunião!', 'Coloquei no marcador de tarefas', 'Fiz um esquema pra você', 'Falei com a engenharia sobre isso']) {
    assert.strictEqual(stripMechanismLeak(s).fired, false, s);
  }
});

test('sem vazamento → intacto', () => {
  const s = '✅ Reunião criada pra sexta 9h! Te aviso conforme confirmarem.';
  const r = stripMechanismLeak(s);
  assert.strictEqual(r.fired, false);
  assert.strictEqual(r.reply, s);
});

test('vazio/nulo seguro', () => {
  assert.deepStrictEqual(stripMechanismLeak(''), { reply: '', fired: false });
  assert.deepStrictEqual(stripMechanismLeak(null), { reply: '', fired: false });
});
