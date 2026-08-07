const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// Injeta um client fake no require.cache ANTES do módulo sob teste resolvê-lo.
const clientPath = require.resolve('../supabase/client');
let rpcCalls = 0;
let rpcImpl = async () => ({ data: [], error: null });
require.cache[clientPath] = {
  id: clientPath, filename: clientPath, loaded: true, exports: {
    rpc: async (...args) => { rpcCalls++; return rpcImpl(...args); },
  },
};

const { getCredenciaisPublicas, _resetCache, CACHE_TTL_MS } = require('./credenciais-publicas');

test('getCredenciaisPublicas: retorna as linhas da RPC', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ nome: 'Anamnese', url_ref: 'https://a' }], error: null });
  const out = await getCredenciaisPublicas();
  assert.deepEqual(out, [{ nome: 'Anamnese', url_ref: 'https://a' }]);
  assert.equal(rpcCalls, 1);
});

test('getCredenciaisPublicas: segunda chamada usa cache (nao bate na RPC)', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: [{ nome: 'X', url_ref: 'https://x' }], error: null });
  await getCredenciaisPublicas();
  await getCredenciaisPublicas();
  assert.equal(rpcCalls, 1, 'RPC chamada uma unica vez dentro do TTL');
});

test('getCredenciaisPublicas: erro da RPC nao lanca — devolve []', async () => {
  _resetCache(); rpcCalls = 0;
  rpcImpl = async () => ({ data: null, error: { message: 'boom' } });
  const out = await getCredenciaisPublicas();
  assert.deepEqual(out, []);
});

test('getCredenciaisPublicas: excecao da RPC nao lanca — devolve cache stale', async () => {
  _resetCache();
  rpcImpl = async () => ({ data: [{ nome: 'Velho', url_ref: 'https://v' }], error: null });
  await getCredenciaisPublicas();                       // popula cache
  rpcImpl = async () => { throw new Error('rede caiu'); };
  _resetCache({ keepData: true });            // expira o ts, mantem os dados
  const out = await getCredenciaisPublicas();
  assert.deepEqual(out, [{ nome: 'Velho', url_ref: 'https://v' }], 'stale em vez de vazio');
});

test('CACHE_TTL_MS: 30 minutos', () => {
  assert.equal(CACHE_TTL_MS, 30 * 60 * 1000);
});
