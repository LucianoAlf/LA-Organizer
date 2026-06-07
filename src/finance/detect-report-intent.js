'use strict';
// Roteador DETERMINÍSTICO de intenção de RELATÓRIO financeiro (pré-LLM).
// PORQUÊ: com 11 query_* parecidas o LLM erra a escolha (Luciano 07/06:
// "fechamento de maio"→checkup; "saldo do nubank"→extrato; "gastos da semana"→query_transactions).
// Frases de relatório são curtas/estereotipadas → roteamos no engine (igual detectCorrection),
// sem depender do LLM. CONSERVADOR: só casa alta-confiança; senão devolve null (cai no LLM+skill).
// NUNCA casa: registro de transação, lookup por categoria, "resumo da semana" puro (=trabalho),
// criar carteira/cartão, transferência, não-finanças. (Bug FIN-REPORT-ACTION-ALIAS / fase 2.)

const MES_NUM = { janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const MES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
function _ym(nome, today) {
  const mm = MES_NUM[nome];
  if (!mm) return null;
  const y = String(today || new Date().toISOString().slice(0, 10)).slice(0, 4);
  return `${y}-${mm}`;
}
function _acct(raw) { const a = String(raw || '').replace(/[?.!,]+$/, '').trim(); return a || null; }
function _monthIn(t, today) { const m = t.match(new RegExp('\\b(' + MES + ')\\b')); return m ? _ym(m[1], today) : null; }

// text: mensagem do usuário. today: 'YYYY-MM-DD' (injetado p/ ano + testes).
// Devolve { action, params, confidence:'high' } OU null.
function detectReportIntent(text, today) {
  const t = _norm(text);
  if (!t) return null;
  let m;

  // 1) EXTRATO → query_statement  ("extrato [do X] [de mês]", "lançamentos de <mês>")
  if (/\bextrato\b/.test(t) || new RegExp('\\blancamentos?\\s+de\\s+(' + MES + ')\\b').test(t)) {
    const am = t.match(/\bextrato\s+(?:do|da|no|na)\s+(.+)$/);
    if (am && !new RegExp('^(' + MES + ')$').test(_acct(am[1]) || '')) return { action: 'query_statement', params: { account: _acct(am[1]) }, confidence: 'high' };
    const month = _monthIn(t, today);
    return { action: 'query_statement', params: month ? { month } : {}, confidence: 'high' };
  }

  // 2) DIÁRIO
  if (/\b(resumo do dia|balanco do dia|gastos de hoje|quanto (?:eu )?gastei hoje)\b/.test(t))
    return { action: 'query_daily_summary', params: {}, confidence: 'high' };

  // 3) SEMANAL (SÓ finance-qualified — "resumo da semana" puro é o resumo de TRABALHO)
  if (/\b(gastos da semana|quanto (?:eu )?gastei (?:essa|esta|nessa|na) semana|resumo financeiro da semana|balanco da semana)\b/.test(t))
    return { action: 'query_weekly_summary', params: {}, confidence: 'high' };

  // 4) FECHAMENTO (mês FECHADO) — "fechamento [de mês]", "como fechou <mês>", "resumo de <mês>"
  if (/\bfechamento\b/.test(t) || /\bcomo fechou\b/.test(t) || new RegExp('\\bresumo de (' + MES + ')\\b').test(t)) {
    const month = _monthIn(t, today);
    return { action: 'query_monthly_closing', params: month ? { month } : {}, confidence: 'high' };
  }

  // 5) ANÁLISE DO MÊS (corrente, com projeção)
  if (/\b(resumo do mes|analise do mes|analisa(?:r)? (?:as )?(?:minhas|as|essas|nossas) contas)\b/.test(t))
    return { action: 'query_month_analysis', params: {}, confidence: 'high' };

  // 6) SALDO de UMA conta → query_account_detail
  if ((m = t.match(/\bsaldo\s+(?:do|da|no|na)\s+(.+)$/)) || (m = t.match(/\bquanto (?:eu )?tenho (?:no|na)\s+(.+)$/))) {
    const acc = _acct(m[1]);
    if (acc && !/^total$/.test(acc)) return { action: 'query_account_detail', params: { account: acc }, confidence: 'high' };
  }

  // 7) SALDOS consolidados → query_accounts
  if (/\b(meus saldos|minhas carteiras|todos os saldos|posicao atual|quanto tenho no total|quanto tenho de saldo|qual (?:o |e o )?(?:meu )?saldo|meu saldo)\b/.test(t))
    return { action: 'query_accounts', params: {}, confidence: 'high' };

  // 8) GASTOS do período → query_period_expenses (mês corrente, ou "em <mês>")
  if (/\bonde (?:eu )?gasto mais\b/.test(t)
    || /\bgastos (?:do|desse|deste|nesse|neste) mes\b/.test(t)
    || new RegExp('\\bgastos de (' + MES + ')\\b').test(t)
    || new RegExp('\\bquanto (?:eu )?gastei em (' + MES + ')\\b').test(t)
    || /\bquanto (?:eu )?gastei(?:\s+(?:esse|este|neste|nesse|no) mes)?\s*\??$/.test(t)) {
    const month = _monthIn(t, today);
    return { action: 'query_period_expenses', params: month ? { month } : {}, confidence: 'high' };
  }

  // 9) CHECKUP
  if (/\b(checkup|check-up|tem (?:algum )?problema (?:nas|com as|com minhas) contas|alguma (?:conta )?(?:vencida|atrasada))\b/.test(t))
    return { action: 'query_checkup', params: {}, confidence: 'high' };

  // 10) CONTAS A PAGAR (recorte aberto/vencidas/fatura)
  if ((m = t.match(/\bvence dia (\d{1,2})\b/))
    || /\b(contas a pagar|o que (?:falta|tenho|preciso) (?:pra |para )?pagar|quanto (?:eu )?(?:preciso|tenho|falta) (?:pra |para )?pagar|contas (?:em aberto|atrasadas|vencidas)|o que vence)\b/.test(t)) {
    return { action: 'query_bills_to_pay', params: (m && m[1]) ? { due_day: parseInt(m[1], 10) } : {}, confidence: 'high' };
  }

  // 11) CONTAS FIXAS (relação COMPLETA)
  if (/\b(minhas contas fixas|contas fixas|todas as (?:minhas )?contas|quais contas (?:eu )?tenho|relacao de contas)\b/.test(t))
    return { action: 'query_fixed_bills', params: {}, confidence: 'high' };

  return null;
}

module.exports = { detectReportIntent };
