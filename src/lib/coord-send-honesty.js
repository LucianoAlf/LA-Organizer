'use strict';

// COORD-SEND-CONFAB-STRIP (Ana 30/06) — irmão de coordenação do AUDIT-OPTIMISTIC-CONFIRM.
//
// Quando um <<COORDINATION_REQUEST>> é rejeitado (schema_invalid / malformado, comum
// sob fallback do OpenAI), NENHUM recado foi entregue. O fix da Daiana (05/06) já
// ANEXAVA um aviso honesto ("não consegui enviar — ninguém foi avisado"), mas NÃO
// REMOVIA a prosa otimista do LLM. Resultado (Ana): "📨 Avisado! Mandando pro grupo
// ADM GERAL agora." + "não consegui enviar — ninguém foi avisado" = contradição
// intra-mensagem. Os ramos TASK/EVENT já removem via sanitizeOptimisticConfirm; a
// coordenação faltava.
//
// stripOptimisticSendLines remove as LINHAS que afirmam envio (avisado/mandando/
// repassei/encaminhei/enviei...), preservando linhas neutras (saudações etc).
// Determinístico e puro (sem DB) — testável isolado.

// Verbo/particípio/gerúndio de "enviar recado". Cobre o passado ("avisei"), o
// particípio decorativo ("Avisado!") e o gerúndio de falsa-ação ("Mandando agora").
const SEND_CLAIM_RE = /\b(avis(?:ei|ado|ada|amos|ando)|mand(?:ei|ado|ada|ando|amos)|repass(?:ei|ado|ada|ando|amos|ei)|encaminh(?:ei|ado|ada|ando|amos)|envi(?:ei|ado|ada|ados|adas|ando)|transmit(?:i|ido|indo)|comuniqu(?:ei|ado|ada)|j[áa]\s+(?:mandei|avisei|enviei|repassei))\b/i;

function stripOptimisticSendLines(text) {
  const s = String(text || '');
  if (!s.trim()) return '';
  const kept = s
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false; // colapsa linhas em branco órfãs
      return !SEND_CLAIM_RE.test(line);
    });
  return kept.join('\n').trim();
}

// Há alguma afirmação de envio no texto? (gate — só sanitiza/anexa quando mente.)
function claimsSent(text) {
  return SEND_CLAIM_RE.test(String(text || ''));
}

module.exports = { stripOptimisticSendLines, claimsSent, SEND_CLAIM_RE };
