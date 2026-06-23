// src/utils/adherence-projects.test.js
// Classificação de projetos do balanço de aderência: "parado" (trabalho aberto sem atividade)
// vs "pronto pra fechar" (todas as tarefas do collab já concluídas). Caso Matheus 22/06.
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyAdherenceProjects } = require('./adherence-projects');

const CUTOFF = '2026-06-20T19:00:00.000Z'; // ~48h antes de "agora"
const TODAY = '2026-06-22';

test('task aberta e parada → paused', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'Proj Parado', status: 'active' }],
    [{ project_id: 'p1', updated_at: '2026-06-06T12:00:00.000Z', status: 'pending' }],
    CUTOFF, TODAY,
  );
  assert.strictEqual(r.pausedProjects.length, 1);
  assert.strictEqual(r.readyProjects.length, 0);
  assert.strictEqual(r.pausedProjects[0].days_since, 16);
});

test('TODAS as tarefas concluídas → ready (não paused)', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'Inventario Musicalização', status: 'active' }],
    [
      { project_id: 'p1', updated_at: '2026-06-06T12:00:00.000Z', status: 'done' },
      { project_id: 'p1', updated_at: '2026-06-03T12:00:00.000Z', status: 'done' },
    ],
    CUTOFF, TODAY,
  );
  assert.strictEqual(r.pausedProjects.length, 0);
  assert.strictEqual(r.readyProjects.length, 1);
  assert.strictEqual(r.readyProjects[0].name, 'Inventario Musicalização');
  assert.strictEqual(r.readyProjects[0].days_since, 16);
});

test('atividade recente (>= cutoff) → nem paused nem ready', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'Ativo', status: 'active' }],
    [{ project_id: 'p1', updated_at: '2026-06-22T10:00:00.000Z', status: 'pending' }],
    CUTOFF, TODAY,
  );
  assert.strictEqual(r.pausedProjects.length, 0);
  assert.strictEqual(r.readyProjects.length, 0);
});

test('collab sem task no projeto → ignorado', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'Sem task', status: 'active' }], [], CUTOFF, TODAY,
  );
  assert.strictEqual(r.pausedProjects.length, 0);
  assert.strictEqual(r.readyProjects.length, 0);
});

test('done + cancelled (nenhuma aberta) → ready', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'P', status: 'active' }],
    [
      { project_id: 'p1', updated_at: '2026-06-06T12:00:00.000Z', status: 'done' },
      { project_id: 'p1', updated_at: '2026-06-05T12:00:00.000Z', status: 'cancelled' },
    ],
    CUTOFF, TODAY,
  );
  assert.strictEqual(r.readyProjects.length, 1);
  assert.strictEqual(r.pausedProjects.length, 0);
});

test('só cancelled → ignorado (não é "feito" nem "parado")', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'P', status: 'active' }],
    [{ project_id: 'p1', updated_at: '2026-06-06T12:00:00.000Z', status: 'cancelled' }],
    CUTOFF, TODAY,
  );
  assert.strictEqual(r.readyProjects.length, 0);
  assert.strictEqual(r.pausedProjects.length, 0);
});

test('done + aberta parada → paused (ainda tem trabalho aberto)', () => {
  const r = classifyAdherenceProjects(
    [{ id: 'p1', name: 'P', status: 'active' }],
    [
      { project_id: 'p1', updated_at: '2026-06-06T12:00:00.000Z', status: 'done' },
      { project_id: 'p1', updated_at: '2026-06-04T12:00:00.000Z', status: 'in_progress' },
    ],
    CUTOFF, TODAY,
  );
  assert.strictEqual(r.pausedProjects.length, 1);
  assert.strictEqual(r.readyProjects.length, 0);
});

test('ordena por days_since desc e separa os grupos', () => {
  const r = classifyAdherenceProjects(
    [
      { id: 'p1', name: 'ParadoNovo', status: 'active' },
      { id: 'p2', name: 'ParadoVelho', status: 'active' },
      { id: 'p3', name: 'Pronto', status: 'active' },
    ],
    [
      { project_id: 'p1', updated_at: '2026-06-10T12:00:00.000Z', status: 'pending' },
      { project_id: 'p2', updated_at: '2026-06-01T12:00:00.000Z', status: 'pending' },
      { project_id: 'p3', updated_at: '2026-06-08T12:00:00.000Z', status: 'done' },
    ],
    CUTOFF, TODAY,
  );
  assert.deepStrictEqual(r.pausedProjects.map(p => p.name), ['ParadoVelho', 'ParadoNovo']);
  assert.deepStrictEqual(r.readyProjects.map(p => p.name), ['Pronto']);
});
