'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { registrarAparicoes, gravarResultado, contarFalhas } = require('./anamnese-pauta-repo');

// supabase de mentira: encadeável, guarda o que foi escrito, devolve o que mandarmos
function fakeSb({ rows = [], erro = null } = {}) {
  const escritas = [];
  const api = {
    _escritas: escritas,
    from() { return api; },
    insert(v) { escritas.push({ op: 'insert', v }); return api; },
    update(v) { escritas.push({ op: 'update', v }); return api; },
    upsert(v, o) { escritas.push({ op: 'upsert', v, o }); return api; },
    select() { return api; },
    eq(c, v) { escritas.push({ op: 'eq', c, v }); return api; },
    in() { return api; },
    then(res) { return Promise.resolve({ data: rows, error: erro }).then(res); },
  };
  return api;
}

test('registrarAparicoes grava uma linha por pessoa, idempotente', async () => {
  const sb = fakeSb();
  const r = await registrarAparicoes(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoas: ['pk1', 'pk2'] });
  assert.strictEqual(r.erro, null);
  assert.strictEqual(r.gravadas, 2);
  const up = sb._escritas.find((e) => e.op === 'upsert');
  assert.ok(up, 'usa upsert — o ritual pode rodar duas vezes no mesmo slot');
  assert.strictEqual(up.o.onConflict, 'unidade_id,pessoa_chave,dia');
});

test('registrarAparicoes com lista vazia não escreve nada', async () => {
  const sb = fakeSb();
  const r = await registrarAparicoes(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoas: [] });
  assert.strictEqual(r.gravadas, 0);
  assert.strictEqual(sb._escritas.length, 0);
});

test('erro de escrita é DITO, não engolido', async () => {
  const sb = fakeSb({ erro: { message: 'boom' } });
  const r = await registrarAparicoes(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoas: ['pk1'] });
  assert.strictEqual(r.gravadas, 0);
  assert.match(r.erro, /boom/);
});

test('contarFalhas conta só nao_preencheu, por pessoa', async () => {
  const sb = fakeSb({ rows: [
    { pessoa_chave: 'pk1', resultado: 'nao_preencheu' },
    { pessoa_chave: 'pk1', resultado: 'nao_preencheu' },
    { pessoa_chave: 'pk2', resultado: 'nao_preencheu' },
  ] });
  const m = await contarFalhas(sb, { unidadeId: 'u1', pessoas: ['pk1', 'pk2', 'pk3'] });
  assert.strictEqual(m.get('pk1'), 2);
  assert.strictEqual(m.get('pk2'), 1);
  assert.strictEqual(m.get('pk3') || 0, 0);
});

// Map vazio significa "ninguém falhou". Erro de leitura NÃO pode dizer isso.
test('contarFalhas devolve null em erro de leitura, nunca Map vazio', async () => {
  const sb = fakeSb({ erro: { message: 'timeout' } });
  assert.strictEqual(await contarFalhas(sb, { unidadeId: 'u1', pessoas: ['pk1'] }), null);
});

test('gravarResultado casa a linha e devolve true', async () => {
  const sb = fakeSb({ rows: [{ id: 'row1' }] });
  const ok = await gravarResultado(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoaChave: 'pk1', resultado: 'preencheu' });
  assert.strictEqual(ok, true);
});

test('gravarResultado devolve false em erro do banco', async () => {
  const sb = fakeSb({ erro: { message: 'x' } });
  const ok = await gravarResultado(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoaChave: 'pk1', resultado: 'preencheu' });
  assert.strictEqual(ok, false);
});

// Correção 1: o PostgREST devolve error:null quando o UPDATE não casa NENHUMA linha — zero
// linhas é SQL válido, não é erro. Sem o .select() no repo, isto voltava `true` sem ter
// gravado nada (dia trocado por fuso, ou linha que registrarAparicoes nunca criou). Este é
// o teste que trava essa regressão.
test('gravarResultado devolve false quando o UPDATE casa ZERO linhas, mesmo com error: null', async () => {
  const sb = fakeSb({ rows: [] });
  const ok = await gravarResultado(sb, { unidadeId: 'u1', dia: '2026-09-10', pessoaChave: 'pk1', resultado: 'preencheu' });
  assert.strictEqual(ok, false);
});
