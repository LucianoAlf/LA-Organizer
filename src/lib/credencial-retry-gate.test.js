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
  ['resumo mascarado do proprio engine', 'Vou cadastrar:\n*Google Ads*\nSenha: ●●●●●●\n\nConfirma?'],
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
