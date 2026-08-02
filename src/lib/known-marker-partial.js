'use strict';

// UNKNOWN-MARKER-STRIPPED-SILENT-PARTIAL (Fefê 01/07 21:01): "Reagenda tudo" → o LLM
// emitiu 4 <<TASK_UPDATE>>s mas 3 saíram MALFORMADOS (sem <<END>> pareado); o parser
// principal só consumiu 1 (ok=1) e o catch-all stripper removeu os outros 3 EM SILÊNCIO
// (UNKNOWN_MARKER_STRIPPED names:TASK_UPDATE×3 delta:274). O usuário leu "Reagendando as
// 3 pendentes ✅" com 1 aplicada — confab de falha parcial invisível ao chokepoint
// (algo persistiu ⇒ nothingPersisted=false; lição do audit 26/06).
//
// Este helper é PURO: dado o array de names que o stripper removeu, decide se algum é
// um marker CONHECIDO (= trabalho real perdido, não alucinação tipo <<TASK_CREATE>>).
// Se sim, o engine anexa um aviso honesto pedindo pra repetir o que faltou.

// Markers que o engine SABE executar (paridade com os parsers do engine.js). Um nome
// fora desta lista (ex: TASK_CREATE) é alucinação — stripar em silêncio segue certo.
const KNOWN_MARKER_NAMES = new Set([
  'TASK_UPDATE', 'EVENT_CREATE', 'EVENT_UPDATE', 'COORDINATION_REQUEST',
  'COORDINATION_RESPONSE', 'PREFS_UPDATE', 'HABIT_ACTION', 'FINANCE_ACTION',
  'PERSONAL_LIST_ACTION', 'CHECKLIST_ACTION', 'NOTE_ACTION', 'DND_SET',
  'TASK_GROUP', 'GROUP_REPORT', 'GROUP_NOTE', 'INVENTORY_ACTION',
  'TASK_TO_HABIT',
]);

const PARTIAL_LOSS_DISCLAIMER =
  '_⚠️ Uma parte dos registros não entrou agora (deu erro técnico no meio). Me repete o que faltou que eu aplico na hora._';

/**
 * @param {string[]} strippedNames  names removidos pelo catch-all (ex: ['TASK_UPDATE','END'])
 * @returns {{lost:boolean, known:string[]}} lost=true se removeu marker executável conhecido
 */
function detectKnownMarkerLoss(strippedNames) {
  const known = [...new Set((strippedNames || []).filter((n) => KNOWN_MARKER_NAMES.has(String(n || '').toUpperCase())))];
  return { lost: known.length > 0, known };
}

module.exports = { detectKnownMarkerLoss, KNOWN_MARKER_NAMES, PARTIAL_LOSS_DISCLAIMER };
