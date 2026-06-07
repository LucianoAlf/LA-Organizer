'use strict';
// Roteador DETERMINÍSTICO de intenção de RELATÓRIO financeiro (pré-LLM).
// PORQUÊ: com 11 query_* parecidas o LLM erra a escolha (Luciano 07/06:
// "fechamento de maio"→checkup; "saldo do nubank"→extrato; "gastos da semana"→query_transactions).
// Roteamos no engine (igual detectCorrection), sem depender do LLM. CONSERVADOR: só alta-confiança;
// senão null (cai no LLM+skill). Endurecido por 2 rodadas de workflow adversarial (95→47→0 bugs):
//   - guard de verbo IMPERATIVO no início (paga/quita/ajusta/zera/poe/adiciona...) → null
//   - _account rejeita: token só-número (valor), substantivo não-conta (DENY), verbo/estado/conector
//     final (TAIL); aceita conta alfanumérica ("c6") e 1-3 palavras ("banco do brasil")
//   - TODAS as regras ancoradas no fim (não pegam "...de maio DO PROJETO", "...semana EM lazer")
//   - extração de mês + ano explícito ("de 2025"). (FIN-REPORT-ACTION-ALIAS fase 2.)

const MES_NUM = { janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06', julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12' };
const MES = 'janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro';
// substantivos que NÃO são conta/finança
const DENY = /\b(projetos?|times?|contratos?|obras?|reuni\w*|trabalho|sistemas?|equipes?|clientes?|vendas?|relacionamento|horas?|dias?|semanas?|mes|meses|m[êe]s|anos?|trimestres?|atividades?|carros?|tarefas?|shows?|lojas?|aulas?|vida|energia|tempo)\b/;
// verbo/estado/conector que indica RELATO ("saldo do nubank diminuiu") e não consulta
const TAIL = /\b(diminuiu|aumentou|subiu|baixou|caiu|acabou|zerou|mudou|virou|ficou|ta|esta|eh|foi|vai|paguei|pagou|recebi|gastei|quitei|conferi|conferido|debitado|creditado|errado|certo|negativo|positivo|pago|pagos|pagas|pra|para|com|sem|mais|menos|ja|tudo|eu|no|na)\b/;
// imperativo de ação no INÍCIO → comando/transação, nunca relatório
const ACTION = /^(?:paga|pague|paguei|quita|quitar|registra|registrar|lanca|lancar|adiciona|adicionar|cria|criar|edita|editar|apaga|apagar|deleta|deletar|exclui|excluir|transfere|transferir|guarda|guardar|separa|separar|poe|p[oõ]e|coloca|colocar|tira|tirar|ajusta|ajustar|corrige|corrigir|zera|zerar|seta|setar|atualiza|atualizar|muda|mudar|desconta|descontar|soma|somar|acrescenta|acrescentar|mete|meter)\b/;
// prefixos de consulta aceitos antes de "saldo"/"extrato"
const Q = '(?:(?:qual|ver|ve|mostra|mostrar|consulta|consultar|cade|me|manda|mandar|envia|enviar)\\s+){0,2}(?:(?:o|e|eh|a|meu|minha)\\s+){0,2}';

function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
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
  if (!a) return null;
  const toks = a.split(/\s+/);
  if (toks.some((w) => /^\d+$/.test(w))) return null;  // token só-número = valor → não é conta
  if (DENY.test(a)) return null;
  if (TAIL.test(a)) return null;                       // verbo/estado/conector → relato, não consulta
  if (toks.length > 3) return null;
  return a;
}

function detectReportIntent(text, today) {
  const t = _norm(text);
  if (!t) return null;
  if (ACTION.test(t)) return null;   // imperativo ("paga/quita/ajusta...") = comando, não relatório
  let m;

  // 1) EXTRATO → query_statement
  if (/^(?:(?:ver|ve|mostra|mostrar|me|manda|mandar|envia|enviar|qual|cade)\s+){0,3}(?:(?:o|meu)\s+)?extrato\s*\??$/.test(t)
    || /\bextrato\s+(?:do|desse|deste|no|nesse)\s+m[eê]s(?:\s+atual)?\s*\??$/.test(t)
    || /\bextrato\s+(?:bancario|da conta|da minha conta|das contas|completo)\s*\??$/.test(t))
    return { action: 'query_statement', params: {}, confidence: 'high' };
  if ((m = t.match(new RegExp('\\b' + Q + 'extrato\\s+(?:do|da|no|na)\\s+(.+)$')))) {
    const acc = _account(m[1]);
    if (acc) { const month = _monthFrom(t, today); return { action: 'query_statement', params: month ? { account: acc, month } : { account: acc }, confidence: 'high' }; }
  }
  if (new RegExp('\\bextrato\\s+de\\s+(' + MES + ')(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t)
    || new RegExp('\\blancamentos?\\s+de\\s+(' + MES + ')(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t))
    return { action: 'query_statement', params: { month: _monthFrom(t, today) }, confidence: 'high' };

  // 2) DIÁRIO (finance-qualified, ancorado)
  if (/\b(gastos de hoje|gastos do dia|quanto (?:eu )?gastei hoje)\s*\??$/.test(t))
    return { action: 'query_daily_summary', params: {}, confidence: 'high' };

  // 3) SEMANAL (finance-qualified, ancorado)
  if (/\b(gastos da semana|quanto (?:eu )?gastei (?:essa|esta|nessa|na) semana|resumo financeiro da semana)\s*\??$/.test(t))
    return { action: 'query_weekly_summary', params: {}, confidence: 'high' };

  // 4) FECHAMENTO (mês FECHADO) — todas as formas ancoradas no fim
  if (new RegExp('\\bfechamento\\s+de\\s+(' + MES + ')(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t)
    || /\bfechamento\s+(?:do\s+m[eê]s|mensal|financeiro|das contas)(?:\s+(?:passado|anterior|atual))?\s*\??$/.test(t)
    || new RegExp('\\bcomo fechou\\s+(?:o\\s+m[eê]s(?:\\s+passado)?|(' + MES + '))(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t)
    || new RegExp('\\bresumo do m[eê]s de (' + MES + ')(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t)
    || new RegExp('\\bresumo de (' + MES + ')(?:\\s+de\\s+20\\d\\d)?\\s*\\??$').test(t))
    return { action: 'query_monthly_closing', params: (() => { const mo = _monthFrom(t, today); return mo ? { month: mo } : {}; })(), confidence: 'high' };

  // 5) ANÁLISE DO MÊS (corrente) — ancorado
  if (/\b(resumo do m[eê]s|analise do m[eê]s)\s*\??$/.test(t)
    || /\banalisa(?:r)? (?:as |minhas |as minhas |essas |nossas )?contas\s*\??$/.test(t))
    return { action: 'query_month_analysis', params: {}, confidence: 'high' };

  // 6) SALDOS consolidados (antes do painel; pega "todas as contas")
  if (/\b(meus saldos|todos os (?:meus )?saldos|minhas carteiras|posicao atual|quanto (?:eu )?tenho no total|saldo de todas as contas|saldo total)\b/.test(t)
    || new RegExp('^' + Q + 'saldo(?:\\s+atual)?\\s*\\??$').test(t))
    return { action: 'query_accounts', params: {}, confidence: 'high' };

  // 7) SALDO de UMA conta (ancorado no INÍCIO; "saldo [atual/disponivel] do X")
  if ((m = t.match(new RegExp('^' + Q + 'saldo(?:\\s+(?:atual|disponivel|atualizado))?\\s+(?:do|da|no|na)\\s+(.+)$')))) {
    const acc = _account(m[1]);
    if (acc) return { action: 'query_account_detail', params: { account: acc }, confidence: 'high' };
  }

  // 8) GASTOS do período — ancorado no fim
  if (/\bonde (?:eu )?gasto mais\s*\??$/.test(t)
    || /\bgastos (?:do|desse|deste|nesse|neste) mes\s*\??$/.test(t)
    || new RegExp('\\bgastos de (' + MES + ')\\s*\\??$').test(t)
    || new RegExp('\\bquanto (?:eu )?gastei em (' + MES + ')\\s*\\??$').test(t)
    || /\bquanto (?:eu )?gastei(?:\s+(?:esse|este|neste|nesse|no) mes)?\s*\??$/.test(t)) {
    const mo = _monthFrom(t, today);
    return { action: 'query_period_expenses', params: mo ? { month: mo } : {}, confidence: 'high' };
  }

  // 9) CHECKUP — exige contexto de "contas"
  if (/^(?:(?:fazer?|faz|faz um|um)\s+)?checkup(?:\s+(?:das contas|financeiro|das minhas contas|geral das contas))?\s*\??$/.test(t)
    || /\b(tem (?:algum )?problema (?:nas|com as|com minhas) contas|alguma (?:conta )?(?:vencida|atrasada))\s*\??$/.test(t))
    return { action: 'query_checkup', params: {}, confidence: 'high' };

  // 10) CONTAS A PAGAR
  if ((m = t.match(/\bvence dia (\d{1,2})\s*\??$/))
    || /\b(contas a pagar|contas (?:em aberto|atrasadas|vencidas))\s*\??$/.test(t)
    || /\b(?:o que (?:falta|tenho|preciso)|quanto (?:eu )?(?:preciso|tenho|falta)) (?:pra |para )?pagar(?:\s+(?:esse|este) m[eê]s|\s+hoje|\s+essa semana|\s+esses dias)?\s*\??$/.test(t)
    || /\bo que vence(?:\s+(?:hoje|amanha|essa semana|esse mes|esses dias))?\s*\??$/.test(t))
    return { action: 'query_bills_to_pay', params: (m && m[1]) ? { due_day: parseInt(m[1], 10) } : {}, confidence: 'high' };

  // 11) CONTAS FIXAS (relação COMPLETA) — ancorado
  if (/\b(minhas contas fixas|contas fixas|todas as (?:minhas )?contas|quais contas (?:eu )?tenho|relacao de contas)\s*\??$/.test(t))
    return { action: 'query_fixed_bills', params: {}, confidence: 'high' };

  return null;
}

module.exports = { detectReportIntent };
