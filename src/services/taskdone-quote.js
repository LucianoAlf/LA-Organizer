'use strict';

// TASKDONE-QUOTE-REMINDER-NOOP (27/06) — decisão PURA: responder (reply-quote) a um lembrete
// de TAREFA com confirmação de conclusão ("isso foi feito") deve concluir a tarefa CITADA de
// forma determinística, em vez de depender 100% do LLM (que falhou sob fallback Codex — a tarefa
// do Arthur a034a0ae ficou pending). O alvo já vem resolvido por ID (resolveReplyTarget, via
// whatsapp_message_id ÚNICO → sempre 0 ou 1, sem ambiguidade de match). Família reply-quote
// scaffold (igual #4 FINEDIT). Escopo: só task (event = fast-follow).
//
// detectConfirm é INJETADO (default: lazy-require do detectUserConfirmation real). Isso mantém o
// helper testável LOCAL — pending-intents.js puxa ../supabase/client, que só existe na VPS
// ([[project_local_vps_desync]]). O vocabulário "done" real é certificado no E2E da VPS.
const { stripReplyScaffold } = require('../events/detect-approval-reply');

// decideTaskDoneFromQuote({ rawText, target, detectConfirm }) → { refId, title } se for pra
// concluir; senão null. rawText = o `text` do engine (com scaffold); target = saída de
// resolveReplyTarget. detectConfirm(userText, {allowDone}) → 'yes'|'no'|null (default: o real).
function decideTaskDoneFromQuote({ rawText, target, detectConfirm }) {
  if (!target || target.refType !== 'task' || !target.refId) return null;
  const userText = stripReplyScaffold(String(rawText || '')).userText;
  const fn = typeof detectConfirm === 'function'
    ? detectConfirm
    : require('./pending-intents').detectUserConfirmation; // lazy: só no engine (VPS)
  if (fn(userText, { allowDone: true }) !== 'yes') return null;
  return { refId: target.refId, title: target.title || 'tarefa' };
}

module.exports = { decideTaskDoneFromQuote };
