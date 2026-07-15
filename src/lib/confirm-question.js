'use strict';
// confirm-question.js — REDE 1 / recência de ação pendente (audit 15/07, caso Matheus).
//
// isActionConfirmQuestion(lastTomText): a ÚLTIMA virada do TOM foi uma pergunta-de-CONFIRMAÇÃO
// de uma ação proposta ("Tá certo isso?", "Confirma?", "Pode ser às 9h?")? É o gate anti-banter
// da camada FRACA do chokepoint (optimistic-confirm.js): "Fechou" após uma confirm-question sem
// persistir = confab (fira honesto); "Fechou, valeu!" sem confirm-question = papo (não fira).
//
// Puro e NÃO load-bearing (o eixo primário é nothingPersisted). Conservador: exige "?" +
// intenção de confirmação. Pergunta de INFO ("qual horário?") NÃO conta — parsear intenção
// de prosa livre já mordeu (coord_response_wrong_bind), então só reconhece padrões explícitos.

const CONFIRM_INTENT_RE = new RegExp(
  '\\b(' +
  't[aá]\\s+certo|est[aá]\\s+certo|certo\\s+assim|' +
  'confirma(?:r|do)?|isso\\s+mesmo|pode\\s+ser|fica\\s+assim|' +
  'assim\\s+(?:t[aá]\\s+)?(?:certo|bom|ok)|' +
  'posso\\s+(?:seguir|agendar|reagendar|criar|marcar|confirmar|lan[çc]ar)' +
  ')\\b',
  'i',
);

function isActionConfirmQuestion(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return false;
  if (!t.includes('?')) return false;       // precisa ser pergunta
  return CONFIRM_INTENT_RE.test(t);          // ...com intenção de confirmação de ação
}

module.exports = { isActionConfirmQuestion };
