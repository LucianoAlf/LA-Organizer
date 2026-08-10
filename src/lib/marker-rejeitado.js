'use strict';
// marker-rejeitado.js — a catraca entre "o marker caiu" e "a fala afirma que não caiu".
//
// HABIT-UPDATE-SILENT-LIE (10/08/2026). Quando um marker é rejeitado no PARSER (schema_invalid,
// invalid_json, ação desconhecida), ZERO foi persistido — mas o texto que o LLM escreveu junto
// segue no ar. Dos 21 ramos `malformed` do engine, 13 dropavam o marker e mandavam a fala
// intacta: "Beleza, Bianca! Hábito continua, só sem o toque das 6h" com o lembrete das 6h ainda
// tocando. TASK_UPDATE e EVENT_CREATE já rebaixavam desde a Sprint 21.5; o guard existia e
// nunca foi propagado — o buraco morava nos irmãos que ninguém fechou.
//
// Por que o gate é o FRACO (hasWeakCompletionClaim) e não o padrão: a fala da Bianca não tem
// ✅ nem "criado/registrado/salvei", então `hasOptimisticConfirm` devolve false para ela. Um fix
// plugado no gate padrão ficaria verde e deixaria o caso de origem exatamente como estava.
// O fraco é seguro AQUI e só aqui: o ramo é binário — marker rejeitado = nada no banco —,
// então não existe o meio-termo que faz o detector fraco ser arriscado no caminho parcial.

const { hasOptimisticConfirm, hasWeakCompletionClaim, sanitizeOptimisticConfirm } = require('./optimistic-confirm');

// Reconhece o próprio aviso já anexado (dois markers rejeitados no mesmo turno).
const JA_AVISADO = /problema t[ée]cnico e n[ãa]o consegui/i;

function _aviso(oQue) {
  const alvo = (typeof oQue === 'string' && oQue.trim()) ? ` ${oQue.trim()}` : '';
  return `_⚠️ Tive um problema técnico e não consegui salvar${alvo}. Não confirmei nada — me pede de novo?_`;
}

/**
 * Rebaixa a confirmação e anexa o aviso honesto quando o marker foi rejeitado.
 * PURA. Devolve { texto, rebaixou } — `rebaixou:false` significa "não havia promessa", e nesse
 * caso o texto volta idêntico: pergunta e resposta neutra não viram susto.
 *
 * @param {string} texto  A fala do LLM já sem o bloco do marker (cleanText).
 * @param {{oQue?: string}} [opts]  Substantivo do domínio ("o hábito", "o checklist").
 */
function honestidadeDeMarkerRejeitado(texto, opts = {}) {
  const t = typeof texto === 'string' ? texto : '';
  if (!t.trim()) return { texto: t, rebaixou: false };
  if (JA_AVISADO.test(t)) return { texto: t, rebaixou: false };

  const prometeu = hasOptimisticConfirm(t) || hasWeakCompletionClaim(t);
  if (!prometeu) return { texto: t, rebaixou: false };

  // includeWeak: sem ele o sanitizador não remove a linha da Bianca — o aviso entraria embaixo
  // da afirmação falsa, que é pior que não avisar (a pessoa lê as duas e acredita na primeira).
  const base = sanitizeOptimisticConfirm(t, 'failed', { includeWeak: true }).trim();
  const aviso = _aviso(opts && opts.oQue);
  return { texto: base ? `${base}\n\n${aviso}` : aviso, rebaixou: true };
}

module.exports = { honestidadeDeMarkerRejeitado };
