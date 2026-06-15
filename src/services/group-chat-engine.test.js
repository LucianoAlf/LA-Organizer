// src/services/group-chat-engine.test.js — foco no buildTomContent (montagem prosa+ações).
const { test } = require('node:test');
const assert = require('node:assert');
const { buildTomContent, ACTIONS_DELIM, friendlyTaskFail } = require('./group-chat-engine');

const prose = (c) => String(c).split(ACTIONS_DELIM)[0].trim();

test('sem ação: prosa pura, sem bloco ACTIONS', () => {
  const c = buildTomContent('Beleza, Rose!', []);
  assert.equal(c, 'Beleza, Rose!');
  assert.ok(!c.includes(ACTIONS_DELIM));
});

test('ação ok + prosa: mantém a prosa do LLM e anexa o bloco', () => {
  const c = buildTomContent('Criei a tarefa!', [{ kind: 'task', status: 'ok', label: 'Tarefa' }]);
  assert.match(c, /^Criei a tarefa!/);
  assert.ok(c.includes(ACTIONS_DELIM));
});

test('FALHA com prosa otimista do LLM: descarta a mentira E manda falha HONESTA (nunca muda no zap)', () => {
  const c = buildTomContent('Pronto, apaguei a tarefa! ✅', [
    { kind: 'task', status: 'fail', label: 'Tarefa', detail: 'não consegui registrar' },
  ]);
  assert.ok(!c.includes('apaguei'), 'não pode repetir a prosa otimista falsa');
  // PROVA do bug Rose 15/06: a prosa (antes do ACTIONS) NÃO pode ser vazia, senão o bridge-out não espelha.
  assert.ok(prose(c).length > 0, 'prosa de falha não pode ser vazia');
  assert.match(prose(c), /não consegui registrar/);
  assert.ok(c.includes(ACTIONS_DELIM));
});

test('FALHA sem prosa nenhuma: ainda manda prosa honesta com o motivo', () => {
  const c = buildTomContent('', [{ kind: 'task', status: 'fail', label: 'Tarefa', detail: 'não achei essa tarefa' }]);
  assert.ok(prose(c).length > 0);
  assert.match(prose(c), /não achei essa tarefa/);
});

test('ação ok SEM prosa: INALTERADO (só o bloco ACTIONS — sucesso não regride)', () => {
  const c = buildTomContent('', [{ kind: 'task', status: 'ok', label: 'Tarefa' }]);
  assert.equal(prose(c), ''); // sucesso sem prosa segue igual ao antes do fix (zero regressão)
  assert.ok(c.includes(ACTIONS_DELIM));
});

test('só <<SILENCIO>> e sem ação → null (silêncio real)', () => {
  assert.equal(buildTomContent('<<SILENCIO>>', []), null);
});

test('prosa vazia e sem ação → null', () => {
  assert.equal(buildTomContent('   ', []), null);
});

test('friendlyTaskFail: tarefa antiga vira explicação útil; motivo desconhecido cai no genérico', () => {
  assert.match(friendlyTaskFail('not_found_or_too_old'), /antiga|recentes|app/);
  assert.match(friendlyTaskFail('not_found_in_pool'), /não achei/);
  assert.equal(friendlyTaskFail('xpto-desconhecido'), 'não consegui registrar');
});
