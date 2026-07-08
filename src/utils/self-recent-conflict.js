'use strict';
// self-recent-conflict.js — detecta "auto-conflito recente" no dup-guard de criação.
//
// Audit 08/07 (Ana 🔴): quando o dup-guard flagra uma tarefa que o PRÓPRIO remetente
// criou há poucos minutos (mesma conversa/rajada), o "conflito" é quase sempre um
// RE-EMIT do que o TOM acabou de criar — perguntar "1/2/3" não faz sentido (disparou
// 7x na conversa da Ana em 09:56–10:06 → ela desistiu: "desisti de você"). Este
// predicado marca esse caso pra SILENCIAR a pergunta e pular a criação (como o dedupe
// defensivo de 60s, porém semântico e com janela maior).
//
// ⚠️ TRADEOFF (sinalizado à catraca): o match do detector é FUZZY. Duas tarefas
// DISTINTAS mas quase-idênticas do mesmo remetente na janela (ex.: "Ligar cliente A" vs
// "Ligar cliente B", sem o sufixo "— X") também casam → a 2ª seria pulada em silêncio.
// Mitigado por: (i) janela curta (default 5min, env TOM_SELF_RECENT_CONFLICT_MS);
// (ii) threshold alto do detector (score>=0.95 c/ keyword, ou >0.85 c/ 2+ keywords);
// (iii) rebaixa de sufixo distinto ("— Renan" vs "— Kinho") já feita no detector.
// A parte 2 (re-emit→reschedule determinístico) fica pra design com TDD depois.
//
// @param {{created_by?:string, created_at?:string}} conflict — a tarefa candidata a dup
// @param {string} requesterId — id do remetente atual (collaborator.id)
// @param {number} nowMs — Date.now()
// @param {number} windowMs — janela de "recente"
function isSelfRecentConflict(conflict, requesterId, nowMs, windowMs) {
  if (!conflict || !requesterId) return false;
  if (conflict.created_by !== requesterId) return false;   // só re-emit do PRÓPRIO remetente
  if (!conflict.created_at) return false;
  const createdMs = new Date(conflict.created_at).getTime();
  if (!Number.isFinite(createdMs)) return false;
  const age = nowMs - createdMs;
  return age >= 0 && age <= windowMs;                       // dentro da janela (não futuro)
}

// buildSelfRecentSkipReason — monta a string `reason` do marker_logs quando o skip
// dispara. Observabilidade (audit 08/07, pedido da catraca): o skip antes só ia pro
// console.warn (invisível ao auditor das 7h, que lê marker_logs, não faz grep no stdout).
// Persistir com esta reason deixa a auditoria CONTAR reincidência e investigar perda real
// (o TRADEOFF fuzzy acima). Determinístico e puro (sem Date.now/IO) → testável isolado.
// Formato fixo (contrato com o auditor): self_recent_skip:existing=<8hex> age=<Nmin> score=<X.XX>
//
// @param {{existingId?:string, ageMs?:number, score?:number}} opts
// @returns {string}
function buildSelfRecentSkipReason(opts = {}) {
  const { existingId, ageMs, score } = opts || {};
  const existing = existingId ? String(existingId).slice(0, 8) : 'unknown';
  const ageMin = Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 60000)) : 0;
  const scoreStr = Number.isFinite(score) ? Number(score).toFixed(2) : 'na';
  return `self_recent_skip:existing=${existing} age=${ageMin}min score=${scoreStr}`;
}

module.exports = { isSelfRecentConflict, buildSelfRecentSkipReason };
