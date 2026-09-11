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

// ── MECHANISM-LEAK-CORTA-OPCAO (triagem 11/09 — fdc6f327) ────────────────────────────────
const _ml = require('./mechanism-leak');
const _mlT = require('node:test').test;
const _mlA = require('node:assert');
const _ROSE_1407 = 'Rose, recebi — Latam PASS, fatura julho, 62 itens · R$ 6.008,04. ✅\n\nO sistema já mostra R$ 4.638,21 lançados nesse cartão, mas sem ver os itens individuais não dá pra cruzar item a item. Duas opções:\n\n**(a)** Puxo o extrato do Latam PASS agora pra ver o que já está lá e te mostro só o que falta — sem risco de duplicar.\n\n**(b)** Lançamos tudo e o engine verifica duplicidades na hora.\n\nQual prefere?';
_mlT('Rose 14/07: a opção (b) não some — o termo interno vira palavra comum', () => {
  const r = _ml.stripMechanismLeak(_ROSE_1407);
  _mlA.strictEqual(r.fired, true);
  _mlA.match(r.reply, /\*\*\(b\)\*\* Lançamos tudo e o sistema verifica duplicidades na hora\./);
  _mlA.match(r.reply, /\*\*\(a\)\*\* Puxo o extrato/);
  _mlA.doesNotMatch(r.reply, /engine/i);
});
_mlT('linha comum com vocabulário interno continua saindo inteira', () => {
  const r = _ml.stripMechanismLeak('Fechado, criei o evento.\nDessa vez o marker vai de verdade com bypass_integrity.');
  _mlA.strictEqual(r.reply, 'Fechado, criei o evento.');
});
_mlT('opção que ainda carrega vocabulário interno depois da troca sai (to_name não tem tradução)', () => {
  const r = _ml.stripMechanismLeak('Duas opções:\n(a) Mando pro Yuri.\n(b) Crio com to_name da Fefê.');
  _mlA.strictEqual(r.reply, 'Duas opções:\n(a) Mando pro Yuri.');
});
