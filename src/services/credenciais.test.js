const test = require('node:test');
const assert = require('node:assert');

const clientPath = require.resolve('../supabase/client');
let rpcCalls = 0;
let rpcImpl = async () => ({ data: [], error: null });
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: {
    rpc: async (...args) => { rpcCalls++; return rpcImpl(...args); },
  },
};

const { getCredenciaisPara, _resetCache, CACHE_TTL_MS } = require('./credenciais');

const ADMIN = '11111111-1111-1111-1111-111111111111';
const COMUM = '22222222-2222-2222-2222-222222222222';

test('getCredenciaisPara: admin recebe isAdmin true e os campos', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'x', nome: 'Google', url_ref: 'https://g', campos: [{ label: 'Senha', valor: 's3cr3t', sensivel: true }], is_admin: true }], error: null });
  const out = await getCredenciaisPara(ADMIN);
  assert.equal(out.isAdmin, true);
  assert.equal(out.creds[0].campos[0].valor, 's3cr3t');
});

test('getCredenciaisPara: nao-admin recebe isAdmin false', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'y', nome: 'Anamnese', url_ref: 'https://a', campos: [], is_admin: false }], error: null });
  const out = await getCredenciaisPara(COMUM);
  assert.equal(out.isAdmin, false);
});

test('getCredenciaisPara: escopo publico usa cache na segunda chamada', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'y', nome: 'A', url_ref: 'https://a', campos: [], is_admin: false }], error: null });
  await getCredenciaisPara(COMUM);
  await getCredenciaisPara(COMUM);
  assert.equal(rpcCalls, 1, 'publico e cacheado');
});

test('getCredenciaisPara: escopo admin NUNCA e cacheado (senha fora da memoria)', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ id: 'x', nome: 'G', url_ref: null, campos: [{ label: 'Senha', valor: 'p', sensivel: true }], is_admin: true }], error: null });
  await getCredenciaisPara(ADMIN);
  await getCredenciaisPara(ADMIN);
  assert.equal(rpcCalls, 2, 'admin sempre consulta de novo');
});

test('getCredenciaisPara: erro da RPC nao lanca — devolve vazio e nao-admin', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: null, error: { message: 'boom' } });
  const out = await getCredenciaisPara(ADMIN);
  assert.deepEqual(out.creds, []);
  assert.equal(out.isAdmin, false, 'fail-closed: erro nunca vira admin');
});

test('getCredenciaisPara: excecao nao lanca — fail-closed', async () => {
  _resetCache();
  rpcImpl = async () => { throw new Error('rede caiu'); };
  const out = await getCredenciaisPara(ADMIN);
  assert.deepEqual(out.creds, []);
  assert.equal(out.isAdmin, false);
});

test('getCredenciaisPara: id nulo nem chama a RPC', async () => {
  _resetCache(); rpcCalls = 0;
  const out = await getCredenciaisPara(null);
  assert.equal(rpcCalls, 0);
  assert.equal(out.isAdmin, false);
  assert.deepEqual(out.creds, []);
});

test('CACHE_TTL_MS: 30 minutos', () => {
  assert.equal(CACHE_TTL_MS, 30 * 60 * 1000);
});
