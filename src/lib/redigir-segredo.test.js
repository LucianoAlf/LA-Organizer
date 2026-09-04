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
  assert.match(r.texto, /Senha:/, 'rotulo que ARMOU o modo nao pode sumir, so o valor');
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

// --- Fix round 2 (review C-4/C-5/C-6) -------------------------------------

// ATUALIZADO no round 4: pela regra 3 do desenho novo, com o modo ligado toda
// linha nao vazia e mascarada INTEIRA -- inclusive quando ela tem cara de
// rotulo ("Token:"). Perder o rotulo empilhado no log e sobre-redacao
// aceitavel; a alternativa (tentar adivinhar se a linha e rotulo) era a causa
// raiz dos vazamentos dos rounds 1..3.
test('C-4: rotulos empilhados sem valor -- rotulo empilhado tambem mascara', () => {
  const r = redigirSegredos('Senha:\nToken:\nhunter2');
  assert.equal(r.achou, true);
  assert.equal(r.texto, 'Senha:\n***\n***');
  assert.doesNotMatch(r.texto, /hunter2/);
});

test('C-4: rotulo desconhecido nao arma o modo (Login:/Senha: -> admin e hunter2 mascarados)', () => {
  const r = redigirSegredos('Login:\nSenha:\nadmin\nhunter2');
  assert.equal(r.achou, true);
  assert.equal(r.texto, 'Login:\nSenha:\n***\n***');
  assert.doesNotMatch(r.texto, /admin/);
  assert.doesNotMatch(r.texto, /hunter2/);
});

// ATUALIZADO no round 4: mesmo motivo do teste acima -- "Token:" mascara.
test('C-4: caso do proprio C-1 (Usuario com valor, depois Senha:/Token: empilhados)', () => {
  const r = redigirSegredos('Usuario: admin\nSenha:\nToken:\nT0k3n789');
  assert.equal(r.achou, true);
  assert.equal(r.texto, 'Usuario: admin\nSenha:\n***\n***');
  assert.doesNotMatch(r.texto, /T0k3n789/);
});

test('C-5: pergunta solta depois de rotulo pendente nao vira valor', () => {
  const t = 'Senha:\nvoce pode me ajudar com outra coisa?';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false, 'pergunta nao e valor, nao ha nada para mascarar');
  assert.equal(r.texto, t);
});

test('C-6: separador espaco em frase idiomatica nao dispara (chave/segredo como palavra comum)', () => {
  const t = 'a chave da porta esta emprestada com o joao';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false);
  assert.equal(r.texto, t);
});

// --- Fix round 3 (review C-5.1: guarda de pergunta abortava demais a fila) -

test('C-5.1: pergunta nao consome o modo -- valor real logo depois ainda mascara', () => {
  const r = redigirSegredos('Senha:\nvoce pode ajudar?\nhunter2');
  assert.equal(r.texto, 'Senha:\nvoce pode ajudar?\n***');
  assert.equal(r.achou, true);
});

test('C-5.1: pergunta sem valor nenhum depois -- nada para mascarar', () => {
  const t = 'Senha:\nvoce pode ajudar?';
  const r = redigirSegredos(t);
  assert.equal(r.achou, false, 'nao ha valor nenhum na mensagem, so a pergunta');
  assert.equal(r.texto, t);
});

// ATUALIZADO no round 4: o orcamento "K linhas" (tamanho do bloco de rotulos)
// deixou de existir. O modo agora so fecha por PROSA ou pelo TETO de 5
// mascaras -- "a"/"b"/"c" nao sao prosa (1 palavra cada), entao o modo segue
// ligado e "hunter2" e mascarado. Sobre-redacao deliberada: a versao antiga
// deixava "hunter2" em claro, que e exatamente o vazamento a evitar.
test('round 4: linhas curtas nao fecham o modo -- valor tardio ainda mascara', () => {
  const r = redigirSegredos('Senha:\na\nb\nc\nhunter2');
  assert.equal(r.texto, 'Senha:\n***\n***\n***\n***');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /hunter2/);
});

// --- Round 4: desenho novo (modo "as proximas linhas sao valores") ---------
// Uma tabela de comportamento, entrada por entrada.

test('R4 tabela 1: rotulo empilhado com cara de valor nao e lido como rotulo', () => {
  const r = redigirSegredos('Senha:\nhunter2:\nrealvalue');
  assert.equal(r.texto, 'Senha:\n***\n***');
  assert.equal(r.achou, true);
});

test('R4 tabela 2: rotulo + linha unica com cara de rotulo mascara e sinaliza', () => {
  const r = redigirSegredos('Senha:\nhunter2:');
  assert.equal(r.texto, 'Senha:\n***');
  assert.equal(r.achou, true);
});

test('R4 tabela 3: prosa fecha o modo e volta a conversa ao log', () => {
  const r = redigirSegredos('Senha:\nToken:\nvou te mandar por email.\nfalou.');
  assert.equal(r.texto, 'Senha:\n***\nvou te mandar por email.\nfalou.');
  assert.equal(r.achou, true);
});

test('R4 tabela 4: tres frases reais depois de rotulos empilhados ficam intactas', () => {
  const t = 'Senha:\nSenha:\nSenha:\nnao lembro mesmo, vou verificar depois.\nte aviso amanha.\nvaleu!';
  const r = redigirSegredos(t);
  assert.equal(
    r.texto,
    'Senha:\n***\n***\nnao lembro mesmo, vou verificar depois.\nte aviso amanha.\nvaleu!'
  );
  assert.equal(r.achou, true);
  assert.match(r.texto, /nao lembro mesmo, vou verificar depois\./);
  assert.match(r.texto, /te aviso amanha\./);
  assert.match(r.texto, /valeu!/);
});

test('R4 tabela 5: Login:/Senha: -> admin e hunter2 fora do log', () => {
  const r = redigirSegredos('Login:\nSenha:\nadmin\nhunter2');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /admin/);
  assert.doesNotMatch(r.texto, /hunter2/);
});

test('R4 tabela 6: Senha:/Token: empilhados -> hunter2 fora do log', () => {
  const r = redigirSegredos('Senha:\nToken:\nhunter2');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /hunter2/);
});

test('R4 tabela 7: print de tela com dois rotulos empilhados', () => {
  const r = redigirSegredos('[Imagem analisada]\nUsuario: admin\nSenha:\nToken:\nT0k3nR3al789');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /T0k3nR3al789/);
  assert.match(r.texto, /\[Imagem analisada\]/);
});

test('R4 tabela 8: pergunta e pulada e o valor seguinte mascara', () => {
  const r = redigirSegredos('Senha:\nvoce pode ajudar?\nhunter2');
  assert.equal(r.texto, 'Senha:\nvoce pode ajudar?\n***');
  assert.equal(r.achou, true);
});

test('R4 tabela 9: rotulo + pergunta sem valor sai byte a byte identico', () => {
  const t = 'Senha:\nvoce pode ajudar?';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false);
});

test('R4 tabela 10: rotulo + valor na linha seguinte', () => {
  const r = redigirSegredos('Senha:\nTr0ub4dor&3');
  assert.equal(r.texto, 'Senha:\n***');
  assert.equal(r.achou, true);
});

// --- Round 4: travas contra virar redator universal -----------------------

test('R4 trava: frases de conversa real saem byte a byte identicas com achou=false', () => {
  const intactas = [
    'qual a senha do chatwoot?',
    'a chave da porta esta emprestada com o joao',
    'me manda o link da anamnese por favor',
    'Deixa eu te contar um segredo:\nvi ela na academia ontem'
  ];
  for (const t of intactas) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `deveria sair identico: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false, `nao deveria sinalizar: ${JSON.stringify(t)}`);
  }
});

test('R4 trava: credenciais na mesma linha continuam mascaradas', () => {
  const casos = [
    ['senha: 250178Alf#', '250178Alf#'],
    ['senha abc123XYZ', 'abc123XYZ'],
    ['senha = abc123XYZ', 'abc123XYZ'],
    ['senha_wifi: hunter2', 'hunter2'],
    ['MinhaSenha: hunter2', 'hunter2'],
    ['senha; hunter2', 'hunter2']
  ];
  for (const [entrada, valor] of casos) {
    const r = redigirSegredos(entrada);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(entrada)}`);
    assert.ok(!r.texto.includes(valor), `deveria mascarar ${valor} em ${JSON.stringify(entrada)}`);
  }
  const dois = redigirSegredos('senha: abc123 token: xyz789');
  assert.equal(dois.achou, true);
  assert.ok(!dois.texto.includes('abc123'));
  assert.ok(!dois.texto.includes('xyz789'));
});

// --- Round 4: mecanica do modo -------------------------------------------

test('R4 modo: teto de 5 mascaras fecha o modo sozinho', () => {
  const r = redigirSegredos('Senha:\na\nb\nc\nd\ne\nf');
  assert.equal(r.texto, 'Senha:\n***\n***\n***\n***\n***\nf');
  assert.equal(r.achou, true);
});

test('R4 modo: orcamento de 3 perguntas puladas fecha o modo', () => {
  const r = redigirSegredos('Senha:\nvoce pode?\ne isso?\ntudo bem?\nhunter2');
  assert.equal(r.texto, 'Senha:\nvoce pode?\ne isso?\ntudo bem?\nhunter2');
  assert.equal(r.achou, false, 'orcamento estourou antes de achar valor');
});

test('R4 modo: forma de rotulo sem rotulo conhecido NAO arma o modo', () => {
  const t = 'Login:\nadmin';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'Login nao e rotulo de segredo -- nada a mascarar');
  assert.equal(r.achou, false);
});

test('R4 modo: prosa fecha o modo mas o campo inline dela ainda mascara', () => {
  const r = redigirSegredos('Senha:\naqui esta a minha token: xyz123');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /xyz123/);
  assert.match(r.texto, /aqui esta a minha token: \*\*\*/);
});

// --- Round 4: varredura adversarial ---------------------------------------

test('R4 adversarial: CRLF no lugar de LF', () => {
  const r = redigirSegredos('Senha:\r\nhunter2');
  assert.equal(r.texto, 'Senha:\r\n***');
  assert.equal(r.achou, true);
});

test('R4 adversarial: linha em branco entre rotulo e valor nao quebra o modo', () => {
  const r = redigirSegredos('Senha:\n\nhunter2');
  assert.equal(r.texto, 'Senha:\n\n***');
  assert.equal(r.achou, true);
});

test('R4 adversarial: rotulo na ultima linha nao tem valor para mascarar', () => {
  const t = 'Senha:';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false, 'nao ha valor no texto -- nada vaza, nada a sinalizar');
});

test('R4 adversarial: valor com dois-pontos no meio mascara inteiro', () => {
  const r = redigirSegredos('Senha:\nabc:def');
  assert.equal(r.texto, 'Senha:\n***');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /abc/);
  assert.doesNotMatch(r.texto, /def/);
});

test('R4 adversarial: linha unica longa com credencial no meio mascara ate o fim', () => {
  const r = redigirSegredos('bom dia, segue o acesso do painel, senha: Xk9#mP2z entao me avisa');
  assert.equal(r.achou, true);
  assert.doesNotMatch(r.texto, /Xk9#mP2z/);
  assert.match(r.texto, /bom dia, segue o acesso do painel, senha: \*\*\*/);
});

test('R4 adversarial: nunca lanca, para entradas estranhas', () => {
  const entradas = [undefined, null, 0, 123, {}, [], true, '\n\n\n', '   ', ':::', 'senha:'.repeat(50)];
  for (const e of entradas) {
    assert.doesNotThrow(() => redigirSegredos(e), `lancou para ${JSON.stringify(e)}`);
    const r = redigirSegredos(e);
    assert.equal(typeof r.texto, 'string');
    assert.equal(typeof r.achou, 'boolean');
  }
});
