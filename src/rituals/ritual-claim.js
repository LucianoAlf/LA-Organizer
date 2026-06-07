#!/usr/bin/env node
// src/rituals/ritual-claim.js
// Fatia G (RITUAL-NO-RETRY) — claim atômico idempotente para envio de rituais.
//
// PROBLEMA (auditoria 07/06, confirmada por workflow adversarial): fireRitual usava
// check-then-act — enviava PRIMEIRO e gravava o anchor 'sent' DEPOIS. Em erro
// transitório sustentado por mais de um slot (~15min = ~3 ticks de 5min), o ritual
// do dia era PERDIDO sem retry. ~58/61 combos de erro nunca recuperaram.
//
// FIX: espelhar o padrão SEGURO já provado em checkDeadlineAlerts — claim ANTES de
// enviar, apoiado num índice único parcial (ritual_logs_sent_daily_uq, WHERE
// status='sent' AND ritual_type IN <família briefing>). Em erro transitório
// (pré-entrega), faz rollback do claim para liberar o re-envio no próximo tick.
//
// GARANTIA HONESTA: o índice garante ZERO linha 'sent' duplicada por
// (collaborator_id, ritual_type, reference_date). A janela residual de reenvio é
// EQUIVALENTE à de checkDeadlineAlerts (a mensagem PODE, em tese, sair 2x se o
// WhatsApp foi entregue mas o cliente acusou um erro transitório DEPOIS da entrega).
// NÃO é "nunca duplica a mensagem".
//
// Reutilizável (briefing hoje; finance/CEO reports podem reusar depois). O cliente
// `supabase` é injetado para manter o módulo testável sem DB (ver
// scripts/smoke-ritual-retry.js).
'use strict';

// Insere a linha 'sent' como CLAIM ATÔMICO, ANTES do envio. Graças ao índice
// parcial, só UMA execução vence por (collaborator_id, ritual_type, reference_date)
// no dia — imune a tick-a-cada-5min, lag de DB, restart e concorrência.
// Retorna:
//   { won: true, id }                       → venceu o claim, pode enviar
//   { won: false, duplicate: true }         → 23505: outro tick já enviou hoje → skip
//   { won: false, duplicate: false, code }  → outro erro de claim → não arrisca, re-tenta depois
async function claimRitualSend(supabase, collaboratorId, ritualType, ymd) {
  const { data, error } = await supabase
    .from('ritual_logs')
    .insert({
      collaborator_id: collaboratorId,
      ritual_type: ritualType,
      reference_date: ymd,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (error) {
    return { won: false, duplicate: error.code === '23505', code: error.code || null };
  }
  return { won: true, id: data.id };
}

// Rollback do claim — usado SÓ quando o envio falhou com erro transitório
// (pré-entrega), liberando o re-envio no próximo tick. Espelha o delete do claim
// em checkDeadlineAlerts. Falha de rollback é logada, nunca propagada (não derruba o tick).
async function rollbackRitualClaim(supabase, claimId) {
  if (!claimId) return;
  const { error } = await supabase.from('ritual_logs').delete().eq('id', claimId);
  if (error) console.error('[ritual-claim] rollback err:', error.message);
}

// Classifica se um erro de envio é TRANSITÓRIO (= seguro re-tentar via rollback,
// com confiança razoável de que a mensagem NÃO saiu).
//
// EXCLUI deliberadamente (→ NÃO transitório → NÃO faz rollback/retry):
//  - 23505 (unique_violation): só aparece DEPOIS do claim; rollback aqui seria errado.
//  - classe Postgres 08* (connection_exception): pode surgir DEPOIS do WhatsApp já
//    ter saído (ex.: logConversation em engine.sendRitual). Rollback+retry duplicaria.
// Os demais (timeout/rede da fase de IA, falha pré-envio) → transitório → re-tenta.
//
// Default = transitório: preserva (e estende) o retry intra-slot que o check-then-act
// já tinha. Sem isso, um único erro "queimaria" o claim e o ritual nunca re-tentaria.
function isTransientRitualError(err) {
  if (!err) return false;
  const code = err.code || (err.cause && err.cause.code) || null;
  if (code === '23505') return false;
  if (typeof code === 'string' && code.startsWith('08')) return false;
  return true;
}

module.exports = { claimRitualSend, rollbackRitualClaim, isTransientRitualError };
