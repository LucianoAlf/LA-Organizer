'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const p = require('./pix-migracao');

const c = (fatia, nome, extra = {}) => ({
  pagador_chave: `u:${nome}`, pagador_nome: nome, alunos: [nome + ' filho'],
  categoria: fatia === 'autorizacao_pendente' ? 'autorizacao_pendente' : 'migrar',
  fatia: fatia === 'autorizacao_pendente' ? null : fatia, ...extra,
});

test('autorização pendente vem antes do pix avulso, e o resto na ordem combinada', () => {
  const ordem = p.ordenarPorPrioridade([
    c('sem_historico', 'E'), c('cheque', 'C'), c('pix_avulso', 'B'),
    c('autorizacao_pendente', 'A'), c('boleto', 'D'),
  ]).map((x) => x.pagador_nome);
  assert.deepStrictEqual(ordem, ['A', 'B', 'C', 'D', 'E']);
});

test('dentro da mesma fatia, ordena por nome', () => {
  const ordem = p.ordenarPorPrioridade([c('pix_avulso', 'Zeca'), c('pix_avulso', 'Ana')])
    .map((x) => x.pagador_nome);
  assert.deepStrictEqual(ordem, ['Ana', 'Zeca']);
});

test('o lote do dia respeita o tamanho e mantém a prioridade', () => {
  const linhas = [...Array(30)].map((_, i) => c(i < 3 ? 'autorizacao_pendente' : 'pix_avulso', `N${String(i).padStart(2, '0')}`));
  const lote = p.loteDoDia(linhas, { tamanho: p.LOTE_DIARIO });
  assert.strictEqual(lote.length, 10);
  assert.strictEqual(lote.filter((x) => x.categoria === 'autorizacao_pendente').length, 3);
});

test('contagem por fatia inclui a autorização pendente como fatia própria', () => {
  const m = p.contagemPorFatia([c('pix_avulso', 'A'), c('pix_avulso', 'B'), c('autorizacao_pendente', 'C')]);
  assert.strictEqual(m.get('pix_avulso'), 2);
  assert.strictEqual(m.get('autorizacao_pendente'), 1);
});

test('título da filha leva o pagador e os alunos, sem telefone nem valor', () => {
  const t = p.tituloDaFilha({ ...c('pix_avulso', 'Maria'), alunos: ['João', 'Ana'] });
  assert.strictEqual(t, 'PIX automático — Maria (João, Ana)');
  assert.ok(!/\d{4}/.test(t));
});

test('mensagem: cabeçalho com total e meta, lote por extenso, resto contado', () => {
  const linhas = [
    { pagador_chave: 'a', pagador_nome: 'Ana Lima', alunos: ['Rafa'], categoria: 'autorizacao_pendente', fatia: null },
    { pagador_chave: 'b', pagador_nome: 'Bruno Sá', alunos: ['Léo'], categoria: 'migrar', fatia: 'pix_avulso' },
    { pagador_chave: 'c', pagador_nome: 'Carla Dias', alunos: ['Tina'], categoria: 'migrar', fatia: 'cheque' },
  ];
  const txt = p.mensagemDaUnidade({ unidadeNome: 'Campo Grande', linhas, lote: linhas.slice(0, 2) });
  assert.match(txt, /^💠 \*PIX automático — Campo Grande\* · faltam 3 · meta 31\/10$/m);
  assert.match(txt, /🔵 \*Cadastrados sem cobrança\* \(1\) — resolver primeiro\n {3}• Ana Lima \(Rafa\)/);
  assert.match(txt, /🔴 \*Pix avulso\* \(1\)\n {3}• Bruno Sá \(Léo\)/);
  assert.match(txt, /🟠 Cheque \(1\)/, 'fatia fora do lote aparece contada');
  assert.ok(!txt.includes('Carla Dias'), 'quem não está no lote não é citado');
});

test('mensagem: fatia sem ninguém não aparece', () => {
  const txt = p.mensagemDaUnidade({ unidadeNome: 'Barra', linhas: [{ pagador_nome: 'X', alunos: [], categoria: 'migrar', fatia: 'pix_avulso', pagador_chave: 'x' }], lote: [] });
  assert.ok(!txt.includes('Cheque'));
});

test('mensagem: fonte velha não publica número, avisa', () => {
  const txt = p.mensagemDaUnidade({ unidadeNome: 'Barra', linhas: [], lote: [], fonteVelha: true });
  assert.match(txt, /não atualizou/i);
  assert.ok(!/\(\d+\)/.test(txt));
});
