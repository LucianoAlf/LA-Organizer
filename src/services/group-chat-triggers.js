// src/services/group-chat-triggers.js
// Chat de grupo Fase 2 — gatilhos de engajamento (funções puras, sem I/O).
// O TOM fica em silêncio até menção direta; despedida ao TOM o devolve ao silêncio.

const ENGAGE_WINDOW_MIN = 8;

// Menção direta ao TOM. `tom` é ASCII → \btom\b é seguro (não casa "automático"/"tombou").
// Cobre "@tom", "fala tom", "tom,", "tom?" e o nome isolado.
const VOCATIVE_STOPWORDS = new Set([
  'o', 'a', 'os', 'as', 'do', 'da', 'dos', 'das', 'pro', 'pra', 'pros', 'pras',
  'ao', 'aos', 'com', 'de', 'no', 'na', 'nos', 'nas', 'um', 'uma',
]);

// Janela em que uma resposta a uma PERGUNTA do TOM conta sem precisar repetir o nome.
const AWAIT_WINDOW_MS = 3 * 60 * 1000;

// Normaliza um token pra a-z minúsculo sem acento/pontuação (p/ comparar no stoplist).
function _normToken(tok) {
  return String(tok || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
}

// "Tom" como CHAMADO DIRETO (vocativo), não menção sobre ele.
// Acorda: "@tom"; "Tom" no início; "Tom" precedido de palavra fora do stoplist ("fala tom", "bom dia Tom").
// NÃO acorda: "o Tom", "pro Tom", "com o Tom" (sobre ele); nem substring ("automático", "tombou", "fantom").
function isVocativeTom(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  if (/@tom\b/.test(lower)) return true;                  // @tom é sempre chamado
  const words = lower.split(/[^a-zà-ú@]+/i).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (_normToken(words[i]) !== 'tom') continue;
    if (i === 0) return true;                             // "Tom ..." no início
    if (!VOCATIVE_STOPWORDS.has(_normToken(words[i - 1]))) return true; // precedido de não-stopword
    // precedido de artigo/preposição → menção sobre ele; segue procurando outra ocorrência
  }
  return false;
}

// Endereçamento: o TOM só fala se for vocativo, reply à msg dele, ou se ele estava esperando.
// (isReplyToTom entra no fast-follow; no v1 vem sempre false do watcher.)
function isAddressedToTom({ text, isReplyToTom = false, tomAwaiting = false } = {}) {
  return isVocativeTom(text) || !!isReplyToTom || !!tomAwaiting;
}

// Despedida dirigida ao TOM: precisa do nome "tom" E de um termo de fechamento na mesma msg.
// Nota: \b NÃO funciona após vogal acentuada no JS (ex: "até" com \b no final falha).
// Usamos anchor de espaço/pontuação nos dois lados em vez de \b para os termos de despedida.
const DISENGAGE_RE = /\btom\b/i;
const FAREWELL_RE = /(?:^|[\s,!?])(?:valeu+|obrigad[ao]s?|tchau|at[eé]|fechou|brigad[ao])(?:[\s,!?.]|$)/i;

function detectEngageTrigger(text) {
  if (!text || typeof text !== 'string') return false;
  return ENGAGE_RE.test(text);
}

function detectDisengageTrigger(text) {
  if (!text || typeof text !== 'string') return false;
  if (!DISENGAGE_RE.test(text)) return false;
  return FAREWELL_RE.test(text);
}

// Engajado = sessão ABERTA. `engaged_at` é o INÍCIO da sessão (não desliza). A sessão
// fica aberta até o watcher fechá-la por ociosidade (silêncio >= 8min, medido pela última
// mensagem real) ou despedida. O cap de horas é só uma trava de segurança contra estado preso.
const ENGAGE_MAX_HOURS = 12;
function isEngaged(engagedAt, now = new Date(), maxHours = ENGAGE_MAX_HOURS) {
  if (!engagedAt) return false;
  const t = new Date(engagedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < maxHours * 60 * 60 * 1000;
}

module.exports = { detectEngageTrigger, detectDisengageTrigger, isEngaged, ENGAGE_WINDOW_MIN, ENGAGE_MAX_HOURS };
