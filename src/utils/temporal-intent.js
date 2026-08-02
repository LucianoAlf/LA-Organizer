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

function detectExplicitDayIntent(rawText) {
  const userTextLC = stripReplyScaffold(String(rawText || '')).userText.toLowerCase();
  if (EXPLANATORY_DAY_RE.test(userTextLC) || COMPETING_DAY_RE.test(userTextLC)) {
    return { wantsToday: false, wantsTomorrow: false };
  }
  const wantsTomorrow = /\bamanh[ãa]/.test(userTextLC);
  const wantsToday = /\b(hoje)\b/.test(userTextLC) && !wantsTomorrow;
  return { wantsToday, wantsTomorrow };
}

module.exports = { detectExplicitDayIntent };
