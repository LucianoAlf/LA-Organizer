'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { ehNomeQA, idsQA, foraDoQA } = require('./perfis-qa');

// Auditoria 12/09: os 7 disparos de CHOKEPOINT eram 6 do replay + 1 do Leo (pessoa real).
const COLABS = [
  { id: 'qa1', full_name: '[QA] Replay 01' },
  { id: 'qa2', full_name: '[QA] Replay 02' },
  { id: 'leo', full_name: 'Leo' },
];
const METRICAS = [
  { collaborator_id: 'qa1', fallback_from: 'claude' },
  { collaborator_id: 'qa1', fallback_from: 'claude' },
  { collaborator_id: 'leo', fallback_from: null },
  { collaborator_id: null, fallback_from: null },
];

test('perfil de replay é o nome que COMEÇA com [QA]; no meio do nome não conta', () => {
  assert.strictEqual(ehNomeQA('[QA] Replay 01'), true);
  assert.strictEqual(ehNomeQA(' [qa] replay 02'), true);
  assert.strictEqual(ehNomeQA('Leo'), false);
  assert.strictEqual(ehNomeQA('Ana [QA] Souza'), false);
  assert.strictEqual(ehNomeQA(null), false);
});

test('ids de replay saem da lista de colaboradores', () => {
  assert.deepStrictEqual([...idsQA(COLABS)].sort(), ['qa1', 'qa2']);
  assert.deepStrictEqual([...idsQA(null)], []);
});

test('a amostra perde as linhas do replay e mantém as de produção, inclusive sem dono', () => {
  const fora = foraDoQA(METRICAS, idsQA(COLABS));
  assert.strictEqual(fora.length, 2);
  assert.deepStrictEqual(fora.map((l) => l.collaborator_id), ['leo', null]);
  assert.strictEqual(foraDoQA(METRICAS, []).length, 4);
  assert.deepStrictEqual(foraDoQA(null, idsQA(COLABS)), []);
});

test('linha vazia é lixo e sai da conta (não vira mensagem de produção)', () => {
  assert.strictEqual(foraDoQA([null, { collaborator_id: 'leo' }, undefined], idsQA(COLABS)).length, 1);
});

const HC = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'rituals', 'health-check.js'), 'utf8');
test('health check: a saúde do provedor mede sem os perfis de replay', () => {
  assert.match(HC, /const dados = foraDoQA\(data \|\| \[\], idsQA\(_qaRows \|\| \[\]\)\);/);
  assert.match(HC, /\.select\('collaborator_id, latency_ms, provider_used, fallback_from, error_kind'\)/);
  assert.ok(!/const n = data\.length;/.test(HC), 'a conta ainda usa a amostra crua');
});
