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

test('rejeita action que nao e string (fail-closed)', () => {
  assert.equal(parseCredencialAction(MK({ action: ['create'], nome: 'X' })), null);
  assert.equal(parseCredencialAction(MK({ action: 123, nome: 'X' })), null);
  assert.equal(parseCredencialAction(MK({ action: { x: 1 }, nome: 'X' })), null);
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

// =====================================================================
// temValorMascarado — caso Hugo 04/09 15:40
// O engine imprime a senha como ●●●●●● na confirmacao. Essa mensagem volta pro modelo no turno
// seguinte como se fosse fala dele (system.js:4039), e ele reproduz o ●●●●●● ao imitar o
// formato. Gravar isso criaria uma credencial que PARECE certa na tela e nao serve pra nada.
// =====================================================================
const { temValorMascarado } = require('./credencial-action');

test('mascara e reconhecida em todas as marcas que o engine usa', () => {
  for (const m of ['●●●●●●', '***', '••••', '▪▪▪', '  ●●●●●●  ', '××××']) {
    assert.strictEqual(
      temValorMascarado({ campos: [{ label: 'Senha', valor: m }] }), 'Senha', `nao pegou: ${m}`);
  }
});

test('devolve o LABEL do primeiro campo mascarado, pra mensagem dizer qual e', () => {
  assert.strictEqual(temValorMascarado({ campos: [
    { label: 'E-mail', valor: 'a@b.com' },
    { label: 'Token de acesso', valor: '●●●●●●' },
  ] }), 'Token de acesso');
});

test('valor legitimo NAO e confundido com mascara', () => {
  for (const v of ['hunter2', 'a@b.com', '**', 'xx', '[preencher]', 'P@ssw0rd***', '***abc', '250178Alf#']) {
    assert.strictEqual(
      temValorMascarado({ campos: [{ label: 'Senha', valor: v }] }), null, `falso positivo: ${v}`);
  }
});

test('acao sem campos, invalida ou com valor nao-string devolve null', () => {
  assert.strictEqual(temValorMascarado(null), null);
  assert.strictEqual(temValorMascarado({}), null);
  assert.strictEqual(temValorMascarado({ campos: [] }), null);
  assert.strictEqual(temValorMascarado({ campos: [null, { label: 'X' }] }), null);
  assert.strictEqual(temValorMascarado({ campos: [{ label: 'X', valor: 123 }] }), null);
});
