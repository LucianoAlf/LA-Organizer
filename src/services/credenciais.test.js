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

test('getCredenciaisPara: excecao sem Error (null) nao lanca — fail-closed (C-1)', async () => {
  _resetCache();
  rpcImpl = async () => { throw null; };
  const out = await getCredenciaisPara(ADMIN);
  assert.deepEqual(out.creds, []);
  assert.equal(out.isAdmin, false, 'null rejection é fail-closed, nao lanca');
});

test('getCredenciaisPara: admin com lista vazia nao fica cacheado como publico (I-1)', async () => {
  _resetCache(); rpcCalls = 0;
  const ADMIN_DINAMICO = '33333333-3333-3333-3333-333333333333';

  // Primeira chamada: RPC devolve [] (lista vazia)
  rpcImpl = async () => ({ data: [], error: null });
  const out1 = await getCredenciaisPara(ADMIN_DINAMICO);
  assert.equal(rpcCalls, 1);
  assert.deepEqual(out1.creds, []);
  assert.equal(out1.isAdmin, false, 'lista vazia => isAdmin false, mas nao e admin real');

  // Segunda chamada: RPC agora devolve dado admin real (nao deveria servir cache)
  rpcImpl = async () => ({ data: [{ id: 'x', nome: 'Secret', url_ref: null, campos: [{ label: 'Pass', valor: 'secret123', sensivel: true }], is_admin: true }], error: null });
  const out2 = await getCredenciaisPara(ADMIN_DINAMICO);
  assert.equal(rpcCalls, 2, 'lista vazia nao e cacheada — RPC bateu de novo');
  assert.equal(out2.isAdmin, true, 'agora retorna admin verdadeiro');
  assert.equal(out2.creds[0].campos[0].valor, 'secret123');
});

const { upsertCredencial, deleteCredencial } = require('./credenciais');

test('upsertCredencial: sucesso devolve ok e id', async () => {
  rpcImpl = async () => ({ data: 'uuid-novo', error: null });
  const r = await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'uuid-novo');
  assert.equal(r.erro, null);
});

test('upsertCredencial: forbidden do banco vira erro, nao excecao', async () => {
  rpcImpl = async () => ({ data: null, error: { message: 'forbidden', code: '42501' } });
  const r = await upsertCredencial(COMUM, { nome: 'X', campos: [] });
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'forbidden');
});

test('upsertCredencial: excecao nao lanca', async () => {
  rpcImpl = async () => { throw new Error('rede caiu'); };
  const r = await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(r.ok, false);
  assert.equal(r.id, null);
});

test('upsertCredencial: rejeicao non-Error nao lanca', async () => {
  rpcImpl = async () => { throw null; };
  const r = await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(r.ok, false);
});

test('upsertCredencial: id nulo do colaborador nem chama a RPC', async () => {
  rpcCalls = 0;
  const r = await upsertCredencial(null, { nome: 'X', campos: [] });
  assert.equal(rpcCalls, 0);
  assert.equal(r.ok, false);
});

test('upsertCredencial: envia p_categoria na chamada da RPC', async () => {
  let params = null;
  rpcImpl = async (_fn, p) => { params = p; return { data: 'uuid-novo', error: null }; };
  await upsertCredencial(ADMIN, { nome: 'X', categoria: 'plataforma', campos: [] });
  assert.equal(params.p_categoria, 'plataforma');
  await upsertCredencial(ADMIN, { nome: 'X', campos: [] });
  assert.equal(params.p_categoria, null, 'ausente vira null — quem decide o default e a RPC');
});

test('deleteCredencial: sucesso', async () => {
  rpcImpl = async () => ({ data: true, error: null });
  const r = await deleteCredencial(ADMIN, 'cred-1');
  assert.equal(r.ok, true);
});

test('deleteCredencial: forbidden vira erro', async () => {
  rpcImpl = async () => ({ data: null, error: { message: 'forbidden' } });
  const r = await deleteCredencial(COMUM, 'cred-1');
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'forbidden');
});

test('deleteCredencial: sem credId nem chama a RPC', async () => {
  rpcCalls = 0;
  const r = await deleteCredencial(ADMIN, null);
  assert.equal(rpcCalls, 0);
  assert.equal(r.ok, false);
});

// C-2 (review 04/09): a RPC faz `campos = coalesce(p_campos, g.campos)` no UPDATE.
// `'[]'::jsonb` nao e null — mandar lista vazia num update parcial APAGAVA login e senha.
test('upsertCredencial: campos ausente vai como null (nao apaga o que ja esta la)', async () => {
  let params = null;
  rpcImpl = async (_fn, p) => { params = p; return { data: 'uuid-1', error: null }; };
  await upsertCredencial(ADMIN, { id: 'cred-1', nome: 'Canva', url_ref: 'https://novo' });
  assert.equal(params.p_campos, null, 'sem campos => null, pro coalesce da RPC preservar');
});

test('upsertCredencial: campos [] tambem vai como null (update parcial nao destroi)', async () => {
  let params = null;
  rpcImpl = async (_fn, p) => { params = p; return { data: 'uuid-1', error: null }; };
  await upsertCredencial(ADMIN, { id: 'cred-1', nome: 'Canva', campos: [] });
  assert.equal(params.p_campos, null);
});

test('upsertCredencial: campos com item vai como lista', async () => {
  let params = null;
  rpcImpl = async (_fn, p) => { params = p; return { data: 'uuid-1', error: null }; };
  const campos = [{ label: 'Senha', valor: 's3cr3t', sensivel: true }];
  await upsertCredencial(ADMIN, { id: 'cred-1', nome: 'Canva', campos });
  assert.deepEqual(params.p_campos, campos);
});

test('upsertCredencial: create sem campos segue valido (RPC faz coalesce p/ [] no insert)', async () => {
  let params = null;
  rpcImpl = async (_fn, p) => { params = p; return { data: 'uuid-novo', error: null }; };
  const r = await upsertCredencial(ADMIN, { nome: 'Novo' });
  assert.equal(r.ok, true);
  assert.equal(params.p_cred_id, null, 'sem id => insert');
  assert.equal(params.p_campos, null);
});
