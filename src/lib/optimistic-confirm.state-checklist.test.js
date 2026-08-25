'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { enforceNoMarkerHonesty, hasCompletionClaim, hasCheckmarkCompletionList } = require('./optimistic-confirm');

// CONFAB-ESTADO-E-CHECKLIST (audit 25/08, root "afirmação de estado passa inteira").
// Guard roda só sob nothingPersisted. Duas formas novas que escapavam:
//   A) estado resultante em 3ª pessoa ("já estão no banco", "entrou nas recorrências", "fica aberta")
//   C) lista de conclusão com ✓ por item (>=2 linhas)
const OFF = { nothingPersisted: true };

function scrubbed(reply) {
  // true = o guard disparou e removeu a claim (a fala NÃO sobreviveu intacta)
  const out = enforceNoMarkerHonesty(reply, OFF, { meta: true });
  return out.fired;
}

// ── A: estado resultante (RED — hoje escapa) ──────────────────────────────
test('A1: "As 3 tarefas já estão no banco" → dispara', () => {
  assert.equal(scrubbed('As 3 tarefas já estão no banco com prazo amanhã (27/07). Travando o plano agora:'), true);
});
test('A2: "entrou nas suas recorrências" → dispara', () => {
  assert.equal(scrubbed('🆕 *Kayo Advogado Setembro 27* (R$ 390,00/mês) entrou nas suas recorrências.'), true);
});
test('A3: "Tarefa fica aberta até sábado" → dispara', () => {
  assert.equal(scrubbed('Tarefa fica aberta até sábado pra você fechar o registro completo.'), true);
});

// ── C: lista de ✓ (RED — hoje escapa) ─────────────────────────────────────
test('C: 2+ linhas "• título ✓" → dispara e limpa', () => {
  const reply = '• Reunião com Juliana ✓\n• Reunião com Rafinha ✓\nJunho encerrado redondo. 💪';
  assert.equal(hasCheckmarkCompletionList(reply), true);
  const out = enforceNoMarkerHonesty(reply, OFF, { meta: true });
  assert.equal(out.fired, true);
  assert.ok(!/Juliana ✓/.test(out.reply), 'a linha de checkmark deve sair');
  assert.ok(/não consegui registrar/i.test(out.reply), 'nota honesta anexada');
});

// ── Não-regressão: legítimas que PRECISAM sobreviver ──────────────────────
test('NEG A: "já tava marcado" (imperfeito, pré-existente) → NÃO dispara', () => {
  assert.equal(scrubbed('Comprar enfeite já tava marcado pra essa semana.'), false);
});
test('NEG A: "a loja fica aberta até 22h" (sem contexto de tarefa) → NÃO dispara', () => {
  assert.equal(scrubbed('A loja fica aberta até 22h nos dias de semana.'), false);
});
test('NEG A: pergunta "está no banco?" → NÃO dispara', () => {
  assert.equal(scrubbed('Essa tarefa já está no banco?'), false);
});
test('NEG A: negação "não está no banco ainda" → NÃO dispara', () => {
  assert.equal(scrubbed('Isso não está no banco ainda — me confirma?'), false);
});
test('NEG C: 1 checkmark decorativo sozinho → NÃO dispara', () => {
  assert.equal(hasCheckmarkCompletionList('Boa ideia ✓'), false);
  assert.equal(scrubbed('Boa ideia ✓'), false);
});
test('NEG geral: nada persistiu falso? guard OFF quando persistiu', () => {
  const out = enforceNoMarkerHonesty('As 3 tarefas já estão no banco.', { nothingPersisted: false }, { meta: true });
  assert.equal(out.fired, false);
});
