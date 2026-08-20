const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeHabitAliases } = require('./habit-field-alias');

// HABIT-FIELD-ALIAS-HABIT (Ana Paula 08/07 21:09): o LLM emitiu
// [{"action":"log","habit":"Ir para academia"},{"action":"log","habit":"Usar bombinha Asma Alice"}]
// → schema_invalid (o fallback de aliases cobria habit_slug/title, não `habit`).
// O chokepoint segurou a mentira, mas a ação se perdeu ("não executei, me pede de novo").

test('caso Ana Paula REAL: log com `habit` → habit_name', () => {
  const a = { action: 'log', habit: 'Ir para academia' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, 'Ir para academia');
});

test('aliases atuais preservados: habit_slug (com troca de -/_) e title', () => {
  const slug = { action: 'log', habit_slug: 'usar-bombinha_asma' };
  normalizeHabitAliases(slug);
  assert.strictEqual(slug.habit_name, 'usar bombinha asma');

  const title = { action: 'delete', title: 'Beber água' };
  normalizeHabitAliases(title);
  assert.strictEqual(title.habit_name, 'Beber água');
});

test('precedência: habit_slug > habit > title', () => {
  const a = { action: 'log', habit_slug: 'do-slug', habit: 'do habit', title: 'do title' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, 'do slug');

  const b = { action: 'log', habit: 'do habit', title: 'do title' };
  normalizeHabitAliases(b);
  assert.strictEqual(b.habit_name, 'do habit');
});

test('NÃO clobber: habit_id ou habit_name presentes → intacto', () => {
  const withId = { action: 'log', habit_id: 'x1', habit: 'outra coisa' };
  normalizeHabitAliases(withId);
  assert.strictEqual(withId.habit_name, undefined);

  const withName = { action: 'log', habit_name: 'oficial', habit: 'alias' };
  normalizeHabitAliases(withName);
  assert.strictEqual(withName.habit_name, 'oficial');
});

test('create: title → name (comportamento atual); não mexe em habit_name', () => {
  const a = { action: 'create', title: 'Ir pra academia' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.name, 'Ir pra academia');
  assert.strictEqual(a.habit_name, undefined);
});

test('create com name já definido → não sobrescreve', () => {
  const a = { action: 'create', name: 'Oficial', title: 'Alias' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.name, 'Oficial');
});

test('query_progress também normaliza; ação fora da lista não mexe', () => {
  const q = { action: 'query_progress', habit: 'Leitura' };
  normalizeHabitAliases(q);
  assert.strictEqual(q.habit_name, 'Leitura');

  const other = { action: 'update', habit: 'Leitura' };
  normalizeHabitAliases(other);
  assert.strictEqual(other.habit_name, undefined);
});

test('defensivo: null/não-objeto/valores não-string não quebram', () => {
  assert.doesNotThrow(() => normalizeHabitAliases(null));
  assert.doesNotThrow(() => normalizeHabitAliases('x'));
  const a = { action: 'log', habit: 123 };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, undefined);
});

// ── HABIT-ACTION-SO-ACEITA-ID-REJEITA-TITULO (Bianca 20/08) ────────────────────
// O LLM emitiu <<HABIT_ACTION>>{"action":"log","habit_title":"Tomar remédios"}<<END>>
// → validateHabitAction devolveu `bad_habit_id` → o bloco INTEIRO foi dropado e o
// hábito nunca foi registrado; ela só viu a reação ✅ (que não é afirmação de texto,
// então o chokepoint de honestidade não dispara). Terceira vez na MESMA família
// (habit_slug/title 22/06 · habit 08/07 · habit_title agora): o defeito não é
// "falta o alias X", é a LISTA — o LLM prefixa um sufixo já aceito com `habit_` e
// a enumeração não cobre o produto cartesiano. A regra passa a GERAR os candidatos.
test('caso Bianca REAL: log com `habit_title` → habit_name', () => {
  const a = { action: 'log', habit_title: 'Tomar remédios' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, 'Tomar remédios');
});

test('produto cartesiano: qualquer sufixo aceito vale com e sem o prefixo `habit_`', () => {
  const casos = [
    ['habit_title', 'Tomar remédios'], ['title', 'Tomar remédios'],
    ['habit_titulo', 'Tomar remédios'], ['titulo', 'Tomar remédios'],
    ['habit_nome', 'Tomar remédios'], ['nome', 'Tomar remédios'],
    ['name', 'Tomar remédios'],
  ];
  for (const [chave, valor] of casos) {
    const a = { action: 'log', [chave]: valor };
    normalizeHabitAliases(a);
    assert.strictEqual(a.habit_name, valor, `alias ${chave} não resolveu`);
  }
});

test('slug desidrata hífen/underline com OU sem prefixo; os outros sufixos vêm crus', () => {
  const comPrefixo = { action: 'log', habit_slug: 'tomar-remedios' };
  normalizeHabitAliases(comPrefixo);
  assert.strictEqual(comPrefixo.habit_name, 'tomar remedios');

  const semPrefixo = { action: 'log', slug: 'tomar_remedios' };
  normalizeHabitAliases(semPrefixo);
  assert.strictEqual(semPrefixo.habit_name, 'tomar remedios');

  // título com hífen legítimo não pode ser mutilado
  const titulo = { action: 'log', habit_title: 'Auto-exame mensal' };
  normalizeHabitAliases(titulo);
  assert.strictEqual(titulo.habit_name, 'Auto-exame mensal');
});

test('create: o prefixo `habit_` também vale pro nome (mesma raiz da Bianca)', () => {
  const a = { action: 'create', habit_title: 'Tomar remédios' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.name, 'Tomar remédios');
});

test('precedência estável mesmo com prefixo misturado', () => {
  const a = { action: 'log', habit_title: 'do title', habit_slug: 'do-slug', habit: 'do habit' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, 'do slug');

  const b = { action: 'log', habit_title: 'do title', habit: 'do habit' };
  normalizeHabitAliases(b);
  assert.strictEqual(b.habit_name, 'do habit');
});

test('`habit_name` oficial nunca é tratado como alias de si mesmo', () => {
  const a = { action: 'log', habit_name: '   ' };
  normalizeHabitAliases(a);
  assert.strictEqual(a.habit_name, '   ', 'não deve reescrever o campo oficial');
});
