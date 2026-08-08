'use strict';

const { stripReplyScaffold } = require('../events/detect-approval-reply');

// AUTO-ALIGN-QUOTE-CONTAMINATION (auditoria 30/06, caso Ana): o auto-align de
// datas (engine.js) lia o `text` CRU pra decidir se o usuário disse "hoje"/"amanhã".
// Quando a mensagem é um reply-quote, o webhook prepende o scaffold
//   [O usuário está RESPONDENDO a esta mensagem anterior: "<citação>"]\n<fala real>
// e a CITAÇÃO pode conter "hoje"/"amanhã" da mensagem do TOM (ex.: cobrança
// "Resolve hoje ou reagenda?"). Isso disparava wantsToday=true e o auto-align
// jogava um reschedule EXPLÍCITO pra data futura (05/07) de volta pra hoje —
// clobber silencioso pós-marker + confab ("✅ reagendado pra 05/07" mas o banco
// ficava em hoje). Mesma família do FINEDIT-QUOTE-SCAFFOLD-MISROUTE: detector
// determinístico tem que ler a FALA REAL, nunca o scaffold.
//
// Retorna a intenção temporal EXPLÍCITA do usuário na fala real (sem a citação).
// wantsTomorrow tem precedência sobre wantsToday (caso Union Suites 02/06: "hoje"
// de passagem + "amanhã" de intenção — só "amanhã" deve valer).
// AUTOALIGN-EXPLANATORY-DAY (01/08, caso Rose) — "amanhã"/"hoje" nem sempre é DESTINO.
// Ela escreveu: "Tom muda essa tarefa pra segunda pfvr, amanhã é domingo, n trabalho".
// O LLM entendeu certo e emitiu reschedule pra SEGUNDA; o auto-align viu a palavra "amanhã"
// (que ali é SUJEITO de uma oração explicativa) e sobrescreveu pra DOMINGO — justamente o dia
// que ela dissera não trabalhar. Dois vetos, ambos conservadores:
//   (1) EXPLANATORY — "amanhã/hoje" seguido de verbo de ligação = está DESCREVENDO o dia,
//       não pedindo ele ("amanhã é domingo", "hoje é feriado").
//   (2) COMPETING — a fala nomeia outro destino (dia da semana, "dia 12", "05/08"): então o
//       "hoje/amanhã" solto não é o alvo.
// PRINCÍPIO: o auto-align é DEFESA DE MODELO, não interpretador. Só age quando o sinal é
// inequívoco; havendo ambiguidade, confia no LLM — que leu a frase inteira — em vez de forçar
// data por palavra isolada. Perde-se um pouco de proteção nos casos mistos; evita-se o erro
// pior, que é gravar a data que a pessoa acabou de RECUSAR.
const EXPLANATORY_DAY_RE = /\b(?:amanh[ãa]|hoje)\s+(?:é|eh|e|foi|ser[áa]|vai\s+ser|t[áa]|est[áa]|seria)\b/u;
const COMPETING_DAY_RE = /\b(?:segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo)(?:[-\s]feira)?\b|\bdia\s+\d{1,2}\b|\b\d{1,2}\/\d{1,2}\b|\bpr[óo]xim[ao]\s+(?:semana|m[êe]s)\b/u;
const EXPLICIT_NUMERIC_DATE_RE = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\bdia\s+\d{1,2})\b/u;
// "próxima sexta", "sexta que vem", "semana que vem": deslocam para a semana seguinte,
// que este resolvedor não modela. Detectar para ABSTER, não para tentar resolver.
const WEEK_SHIFT_RE = /\bpr[óo]xim[ao]\b|\bque\s+vem\b|\bseguinte\b/u;
const WEEKDAY_RE = /\b(domingo|segunda(?:-feira)?|ter[çc]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[áa]bado)\b/gu;
const WEEKDAY_TO_DOW = {
  domingo: 0,
  segunda: 1,
  'segunda-feira': 1,
  terca: 2,
  'terca-feira': 2,
  terça: 2,
  'terça-feira': 2,
  quarta: 3,
  'quarta-feira': 3,
  quinta: 4,
  'quinta-feira': 4,
  sexta: 5,
  'sexta-feira': 5,
  sabado: 6,
  'sabado-feira': 6,
  sábado: 6,
  'sábado-feira': 6,
};

function addDaysYmd(ymd, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return null;
  const d = new Date(`${ymd}T15:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dowFromYmd(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return null;
  const d = new Date(`${ymd}T15:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

function detectExplicitDayIntent(rawText) {
  const userTextLC = stripReplyScaffold(String(rawText || '')).userText.toLowerCase();
  if (EXPLANATORY_DAY_RE.test(userTextLC) || COMPETING_DAY_RE.test(userTextLC)) {
    return { wantsToday: false, wantsTomorrow: false };
  }
  const wantsTomorrow = /\bamanh[ãa]/.test(userTextLC);
  const wantsToday = /\b(hoje)\b/.test(userTextLC) && !wantsTomorrow;
  return { wantsToday, wantsTomorrow };
}

function resolveExplicitWeekdayDate(rawText, { baseYmd } = {}) {
  const userTextLC = stripReplyScaffold(String(rawText || '')).userText.toLowerCase();
  if (!baseYmd || EXPLICIT_NUMERIC_DATE_RE.test(userTextLC)) return null;
  const pedeSemanaSeguinte = WEEK_SHIFT_RE.test(userTextLC);

  const matches = [...userTextLC.matchAll(WEEKDAY_RE)].map((m) => m[1]);
  const unique = [...new Set(matches.map((m) => String(m).normalize('NFD').replace(/\p{Diacritic}/gu, '')))];
  if (unique.length !== 1) return null;

  const targetDow = WEEKDAY_TO_DOW[unique[0]];
  const baseDow = dowFromYmd(baseYmd);
  if (targetDow == null || baseDow == null) return null;

  const delta = (targetDow - baseDow + 7) % 7;

  // TASK-RESCHEDULE-WEEKDAY-OFFBY: "próxima terça" / "terça que vem" caíam numa abstenção
  // total e voltavam pro LLM, que erra o cálculo (4 casos medidos entre 01 e 06/08:
  // "terça após 06/08 é 11/08, não 12/08").
  //
  // Mas "que vem" só é AMBÍGUO quando a próxima ocorrência ainda cai na MESMA semana da base
  // — aí ela pode ser esta (delta) ou a de sete dias depois, e o resolvedor não tem como
  // saber. Quando a próxima ocorrência JÁ cai na semana seguinte, "próxima terça" e "terça
  // que vem" apontam para o MESMO dia: não há decisão a tomar, e abster era desperdiçar
  // certeza. Semana começa no domingo (`baseDow` é 0 = domingo).
  if (pedeSemanaSeguinte) {
    const caiNaSemanaSeguinte = baseDow + delta >= 7;
    if (!caiNaSemanaSeguinte) return null;   // ambiguidade real: deixa o marker do LLM valer
  }
  // delta 0 = a pessoa nomeou o dia de HOJE. Num reagendamento isso nunca é o que ela
  // quer (mover para hoje é no-op), e o mais provável é a semana seguinte — que este
  // resolvedor não sabe decidir. Abster deixa o marker do LLM valer, que é o
  // comportamento de antes do guard: não piora nada, só não força.
  if (delta === 0) return null;
  return addDaysYmd(baseYmd, delta);
}

module.exports = { detectExplicitDayIntent, resolveExplicitWeekdayDate, dowFromYmd };
