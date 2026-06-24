const { test } = require('node:test');
const assert = require('node:assert');
const { shouldMaterializeTemplate } = require('./recurrence-guard');

// RECUR-RESURRECT-CALLER-GUARD (caso Gabi/equipe 24/06)
// O guard "não materializar molde fechado" existia só no materializeAll (cron).
// As outras portas (engine ao criar/mexer, PWA criar/editar, grupo revive) chamavam
// materializeSeries SEM o guard → instância de molde done/cancelled "voltava" (Gabi:
// "apago e volta"). Este helper centraliza a decisão num ponto único e testável.

// --- O FIX: molde fechado NÃO materializa ---
test('molde DONE → NÃO materializa (caso Gabi: concluiu e a tarefa voltava)', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'done' }), false);
});
test('molde CANCELLED → NÃO materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'cancelled' }), false);
});

// --- OS 3 FLUXOS QUE NÃO PODEM QUEBRAR (travados ANTES de mexer no código) ---
test('NÃO QUEBRA: molde pending (tarefa recorrente nova/ativa) → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'pending' }), true);
});
test('NÃO QUEBRA: molde scheduled (evento recorrente novo) → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'scheduled' }), true);
});
test('NÃO QUEBRA: revive (reviveSeries seta pending ANTES de materializar) → materializa', () => {
  assert.strictEqual(
    shouldMaterializeTemplate({ status: 'pending', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
    true
  );
});

// --- FAIL-OPEN: status desconhecido NUNCA bloqueia (preserva comportamento atual) ---
test('fail-open: objeto sem status → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ id: 'x', recurrence_rule: 'FREQ=DAILY' }), true);
});
test('fail-open: status null/undefined/template null → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: null }), true);
  assert.strictEqual(shouldMaterializeTemplate({ status: undefined }), true);
  assert.strictEqual(shouldMaterializeTemplate(null), true);
  assert.strictEqual(shouldMaterializeTemplate(undefined), true);
});
test('só bloqueia done/cancelled: awaiting_confirmation/in_progress → materializa', () => {
  assert.strictEqual(shouldMaterializeTemplate({ status: 'awaiting_confirmation' }), true);
  assert.strictEqual(shouldMaterializeTemplate({ status: 'in_progress' }), true);
});
