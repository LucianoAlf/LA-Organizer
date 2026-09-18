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
// Audit 11/09 (Ana, achado ada0545e): o TRADEOFF acima materializou numa SÉRIE
// multi-dia. Ela pediu "Semana de provas" de 26/09 a 30/09; o LLM emitiu 5 TASK_CREATE
// com sufixo de data em "·" (que a rebaixa de sufixo não quebra, ela só split em —/–),
// score 1.00 nos cinco, e os 4 dias restantes foram comidos em silêncio contra a tarefa
// de 30/09. Re-emit é o MESMO item emitido duas vezes; prazo diferente = item diferente.
//
// Audit 18/09 (Rafinha, achado a60338c6): o mesmo TRADEOFF, agora no MESMO dia. Ele
// mandou 4 manutenções pra Campo Grande; "Trocar lâmpada do corredor do estúdio" casou
// 0.99 contra "Trocar lâmpada do bistrô" (o detector faz strip do sufixo de unidade e
// compara o núcleo, então o miolo que distingue as duas fica diluído) e foi comida em
// silêncio, com okCount++ e "✅ 4 demandas" pro usuário. A tabela tinha três.
// O detector é fuzzy de propósito — o predicado de re-emit não pode ser. Título distinto
// é item distinto: a dúvida vira menu (recuperável), nunca silêncio (irrecuperável).
//
// @param {{created_by?:string, created_at?:string, due_date?:string, title?:string}} conflict — a tarefa candidata a dup
// @param {string} requesterId — id do remetente atual (collaborator.id)
// @param {number} nowMs — Date.now()
// @param {number} windowMs — janela de "recente"
// @param {string} [candidateDueDate] — due_date do item sendo criado agora
// @param {string} [candidateTitle] — title do item sendo criado agora
function isSelfRecentConflict(conflict, requesterId, nowMs, windowMs, candidateDueDate, candidateTitle) {
  if (!conflict || !requesterId) return false;
  if (conflict.created_by !== requesterId) return false;   // só re-emit do PRÓPRIO remetente
  if (!conflict.created_at) return false;
  const createdMs = new Date(conflict.created_at).getTime();
  if (!Number.isFinite(createdMs)) return false;
  const age = nowMs - createdMs;
  if (age < 0 || age > windowMs) return false;              // dentro da janela (não futuro)
  if (conflict.due_date && candidateDueDate && conflict.due_date !== candidateDueDate) {
    return false;                                           // dia diferente → não é re-emit
  }
  if (conflict.title && candidateTitle
      && normalizeTitle(conflict.title) !== normalizeTitle(candidateTitle)) {
    return false;                                           // título distinto → item distinto
  }
  return true;
}

// Sem fuzzy de propósito: só caixa, acento e pontuação. Foi a tolerância fuzzy do
// detector que produziu os 12 sumiços medidos em 18/09.
function normalizeTitle(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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
