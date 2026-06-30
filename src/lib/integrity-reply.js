'use strict';

// PETERSON-INTEGRITY-HIDES-OKCOUNT (auditoria 30/06, Peterson 29/06 08:13): áudio com
// ~6 demandas. O applyTaskActions acumula o 1º soft-dup SEM abortar o lote (Sprint 31),
// então criou 5 tarefas (okCount=5) e segurou 1 dup. Mas o ramo de integrity-block do
// engine assumia "integrity bloqueou = NADA persistiu": sanitizava o cleanText como
// 'failed' (apagando qualquer "criei") e mostrava SÓ o menu de dedup do item 1. As 5
// criadas sumiam do reply (e do marker_log). O usuário leu "TOM só tratou a 1ª demanda".
//
// Este helper é PURO: monta o reply do integrity-block respeitando o okCount real.
//   - okCount>0 → as outras persistiram: sanitiza 'partial' (preserva o "criei" legítimo)
//     e anexa um footer DETERMINÍSTICO com a contagem real (não confia no LLM ter
//     enumerado), antes do menu de duplicata.
//   - okCount==0 → nada persistiu: 'failed' (rebaixa o ✅ otimista), só o menu.
const { sanitizeOptimisticConfirm } = require('./optimistic-confirm');

// opts.sing/opts.plur — formas do footer determinístico por domínio (default tarefa).
//   TASK:  'tarefa já registrada' / 'tarefas já registradas'
//   EVENT: 'evento já registrado'  / 'eventos já registrados'
function buildIntegrityReply(cleanText, dupQuestion, okCount, opts) {
  const ok = Number(okCount) || 0;
  const o = opts || {};
  const sing = o.sing || 'tarefa já registrada';
  const plur = o.plur || 'tarefas já registradas';
  const outcome = ok > 0 ? 'partial' : 'failed';
  let prev = sanitizeOptimisticConfirm((cleanText || '').trim(), outcome);
  if (ok > 0) {
    const footer = `✅ ${ok === 1 ? '1 ' + sing : ok + ' ' + plur}.`;
    prev = prev ? `${prev}\n\n${footer}` : footer;
  }
  const dq = String(dupQuestion || '').trim();
  if (!dq) return prev;
  return prev ? `${prev}\n\n${dq}` : dq;
}

module.exports = { buildIntegrityReply };
