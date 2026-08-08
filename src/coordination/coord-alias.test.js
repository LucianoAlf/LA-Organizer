const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeCoordinationFields } = require('./coord-alias');

// COORD-REQUEST-TONAME-ALIAS (audit 14/07): o LLM emite `to_name` (espelhando `from_name`)
// como destinatário do <<COORDINATION_REQUEST>>. A cadeia de aliases do parser cobria
// recipient/to/name mas NÃO to_name → recipient_name:missing → schema_invalid → o recado
// NUNCA saía (81% das rejeições históricas; 100% das de julho: John 14/07, Anne 13/07…).
// Helper puro extraído do engine (1563-1575) + o alias faltante. Aditivo, precedência preserva
// o campo canônico quando presente (zero-regressão do COORD-REQUEST-ALIAS 11/06).

// ── o BUG: to_name vira recipient_name ───────────────────────────────────────
test('John 14/07 REAL: {to_name:"John"} → recipient_name="John"', () => {
  const p = { to_name: 'John', message: 'Passa uma olhada nas tarefas', message_body: 'Passa uma olhada nas tarefas', mode: 'relay_literal' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.recipient_name, 'John');
});
test('Anne 13/07 REAL: {to_name:"Anne"} → recipient_name="Anne"', () => {
  const p = { to_name: 'Anne', message: 'Rafinha já pegou os cheques', message_body: 'Rafinha já pegou os cheques' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.recipient_name, 'Anne');
});

// ── COORD-MODE-DIRECT-E-AUSENTE (08/08) ─────────────────────────────────────
// Depois que o to_name foi resolvido em 14/07, `mode` virou o ÚNICO motivo vivo de rejeição
// da coordenação — os 3 casos de agosto tinham recipient_name e message_body CORRETOS e
// morreram só no mode. Um emitiu "direct"; nos outros o log trunca antes do campo, então
// ausente também precisa ser coberto (a validação é includes() sobre undefined).
test('Krissya 03/08 REAL: mode "direct" → relay_literal (recado sai)', () => {
  const p = { to_name: 'Krissya', message_body: 'Lembrete do Arthur: pegar os fones em CG às 18h40 de hoje.',
              scheduled_at: '2026-08-04T18:40:00-03:00', mode: 'direct', recipient_name: 'Krissya' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.mode, 'relay_literal');
  assert.ok(['relay_literal', 'relay_assisted', 'followup'].includes(p.mode), 'tem que passar na whitelist do engine');
});

test('mode AUSENTE com recado completo → assume relay_literal', () => {
  const p = { to_name: 'Quintela', message_body: 'Rafinha informou que há um violão quebrado na Barra.' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.mode, 'relay_literal');
});

test('outras grafias de envio direto também entram', () => {
  for (const m of ['direto', 'Direct', 'SEND', 'message']) {
    const p = { to_name: 'X', message_body: 'oi', mode: m };
    normalizeCoordinationFields(p);
    assert.strictEqual(p.mode, 'relay_literal', `mode="${m}"`);
  }
});

// FAIL-CLOSED: sem destinatário ou sem texto não há recado — não inventa mode, e o engine
// segue rejeitando. Assumir mode aqui mascararia um marker genuinamente quebrado.
test('mode ausente SEM recado completo → não assume nada', () => {
  const semTexto = { to_name: 'X' };
  normalizeCoordinationFields(semTexto);
  assert.strictEqual(semTexto.mode, undefined);
  const semDest = { message_body: 'oi' };
  normalizeCoordinationFields(semDest);
  assert.strictEqual(semDest.mode, undefined);
});

test('zero-regressão: mode canônico e aliases antigos intactos', () => {
  for (const [entrada, esperado] of [['relay_literal', 'relay_literal'], ['relay_assisted', 'relay_assisted'],
                                     ['followup', 'followup'], ['relay', 'relay_literal'],
                                     ['assisted', 'relay_assisted'], ['follow-up', 'followup']]) {
    const p = { to_name: 'X', message_body: 'oi', mode: entrada };
    normalizeCoordinationFields(p);
    assert.strictEqual(p.mode, esperado, `mode="${entrada}"`);
  }
});

test('mode desconhecido de verdade NÃO vira default — segue inválido', () => {
  const p = { to_name: 'X', message_body: 'oi', mode: 'modo_que_nao_existe' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.mode, 'modo_que_nao_existe', 'o engine tem que continuar rejeitando o que não conhecemos');
});

// ── zero-regressão: aliases já cobertos (COORD-REQUEST-ALIAS 11/06) seguem valendo ──
test('legado: recipient/to/name ainda mapeiam pra recipient_name', () => {
  const a = { recipient: 'Leo' }; normalizeCoordinationFields(a); assert.strictEqual(a.recipient_name, 'Leo');
  const b = { to: 'Dai' };        normalizeCoordinationFields(b); assert.strictEqual(b.recipient_name, 'Dai');
  const c = { name: 'Rafinha' };  normalizeCoordinationFields(c); assert.strictEqual(c.recipient_name, 'Rafinha');
});
test('precedência: recipient_name canônico NÃO é clobber por to_name', () => {
  const p = { recipient_name: 'Quintela', to_name: 'ERRADO' };
  normalizeCoordinationFields(p);
  assert.strictEqual(p.recipient_name, 'Quintela');
});

// ── message_body aliases (message/body/content/text) preservados ──────────────
test('message/body/content/text → message_body', () => {
  const a = { message: 'oi' };  normalizeCoordinationFields(a); assert.strictEqual(a.message_body, 'oi');
  const b = { body: 'oi' };     normalizeCoordinationFields(b); assert.strictEqual(b.message_body, 'oi');
  const c = { content: 'oi' };  normalizeCoordinationFields(c); assert.strictEqual(c.message_body, 'oi');
  const d = { text: 'oi' };     normalizeCoordinationFields(d); assert.strictEqual(d.message_body, 'oi');
});

// ── mode aliases (relay/literal/assisted/follow-up) preservados ───────────────
test('mode aliases normalizam', () => {
  const a = { mode: 'relay' };      normalizeCoordinationFields(a); assert.strictEqual(a.mode, 'relay_literal');
  const b = { mode: 'literal' };    normalizeCoordinationFields(b); assert.strictEqual(b.mode, 'relay_literal');
  const c = { mode: 'assisted' };   normalizeCoordinationFields(c); assert.strictEqual(c.mode, 'relay_assisted');
  const d = { mode: 'follow-up' };  normalizeCoordinationFields(d); assert.strictEqual(d.mode, 'followup');
  const e = { mode: 'relay_literal' }; normalizeCoordinationFields(e); assert.strictEqual(e.mode, 'relay_literal'); // canônico intacto
});

// ── defensivo ─────────────────────────────────────────────────────────────────
// EXPECTATIVA ALTERADA EM 08/08, DE PROPÓSITO — a segunda asserção exigia que um recado
// COMPLETO (destinatário + texto) sem `mode` ficasse com mode=undefined. Na prática isso
// significava `mode:invalid` no engine e o recado nunca saía: foi o que sobrou como único
// motivo vivo de rejeição da coordenação em agosto. Agora recado completo sem mode assume
// relay_literal. O que o teste ancorava de essencial — objeto vazio não inventa nada, e
// campo canônico não é sobrescrito — segue valendo e está coberto acima.
test('defensivo: objeto vazio não inventa campo', () => {
  const a = {}; normalizeCoordinationFields(a);
  assert.strictEqual(a.recipient_name, undefined);
  assert.strictEqual(a.mode, undefined, 'sem recado nenhum, não assume mode');
  const b = { recipient_name: 'X', message_body: 'y' }; normalizeCoordinationFields(b);
  assert.strictEqual(b.recipient_name, 'X');
  assert.strictEqual(b.mode, 'relay_literal', 'recado completo sem mode agora sai em vez de morrer');
});
