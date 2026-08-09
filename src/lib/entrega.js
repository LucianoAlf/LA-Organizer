'use strict';
// entrega.js — a catraca entre "mandei" e "chegou".
//
// GOVLOG-SEM-ENTREGA (09/08/2026). Os rituais que entregam no grupo (digest de auditoria das
// 07:30, ciclo de governança das 08:00) seguem o padrão "posta primeiro, grava o log depois",
// e declaravam o invariante: *se o envio falhar, o próximo tick retenta*. Não se sustentava.
//
// O `postar` de produção é o `postOpsResult` do group-chat-engine, e ele NUNCA lançava:
// `postTomText` fazia `console.error` e devolvia null quando o insert em `group_chat_messages`
// falhava. Então o `await postar(texto)` resolvia normalmente, o `ritual_logs` gravava `sent`,
// e o gate de idempotência bloqueava o retry do dia. O relatório não chegava a ninguém, em
// silêncio — o gate, que existe pra não duplicar mensagem, virava mordaça.
//
// Os testes passavam porque injetavam um `postar` que LANÇA. Validavam um contrato que a
// implementação real não cumpria.
//
// O contrato agora é explícito: **`postar` PROVA a entrega resolvendo com valor truthy.**
// Não provou — falsy, `undefined` ou exceção — conta como não entregue, e quem chama não fecha
// o dia. "Não sei se entregou" é tratado como "não entregou": o custo de retentar é uma
// mensagem repetida; o custo de fechar errado é o dia inteiro em silêncio.

class EntregaNaoConfirmada extends Error {
  constructor(oQue) {
    super(`entrega não confirmada: ${oQue} não chegou ao grupo`);
    this.name = 'EntregaNaoConfirmada';
  }
}

/**
 * Posta e só devolve se a entrega for confirmada. Erro de quem posta passa direto (a causa
 * real vale mais que "não confirmada"); resposta sem prova vira EntregaNaoConfirmada.
 */
async function entregar(postar, texto, oQue = 'a mensagem') {
  const comprovante = await postar(texto);
  if (!comprovante) throw new EntregaNaoConfirmada(oQue);
  return comprovante;
}

module.exports = { entregar, EntregaNaoConfirmada };
