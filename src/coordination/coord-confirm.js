'use strict';
// coord-confirm.js — rede determinística de confirmação de coordenação (Fabi 10/07).
//
// Espelha o staging do financeiro (FIN-CONFIRM): o engine ESTAGIA o COORDINATION_REQUEST e
// confirma antes de enviar; o "sim" (handler pré-LLM) despacha via applyCoordinationRequestAction
// (executor existente, engine.js:1836) — sem depender do LLM re-emitir o marker (que
// confabulou no caso Fabi: "avisei" sem enviar). Ver spec/plan 2026-07-10-coordenacao-confirm.
//
// Helpers PUROS (sem I/O) → testáveis isolados; pending-intents/engine quebram local.

// shouldStageCoordination — FAIL-SAFE: estagiar é o DEFAULT. Todo COORDINATION_REQUEST em
// escopo (toca outra pessoa) DEVE confirmar antes de enviar. NUNCA "envia direto por
// omissão" (fail-OPEN = envio cego sem confirmação = proibido). O parser já rejeita mode
// fora do escopo (schema_invalid), mas este helper NÃO depende disso — retorna true pra
// qualquer lista não-vazia; só uma exceção FUTURA explicitamente segura retornaria false.
function shouldStageCoordination(items, opts = {}) {
  // FATIA 8: preConfirmed = o recado JÁ foi confirmado no turno anterior (o TOM propôs "Mando pro
  // X?" e o usuário disse sim). Não re-estagia — o handler despacha direto. Fora isso, estagia
  // sempre (fail-safe: NUNCA envia sem confirmar).
  if (opts && opts.preConfirmed) return false;
  return Array.isArray(items) && items.length > 0;
}

// buildCoordinationConfirmPreview — FALLBACK da pergunta quando o LLM não escreveu prosa
// (cleanText vazio). O caminho normal usa a prosa do LLM (voz intacta); este é a rede.
function buildCoordinationConfirmPreview(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.recipient_name);
  if (!list.length) return 'Confirma que eu mando esse recado?';
  if (list.length === 1) return `Aviso o ${list[0].recipient_name}? Confirma?`;
  return `Aviso ${list.length} pessoas (${list.map((i) => i.recipient_name).join(', ')})? Confirma?`;
}

// resolveStageConfirmPrompt — COORD-CONFIRM-STAGE-PROSE-CONFAB (Fabi 11/07). A prosa mostrada
// AO ESTAGIAR é MECÂNICA (instrui o user a dar o "sim"), NÃO criatividade do LLM. Se o LLM
// escreveu uma AFIRMAÇÃO DE ENVIO ("Mandando agora ✅", "Avisei") em vez da pergunta, o user
// acha que já foi feito e nunca confirma → o recado fica estagiado e NUNCA sai (Fabi→Luciano
// 11/07). Usa a prosa do LLM SÓ se for pergunta de confirmação limpa; senão, a determinística.
function isSafeConfirmPrompt(t) {
  const low = t.toLowerCase();
  // Sinal de envio consumado/em-curso desqualifica (é o bug): "Mandando/Avisei/Enviei/✅".
  if (/mandando|enviando|enviei|mandei|avisei|avisad|avisando|encaminh|repass|✅|👍/.test(low)) return false;
  // E tem que SOAR como pergunta de confirmação.
  return /confirma/.test(low) || /\?\s*$/.test(t);
}
function resolveStageConfirmPrompt(cleanText, items) {
  const t = (typeof cleanText === 'string' ? cleanText : '').trim();
  return (t && isSafeConfirmPrompt(t)) ? t : buildCoordinationConfirmPreview(items);
}

module.exports = { shouldStageCoordination, buildCoordinationConfirmPreview, resolveStageConfirmPrompt };
