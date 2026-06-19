// src/services/reply-ref.js
// LOTE D (REPLY-QUOTE-PROATIVO, spec 2026-06-19): resolução DETERMINÍSTICA do alvo de um
// reply-quote a um proativo. O engine extrai o stanzaID da msg citada, busca a linha
// outbound com esse whatsapp_message_id e carrega o objeto. Estas funções PURAS decidem
// se há alvo ancorável e montam o hint pro LLM — sem I/O, testáveis. Filosofia
// FECHAMENTO-ITEM-NO-ANCHOR / ALVO-FUTURO-RESPOSTA-CURTA: ancorar por id, nunca chutar.
'use strict';

const ALIVE = new Set(['pending', 'in_progress']);

/**
 * @param {{ quotedId:string|null,
 *           row:{ref_type?:string, ref_id?:string}|null,
 *           object:{id:string, status?:string, title?:string}|null }} a
 * @returns {{ refType:string, refId:string, title:string }|null}
 */
function resolveReplyTarget({ quotedId, row, object }) {
  if (!quotedId) return null;                              // não é reply-quote
  if (!row || !row.ref_id || !row.ref_type) return null;  // proativo sem vínculo
  if (!object || object.id !== row.ref_id) return null;   // objeto sumiu/diverge
  if (object.status && !ALIVE.has(object.status)) return null; // done/cancelled → não ancora
  return { refType: row.ref_type, refId: row.ref_id, title: object.title || 'item' };
}

function buildReplyRefCtxHint(target) {
  if (!target) return '';
  const kind = target.refType === 'event' ? 'evento' : 'tarefa';
  return `\n\n[CONTEXTO INTERNO — não verbalize ao usuário]\n`
    + `O usuário está respondendo (reply-quote) a um lembrete da ${kind} "${target.title}" `
    + `(id ${target.refId}). Se ele pediu novo prazo, nova data ou novo lembrete, emita o `
    + `marker de atualização (<<TASK_UPDATE>>) para ESTE id — não crie, conclua nem `
    + `reagende nenhum outro item.`;
}

module.exports = { resolveReplyTarget, buildReplyRefCtxHint };
