'use strict';
// Roteador DETERMINÍSTICO de intenção de RELATÓRIO financeiro (pré-LLM).
// PORQUÊ: com 11 query_* parecidas o LLM erra a escolha (Luciano 07/06:
// "fechamento de maio"→checkup; "saldo do nubank"→extrato; "gastos da semana"→query_transactions).
// Frases de relatório são curtas/estereotipadas → roteamos no engine (igual detectCorrection),
// sem depender do LLM. CONSERVADOR: só casa alta-confiança; senão devolve null (cai no LLM+skill).
// Endurecido por workflow adversarial (95 bugs em 302 frases): âncoras de início/fim +
// denylist de substantivos não-conta + extração de mês/ano. (FIN-REPORT-ACTION-ALIAS fase 2.)

const MES_NUM = { janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const MES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
// substantivos que NÃO são conta/finança — bloqueiam "saldo do X" / "extrato do X" / "...do Y"
const DENY = /\b(projetos?|times?|contratos?|obras?|reuni[oõ]\w*|trabalho|sistemas?|equipes?|clientes?|vendas?|relacionamento|horas?|dias?|semanas?|mes|meses|m[êe]s|anos?|trimestres?|atividades?|carros?|tarefas?|shows?|lojas?|aulas?|contrato|vida)\b/;

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
// mês (+ ano opcional "de 20XX") no texto → 'YYYY-MM' (ano corrente se não houver).
function _monthFrom(t, today) {
  const mm = t.match(new RegExp('\\b(' + MES + ')\\b'));
  if (!mm) return null;
  const ym = t.match(/\bde (20\d\d)\b/);
  const year = ym ? ym[1] : String(today || new Date().toISOString().slice(0, 10)).slice(0, 4);
  return `${year}-${MES_NUM[mm[1]]}`;
}
// Limpa o "X" de "saldo do X"/"extrato do X" → nome de conta plausível, ou null.
function _account(rest) {
  let a = String(rest || '').replace(/[?.!,]+$/, '').trim();
  a = a.replace(new RegExp('\\s+de\\s+(' + MES + ')(\\s+de\\s+20\\d\\d)?\\s*$'), '').trim(); // tira " de maio [de ANO]"
  a = a.replace(/\s+de\s+20\d\d\s*$/, '').trim();
  if (!a) return null;
  if (/\d/.test(a)) return null;                 // tem número → ajuste/transação, não consulta
  if (DENY.test(a)) return null;                 // substantivo não-conta
  if (a.split(/\s+/).length > 3) return null;    // longo demais → frase, não nome de conta
  return a;
}

// Prefixos de consulta aceitos antes de "saldo"/"extrato" (ancoragem no início).
const Q = '(?:(?:qual|ver|mostra|mostrar|consulta|consultar|cade|me|manda|mandar|envia|enviar)\\s+){0,2}(?:(?:o|e|eh|a|meu|minha)\\s+){0,2}';

function detectReportIntent(text, today) {
  const t = _norm(text);
  if (!t) return null;
  let m;

  // 1) EXTRATO → query_statement (formas específicas; "extrato" não dispara sozinho p/ qualquer "do X")
  if (/^(?:(?:ver|mostra|mostrar|me|manda|mandar|envia|enviar|qual|cade)\s+){0,3}(?:(?:o|meu)\s+)?extrato\s*\??$/.test(t)
    || /\bextrato\s+(?:do|desse|deste|no|nesse)\s+m[eê]s(?:\s+atual)?\s*\??$/.test(t)
    || /\bextrato\s+(?:bancario|da conta|da minha conta|das contas|completo)\b/.test(t))
    return { action: 'query_statement', params: {}, confidence: 'high' };
  if ((m = t.match(new RegExp('\\b' + Q + 'extrato\\s+(?:do|da|no|na)\\s+(.+)$')))) {
    const acc = _account(m[1]);
    if (acc) { const month = _monthFrom(t, today); return { action: 'query_statement', params: month ? { account: acc, month } : { account: acc }, confidence: 'high' }; }
  }
  if (new RegExp('\\bextrato\\s+de\\s+(' + MES + ')\\b').test(t) || new RegExp('\\blancamentos?\\s+de\\s+(' + MES + ')\\b').test(t))
    return { action: 'query_statement', params: { month: _monthFrom(t, today) }, confidence: 'high' };

  // 2) DIÁRIO (SÓ finance-qualified; "resumo/balanço do dia" puro é ambíguo → LLM)
  if (/\b(gastos de hoje|gastos do dia|quanto (?:eu )?gastei hoje)\s*\??$/.test(t))
    return { action: 'query_daily_summary', params: {}, confidence: 'high' };

  // 3) SEMANAL (finance-qualified + ancorado no fim; "resumo da semana" puro = TRABALHO)
  if (/\b(gastos da semana|quanto (?:eu )?gastei (?:essa|esta|nessa|na) semana|resumo financeiro da semana)\s*\??$/.test(t))
    return { action: 'query_weekly_summary', params: {}, confidence: 'high' };

  // 4) FECHAMENTO (mês FECHADO) — exige qualificador de MÊS (não "do contrato/obra/dia/semana")
  if (new RegExp('\\bfechamento\\s+de\\s+(' + MES + ')\\b').test(t)
    || /\bfechamento\s+(?:do\s+m[eê]s|mensal|financeiro|das contas)(?:\s+(?:passado|anterior|atual))?\s*\??$/.test(t)
    || new RegExp('\\bcomo fechou\\s+(?:o\\s+m[eê]s(?:\\s+passado)?|(' + MES + '))\\b').test(t)
    || new RegExp('\\bresumo do m[eê]s de (' + MES + ')\\b').test(t)
    || new RegExp('\\bresumo de (' + MES + ')(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t))
    return { action: 'query_monthly_closing', params: (() => { const mo = _monthFrom(t, today); return mo ? { month: mo } : {}; })(), confidence: 'high' };

  // 5) ANÁLISE DO MÊS (corrente) — ancorado no fim
  if (/\b(resumo do m[eê]s|analise do m[eê]s)\s*\??$/.test(t)
    || /\banalisa(?:r)? (?:as |minhas |as minhas |essas |nossas )?contas\s*\??$/.test(t))
    return { action: 'query_month_analysis', params: {}, confidence: 'high' };

  // 6) SALDOS consolidados (antes do painel de 1 conta p/ pegar "todas as contas")
  if (/\b(meus saldos|todos os (?:meus )?saldos|minhas carteiras|posicao atual|quanto (?:eu )?tenho no total|saldo de todas as contas|saldo total)\b/.test(t)
    || new RegExp('^' + Q + 'saldo\\s*\\??$').test(t))
    return { action: 'query_accounts', params: {}, confidence: 'high' };

  // 7) SALDO de UMA conta → query_account_detail (ancorado no INÍCIO; mata "adiciona 200 no saldo...")
  if ((m = t.match(new RegExp('^' + Q + 'saldo\\s+(?:do|da|no|na)\\s+(.+)$')))) {
    const acc = _account(m[1]);
    if (acc) return { action: 'query_account_detail', params: { account: acc }, confidence: 'high' };
  }

  // 8) GASTOS do período → query_period_expenses (mês corrente, ou "em <mês>"; ancorado no fim)
  if (/\bonde (?:eu )?gasto mais\b/.test(t)
    || /\bgastos (?:do|desse|deste|nesse|neste) mes\s*\??$/.test(t)
    || new RegExp('\\bgastos de (' + MES + ')\\s*\\??$').test(t)
    || new RegExp('\\bquanto (?:eu )?gastei em (' + MES + ')\\s*\\??$').test(t)
    || /\bquanto (?:eu )?gastei(?:\s+(?:esse|este|neste|nesse|no) mes)?\s*\??$/.test(t)) {
    const mo = _monthFrom(t, today);
    return { action: 'query_period_expenses', params: mo ? { month: mo } : {}, confidence: 'high' };
  }

  // 9) CHECKUP — exige contexto de "contas" (não "checkup do carro/sistema/equipe")
  if (/^(?:(?:fazer?|faz|faz um|um)\s+)?checkup(?:\s+(?:das contas|financeiro|das minhas contas|geral das contas))?\s*\??$/.test(t)
    || /\b(tem (?:algum )?problema (?:nas|com as|com minhas) contas|alguma (?:conta )?(?:vencida|atrasada))\s*\??$/.test(t))
    return { action: 'query_checkup', params: {}, confidence: 'high' };

  // 10) CONTAS A PAGAR (recorte aberto/vencidas/fatura)
  if ((m = t.match(/\bvence dia (\d{1,2})\s*\??$/))
    || /\b(contas a pagar|contas (?:em aberto|atrasadas|vencidas))\s*\??$/.test(t)
    || /\b(?:o que (?:falta|tenho|preciso)|quanto (?:eu )?(?:preciso|tenho|falta)) (?:pra |para )?pagar(?:\s+(?:esse|este) m[eê]s|\s+hoje|\s+essa semana|\s+esses dias)?\s*\??$/.test(t)
    || /\bo que vence(?:\s+(?:hoje|amanha|essa semana|esse mes|esses dias))?\s*\??$/.test(t))
    return { action: 'query_bills_to_pay', params: (m && m[1]) ? { due_day: parseInt(m[1], 10) } : {}, confidence: 'high' };

  // 11) CONTAS FIXAS (relação COMPLETA) — ancorado no fim
  if (/\b(minhas contas fixas|contas fixas|todas as (?:minhas )?contas|quais contas (?:eu )?tenho|relacao de contas)\s*\??$/.test(t))
    return { action: 'query_fixed_bills', params: {}, confidence: 'high' };

  return null;
}

module.exports = { detectReportIntent };
