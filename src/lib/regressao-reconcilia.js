'use strict';
// src/lib/regressao-reconcilia.js
// UMA fonte de verdade pra "este finding é MESMO uma regressão?", usada pelos DOIS relatórios
// (DM das 07h via conv-quality-format, grupo via ops-digest). Se cada um decidisse sozinho,
// voltariam a divergir na frente do dono — foi o que já aconteceu com a fala do restart.
//
// AUDIT-REGRESSION-PROMOTED-MISMATCH (16/08): a auto-triagem casa o finding a um known-issue
// por SEMELHANÇA DE SINTOMA (matched_code, confiança do LLM) e, se o KI está corrigido e o
// incidente é posterior, chuta decision='regression'. É um PALPITE pré-ciclo. Quando o agente
// examina e PROMOVE o finding a um código DIFERENTE (promoted_code), ele já decidiu que é raiz
// NOVA — não recorrência daquele KI. Caso real: symptom "afirma depois desmente" casou
// TOM-AFIRMA-DEPOIS-DESMENTE (0.95), mas a raiz era o guard de promessa se desmentindo, e o
// agente promoveu pra CONFAB-INVERSO-OFERTA-CONDICIONAL. O banner "🔁 REGRESSÃO
// [TOM-AFIRMA-DEPOIS-DESMENTE]" contradizia o veredito do próprio agente.
//
// Regra: é regressão quando a triagem disse 'regression' E o agente NÃO promoveu pra um código
// diferente do casado. Promoção ao MESMO código = agente confirmou o KI voltando (segue
// regressão). Sem promoção = palpite ainda vale (o ciclo não refinou). Só a promoção a um
// código DISTINTO derruba o rótulo.
function ehRegressaoConfirmada(finding) {
  if (!finding) return false;
  const decision = (finding.auto_triage || {}).decision;
  if (decision !== 'regression') return false;
  const matched = (finding.auto_triage || {}).matched_code;
  if (finding.promoted_code && matched && finding.promoted_code !== matched) return false;
  return true;
}

module.exports = { ehRegressaoConfirmada };
