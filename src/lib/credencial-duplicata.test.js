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

// I-1 (review 04/09): o `motivo` vai inteiro pra tela do WhatsApp. Campo sensivel nao
// pode devolver o segredo em claro na lista de duplicatas.
test('motivo NAO cita o valor quando o campo e sensivel — cita o label', () => {
  const existentes = [{ id: '9', nome: 'Canva Antigo', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] }];
  const d = acharDuplicatas({ nome: 'Canva Novo', campos: [{ label: 'Senha', valor: 'hunter2', sensivel: true }] }, existentes);
  assert.equal(d.length, 1);
  assert.equal(d[0].forca, 'alta');
  assert.ok(!/hunter2/.test(d[0].motivo), `segredo vazou no motivo: ${d[0].motivo}`);
  assert.equal(d[0].motivo, 'mesmo valor no campo Senha');
});

test('motivo mascara mesmo sem a flag, quando o label denuncia segredo', () => {
  const existentes = [{ id: '9', nome: 'VPS', campos: [{ label: 'Senha', valor: 'p4ss' }] }];
  const d = acharDuplicatas({ nome: 'VPS nova', campos: [{ label: 'Senha', valor: 'p4ss' }] }, existentes);
  assert.ok(!/p4ss/.test(d[0].motivo), `segredo vazou no motivo: ${d[0].motivo}`);
});

test('basta um dos lados marcar sensivel para mascarar', () => {
  const existentes = [{ id: '9', nome: 'Token X', campos: [{ label: 'Valor', valor: 'abc123' }] }];
  const d = acharDuplicatas({ nome: 'Token Y', campos: [{ label: 'Valor', valor: 'abc123', sensivel: true }] }, existentes);
  assert.ok(!/abc123/.test(d[0].motivo), `segredo vazou no motivo: ${d[0].motivo}`);
});

test('campo NAO sensivel segue mostrando o valor (e o que torna a mensagem util)', () => {
  const existentes = [{ id: '9', nome: 'Gmail A', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }];
  const d = acharDuplicatas({ nome: 'Gmail B', campos: [{ label: 'E-mail', valor: 'escola@gmail.com' }] }, existentes);
  assert.equal(d[0].motivo, 'mesmo valor de campo: escola@gmail.com');
});
