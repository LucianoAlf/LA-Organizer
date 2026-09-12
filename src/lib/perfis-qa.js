'use strict';
// perfis-qa.js — RUIDO-QA-NA-AUDITORIA (12/09/2026).
//
// Os perfis de replay ("[QA] Replay 01", "[QA] Replay 02") existem pra eu rodar E2E sem tocar em
// gente. Mas o que eles produzem entrava na auditoria como sinal de produção: na foto de 12/09, 6
// dos 7 disparos de CHOKEPOINT e 4 dos 5 fallbacks do provedor eram meus — inclusive um fallback
// que eu FORCEI pra reproduzir um bug. Alarme que gasta a atenção do Alf é o mesmo estrago do
// alarme falso da série faminta: ele ensina a ignorar o painel.
//
// O marcador é o NOME: perfil de replay começa com "[QA]". Só o começo — "o [QA] pediu" no meio de
// um nome de pessoa não pode sumir da conta. PURO.

const QA_PREFIXO = /^\s*\[qa\]/i;

function ehNomeQA(nome) {
  return QA_PREFIXO.test(String(nome == null ? '' : nome));
}

/** Ids dos colaboradores de replay, a partir das linhas (id, full_name). */
function idsQA(colaboradores) {
  return new Set((colaboradores || []).filter((c) => c && ehNomeQA(c.full_name)).map((c) => c.id));
}

/**
 * Tira da amostra as linhas cujo collaborator_id é de replay. Linha SEM DONO fica (é produção:
 * fila, job, audiência sem colaborador); linha vazia/nula sai, que é lixo e não é sinal.
 */
function foraDoQA(linhas, ids) {
  const s = ids instanceof Set ? ids : new Set(ids || []);
  return (linhas || []).filter((l) => l && !s.has(l.collaborator_id));
}

module.exports = { ehNomeQA, idsQA, foraDoQA };
