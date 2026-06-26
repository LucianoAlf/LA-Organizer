'use strict';
// Caminho 2 / Fatia 1 — resolvedor determinístico de capacidade & alcance (PURO).
// Decide ANTES do LLM: o TOM consegue essa ação? está no alcance (janela/alvo)? se não,
// qual o redirect honesto? Quem consome ESCREVE a linha (Modelo α) — aqui só o veredito.
//
// EDIT_WINDOW_HOURS é a FONTE ÚNICA da janela ~2h (handler + detectCorrection-path + redirect),
// pra a promessa "~2h" do redirect nunca divergir da query do caller.

const EDIT_WINDOW_HOURS = 2;

// Ações de finança que o engine SABE fazer (espelha FINANCE_ACTIONS do engine).
const FINANCE_CAN = new Set([
  'register_transaction', 'card_purchase', 'card_refund', 'register_bill', 'pay_bill',
  'delete_bill', 'pay_invoice', 'transfer', 'create_account', 'edit_account',
  'edit_transaction', 'delete_transaction',
]);
// Ações que mexem em lançamento RECENTE → têm janela de alcance.
const WINDOWED = new Set(['edit_transaction', 'delete_transaction']);

function appRedirectFor(_action) {
  // app_path = só a NAVEGAÇÃO; o "→ toca no lançamento e edita" é do builder. Evita instrução
  // duplicada ("toque no lançamento → toca nele" soava robótico — review de voz 24/06).
  return {
    app_path: 'Finanças → Transações',
    why: `fora das ~${EDIT_WINDOW_HOURS}h que eu consigo editar pelo chat`,
  };
}

/**
 * @param {{action:string, params?:object}} intent
 * @param {{candidates?:Array}} ctx  candidates = lançamentos recentes já filtrados pela MESMA
 *   query do handler (listRecentTransactions {hours: EDIT_WINDOW_HOURS}). Fonte única.
 * @returns {{can:boolean, reachable:boolean, reason:string, redirect?:{app_path:string,why:string}}}
 */
function resolveFinanceCapability(intent, ctx = {}) {
  const action = intent && intent.action;
  if (!action || !FINANCE_CAN.has(action)) return { can: false, reachable: false, reason: 'unknown_action' };
  // Criar/registrar: SEMPRE dá, sem janela (caso Matheus "joga esses dados").
  if (!WINDOWED.has(action)) return { can: true, reachable: true, reason: 'ok' };
  // Editar/apagar: precisa de alvo dentro da janela E identificável de forma única.
  const cands = Array.isArray(ctx.candidates) ? ctx.candidates : [];
  if (cands.length === 0) return { can: true, reachable: false, reason: 'no_recent_target', redirect: appRedirectFor(action) };
  if (cands.length > 1 && !(intent.params && intent.params.which)) return { can: true, reachable: false, reason: 'ambiguous_target', redirect: appRedirectFor(action) };
  return { can: true, reachable: true, reason: 'ok' };
}

module.exports = { resolveFinanceCapability, EDIT_WINDOW_HOURS, FINANCE_CAN, WINDOWED };
