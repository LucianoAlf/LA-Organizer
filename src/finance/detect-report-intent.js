'use strict';
// Roteador DETERMINÍSTICO de intenção de RELATÓRIO financeiro (pré-LLM).
// PORQUÊ: com 11 query_* parecidas o LLM erra a escolha (Luciano 07/06). Roteamos no engine
// (igual detectCorrection), sem depender do LLM. CONSERVADOR: só alta-confiança; senão null.
//
// ARQUITETURA (4 rodadas de workflow adversarial, 95→47→71→23→0 bugs): ANCORAGEM DE MENSAGEM
// INTEIRA `^ LEAD (core) $` — só dispara quando a mensagem É a consulta (com lead-in de cortesia/
// pergunta), nunca quando a CONTÉM (mata negação/passado/sentimento/comando enterrados). Mais:
//   - _account descarta valor, substantivo não-conta (DENY), verbo/estado (TAIL), ruído temporal.
//   - mês-named report (resumo/fechamento/análise/como fechou + <mês>): se o mês = MÊS CORRENTE →
//     query_month_analysis (visão atual c/ projeção); senão → query_monthly_closing (mês fechado).
// (FIN-REPORT-ACTION-ALIAS fase 2.)

const MES_NUM = { janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const MES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
const Y = '(?:\\s+de\\s+20\\d\\d)?';
const LEAD = '(?:(?:oi|ola|e|ai|tom|por|favor|pf|me|qual|quais|quanto|quantos|quanta|onde|o|que|como|cade|mostra|mostrar|manda|mandar|envia|enviar|ve|ver|diz|dizer|fala|falar|traz|trazer|da|de|a|os|as|do|eh|meu|minha|meus|minhas|um|uns|sao|sera|quero|preciso|saber|gostaria|consultar|consulta)\\s+)*';
const DENY = /\b(projetos?|times?|contratos?|obras?|reuni\w*|trabalho|sistemas?|equipes?|clientes?|vendas?|relacionamento|horas?|dias?|semanas?|mes|meses|m[êe]s|anos?|trimestres?|atividades?|carros?|tarefas?|shows?|lojas?|aulas?|vida|energia|tempo)\b/;
const TAIL = /\b(diminuiu|aumentou|subiu|baixou|caiu|acabou|zerou|mudou|virou|ficou|ta|esta|eh|foi|vai|paguei|pagou|recebi|gastei|quitei|conferi|conferido|debitado|creditado|transferi|transferiu|comprei|comprou|vendi|vendeu|depositei|saquei|investi|errado|errados|certo|negativo|positivo|pago|pagos|pagas|pra|para|com|sem|mais|menos|ja|tudo|eu|no|na)\b/;

function _norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
function _re(core) { return new RegExp('^' + LEAD + '(?:' + core + ')\\s*\\??$'); }
function _curYM(today) { return String(today || new Date().toISOString().slice(0, 10)).slice(0, 7); }
function _monthFrom(t, today) {
  const mm = t.match(new RegExp('\\b(' + MES + ')\\b'));
  if (!mm) return null;
  const ym = t.match(/\bde (20\d\d)\b/);
  const year = ym ? ym[1] : String(today || new Date().toISOString().slice(0, 10)).slice(0, 4);
  return `${year}-${MES_NUM[mm[1]]}`;
}
function _account(rest) {
  let a = String(rest || '').replace(/[?.!,]+$/, '').trim();
  a = a.replace(new RegExp('\\s+de\\s+(' + MES + ')(\\s+de\\s+20\\d\\d)?\\s*$'), '').trim();
  a = a.replace(/\s+de\s+20\d\d\s*$/, '').trim();
  a = a.replace(new RegExp('\\s+(' + MES + ')\\s*$'), '').trim();   // mês "solto" no fim
  let prev;
  do { prev = a; a = a.replace(/\s+(?:de\s+)?(?:hoje|ontem|amanha|anteontem|agora|atual|atualizado|por favor|pf|ai|entao|mesmo|certo|ne|por gentileza|pra mim)\s*$/, '').trim(); } while (a !== prev);
  if (!a) return null;
  const toks = a.split(/\s+/);
  if (toks.some((w) => /^\d+$/.test(w))) return null;
  if (DENY.test(a)) return null;
  if (TAIL.test(a)) return null;
  if (toks.length > 3) return null;
  return a;
}

function detectReportIntent(text, today) {
  const t = _norm(text);
  if (!t) return null;
  let m;

  // 1) EXTRATO → query_statement
  if (_re('extrato').test(t)
    || _re('extrato (?:do|desse|deste|no|nesse) m[eê]s(?: atual)?').test(t)
    || _re('extrato (?:bancario|da conta|da minha conta|das contas|completo)').test(t))
    return { action: 'query_statement', params: {}, confidence: 'high' };
  if ((m = t.match(new RegExp('^' + LEAD + 'extrato\\s+(?:do|da|no|na)\\s+(.+)$')))) {
    const acc = _account(m[1]);
    if (acc) { const month = _monthFrom(t, today); return { action: 'query_statement', params: month ? { account: acc, month } : { account: acc }, confidence: 'high' }; }
  }
  if (_re('(?:extrato de|lancamentos? de) (?:' + MES + ')' + Y).test(t))
    return { action: 'query_statement', params: { month: _monthFrom(t, today) }, confidence: 'high' };

  // 2) DIÁRIO
  if (_re('gastos de hoje|gastos do dia|quanto (?:eu )?gastei hoje').test(t))
    return { action: 'query_daily_summary', params: {}, confidence: 'high' };

  // 3) SEMANAL
  if (_re('gastos da semana|quanto (?:eu )?gastei (?:essa|esta|nessa|na) semana|resumo financeiro da semana').test(t))
    return { action: 'query_weekly_summary', params: {}, confidence: 'high' };

  // 4) RELATÓRIO DE MÊS NOMEADO → analysis (se mês corrente) ou closing (mês fechado)
  if (_re('(?:(?:resumo|fechamento|analise)(?: financeiro)?(?: do m[eê]s)? de|como fechou(?: o m[eê]s de)?) (?:' + MES + ')' + Y).test(t)) {
    const mo = _monthFrom(t, today);
    if (mo === _curYM(today)) return { action: 'query_month_analysis', params: {}, confidence: 'high' };
    return { action: 'query_monthly_closing', params: mo ? { month: mo } : {}, confidence: 'high' };
  }
  // 4b) FECHAMENTO sem mês nomeado (mês fechado/anterior)
  if (_re('fechamento(?: do m[eê]s| mensal| financeiro| das contas)?(?: (?:passado|anterior))?').test(t)
    || _re('resumo do m[eê]s (?:passado|anterior)').test(t)
    || _re('como fechou o m[eê]s(?: passado)?').test(t))
    return { action: 'query_monthly_closing', params: {}, confidence: 'high' };

  // 5) ANÁLISE DO MÊS (corrente)
  if (_re('resumo do m[eê]s(?: atual)?|analise do m[eê]s(?: atual)?|analisa(?:r)? (?:as |minhas |as minhas |essas |nossas )?contas').test(t))
    return { action: 'query_month_analysis', params: {}, confidence: 'high' };

  // 6) SALDOS consolidados (inclui "saldo da conta" genérico)
  if (_re('meus saldos|todos os (?:meus )?saldos|minhas carteiras|posicao atual|quanto (?:eu )?tenho no total|saldo de todas as contas|saldo total|saldo da (?:minha )?conta|saldo na conta|saldo(?: atual)?').test(t))
    return { action: 'query_accounts', params: {}, confidence: 'high' };

  // 7) SALDO de UMA conta ("saldo [atual/disponivel] do X")
  if ((m = t.match(new RegExp('^' + LEAD + 'saldo(?:\\s+(?:atual|disponivel|atualizado))?\\s+(?:do|da|no|na)\\s+(.+)$')))) {
    const acc = _account(m[1]);
    if (acc) return { action: 'query_account_detail', params: { account: acc }, confidence: 'high' };
  }

  // 8) GASTOS do período (mês corrente ou "em <mês> [de ano]")
  if (_re('onde (?:eu )?gasto mais').test(t)
    || _re('gastos (?:do|desse|deste|nesse|neste) mes').test(t)
    || _re('gastos de (?:' + MES + ')' + Y).test(t)
    || _re('quanto (?:eu )?gastei em (?:' + MES + ')' + Y).test(t)
    || _re('quanto (?:eu )?gastei(?: (?:esse|este|neste|nesse|no) mes)?').test(t)) {
    const mo = _monthFrom(t, today);
    return { action: 'query_period_expenses', params: mo ? { month: mo } : {}, confidence: 'high' };
  }

  // 9) CHECKUP
  if (_re('(?:fazer? |faz |faz um |um )?checkup(?: (?:das contas|financeiro|das minhas contas|geral das contas))?').test(t)
    || _re('tem (?:algum )?problema (?:nas|com as|com minhas) contas|alguma (?:conta )?(?:vencida|atrasada)').test(t))
    return { action: 'query_checkup', params: {}, confidence: 'high' };

  // 10) CONTAS A PAGAR
  if ((m = t.match(_re('vence(?:m)? dia (\\d{1,2})')))
    || _re('contas a pagar|contas (?:em aberto|atrasadas|vencidas)').test(t)
    || _re('(?:o que (?:falta|tenho|preciso)|quanto (?:eu )?(?:preciso|tenho|falta)) (?:pra |para )?pagar(?: (?:esse|este) m[eê]s| hoje| essa semana| esses dias)?').test(t)
    || _re('o que vence(?: (?:hoje|amanha|essa semana|esse mes|esses dias))?').test(t))
    return { action: 'query_bills_to_pay', params: (m && m[1]) ? { due_day: parseInt(m[1], 10) } : {}, confidence: 'high' };

  // 11) CONTAS FIXAS (relação COMPLETA)
  if (_re('minhas contas fixas|contas fixas|todas as (?:minhas )?contas|quais contas (?:eu )?tenho|relacao de contas').test(t))
    return { action: 'query_fixed_bills', params: {}, confidence: 'high' };

  return null;
}

module.exports = { detectReportIntent };
