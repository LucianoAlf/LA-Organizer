'use strict';
// TASK-TITLE-FUZZY-RESOLVE — fallback estrutural de resolução de tarefa por título.
//
// Raiz (audit 27/07, dor #1 do TASK_UPDATE, 14% de falha): os handlers de complete/cancel/
// reschedule resolvem a tarefa por SUBSTRING (`ilike '%titulo%'`). Quando o TOM ABREVIA ou
// reordena o título ("Suporte caneta/apagador" vs a tarefa real "Providenciar suporte para
// caneta de lousa e apagador"), as palavras não são contíguas → o substring volta vazio → a
// ação some (caso Dai 17/08: "Registrei 1 de 4, algumas falharam"; mesma família de Mayra).
//
// Fix estrutural (aprovado pelo Alf): quando o substring falha, cair num fallback por
// SOBREPOSIÇÃO DE TOKENS que SÓ aceita match ÚNICO — se ≥2 candidatos servem (o risco dos
// 60% de títulos duplicados que o audit aponta), devolve `ambiguous` e o caller PERGUNTA em
// vez de fechar a errada. Puramente aditivo: só roda quando o caminho por substring não achou.
//
// Sinal = CONTAINMENT (tokens do pedido ⊆ tokens da tarefa), que modela abreviação melhor que
// Jaccard puro (o Jaccard pune os tokens extras do título completo). Guard: pedido precisa de
// ≥2 tokens úteis (1 token só é ambíguo demais — "reunião" está contido em tudo).

const test = require('node:test');
const assert = require('node:assert');
const { resolveByTitleFuzzy } = require('./task-title-resolver');

test('abreviação com match único resolve — caso Dai 17/08', () => {
  const req = 'Suporte caneta/apagador';
  const cands = [
    { id: 'a', title: 'Providenciar suporte para caneta de lousa e apagador' },
    { id: 'b', title: 'Comprar tinta para impressora' },
    { id: 'c', title: 'Agendar reunião com fornecedor' },
  ];
  const r = resolveByTitleFuzzy(req, cands);
  assert.strictEqual(r.match && r.match.id, 'a');
  assert.strictEqual(r.ambiguous, false);
});

test('paráfrase com match único resolve — "cobrar rafinha material"', () => {
  const req = 'cobrar rafinha material';
  const cands = [
    { id: 'a', title: 'Cobrar Rafinha — status das compras de material' },
    { id: 'b', title: 'Pagar fornecedor de LED' },
  ];
  const r = resolveByTitleFuzzy(req, cands);
  assert.strictEqual(r.match && r.match.id, 'a');
  assert.strictEqual(r.ambiguous, false);
});

test('DOIS candidatos servem → ambíguo, NÃO chuta (guard anti-título-duplicado)', () => {
  const req = 'Reunião equipe';
  const cands = [
    { id: 'a', title: 'Reunião equipe pedagógica' },
    { id: 'b', title: 'Reunião equipe comercial' },
  ];
  const r = resolveByTitleFuzzy(req, cands);
  assert.strictEqual(r.match, null);
  assert.strictEqual(r.ambiguous, true);
});

test('token comum único NÃO casa (anti-overfit) — "material escolar" vs "material de limpeza"', () => {
  const req = 'material escolar novo';
  const cands = [{ id: 'a', title: 'Comprar material de limpeza' }];
  const r = resolveByTitleFuzzy(req, cands);
  assert.strictEqual(r.match, null);
  assert.strictEqual(r.ambiguous, false);
});

test('nada parecido → sem match, sem ambiguidade', () => {
  const req = 'Comprar bola de futebol';
  const cands = [{ id: 'a', title: 'Enviar relatório mensal' }];
  const r = resolveByTitleFuzzy(req, cands);
  assert.strictEqual(r.match, null);
  assert.strictEqual(r.ambiguous, false);
});

test('pedido de 1 token só NUNCA auto-resolve (guard de ≥2 tokens)', () => {
  const req = 'Reunião';
  const cands = [{ id: 'a', title: 'Reunião ADM de segunda' }];
  const r = resolveByTitleFuzzy(req, cands);
  assert.strictEqual(r.match, null);
});

test('entradas vazias/inválidas não lançam', () => {
  assert.doesNotThrow(() => resolveByTitleFuzzy('', []));
  assert.doesNotThrow(() => resolveByTitleFuzzy(null, null));
  assert.doesNotThrow(() => resolveByTitleFuzzy('x', [{ id: 'a' }]));
});
