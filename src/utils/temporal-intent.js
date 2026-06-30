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
function detectExplicitDayIntent(rawText) {
  const userTextLC = stripReplyScaffold(String(rawText || '')).userText.toLowerCase();
  const wantsTomorrow = /\bamanh[ãa]/.test(userTextLC);
  const wantsToday = /\b(hoje)\b/.test(userTextLC) && !wantsTomorrow;
  return { wantsToday, wantsTomorrow };
}

module.exports = { detectExplicitDayIntent };
