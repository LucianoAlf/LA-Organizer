// src/services/group-chat-triggers.js
// Chat de grupo Fase 2 — gatilhos de engajamento (funções puras, sem I/O).
// O TOM fica em silêncio até menção direta; despedida ao TOM o devolve ao silêncio.

const ENGAGE_WINDOW_MIN = 8;

// Menção direta ao TOM. `tom` é ASCII → \btom\b é seguro (não casa "automático"/"tombou").
// Cobre "@tom", "fala tom", "tom,", "tom?" e o nome isolado.
const ENGAGE_RE = /(^|[\s,!?@])tom\b/i;

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
