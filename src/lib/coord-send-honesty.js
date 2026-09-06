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
// Verbos INEQUÍVOCOS de recado — afirmam envio sozinhos, em qualquer contexto: avisar/
// repassar/encaminhar/transmitir/comunicar não têm sentido financeiro.
const SEND_STRONG_RE = /\b(avis(?:ei|ado|ada|ados|adas|amos|ando)|repass(?:ei|ado|ada|ados|adas|ando|amos)|encaminh(?:ei|ado|ada|ados|adas|ando|amos)|transmit(?:i|ido|ida|idos|idas|indo)|comuniqu(?:ei|ado|ada))\b/i;

// FALSO-FIRE FINANCE (Rose 14/07 18:00): mandar/enviar servem TANTO pra recado QUANTO pra
// "lançar na fatura / o PDF que você enviou". No fluxo de fatura o guard casava "mandando/
// enviado" e DESTRUÍA a lista inteira, cuspindo o disclaimer de recado num papo de cartão.
// Verbo ambíguo só conta como envio-de-recado COM um token de recado na MESMA linha E SEM
// contexto financeiro forte.
const SEND_WEAK_RE = /\b(mand(?:ei|ado|ada|ados|adas|ando|amos)|envi(?:ei|ado|ada|ados|adas|ando)|j[áa]\s+(?:mandei|enviei|repassei))\b/i;
const RECADO_CTX_RE = /\b(recado|mensagem|msg|convites?|aviso|zap|whats?app|wpp|(?:no|pro)\s+grupo|pra\s+(?:ela|ele|eles|elas|voc[êe]s?|galera|equipe|turma|time|todos?|cada\s+um))\b/i;
const FIN_CTX_RE = /\b(fatura|cart[ãa]o|financeiro|lan[çc]a\w*|extrato|pdf|planilha|itens?|compras?|lista)\b/i;

// Uma LINHA afirma envio-DE-RECADO? Mesma decisão pro gate (claimsSent) e pro strip.
function lineIsSendClaim(line) {
  const s = String(line || '');
  if (SEND_STRONG_RE.test(s)) return true;                                  // avisar/repassar... sozinho
  if (SEND_WEAK_RE.test(s) && RECADO_CTX_RE.test(s) && !FIN_CTX_RE.test(s)) return true; // mandar/enviar só c/ recado
  return false;
}

function stripOptimisticSendLines(text) {
  const s = String(text || '');
  if (!s.trim()) return '';
  const kept = s
    .split('\n')
    .filter((line) => {
      if (!line.trim()) return false; // colapsa linhas em branco órfãs
      return !lineIsSendClaim(line);
    });
  return kept.join('\n').trim();
}

// Há alguma afirmação de envio-de-recado no texto? (gate — só sanitiza/anexa quando mente.)
function claimsSent(text) {
  return String(text || '').split('\n').some(lineIsSendClaim);
}

// SEND-CLAIM-NOMARKER (audit 01/07, Reunião Time Gestão): a fala afirma ter avisado/convidado
// pessoas ("mandando o convite pra cada um dos 8") mas NENHUM <<COORDINATION_REQUEST>> foi
// emitido — o strip de coord-send-honesty vivia só DENTRO dos ramos que parseiam o marker, e o
// chokepoint Camada 1 é BINÁRIO (o EVENT_CREATE que persistiu faz nothingPersisted=false). O
// engine chama isto SÓ no ramo sem-coord-marker; aqui a decisão é pura: se afirma envio e não é
// pergunta/rascunho, tira a(s) linha(s) de falso-envio e anexa o aviso honesto. { reply, fired }.
const SEND_NOMARKER_DISCLAIMER =
  '_⚠️ Sendo sincero: eu ainda NÃO avisei ninguém — nenhuma mensagem chegou a ser enviada. Se quiser, me diz pra quem mandar que eu passo o recado._';

// COORD-HONESTY-NEGA-ENVIO-FEITO (Leo 05/08): o disclaimer afirma o ABSOLUTO ("nenhuma mensagem
// chegou a ser enviada"), mas a evidência do guard é só a ausência de marker NESTE turn. Quando o
// recado saiu num turn ANTERIOR — o caso do Leo: 2 envios executados e o guard negando os dois 51
// min depois — a "correção de confab" é ela própria a confab. recentlySent é o fato do banco
// (coordination_requests status=sent na janela); com ele, a fala do LLM é verdadeira e passa.
// COORD-HONESTY-CEGO-A-DEVOLUTIVA (Rafinha 04/09): o veto do Leo nasceu lendo UM ledger
// (coordination_requests) e ficou cego pra devolutiva de tarefa, que entrega por outro canal.
// A evidência passa a ser um mapa {canal: quantidade}; qualquer canal com entrega veta.
function recentlySentFrom(evidence) {
  if (!evidence) return false;
  return Object.values(evidence).some((n) => Number(n) > 0);
}

function enforceSendHonesty(text, opts = {}) {
  const { isQuestion = false, recentlySent = false } = opts;
  const s = String(text || '');
  if (isQuestion || recentlySent || !claimsSent(s)) return { reply: s, fired: false };
  const stripped = stripOptimisticSendLines(s);
  // CINTO (Rose 14/07): se o strip removeria TUDO de um reply LONGO, é overreach de regex —
  // uma resposta legítima longa não é 100% linhas de envio. Claim real é curto (1-2 linhas) OU
  // vem DENTRO de um reply maior (aí o strip preserva o resto). Nunca destruir mais do que salva.
  if (!stripped && s.length > 160) return { reply: s, fired: false };
  return { reply: stripped ? `${stripped}\n\n${SEND_NOMARKER_DISCLAIMER}` : SEND_NOMARKER_DISCLAIMER, fired: true };
}

module.exports = { stripOptimisticSendLines, claimsSent, enforceSendHonesty, recentlySentFrom, lineIsSendClaim, SEND_STRONG_RE, SEND_WEAK_RE, SEND_NOMARKER_DISCLAIMER };
