'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pareceEscritaDeCredencial } = require('./credencial-retry-gate');

// --- O caso real que originou o gate (Hugo, 04/09 17:21) ---------------------------------
// Texto reconstruido do question_text gravado em pending_intents, com os valores trocados.
const CASO_REAL = `Vou cadastrar:

*Conta do Google Ads*
Login: contato@lamusic.com.br
Senha: Trocada#2026
ID da conta: 123-456-7890

Confirma?`;

test('caso real: proposta de cadastro sem marker e reconhecida', () => {
  assert.strictEqual(pareceEscritaDeCredencial(CASO_REAL), true);
});

// --- Deve DISPARAR ------------------------------------------------------------------------
const POSITIVOS = [
  ['promessa + senha', 'Vou cadastrar aqui:\nLogin: a@b.com\nSenha: xyz123'],
  ['afirmacao de feito (mentira sem marker)', 'Pronto, cadastrei!\nLogin: a@b.com\nSenha: xyz123'],
  ['registrei', 'Registrei a conta.\nUsuario: admin\nToken: abc-def'],
  ['guardar com api key', 'Posso guardar isso pra voce?\nAPI Key: sk-abc123'],
  ['atualizar credencial existente', 'Vou atualizar a credencial do Canva.\nSenha: nova123'],
  ['apagar', 'Vou apagar a credencial do Meta Ads.\nSenha: irrelevante'],
  ['dois rotulos nao sensiveis', 'Vou registrar aqui:\nE-mail: a@b.com\nURL: https://x.com'],
  ['palavra credencial + um rotulo', 'Vou salvar essa credencial.\nLogin: admin'],
  ['rotulo com asterisco de negrito', 'Vou cadastrar:\n*Senha:* abc123'],
  ['separador igual', 'Vou gravar isso.\nsenha = abc123'],
  ['acento em usuario', 'Vou anotar.\nUsuário: admin\nE-mail: a@b.com'],
];
for (const [nome, texto] of POSITIVOS) {
  test(`dispara: ${nome}`, () => {
    assert.strictEqual(pareceEscritaDeCredencial(texto), true, texto);
  });
}

// --- NAO deve disparar (fail-closed) -------------------------------------------------------
const NEGATIVOS = [
  ['vazio', ''],
  ['nao-string', null],
  ['numero', 42],
  ['leitura sem verbo de escrita', '*Canva — criativos*\nLogin: a@b.com\nSenha: xyz123'],
  ['proposta de TAREFA, nao credencial', 'Vou cadastrar a tarefa de trocar as lampadas da sala 3. Confirma?'],
  ['verbo sem nenhum rotulo', 'Vou cadastrar isso aqui pra voce, pode deixar.'],
  ['um rotulo nao sensivel so', 'Vou registrar.\nE-mail: a@b.com'],
  ['rotulo no meio da frase, nao em ficha', 'Vou anotar que a senha do wifi mudou ontem.'],
  ['conversa sobre credencial sem ficha', 'Vou cadastrar essa credencial assim que voce me mandar os dados.'],
  ['pergunta do usuario ecoada', 'Qual a senha do Canva?'],
];
for (const [nome, texto] of NEGATIVOS) {
  test(`nao dispara: ${nome}`, () => {
    assert.strictEqual(pareceEscritaDeCredencial(texto), false, String(texto));
  });
}

// --- O caso de 04/09 18:25: bullet furou o gate e a mensagem virou teatro ------------------
// Texto reconstruido do [OUT] do log, com os valores trocados. O TOM propos, o Hugo confirmou,
// e nao existia intent nenhuma — porque sem marker o executor nunca roda, e o gate que deveria
// salvar reprovou por UM caractere: toda linha comeca com "• ", que a ancora nao conhecia.
const CASO_BULLET = `Agora vi os valores completos. Situação:

• *Google Ads API - LA Music* — Developer Token, Customer ID e Login Customer ID já registrados
• *Cleinte Oauth Google la.technology* — existe, mas os campos estavam vazios

Vou atualizar o OAuth com os valores reais:
• Client ID: 1041658696311-abc.apps.googleusercontent.com
• Client Secret: ●●●●●●
• Refresh Token: ●●●●●●

Confirma?`;

test('caso real 18:25: ficha com bullet e reconhecida', () => {
  assert.strictEqual(pareceEscritaDeCredencial(CASO_BULLET), true);
});

// Terceira vez no dia que pontuacao tipografica furou uma ancora minha (aspas curvas na
// redacao, travessao no casamento de alvo, bullet aqui). Estes casos existem pra que a
// proxima variacao de marcador de lista nao vire incidente.
const ORNAMENTOS = [
  ['bullet redondo', '•'], ['bullet meio', '·'], ['bullet vazado', '◦'],
  ['quadrado', '▪'], ['circulo cheio', '●'], ['travessao', '—'], ['en-dash', '–'],
  ['hifen ascii', '-'], ['asterisco', '*'], ['citacao', '>'],
];
for (const [nome, orn] of ORNAMENTOS) {
  test(`ornamento de lista nao cega o gate: ${nome}`, () => {
    const t = `Vou atualizar isso:\n${orn} Senha: trocada123\n${orn} Login: a@b.com`;
    assert.strictEqual(pareceEscritaDeCredencial(t), true, t);
  });
}

test('lista numerada tambem conta como ficha', () => {
  assert.strictEqual(pareceEscritaDeCredencial('Vou gravar:\n1. Senha: abc123\n2. Login: a@b.com'), true);
  assert.strictEqual(pareceEscritaDeCredencial('Vou gravar:\n1) Token: abc123'), true);
});

test('bullet sem rotulo de credencial continua NAO disparando', () => {
  const t = 'Vou cadastrar isso aqui:\n• a tarefa das lâmpadas da sala 3\n• e o pedido de baquetas';
  assert.strictEqual(pareceEscritaDeCredencial(t), false);
});

test('ficha com bullet mas SEM verbo de escrita continua leitura', () => {
  const t = '*Canva — criativos*\n• Login: a@b.com\n• Senha: xyz123';
  assert.strictEqual(pareceEscritaDeCredencial(t), false);
});
