// src/coordination/coord-recency.js
// COORD-RESPONSE-WRONG-BIND (Alf 22/06) — recency gate do COORD_HINT.
//
// Bug: havia um recado aberto (Yuri->Alf, "como ficou o lance dos aniversariantes?",
// 20:34) E o TOM mandou um FECHAMENTO mais novo pro Alf (21:01). O Alf respondeu o
// fechamento ("a reunião não resolveu nada"), mas o COORD_HINT pressionou o LLM a tratar
// como resposta ao recado -> COORDINATION_RESPONSE errado, relay envenenado pro Yuri.
//
// Sinal determinístico (espelha shouldClosingInterceptorFire "não há intent mais fresca"):
// se o TOM falou ALGO com o user DEPOIS de entregar o recado mais recente, a resposta do
// user provavelmente é pra ESSA msg mais nova, não pro recado velho. O buffer ignora a
// PRÓPRIA entrega do recado (vai pro histórico segundos após o request ser criado).
//
// PURO/testável. Não decide sozinho concluir nada — só diz se deve SUPRIMIR a pressão de
// COORDINATION_RESPONSE (deixando a msg seguir o fluxo natural). Relay explícito
// ("avisa o X que Y") tem caminho próprio (detect-relay-request) e não passa por aqui.

/**
 * @param {string} newestRequestIso  created_at do recado aberto mais recente
 * @param {string[]} outboundIsos    created_at de mensagens outbound ao user APÓS o request
 * @param {number} [bufferMs]        janela que ignora a entrega do próprio recado (default 5min)
 * @returns {boolean} true se há outbound mais novo que o recado+buffer (=> suprimir o hint)
 */
function hasFresherOutboundAfterRequest(newestRequestIso, outboundIsos, bufferMs = 5 * 60 * 1000) {
  if (!newestRequestIso) return false;
  const base = new Date(newestRequestIso).getTime();
  if (Number.isNaN(base)) return false;
  const cutoff = base + bufferMs;
  return (outboundIsos || []).some((iso) => {
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && t > cutoff;
  });
}

module.exports = { hasFresherOutboundAfterRequest };
