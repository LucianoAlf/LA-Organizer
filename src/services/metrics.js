// src/services/metrics.js — Sprint 10
// Telemetria operacional do motor: 1 linha em tom_metrics por processMessage.
// Não substitui marker_logs (que é audit/journal). Esta tabela é pra responder
// "qual a latência mediana?", "quantos fallbacks aconteceram?", "quantos leaks
// bloqueados?", "qual provider tá segurando?".
//
// Falha silenciosa: erro de telemetria nunca pode quebrar o fluxo principal.
const supabase = require('../supabase/client');

async function recordMessage(payload) {
  try {
    await supabase.from('tom_metrics').insert({
      collaborator_id: payload.collaborator_id || null,
      message_kind: payload.message_kind || 'text',
      provider_used: payload.provider_used || null,
      fallback_from: payload.fallback_from || null,
      latency_ms: payload.latency_ms ?? null,
      input_tokens: payload.input_tokens ?? null,
      output_tokens: payload.output_tokens ?? null,
      sanitized_chars: payload.sanitized_chars || 0,
      leak_blocked: !!payload.leak_blocked,
      leak_match: payload.leak_match || null,
      marker_emitted: payload.marker_emitted || null,
      marker_result: payload.marker_result || null,
      error_kind: payload.error_kind || null,
      skill_active: payload.skill_active || null,
      actionable_intent: !!payload.actionable_intent, // Fatia J: era OMITIDO no insert → coluna ficava sempre no DEFAULT false (dashboard ACTIONABLE_NO_MARKER cego)
    });
  } catch (e) {
    // Nunca quebrar o fluxo principal por causa de telemetria.
    console.error('[Metrics] insert falhou:', e.message?.slice(0, 200));
  }
}

module.exports = { recordMessage };
