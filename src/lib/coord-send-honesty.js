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
// Inclui plural/passiva ("os convites já foram mandados" — audit 01/07 2ª evidência): as
// formas participiais ganham ados|adas. comuniqu NÃO ganha ados (o módulo "comunicados" usa
// o radical "comunic", não "comuniqu" — mas não arriscar). "convidados"/"avise" seguem FORA
// (substantivo e subjuntivo de pedido, respectivamente — cobertos pelos testes de CONTROLE).
const SEND_CLAIM_RE = /\b(avis(?:ei|ado|ada|ados|adas|amos|ando)|mand(?:ei|ado|ada|ados|adas|ando|amos)|repass(?:ei|ado|ada|ados|adas|ando|amos)|encaminh(?:ei|ado|ada|ados|adas|ando|amos)|envi(?:ei|ado|ada|ados|adas|ando)|transmit(?:i|ido|ida|idos|idas|indo)|comuniqu(?:ei|ado|ada)|j[áa]\s+(?:mandei|avisei|enviei|repassei))\b/i;

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

// SEND-CLAIM-NOMARKER (audit 01/07, Reunião Time Gestão): a fala afirma ter avisado/convidado
// pessoas ("mandando o convite pra cada um dos 8") mas NENHUM <<COORDINATION_REQUEST>> foi
// emitido — o strip de coord-send-honesty vivia só DENTRO dos ramos que parseiam o marker, e o
// chokepoint Camada 1 é BINÁRIO (o EVENT_CREATE que persistiu faz nothingPersisted=false). O
// engine chama isto SÓ no ramo sem-coord-marker; aqui a decisão é pura: se afirma envio e não é
// pergunta/rascunho, tira a(s) linha(s) de falso-envio e anexa o aviso honesto. { reply, fired }.
const SEND_NOMARKER_DISCLAIMER =
  '_⚠️ Sendo sincero: eu ainda NÃO avisei ninguém — nenhuma mensagem chegou a ser enviada. Se quiser, me diz pra quem mandar que eu passo o recado._';

function enforceSendHonesty(text, opts = {}) {
  const { isQuestion = false } = opts;
  const s = String(text || '');
  if (isQuestion || !claimsSent(s)) return { reply: s, fired: false };
  const stripped = stripOptimisticSendLines(s);
  return { reply: stripped ? `${stripped}\n\n${SEND_NOMARKER_DISCLAIMER}` : SEND_NOMARKER_DISCLAIMER, fired: true };
}

module.exports = { stripOptimisticSendLines, claimsSent, enforceSendHonesty, SEND_CLAIM_RE, SEND_NOMARKER_DISCLAIMER };
