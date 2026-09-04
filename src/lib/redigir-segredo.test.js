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

// ATUALIZADO no round 8 (V-1): o valor aqui e "aqui?", UMA palavra. Pela regra
// nova, um token so nunca e pergunta -- e valor -- porque era exatamente essa
// leitura que fazia 'senha: Alf#2026?' sair em claro. Sobre-redacao deliberada
// de uma pergunta; a trava de verdade ('qual a senha do chatwoot?', cujo valor
// "do chatwoot?" tem 2 palavras) continua byte a byte identica.
test('pergunta com rotulo composto: valor de UMA palavra agora mascara (V-1)', () => {
  const r = redigirSegredos('qual eh a senha_wifi aqui?');
  assert.equal(r.texto, 'qual eh a senha_wifi ***');
  assert.equal(r.achou, true);
  const trava = redigirSegredos('qual a senha do chatwoot?');
  assert.equal(trava.texto, 'qual a senha do chatwoot?', 'valor de 2 palavras segue sendo pergunta');
  assert.equal(trava.achou, false);
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

// --- Round 5: rotulo nao adjacente ao separador tambem arma o modo --------
// Em portugues de verdade o rotulo quase nunca encosta no separador:
// "A senha e:", "Minha senha eh:". O token colado ao ":" e "e"/"eh", entao a
// regra de arme do round 4 (so o token adjacente) nao disparava e o valor da
// linha seguinte vazava. Agora, numa linha que ja e candidata (termina em
// ":"/"="/";" e nada depois), basta QUALQUER palavra da linha conter um
// rotulo conhecido.

test('R5: rotulo nao adjacente ao separador arma o modo (A senha e:)', () => {
  const r = redigirSegredos('A senha e:\nhunter2');
  assert.equal(r.texto, 'A senha e:\n***');
  assert.equal(r.achou, true);
});

test('R5: rotulo nao adjacente ao separador arma o modo (Minha senha eh:)', () => {
  const r = redigirSegredos('Minha senha eh:\nhunter2');
  assert.equal(r.texto, 'Minha senha eh:\n***');
  assert.equal(r.achou, true);
});

// A trava que impede a regra nova de virar redacao universal: a frase ARMA
// (contem "segredo"), mas a linha seguinte tem 5 palavras -> e prosa -> fecha
// o modo sem mascarar nada. Saida byte a byte identica, achou=false.
test('R5 trava: frase longa terminando em rotulo arma, mas a prosa fecha o modo', () => {
  const t = 'Deixa eu te contar um segredo:\nvi ela na academia ontem';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false);
});

test('R5 trava: as quatro frases de conversa real seguem byte a byte identicas', () => {
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

test('R5: linha candidata sem rotulo nenhum continua sem armar', () => {
  for (const t of ['Login:\nadmin', 'Observacao:\nteste', 'Endereco:\nrua x']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `nao deveria mascarar: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

test('R5: linha de prosa que e ela mesma candidata re-arma o modo', () => {
  const r = redigirSegredos('Senha:\nvou te falar a senha nova:\nhunter2');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'), 'valor depois da re-arme nao pode vazar');
});

// --- Round 5: limites conhecidos, documentados de proposito ---------------
// Ficam como estao por decisao do coordenador: cada um exigiria afrouxar o
// gatilho de um jeito que reabre sobre-redacao em prosa, e as tres formas de
// mensagem sao bem menos provaveis que a consertada nesta rodada.

test('R5 limite conhecido: sem separador nenhum nao arma', () => {
  const t = 'Senha\nhunter2';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'limite conhecido e documentado no topo do modulo');
  assert.equal(r.achou, false);
});

test('R5 limite conhecido: tres perguntas seguidas esgotam o orcamento', () => {
  const t = 'Senha:\nvoce pode?\ne isso?\ntudo bem?\nhunter2';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'limite conhecido e documentado no topo do modulo');
  assert.equal(r.achou, false);
});

test('R5 limite conhecido: rotulo sozinho sem valor devolve achou=false', () => {
  const r = redigirSegredos('Senha:');
  assert.equal(r.texto, 'Senha:');
  assert.equal(r.achou, false, 'nada foi redigido -- achou nao e "a mensagem fala de credencial"');
});

// --- Round 6: enfase/aspas ao redor do rotulo + rotulo de duas palavras ---
// O texto de "[Imagem analisada]" e gerado por modelo, e modelo formata rotulo
// em markdown. "**Senha:** 250178Alf#" indo em claro para conversation_history
// e para marker_logs.reason (que o relatorio das 7h transmite por WhatsApp) e o
// caminho principal da feature, nao uma borda.

test('R6: enfase markdown dupla na mesma linha', () => {
  const r = redigirSegredos('**Senha:** hunter2');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'), 'valor nao pode vazar');
});

test('R6: enfase markdown dupla com valor na linha seguinte', () => {
  const r = redigirSegredos('**Senha:**\nhunter2');
  assert.equal(r.texto, '**Senha:**\n***');
  assert.equal(r.achou, true);
});

test('R6: enfase markdown simples', () => {
  const r = redigirSegredos('*Senha:*\nhunter2');
  assert.equal(r.texto, '*Senha:*\n***');
  assert.equal(r.achou, true);
});

test('R6: aspas ao redor do rotulo', () => {
  const r = redigirSegredos('"Senha:"\nhunter2');
  assert.equal(r.texto, '"Senha:"\n***');
  assert.equal(r.achou, true);
});

test('R6: underscore ao redor do rotulo (era o pior caso: mascarava o _ e vazava)', () => {
  const r = redigirSegredos('_Senha:_\nhunter2');
  assert.equal(r.texto, '_Senha:_\n***');
  assert.equal(r.achou, true);
});

test('R6: crase (code span) ao redor do rotulo', () => {
  const r = redigirSegredos('`Senha:`\nhunter2');
  assert.equal(r.texto, '`Senha:`\n***');
  assert.equal(r.achou, true);
});

test('R6: enfase so de um lado', () => {
  for (const t of ['**Senha:\nhunter2', 'Senha:**\nhunter2', '*Senha:\nhunter2', 'Senha:"\nhunter2']) {
    const r = redigirSegredos(t);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(t)}`);
    assert.ok(!r.texto.includes('hunter2'), `deveria mascarar: ${JSON.stringify(t)}`);
  }
});

test('R6: rotulo de duas palavras separado do separador (api key)', () => {
  const r = redigirSegredos('a minha api key e:\nsk-abc123');
  assert.equal(r.texto, 'a minha api key e:\n***');
  assert.equal(r.achou, true);
});

test('R6: api_key e apikey nao adjacentes continuam funcionando', () => {
  for (const t of ['a minha api_key e:\nsk-abc123', 'minha apikey e:\nsk-abc123', 'a minha api-key e:\nsk-abc123']) {
    const r = redigirSegredos(t);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(t)}`);
    assert.ok(!r.texto.includes('sk-abc123'), `deveria mascarar: ${JSON.stringify(t)}`);
  }
});

test('R6: rotulo de duas palavras com enfase', () => {
  const r = redigirSegredos('a minha **api key** e:\nsk-abc123');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('sk-abc123'));
});

// --- Round 6: travas (a regra nao pode virar redacao universal) -----------

test('R6 trava: as quatro frases de conversa real seguem byte a byte identicas', () => {
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

test('R6 trava: enfase sem rotulo conhecido nao arma', () => {
  for (const t of ['**Endereco:**\nrua x', '"Login:"\nadmin', '_Observacao:_\nteste']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `nao deveria mascarar: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

test('R6 trava: idempotencia -- redigir o texto ja redigido nao arma o modo', () => {
  const uma = redigirSegredos('senha: abc123\nfalou');
  assert.equal(uma.texto, 'senha: ***\nfalou');
  const duas = redigirSegredos(uma.texto);
  assert.equal(duas.texto, 'senha: ***\nfalou', 'a mascara nao pode ser lida como "sem valor" e armar o modo');
});

// --- Round 6: varredura adversarial de enfase -----------------------------

test('R6 adversarial: rotulos empilhados com enfase', () => {
  const r = redigirSegredos('**Senha:**\n**Token:**\nhunter2');
  assert.equal(r.texto, '**Senha:**\n***\n***');
  assert.equal(r.achou, true);
});

test('R6 adversarial: dois campos com enfase na mesma linha', () => {
  const r = redigirSegredos('**senha:** abc123 **token:** xyz789');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('abc123'), 'primeiro valor nao pode vazar');
  assert.ok(!r.texto.includes('xyz789'), 'segundo valor nao pode vazar');
  assert.match(r.texto, /token/i, 'o rotulo do segundo campo nao pode ser engolido');
});

test('R6 adversarial: enfase dentro do valor', () => {
  const a = redigirSegredos('senha: **hunter2**');
  assert.equal(a.achou, true);
  assert.ok(!a.texto.includes('hunter2'));
  const b = redigirSegredos('Senha:\n**hunter2**');
  assert.equal(b.texto, 'Senha:\n***');
  assert.equal(b.achou, true);
});

test('R6 adversarial: enfase + print de tela de login', () => {
  const r = redigirSegredos('[Imagem analisada]\n**Usuario:** admin\n**Senha:** Tr0ub4dor&3');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('Tr0ub4dor&3'));
  assert.match(r.texto, /\[Imagem analisada\]/);
});

test('R6 adversarial: linha so de enfase nao arma nada', () => {
  for (const t of ['**\nhunter2', '***\nhunter2', '":"\nhunter2', '**:**\nhunter2']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `nao deveria mascarar: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

// --- Round 7: aspa entre token e separador + pipe como separador ---------
// Os dois caem no caminho por imagem: o texto vem de um modelo, e modelo
// descreve print de painel de credenciais ora em JSON, ora em tabela markdown.

test('R7: aspa entre o token e o separador (JSON de uma linha)', () => {
  const r = redigirSegredos('{"senha": "hunter2"}');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'), 'valor nao pode vazar');
});

test('R7: aspa entre o token e o separador com "="', () => {
  const a = redigirSegredos('"senha" = "x"');
  assert.equal(a.achou, true);
  assert.ok(!a.texto.includes('"x"'), 'valor nao pode vazar');
  const b = redigirSegredos('"senha" = "hunter2"');
  assert.equal(b.achou, true);
  assert.ok(!b.texto.includes('hunter2'));
});

test('R7: JSON multilinha continua mascarando', () => {
  const r = redigirSegredos('{\n  "senha":\n  "hunter2"\n}');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'));
});

test('R7: pipe como separador (tabela markdown)', () => {
  const r = redigirSegredos('| Senha | hunter2 |');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'), 'valor nao pode vazar');
});

test('R7: pipe sem espacos', () => {
  const r = redigirSegredos('|Senha|hunter2|');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'));
});

test('R7: tabela markdown completa mascara a celula do valor', () => {
  const r = redigirSegredos('| Campo | Valor |\n|---|---|\n| Senha | hunter2 |');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('hunter2'), 'valor nao pode vazar');
  assert.match(r.texto, /\|---\|---\|/, 'o cabecalho de separacao nao pode ser tocado');
});

// --- Round 7: travas do pipe (tabela sem rotulo nao pode armar) -----------

test('R7 trava: tabela sem rotulo nenhum sai intacta (| Nome | Valor |)', () => {
  const t = '| Nome | Valor |';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false);
});

test('R7 trava: tabela sem rotulo nenhum sai intacta (| Coluna A | Coluna B |)', () => {
  const t = '| Coluna A | Coluna B |';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false);
});

test('R7 trava: cabecalho de separacao da tabela nao vira rotulo nem valor', () => {
  const t = '|---|---|';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false);
  const comMais = redigirSegredos('| Nome | Valor |\n|---|---|\n| joao | 42 |');
  assert.equal(comMais.texto, '| Nome | Valor |\n|---|---|\n| joao | 42 |');
  assert.equal(comMais.achou, false);
});

test('R7 trava: as quatro frases de conversa real seguem byte a byte identicas', () => {
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

test('R7 trava: idempotencia com aspa e pipe -- estabiliza na segunda passagem', () => {
  const entradas = [
    'senha: abc123\nfalou',
    '{"senha": "hunter2"}',
    '| Senha | hunter2 |',
    '**Senha:**\nabc123\nfalou pessoal'
  ];
  for (const t of entradas) {
    const p1 = redigirSegredos(t).texto;
    const p2 = redigirSegredos(p1).texto;
    const p3 = redigirSegredos(p2).texto;
    assert.equal(p2, p3, `nao estabilizou: ${JSON.stringify(t)} -> ${JSON.stringify(p2)} / ${JSON.stringify(p3)}`);
  }
});

test('R7: cabecalho de separacao nao vira valor nem quando o modo esta ligado', () => {
  const r = redigirSegredos('| Usuario | Senha |\n|---|---|\n| admin | hunter2 |');
  assert.match(r.texto, /\|---\|---\|/, 'a linha de separacao nao pode virar mascara');
  for (const sep of ['|---|---|', '| --- | --- |', '|:---|---:|', '|:-:|:-:|']) {
    const s = redigirSegredos(`Senha:\n${sep}\nhunter2`);
    assert.ok(s.texto.includes(sep), `separacao ${sep} nao pode virar mascara`);
    assert.ok(!s.texto.includes('hunter2'), `e o valor depois dela ainda deve mascarar (${sep})`);
  }
});

// --- Round 7: limites conhecidos, com teste fixando o comportamento atual --
// Documentados no bloco de limites do modulo. Estes testes existem para que
// uma mudanca futura nesses casos seja consciente, nao acidental.

// ATUALIZADO no round 8: este limite FECHOU para tabela de 2 colunas. A
// contagem de palavras passou a ignorar delimitadores (as barras nao sao
// palavras), entao '| admin | hunter2 |' tem 2 palavras, nao 5 -- deixou de
// cair na regra de prosa e passa a ser mascarado. Com 3+ colunas ainda vaza.
test('round 8: tabela transposta de 2 colunas nao vaza mais', () => {
  const r = redigirSegredos('| Usuario | Senha |\n| admin | hunter2 |');
  assert.equal(r.texto, '| Usuario | Senha |\n***');
  assert.equal(r.achou, true);
});

test('R8 limite conhecido: tabela transposta de 3+ colunas ainda vaza', () => {
  const t = '| Servico | Senha | Token |\n| ads | hunter2 | T0k3n |';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'a linha de valores tem 3 palavras -> e prosa -> fecha o modo');
  assert.equal(r.achou, false);
});

test('R7 limite conhecido: aspas simples nao contam como fronteira', () => {
  const t = "{'senha': 'hunter2'}";
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'apostrofo e comum em prosa; nao entrou na classe de fronteira');
  assert.equal(r.achou, false);
});

test('R7 limite conhecido: XML e query string nao tem separador reconhecido', () => {
  for (const t of ['<senha>hunter2</senha>', 'https://x.com/?senha=hunter2']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `limite conhecido: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

test('R7: sobre-redacao aceita -- pipe em prosa mascara o resto da linha', () => {
  const r = redigirSegredos('me manda a senha | valeu');
  assert.equal(r.achou, true, 'lado seguro de errar: mascara demais, nao de menos');
  assert.ok(!r.texto.includes('valeu'));
});

// =========================================================================
// Round 8 -- revisao final: V-1, V-2, V-3, V-4
// =========================================================================

// --- V-1: a guarda de pergunta estava sendo aplicada ao VALOR -------------
// _ehPergunta foi feita para classificar LINHA de conversa. Usada sobre o
// valor de um campo, fazia senha que comeca com "!"/"." ou termina com "?"
// nunca ser mascarada. Um token so nunca e pergunta -- e valor.

test('V-1: senha com padrao de teclado (!QAZ) na mesma linha', () => {
  const r = redigirSegredos('senha: !QAZ2wsx');
  assert.equal(r.texto, 'senha: ***');
  assert.equal(r.achou, true);
});

test('V-1: senha comecando com ponto', () => {
  const r = redigirSegredos('senha: .Segredo123');
  assert.equal(r.texto, 'senha: ***');
  assert.equal(r.achou, true);
});

test('V-1: senha terminando em interrogacao', () => {
  const r = redigirSegredos('senha: Alf#2026?');
  assert.equal(r.texto, 'senha: ***');
  assert.equal(r.achou, true);
});

test('V-1: senha com !QAZ na linha seguinte ao rotulo', () => {
  const r = redigirSegredos('Senha:\n!QAZ2wsx');
  assert.equal(r.texto, 'Senha:\n***');
  assert.equal(r.achou, true);
});

test('V-1: senha com !QAZ em celula de tabela', () => {
  const r = redigirSegredos('| Senha | !QAZ2wsx |');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('!QAZ2wsx'), 'valor nao pode vazar');
});

test('V-1: o pior caso -- vazava a senha, apagava a conversa e dizia achou=true', () => {
  const r = redigirSegredos('Senha:\n!QAZ2wsx\nfalou');
  assert.ok(!r.texto.includes('!QAZ2wsx'), 'a senha nao pode vazar');
  assert.equal(r.achou, true);
});

test('V-1: a guarda de pergunta continua valendo com 2+ palavras', () => {
  const a = redigirSegredos('qual a senha do chatwoot?');
  assert.equal(a.texto, 'qual a senha do chatwoot?', 'valor "do chatwoot?" tem 2 palavras');
  assert.equal(a.achou, false);
  const b = redigirSegredos('Senha:\nvoce pode ajudar?\nhunter2');
  assert.equal(b.texto, 'Senha:\nvoce pode ajudar?\n***', 'pergunta pulada, valor mascarado');
  assert.equal(b.achou, true);
});

// --- V-2: mesma linha so olhava o token colado ao separador ---------------
// A rodada 5 corrigiu isso SO para armar o modo multilinha. Mensagem digitada
// e justamente o caso de mesma linha -- 10 de 14 fraseados naturais em pt-BR.

test('V-2: rotulo antes do separador, nao colado nele (fraseados naturais)', () => {
  const casos = [
    'senha nova: X7k9Qm2p',
    'a senha do wifi: X7k9Qm2p',
    'a senha e: X7k9Qm2p',
    'segue a senha do painel: X7k9Qm2p',
    'o token do meta e: X7k9Qm2p',
    'a api key e: X7k9Qm2p'
  ];
  for (const t of casos) {
    const r = redigirSegredos(t);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(t)}`);
    assert.ok(!r.texto.includes('X7k9Qm2p'), `deveria mascarar: ${JSON.stringify(t)}`);
  }
});

test('V-2: a assimetria some -- print e mensagem digitada mascaram igual', () => {
  const print = redigirSegredos('Senha:\nX7k9Qm2p');
  const digitada = redigirSegredos('a senha do wifi: X7k9Qm2p');
  assert.equal(print.achou, true);
  assert.equal(digitada.achou, true);
  assert.ok(!print.texto.includes('X7k9Qm2p'));
  assert.ok(!digitada.texto.includes('X7k9Qm2p'));
});

test('V-2: linha sem separador de pontuacao continua como hoje', () => {
  const t = 'qual a senha do chatwoot?';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'so espaco como separador -- regra antiga vale');
  assert.equal(r.achou, false);
});

// --- V-3: sobre-redacao que apagava conversa real ------------------------
// "secret" esta contido em "secretaria", palavra do dia a dia de uma escola
// de musica -- e a mensagem inteira ia para o relatorio das 7h dos diretores.

test('V-3: secretaria nao e rotulo de segredo', () => {
  const t = 'Recado da secretaria: a aula de amanha foi cancelada';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t);
  assert.equal(r.achou, false);
});

test('V-3: outras palavras que continham rotulo por substring crua', () => {
  for (const t of ['o secretario avisou: a reuniao foi adiada', 'a resenha do livro: muito boa']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `nao deveria mascarar: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

test('V-3: rotulo tem de bater com segmento inteiro -- os validos continuam', () => {
  const casos = [
    ['senha_wifi: hunter2', 'hunter2'],
    ['MinhaSenha: hunter2', 'hunter2'],
    ['PasswordConfirm: hunter2', 'hunter2'],
    ['SENHA_ADMIN: hunter2', 'hunter2'],
    ['minha_senha: 123456', '123456'],
    ['api_key: hunter2', 'hunter2'],
    ['api-key: hunter2', 'hunter2'],
    ['apikey: hunter2', 'hunter2'],
    ['chave-api: hunter2', 'hunter2'],
    ['chave: hunter2', 'hunter2']
  ];
  for (const [entrada, valor] of casos) {
    const r = redigirSegredos(entrada);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(entrada)}`);
    assert.ok(!r.texto.includes(valor), `deveria mascarar: ${JSON.stringify(entrada)}`);
  }
});

test('V-3: "chave" so vale como primeiro segmento ou unico', () => {
  for (const t of ['palavras-chave: marketing digital', 'pontos-chave: tres itens']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `nao deveria mascarar: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

// --- V-4: idempotencia incompleta ----------------------------------------
// Com delimitador de ABERTURA, a 1a passagem come o de fechamento e a 2a
// re-arma. A suite nao pegava porque so afirmava p2 === p3.

test('V-4: idempotencia com delimitador de abertura -- p1 === p2 === p3', () => {
  const entradas = [
    '**Senha:** hunter2\nfalou',
    '*Senha:* hunter2\nfalou',
    '`Senha:` hunter2\nfalou',
    '"Senha:" hunter2\nfalou',
    '_Senha:_ hunter2\nfalou',
    '{"senha": "hunter2"}\nfalou',
    'senha: abc123\nfalou',
    '| Senha | hunter2 |\nfalou',
    '**Senha:**\nabc123\nfalou pessoal',
    '***Senha:***\nabc123',
    'SENHA=hunter2\nfalou',
    '| Campo | Valor |\n|---|---|\n| Senha | hunter2 |'
  ];
  for (const t of entradas) {
    const p1 = redigirSegredos(t).texto;
    const p2 = redigirSegredos(p1).texto;
    const p3 = redigirSegredos(p2).texto;
    assert.equal(p1, p2, `1a e 2a passagem divergem em ${JSON.stringify(t)}: ${JSON.stringify(p1)} vs ${JSON.stringify(p2)}`);
    assert.equal(p2, p3, `2a e 3a passagem divergem em ${JSON.stringify(t)}`);
  }
});

test('V-4: a mascara nao e delimitador de fechamento', () => {
  const r = redigirSegredos('**Senha:** hunter2\nfalou');
  assert.ok(!r.texto.includes('hunter2'));
  const p2 = redigirSegredos(r.texto).texto;
  assert.equal(p2, r.texto, 'a 2a passagem nao pode comer a linha seguinte');
  assert.match(p2, /falou/, 'a conversa depois da credencial tem de sobreviver');
});

// --- Bonus: separadores de traco e seta ----------------------------------

test('bonus: traco, travessao e seta como separadores (regra do espaco)', () => {
  for (const t of ['Senha - hunter2', 'Senha — hunter2', 'Senha → hunter2']) {
    const r = redigirSegredos(t);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(t)}`);
    assert.ok(!r.texto.includes('hunter2'), `deveria mascarar: ${JSON.stringify(t)}`);
  }
});

test('bonus: traco com valor de frase nao dispara (regra do espaco vale)', () => {
  const t = 'Senha - nao lembro qual e';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'valor com espacos nao qualifica com separador tipo espaco');
  assert.equal(r.achou, false);
});

// --- As 8 travas ---------------------------------------------------------

test('round 8: as 8 travas seguem byte a byte identicas com achou=false', () => {
  const travas = [
    'qual a senha do chatwoot?',
    'a chave da porta esta emprestada com o joao',
    'me manda o link da anamnese por favor',
    'Deixa eu te contar um segredo:\nvi ela na academia ontem',
    '| Nome | Valor |',
    '| Coluna A | Coluna B |',
    '|---|---|',
    '|:-:|:-:|'
  ];
  for (const t of travas) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `deveria sair identico: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false, `nao deveria sinalizar: ${JSON.stringify(t)}`);
  }
});

// Regressao pega pela comparacao antes/depois desta rodada: a primeira versao
// do V-2 elegia uma barra DENTRO do valor como separador, cortava o valor em
// dois e deixava o segundo pedaco em claro.
test('V-2 regressao: separador colado ao rotulo nao cede lugar a um do valor', () => {
  for (const t of ['| Senha: | hunter2 |', '| **"Senha"**: | hunter2 |', '| Senha | hunter2 |']) {
    const r = redigirSegredos(t);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(t)}`);
    assert.ok(!r.texto.includes('hunter2'), `valor nao pode sobrar em claro: ${JSON.stringify(t)}`);
  }
});

test('V-2: campo unico por linha -- o valor nao vira campo novo', () => {
  const r = redigirSegredos('senha: abc123 token: xyz789');
  assert.equal(r.achou, true);
  assert.ok(!r.texto.includes('abc123'));
  assert.ok(!r.texto.includes('xyz789'));
  assert.match(r.texto, /token/i, 'o rotulo do segundo campo continua preservado');
});

test('V-3: plural continua sendo rotulo (nao regredir o que ja pegava)', () => {
  for (const t of ['senhas: hunter2', 'tokens: hunter2', 'chaves: hunter2']) {
    const r = redigirSegredos(t);
    assert.equal(r.achou, true, `deveria disparar: ${JSON.stringify(t)}`);
    assert.ok(!r.texto.includes('hunter2'));
  }
});

// --- Round 8: limites conhecidos novos, com teste fixando o atual ---------

test('R8 limite conhecido: passphrase de 3+ palavras cai na regra de prosa', () => {
  const t = 'Senha:\ncorrect horse battery staple';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'baixar MIN_PALAVRAS_PROSA apagaria conversa real');
  assert.equal(r.achou, false);
});

test('R8 limite conhecido: connection string e heading markdown', () => {
  for (const t of ['postgres://user:hunter2@host:5432/db', '## Senha\nhunter2']) {
    const r = redigirSegredos(t);
    assert.equal(r.texto, t, `limite conhecido: ${JSON.stringify(t)}`);
    assert.equal(r.achou, false);
  }
});

test('R8 limite conhecido: rotulo DEPOIS do separador nao dispara', () => {
  const t = 'o painel: a senha e X7k9Qm2p';
  const r = redigirSegredos(t);
  assert.equal(r.texto, t, 'o V-2 so olha o que vem antes do separador');
  assert.equal(r.achou, false);
});
