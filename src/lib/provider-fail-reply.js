'use strict';
// provider-fail-reply.js — PROVIDER-ALL-FAILED-SILENCIO (Ana Paula 19/08 21:01).
//
// O ritual prometeu 'é só dizer "fecha"', ela disse "Fecha" e não recebeu NADA. Os dois
// provedores de IA falharam (all_providers_failed) e o engine, nesse único caminho, loga
// telemetria e dá `throw` — o webhook que chama só registra o erro. Todos os OUTROS becos
// do engine falam ("tive um problema técnico, tenta de novo"); só a queda total da IA fica
// muda. Silêncio é o pior resultado: a pessoa não sabe se foi ignorada ou se deu erro.
//
// Fala de INFRA (aviso de falha técnica), não personalidade — mesma família dos ~15 avisos
// honestos que já existem no engine. Fonte única pra não brotar variação. Nada foi
// persistido, então a instrução é reenviar.
const PROVIDER_FAIL_REPLY =
  '_Tive um problema técnico aqui e não consegui processar sua mensagem agora — não registrei nada. Me manda de novo daqui a pouco, por favor._';

module.exports = { PROVIDER_FAIL_REPLY };
