// src/services/proactive-link.js
// LOTE D (REPLY-QUOTE-PROATIVO, spec 2026-06-19): grava o VÍNCULO de um proativo de
// saída (lembrete) com o objeto que o originou (task/event), pra que um reply-quote a
// esse lembrete resolva o alvo por id EXATO. Reusa a coluna whatsapp_message_id já
// existente em conversation_history (ID externo UAZAPI). buildProactiveLogRow é PURA;
// record/sendAndLink recebem supabase injetado (padrão da casa).
'use strict';

function buildProactiveLogRow({ collaboratorId, waMessageId = null, refType = null, refId = null, content }) {
  const row = {
    collaborator_id: collaboratorId,
    direction: 'outbound',
    message_type: 'text',
    content,
  };
  if (waMessageId) row.whatsapp_message_id = waMessageId;
  if (refType && refId) { row.ref_type = refType; row.ref_id = refId; }
  return row;
}

// Grava a linha de vínculo. Nunca derruba o caller (o proativo já foi enviado).
// O supabase-js NÃO lança por padrão (sem throwOnError): erro de escrita volta em
// `{ error }`, não como exceção — por isso checamos explicitamente (senão a falha
// fica invisível, como mascarou a ausência da migration no review do Lote D).
async function record(supabase, args) {
  try {
    const { error } = await supabase.from('conversation_history').insert(buildProactiveLogRow(args));
    if (error) console.warn('[proactiveLink] record falhou (proativo já enviado):', error.message);
  } catch (e) {
    console.warn('[proactiveLink] record exception (proativo já enviado):', e.message);
  }
}

// Envia o proativo E grava o vínculo num passo só. Substitui o par
// "sendMessage + insert(conversation_history)" nos emissores de lembrete.
// O quiet-gate continua sendo responsabilidade do caller (já checado antes).
async function sendAndLink(supabase, { phone, content, collaboratorId, refType = null, refId = null }) {
  const whatsapp = require('./whatsapp');
  // quiet-exempt: helper genérico; o caller (dispatcher: remind*/checkTaskReminders/
  // checkReminders/checkEventReminders) já passou por isQuietNow/DND antes de chamar
  // sendAndLink. Aqui é só o primitivo de envio + gravação do vínculo.
  const res = await whatsapp.sendMessage(phone, content);
  await record(supabase, { collaboratorId, waMessageId: whatsapp.extractSentMessageId(res), refType, refId, content });
  return res;
}

module.exports = { buildProactiveLogRow, record, sendAndLink };
