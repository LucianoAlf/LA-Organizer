'use strict';
// O bypass de lojinha é PRÉ-LLM e dá `return` no engine (engine.js, bloco "Sprint Fase B"):
// quando ele dispara, o turno inteiro do usuário é descartado — não vai pro LLM, nada é salvo.
//
// Caso real — Dudu, 27/08 18:37:25 BRT. Relatório de estoque de 836 chars ("Baquetas Liverpool:
// 12 no total, distribuídas entre recepção, Peterson, Jordão e lojinha... O cabo XLR do Vandinho
// também está separado."). Um segundo depois, 18:37:26, a única resposta foi
// `Unidade "Vandinho" não encontrada.` — e a mesma coisa às 18:52:13 e 19:02:21, quando ele
// reenviou. Às 19:25 ele reclamou: "Poh tom, preciso q anote tudo que te mandei, salva em algum
// lugar." (finding 40d3fb01).
//
// A cadeia: o ramo QUERY casa "lojinha" em qualquer lugar do texto, `queryIntent` casa em
// "estoque", e o fallback do extractUnidadeFromText pega a 1ª palavra Maiúscula depois de
// "da/de/do" — "do Vandinho". Ou seja o relatório vira consulta de estoque de uma unidade
// inventada, e o engine responde só isso.
//
// É o mesmo buraco que o guard `_isImageAnalysis` logo acima já tapa para foto de comprovante
// ("O endereço do cupom fazia o bypass achar que era query de estoque da unidade Campo Grande").
// Relatório longo, transcrição e áudio dump são a mesma coisa: não são query de lojinha digitada.
//
// Medido em produção (inbound com "loj" desde 01/05): 36 mensagens disparam o bypass, e só 5 são
// query real — todas com ≤47 chars e ≤2 linhas. As outras 31 são relatórios, transcrições de
// reunião (uma de 65.536 chars) e análises de imagem.
const assert = require('node:assert');
const { test } = require('node:test');
const { tryShopBypass } = require('./engine');

// Literal exato de conversation_history (inbound, 2026-08-27T21:37:25.576462Z = 18:37:25 BRT).
const RELATORIO_DUDU = [
  'Fala, Rafinha! Hoje comecei pela parte de estoque e fui fazendo o levantamento das baquetas, baterias 9V e cabos.',
  '',
  'Baquetas Liverpool: 12 no total, distribuídas entre recepção, Peterson, Jordão e lojinha. Também encontrei 8 pares de baquetas avulsas na linha de cima do estoque.',
  '',
  'Baterias 9V: 9 no total, sendo 7 reservas e 2 para eventos. Também encontrei 12 Duracell.',
  '',
  'Cabos XLR: 19 no total, sendo 13 funcionando e 6 com defeito, que já deixei separados. O cabo XLR do Vandinho também está separado.',
  '',
  'Sobre as compras: ficaram 4 pares de baquetas para reserva na recepção. As peles de bateria vou segurar por enquanto, conforme o Jordão pediu. E sobre as cordas, o Quintela falou que está vendo com o Luciano.',
  '',
  'Ainda vou continuar a conferência e organização do estoque e fazer a ronda/organização das salas antes de finalizar o dia.',
].join('\n');

test('relatório de estoque não vira query de lojinha (caso Dudu 27/08)', () => {
  assert.strictEqual(tryShopBypass(RELATORIO_DUDU), null);
});

test('transcrição longa com "lojinha" não vira query de lojinha', () => {
  const transcricao = '[áudio transcrito] Cara, eu tenho um monte de coisa pra fazer, eu tenho que comprar os pistões, '
    + 'falar com o pessoal da Sonoramente sobre as cordas, ver o que ficou pendente na lojinha, e ainda '
    + 'preciso fechar o estoque da semana antes de sexta, senão o Jordão vai cobrar de novo.';
  assert.strictEqual(tryShopBypass(transcricao), null);
});

// CONTROLES — a query real de lojinha tem que continuar passando pelo bypass.
test('controle: query curta de lojinha segue disparando', () => {
  assert.deepStrictEqual(tryShopBypass('o que tem na lojinha da Barra?'),
    { action: 'query_shop', params: { unidade: 'Barra' } });
  assert.deepStrictEqual(tryShopBypass('lista pra mim os produtos da lojinha da Barra'),
    { action: 'query_shop', params: { unidade: 'Barra' } });
  assert.deepStrictEqual(tryShopBypass('Lista dos inventário do recreio lojinha'),
    { action: 'query_shop', params: { unidade: 'Recreio' } });
  assert.deepStrictEqual(tryShopBypass('Unidade recreio\nGuarda esse estoque da lojinha'),
    { action: 'query_shop', params: { unidade: 'Recreio' } });
});

test('controle: texto sem lojinha segue devolvendo null', () => {
  assert.strictEqual(tryShopBypass('bom dia, tudo certo por aí?'), null);
  assert.strictEqual(tryShopBypass(RELATORIO_DUDU.replace(/lojinha/gi, 'sala do fundo')), null);
});
