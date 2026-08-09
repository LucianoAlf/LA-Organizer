'use strict';
// Contrato: o que o interceptor de FATURA envia, ele PERSISTE.
//
// Caso real — Rose, 09/08 00:39 BRT. Ela respondeu "Lançar" à prévia da fatura do Inter. O
// executor determinístico lançou de verdade (9 itens em pf_transactions às 00:39:42, intent
// invoice_import resolvida `confirmed`/"lancou 9 itens") e mandou o "✅ Lancei 9 de 9 compras"
// no WhatsApp. Só que NENHUMA dessas mensagens entrou em conversation_history: sendMessage não
// loga, quem loga é logConversation, e os 10 pontos de saída do interceptor de fatura chamavam
// só o primeiro.
//
// Duas consequências, as duas caras:
//   1. o contexto do TOM é reconstruído de conversation_history — sem o ack, ele não sabe que
//      lançou. No mesmo dia a Rose teve que cobrar: "A do Nubank vc havia dito que tinha lançado".
//   2. a auditoria lê a mesma tabela e viu "usuária confirmou / TOM pediu confirmação de novo",
//      abrindo um dropped_request que não existia.
//
// Prova de que as mensagens SAÍRAM mas não foram gravadas: às 00:34 e às 00:39 a Rose deu
// reply-quote na prévia da fatura — o texto citado está no inbound dela, e não existe nenhuma
// linha outbound com ele. Em todo o histórico: 0 linhas com "Li N compras da fatura" e 0 com
// "Lancei N compras no".
//
// Este teste é de CONTRATO no fonte (mesma forma de task-to-habit-contract.test.js): prova que
// todo caminho de saída dos interceptors de fatura grava antes de dar return. Não substitui um
// teste de integração do processMessage — esse não existe hoje.
const assert = require('node:assert');
const { test } = require('node:test');
const fs = require('fs');
const path = require('path');

const ENGINE_SRC = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');

// Os dois interceptors determinísticos da fatura: A manda a prévia, B executa o "lançar".
const REGIOES = [
  ['Intercept A (prévia da fatura)', '// === Intercept A:', "console.warn('[Fatura] intercept A err:"],
  ['Intercept B (resposta ao preview / commit)', '// === Intercept B:', "console.warn('[Fatura] intercept B err:"],
];

function fatiar(inicio, fim) {
  const i = ENGINE_SRC.indexOf(inicio);
  assert.ok(i > 0, `âncora de início não encontrada no engine: ${inicio}`);
  const f = ENGINE_SRC.indexOf(fim, i);
  assert.ok(f > i, `âncora de fim não encontrada no engine: ${fim}`);
  return ENGINE_SRC.slice(i, f).split('\n');
}

for (const [nome, inicio, fim] of REGIOES) {
  test(`${nome}: todo sendMessage grava em conversation_history antes do return`, () => {
    const linhas = fatiar(inicio, fim);
    const semLog = [];
    for (let i = 0; i < linhas.length; i++) {
      if (!linhas[i].includes('whatsapp.sendMessage(')) continue;
      // do envio até o return que fecha aquele caminho de saída
      let fimSaida = i;
      while (fimSaida < linhas.length && !linhas[fimSaida].includes('return;')) fimSaida++;
      assert.ok(fimSaida < linhas.length, `sendMessage sem return no caminho: ${linhas[i].trim()}`);
      const trecho = linhas.slice(i, fimSaida + 1).join('\n');
      if (!trecho.includes('logConversation(')) semLog.push(linhas[i].trim().slice(0, 90));
    }
    assert.deepStrictEqual(
      semLog, [],
      `${semLog.length} saída(s) mandam mensagem pro usuário e não gravam em conversation_history — ` +
      'o TOM esquece que respondeu e a auditoria lê como pedido ignorado',
    );
  });
}

// O ack do commit é o que a Rose não recebeu no histórico. Fixa ele por nome pra que uma
// refatoração que mova o bloco não faça o teste passar por vacuidade.
test('o ack de "Lancei N compras" existe e é gravado', () => {
  const linhas = fatiar('// === Intercept B:', "console.warn('[Fatura] intercept B err:");
  const i = linhas.findIndex((l) => l.includes('Lancei ${_okN} de'));
  assert.ok(i > 0, 'ack do commit da fatura sumiu do Intercept B');
  let f = i;
  while (f < linhas.length && !linhas[f].includes('return;')) f++;
  assert.ok(
    linhas.slice(i, f + 1).join('\n').includes('logConversation('),
    'o ack do lançamento da fatura é enviado mas não persistido',
  );
});
