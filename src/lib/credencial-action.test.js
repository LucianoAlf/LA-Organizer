const test = require('node:test');
const assert = require('node:assert');
const { parseCredencialAction, stripCredencialAction, ACOES_VALIDAS, CATEGORIAS_VALIDAS } = require('./credencial-action');

const MK = (json) => `<<CREDENCIAL_ACTION>>\n${JSON.stringify(json)}\n<<END>>`;

test('parseia create com campos', () => {
  const p = parseCredencialAction(MK({
    action: 'create', nome: 'Google Ads', servico: 'Google',
    campos: [{ label: 'E-mail', valor: 'a@b.com', sensivel: false },
             { label: 'Senha', valor: 's3cr3t', sensivel: true }],
  }));
  assert.equal(p.action, 'create');
  assert.equal(p.nome, 'Google Ads');
  assert.equal(p.campos.length, 2);
  assert.equal(p.campos[1].sensivel, true);
});

test('parseia update com alvo', () => {
  const p = parseCredencialAction(MK({ action: 'update', alvo: 'Google Ads', campos: [{ label: 'Senha', valor: 'nova', sensivel: true }] }));
  assert.equal(p.action, 'update');
  assert.equal(p.alvo, 'Google Ads');
});

test('parseia delete', () => {
  const p = parseCredencialAction(MK({ action: 'delete', alvo: 'Credencial Velha' }));
  assert.equal(p.action, 'delete');
  assert.equal(p.alvo, 'Credencial Velha');
});

test('rejeita acao invalida', () => {
  assert.equal(parseCredencialAction(MK({ action: 'drop_table', nome: 'x' })), null);
});

test('rejeita create sem nome', () => {
  assert.equal(parseCredencialAction(MK({ action: 'create', servico: 'Google' })), null);
});

test('rejeita update e delete sem alvo', () => {
  assert.equal(parseCredencialAction(MK({ action: 'update', campos: [] })), null);
  assert.equal(parseCredencialAction(MK({ action: 'delete' })), null);
});

test('rejeita JSON malformado sem lancar', () => {
  assert.equal(parseCredencialAction('<<CREDENCIAL_ACTION>>{nao é json}<<END>>'), null);
});

test('rejeita texto sem marker', () => {
  assert.equal(parseCredencialAction('cadastra a senha do google'), null);
  assert.equal(parseCredencialAction(null), null);
});

test('normaliza campos: descarta item sem label e sensivel vira boolean', () => {
  const p = parseCredencialAction(MK({
    action: 'create', nome: 'X',
    campos: [{ label: '', valor: 'v' }, { label: 'Ok', valor: 'v2' }, { label: 'S', valor: 'v3', sensivel: 'sim' }],
  }));
  assert.equal(p.campos.length, 2);
  assert.equal(p.campos[0].label, 'Ok');
  assert.equal(p.campos[0].sensivel, false, 'ausente vira false');
  assert.equal(p.campos[1].sensivel, true, 'string truthy vira true');
});

test('campos ausente vira lista vazia', () => {
  const p = parseCredencialAction(MK({ action: 'create', nome: 'X' }));
  assert.deepEqual(p.campos, []);
});

test('stripCredencialAction remove o marker do texto', () => {
  const t = `ok, vou cadastrar\n${MK({ action: 'create', nome: 'X' })}\nfim`;
  const out = stripCredencialAction(t);
  assert.doesNotMatch(out, /CREDENCIAL_ACTION/);
  assert.match(out, /ok, vou cadastrar/);
  assert.equal(stripCredencialAction(null), '');
});

test('ACOES_VALIDAS tem exatamente create, update, delete', () => {
  assert.deepEqual([...ACOES_VALIDAS].sort(), ['create', 'delete', 'update']);
});

test('categoria valida e normalizada; invalida vira null', () => {
  assert.equal(parseCredencialAction(MK({ action: 'create', nome: 'X', categoria: ' Plataforma ' })).categoria, 'plataforma');
  assert.equal(parseCredencialAction(MK({ action: 'create', nome: 'X', categoria: 'inventada' })).categoria, null);
  assert.equal(parseCredencialAction(MK({ action: 'create', nome: 'X' })).categoria, null);
});

test('CATEGORIAS_VALIDAS tem os 8 valores do CHECK do banco', () => {
  assert.deepEqual([...CATEGORIAS_VALIDAS].sort(),
    ['api_key','email','outro','plataforma','social','token','vps','whatsapp']);
});
