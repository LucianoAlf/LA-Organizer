'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { enforceNoMarkerHonesty } = require('./optimistic-confirm');

// CONFAB-ESTADO-RESULTANTE (audit 25/08, root "afirmação de estado passa inteira").
// Guard roda só sob nothingPersisted. Forma nova que escapava:
//   A) estado resultante em 3ª pessoa ("já estão no banco", "entrou nas recorrências", "fica aberta")
// (a forma C "lista de ✓" foi descartada pelo shadow test — over-fire em recap legítimo do usuário.)
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

// ── C DESCARTADO (shadow test 25/08): agenda de TÍTULOS com ✅ (sem verbo de conclusão) é
// relatório de status legítimo — o padrão "≥2 linhas ✅" comeria a voz. Sem C, sobrevive. ──
test('C-descartado: "• Gerar boletos ✅ / • Conferir Emusys ✅" (títulos, sem verbo) → NÃO dispara', () => {
  const reply = 'Bom dia, Ana! Hoje:\n• Gerar boletos Ifood benefícios ✅\n• Conferir Emusys Recreio e CG ✅';
  assert.equal(scrubbed(reply), false);
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
test('✓ decorativo sozinho (sem verbo) → NÃO dispara', () => {
  assert.equal(scrubbed('Boa ideia ✓'), false);
});
test('NEG geral: nada persistiu falso? guard OFF quando persistiu', () => {
  const out = enforceNoMarkerHonesty('As 3 tarefas já estão no banco.', { nothingPersisted: false }, { meta: true });
  assert.equal(out.fired, false);
});
