const test = require('node:test');
const assert = require('node:assert');
const { acharDuplicatas, acharAlvo } = require('./credencial-duplicata');

const EXISTENTES = [
  { id: '1', nome: 'Gmail — Escola de Música LA (YouTube/Google Ads)', servico: 'Gmail', projeto: 'Marketing',
    campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }, { label: 'Senha', valor: 'x' }] },
  { id: '2', nome: 'Gmail — LA Music Barra', servico: 'Gmail', projeto: 'Marketing',
    campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
  { id: '3', nome: 'Cloudflare — DNS/CDN', servico: 'Cloudflare', projeto: 'Landing Pages', campos: [] },
];

test('valor de campo igual e sinal de forca alta', () => {
  const d = acharDuplicatas({ nome: 'Conta nova', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }, EXISTENTES);
  assert.equal(d.length, 1);
  assert.equal(d[0].cred.id, '1');
  assert.equal(d[0].forca, 'alta');
});

test('comparacao de valor ignora caixa e espacos', () => {
  const d = acharDuplicatas({ nome: 'X', campos: [{ label: 'E-mail', valor: '  ESCOLA@Gmail.com ' }] }, EXISTENTES);
  assert.equal(d[0].cred.id, '1');
});

test('mesmo servico e projeto e forca media', () => {
  const d = acharDuplicatas({ nome: 'Outra conta', servico: 'Gmail', projeto: 'Marketing', campos: [] }, EXISTENTES);
  assert.equal(d.length, 2);
  assert.equal(d[0].forca, 'media');
});

test('nome parecido e forca baixa', () => {
  const d = acharDuplicatas({ nome: 'cloudflare', campos: [] }, EXISTENTES);
  assert.equal(d.length, 1);
  assert.equal(d[0].cred.id, '3');
  assert.equal(d[0].forca, 'baixa');
});

test('resultado vem ordenado da forca maior para a menor', () => {
  const d = acharDuplicatas(
    { nome: 'Gmail', servico: 'Gmail', projeto: 'Marketing', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
    EXISTENTES);
  assert.equal(d[0].forca, 'alta');
  assert.equal(d[0].cred.id, '2');
});

test('cada credencial aparece uma vez so, com o sinal mais forte', () => {
  const d = acharDuplicatas(
    { nome: 'Gmail — LA Music Barra', servico: 'Gmail', projeto: 'Marketing', campos: [{ label: 'E-mail', valor: 'barra@gmail.com' }] },
    EXISTENTES);
  const ids = d.map(x => x.cred.id);
  assert.equal(new Set(ids).size, ids.length, 'sem repeticao');
  assert.equal(d.find(x => x.cred.id === '2').forca, 'alta');
});

test('proposta sem sinal nenhum devolve lista vazia', () => {
  assert.deepEqual(acharDuplicatas({ nome: 'Sistema Totalmente Novo', campos: [] }, EXISTENTES), []);
});

test('entrada invalida nao quebra', () => {
  assert.deepEqual(acharDuplicatas(null, EXISTENTES), []);
  assert.deepEqual(acharDuplicatas({ nome: 'X' }, null), []);
});

test('acharAlvo: nome exato ignorando caixa', () => {
  const r = acharAlvo('cloudflare — dns/cdn', EXISTENTES);
  assert.equal(r.exato.id, '3');
});

test('acharAlvo: termo parcial devolve candidatos sem exato', () => {
  const r = acharAlvo('gmail', EXISTENTES);
  assert.equal(r.exato, null);
  assert.equal(r.candidatos.length, 2);
});

test('acharAlvo: termo sem correspondencia devolve vazio', () => {
  const r = acharAlvo('inexistente', EXISTENTES);
  assert.equal(r.exato, null);
  assert.deepEqual(r.candidatos, []);
});

test('acharAlvo: entrada invalida nao quebra', () => {
  assert.deepEqual(acharAlvo(null, EXISTENTES), { exato: null, candidatos: [] });
  assert.deepEqual(acharAlvo('x', null), { exato: null, candidatos: [] });
});
