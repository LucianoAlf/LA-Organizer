'use strict';
// src/lib/reafirma-lote-recente.js — CHOKEPOINT-NEGA-LOTE-RECEM-FECHADO (Duda 06/10 18:25). PURO.
//
// A Duda confirmou o fechamento de 8 tarefas ("confirmo" → TASK_UPDATE ok=8, 18:24:46). 10s depois
// escreveu "conclui todos" e o TOM respondeu a verdade: "Já tá tudo concluído, Duda — essas 4 tarefas
// já foram fechadas no 'confirmo' de agora há pouco." O chokepoint trocou por "não consegui registrar".
// A rede de reafirmação (optimistic-confirm.restatesRecentWrite, congelado) casa pelo TÍTULO — e fala
// sobre LOTE não repete título. Esta régua cobre só o lote, e só com as três condições juntas:
//   1) houve escrita EXECUTADA da própria pessoa nos últimos 2 min (o fato existe no banco);
//   2) a fala da pessoa REPETE conclusão ("conclui todos", "feito", "fiz tudo", "tudo feito");
//   3) a resposta diz que JÁ estava feito (reafirma o passado), sem afirmar escrita nova, e o número
//      que ela cita (se citar) não passa do que foi gravado.
// Falta qualquer uma → não veta (o guard segue valendo). Medido nos 60 dias de CHOKEPOINT/redirected
// com escrita prévia: libera só a Duda 06/10.
const JANELA_MS = 120_000;
const USUARIO_CONCLUI_RE = /(?:^|[^\p{L}])(?:conclu[ií]\w*|feit[oa]s?|fiz|fechei|finalizei|terminei|j[aá]\s+fiz|tudo\s+(?:feito|pronto|ok)|todos?|todas?)(?![\p{L}])/iu;
const JA_FEITO_LOTE_RE = /(?:^|[^\p{L}])(?:j[aá]\s+(?:foram|est[aã]o|t[aá]|tava|estava|fechei|dei\s+baixa|conclu[ií]|marquei)|agora\s+h[aá]\s+pouco|no\s+["“]?confirm\w*)(?![\p{L}])/iu;
const ESCRITA_NOVA_RE = /(?:^|[^\p{L}])(?:vou\s+(?:fechar|criar|registrar|marcar)|acabei\s+de\s+(?:criar|registrar)|criei|agendei|registrei\s+agora)(?![\p{L}])/iu;

function _numeroCitado(reply) {
  const m = String(reply).match(/(\d+)\s+(?:tarefas?|itens?|coisas?)/i);
  return m ? Number(m[1]) : null;
}

/**
 * @param {string} reply resposta do TOM (antes do guard)
 * @param {string} userText fala da pessoa (sem andaime)
 * @param {{executadas:number, maisRecenteMs:number|null}} escrita soma de ok= das escritas executadas
 *        dela na janela e o instante da mais recente
 * @param {number} agoraMs
 */
function reafirmaLoteRecente(reply, userText, escrita, agoraMs = Date.now()) {
  const r = String(reply || '');
  if (!r || !escrita || !(escrita.executadas > 0) || !Number.isFinite(escrita.maisRecenteMs)) return false;
  if (agoraMs - escrita.maisRecenteMs > JANELA_MS) return false;
  if (!USUARIO_CONCLUI_RE.test(String(userText || ''))) return false;
  if (!JA_FEITO_LOTE_RE.test(r) || ESCRITA_NOVA_RE.test(r)) return false;
  const n = _numeroCitado(r);
  if (n != null && n > escrita.executadas) return false;
  return true;
}

module.exports = { reafirmaLoteRecente, JANELA_MS };
