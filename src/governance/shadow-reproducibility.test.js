const { test } = require('node:test');
const assert = require('node:assert');
const { isReproducible } = require('./shadow-reproducibility');

test('turno curto de confab é reproduzível', () => {
  const r = isReproducible({ category: 'confabulation', summary: 'TOM disse que criou mas nada persistiu', evidence: 'USUÁRIO: cria X\nTOM: ✅ criei', group_id: null });
  assert.strictEqual(r.ok, true);
});
test('finding de grupo NÃO é reproduzível (v1)', () => {
  assert.strictEqual(isReproducible({ category: 'confabulation', group_id: 'g1', evidence: 'x' }).ok, false);
});
test('categoria de cron/multi-turno NÃO é reproduzível', () => {
  assert.strictEqual(isReproducible({ category: 'media_fail', evidence: 'cobrança diária' }).ok, false);
  assert.strictEqual(isReproducible({ category: 'confabulation', evidence: 'fatura parte 1 parte 2 parte 3' }).ok, false);
});
test('sem evidência aferível → não reproduzível', () => {
  for (const v of [null, undefined, {}, { category: 'confabulation' }]) assert.strictEqual(isReproducible(v).ok, false);
});
test('lembrete diário (bug-farol de turno único) É reproduzível — não pode ser excluído como multi-turno', () => {
  const r = isReproducible({
    category: 'confabulation',
    evidence: 'USUÁRIO: me lembra todo dia de X\nTOM: ✅ lembrete diário ativado',
  });
  assert.strictEqual(r.ok, true);
});

// SONDA DE GRUPO (01/09) ----------------------------------------------------
// O gate recusava TODO finding de grupo ('v1 nao encena chat de grupo') desde 22/08 e nunca
// foi tocado. So que o Replay Lab TEM grupo desde 13/08 ([QA] Financeiro Replay). Resultado:
// os bugs que mais doem -- Rose, digest, data -- sao de grupo, entao a sonda nao verificava
// NENHUM deles sozinha, e os achados saiam 'inconclusivo' por construcao.
// O laboratorio existia; o robo e que nao sabia usar.
test('finding de GRUPO com fala literal e encenavel', () => {
  const r = isReproducible({ category: 'confabulation', group_id: 'g1',
    evidence: 'USUÁRIO: sim, pode concluir' + String.fromCharCode(10) + 'TOM: nao achei essa tarefa no grupo' });
  assert.strictEqual(r.ok, true, r.motivo);
});
test('CONTROLE: finding de grupo SEM fala literal segue recusado', () => {
  const r = isReproducible({ category: 'confabulation', group_id: 'g1', summary: 'TOM confabulou no grupo' });
  assert.strictEqual(r.ok, false);
});
test('CONTROLE: grupo nao afrouxa categoria nem multi-turno', () => {
  assert.strictEqual(isReproducible({ category: 'frustration', group_id: 'g1', evidence: 'USUÁRIO: oi' }).ok, false);
  assert.strictEqual(isReproducible({ category: 'confabulation', group_id: 'g1', evidence: 'USUÁRIO: confere a fatura' }).ok, false);
});
