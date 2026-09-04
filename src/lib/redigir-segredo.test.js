const test = require('node:test');
const assert = require('node:assert');
const { redigirSegredos, MASCARA } = require('./redigir-segredo');

test('redige valor apos rotulo de senha', () => {
  const r = redigirSegredos('conta do ADS\nsenha: 250178Alf#');
  assert.equal(r.achou, true);
  assert.match(r.texto, /senha: \*\*\*/);
  assert.doesNotMatch(r.texto, /250178Alf#/);
});

test('redige variantes de rotulo', () => {
  for (const rot of ['senha', 'Senha', 'SENHA', 'password', 'pwd', 'token', 'api key', 'api_key', 'chave', 'secret']) {
    const r = redigirSegredos(`${rot}: valorSuperSecreto123`);
    assert.equal(r.achou, true, `rotulo ${rot} deveria disparar`);
    assert.doesNotMatch(r.texto, /valorSuperSecreto123/, `rotulo ${rot} deveria mascarar`);
  }
});

test('aceita separadores = e espaco alem de dois-pontos', () => {
  assert.doesNotMatch(redigirSegredos('senha = abc123XYZ').texto, /abc123XYZ/);
  assert.doesNotMatch(redigirSegredos('senha abc123XYZ').texto, /abc123XYZ/);
});

test('preserva o rotulo e o resto da linha seguinte', () => {
  const r = redigirSegredos('email: a@b.com\nsenha: segredo123\nservico: Google');
  assert.match(r.texto, /email: a@b\.com/);
  assert.match(r.texto, /servico: Google/);
  assert.doesNotMatch(r.texto, /segredo123/);
});

test('nao mexe em texto sem rotulo de segredo', () => {
  const t = 'me manda o link da anamnese por favor';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false);
  assert.equal(r.texto, t);
});

test('nao redige a palavra senha usada em pergunta', () => {
  const t = 'qual a senha do chatwoot?';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false, 'pergunta nao tem valor a redigir');
  assert.equal(r.texto, t);
});

test('redige texto vindo de analise de imagem', () => {
  const t = '[Imagem analisada]\nA imagem mostra uma tela de login.\nUsuario: admin\nSenha: Tr0ub4dor&3';
  const r = redigirSegredos(t);
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /Tr0ub4dor&3/);
  assert.match(r.texto, /A imagem mostra uma tela de login/);
});

test('entrada nula ou vazia nao quebra', () => {
  assert.deepEqual(redigirSegredos(null), { texto: '', achou: false });
  assert.deepEqual(redigirSegredos(''), { texto: '', achou: false });
});

test('MASCARA e ***', () => {
  assert.equal(MASCARA, '***');
});

// --- Fix round 1 (review C-1/C-2/C-3/I-1) ---------------------------------

test('C-1: valor na linha seguinte ao rotulo (print de tela de login)', () => {
  const t = '[Imagem analisada]\nUsuario: admin\nSenha:\nTr0ub4dor&3';
  const r = redigirSegredos(t);
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /Tr0ub4dor&3/);
  assert.match(r.texto, /Senha:/, 'rotulo nao pode sumir, so o valor');
});

test('C-2: rotulo colado a outra palavra ainda dispara (senha_wifi)', () => {
  const r = redigirSegredos('senha_wifi: hunter2');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /hunter2/);
});

test('C-2: rotulo colado a outra palavra ainda dispara (minha_senha)', () => {
  const r = redigirSegredos('minha_senha: 123456');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /123456/);
});

test('C-2: rotulo colado a outra palavra ainda dispara (camelCase MinhaSenha)', () => {
  const r = redigirSegredos('MinhaSenha: hunter2');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /hunter2/);
});

test('C-3: separador ponto-e-virgula tambem dispara', () => {
  const r = redigirSegredos('senha; hunter2');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /hunter2/);
});

test('I-1: valor de um campo nao engole o rotulo do proximo na mesma linha', () => {
  const r = redigirSegredos('senha: abc123 token: xyz789');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /abc123/);
  assert.doesNotMatch(r.texto, /xyz789/);
  const marcas = (r.texto.match(/\*\*\*/g) || []).length;
  assert.equal(marcas, 2, 'os dois campos devem virar mascaras separadas, nao uma so engolindo a outra');
  assert.match(r.texto, /token/i, 'o rotulo do segundo campo nao pode ser engolido pela mascara do primeiro');
});

test('pergunta continua intocada mesmo com rotulo composto (regressao do fix)', () => {
  const t = 'qual eh a senha_wifi aqui?';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false, 'pergunta nao tem valor a redigir, nem com rotulo composto');
  assert.equal(r.texto, t);
});
