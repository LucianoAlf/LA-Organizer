'use strict';
// MECHANISM-LEAK (regra 16 do SOUL — audit 01/07, caso Reunião Time Gestão):
// o LLM às vezes NARRA o próprio mecanismo pro usuário ("dessa vez o marker vai de verdade —
// com bypass_integrity", "vou disparar o marker"). O STACK_LEAK_RE (engine) cobre infra
// (supabase/sql/paths) e SUBSTITUI a resposta inteira — errado aqui (mataria o card do evento) e
// o próprio comentário pede "não crescer aquele regex". Esta é uma rede SEPARADA, line-level:
// remove só a(s) LINHA(s) que citam vocabulário interno, preserva o resto. Determinística/pura.
//
// Conjunto CONSERVADOR (zero falso-positivo): termos que NUNCA aparecem em prosa PT legítima —
// nomes de marker/campo interno + "bypass_integrity" + fragmentos <<...>> e [ev:. NÃO inclui
// "skill"/"schema" (risco de casar "esquema"); se vazarem, adicionar depois.
// 02/07: +engine (vazou "convite sai quando o engine confirmar"; \bengine\b NÃO casa "engenharia").
const MECHANISM_RE = /\b(markers?|engine|bypass_integrity|bypass\s+integrity|event_create|event_update|task_update|inventory_action|coordination_request|prefs_update|personal_list_action|checklist_action|to_name|to_phone|attendees|collaborator_id|payload)\b|<<\s*[a-z_]+\s*>>|\[ev:/i;

// Linha de OPÇÃO enumerada: "(a) …", "**(b)** …", "a) …", "1) …".
const OPCAO_RE = /^[\s*_>•-]*\(?[a-e1-5]\)[\s*_]/i;

function stripMechanismLeak(text) {
  const s = String(text || '');
  if (!s.trim()) return { reply: s.trim() ? s : '', fired: false };
  const lines = s.split('\n');
  // MECHANISM-LEAK-CORTA-OPCAO (triagem 11/09 — fdc6f327): Rose 14/07, o TOM ofereceu "Duas
  // opções: (a) … (b) Lançamos tudo e o engine verifica duplicidades na hora." — só "engine"
  // vazou, e a linha inteira da opção (b) sumiu: ela recebeu "duas opções" com uma, e o "(a)"
  // dela no turno seguinte caiu num histórico corrompido. Em LINHA DE OPÇÃO o termo interno vira
  // palavra comum; se ainda sobrar vocabulário interno, a linha sai como antes.
  const kept = [];
  let mudou = false;
  for (const line of lines) {
    if (!MECHANISM_RE.test(line)) { kept.push(line); continue; }
    mudou = true;
    if (OPCAO_RE.test(line)) {
      const limpa = line.replace(/\bengine\b/gi, 'sistema').replace(/\bmarkers?\b/gi, 'registro').replace(/\bpayload\b/gi, 'dados');
      if (!MECHANISM_RE.test(limpa)) kept.push(limpa);
    }
  }
  if (!mudou) return { reply: s, fired: false };
  const out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { reply: out, fired: true };
}

module.exports = { stripMechanismLeak, MECHANISM_RE };
