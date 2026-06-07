'use strict';
const { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions } = require('../report-analysis');
const { CAT_META } = require('../../services/finance-format');

// data: { monthLabel, despesas, receitas, despesasPrev, byCategory:[{slug,total,count}],
//         saldoAtual, aPagar, overdueCount, goals:[{name,pct,current,target}] }
function buildMonthAnalysis(data) {
  const desp = Number(data.despesas) || 0;
  const comparativo = {
    atual: desp, anterior: Number(data.despesasPrev) || 0,
    variation: calcVariation(desp, data.despesasPrev),
  };
  const ranking = (data.byCategory || []).slice()
    .sort((a, b) => b.total - a.total).slice(0, 5)
    .map((c) => ({
      slug: c.slug, label: (CAT_META[c.slug] || {}).label || c.slug,
      total: c.total, count: c.count, pct: desp > 0 ? Math.round((c.total / desp) * 100) : 0,
    }));
  let ess = 0, life = 0;
  for (const c of (data.byCategory || [])) {
    const t = classifyExpenseType(c.slug);
    if (t === 'essential') ess += c.total; else if (t === 'lifestyle') life += c.total;
  }
  const tot = ess + life;
  const porTipo = {
    essenciais: ess, estilo: life,
    essPct: tot > 0 ? Math.round((ess / tot) * 100) : 0,
    estiloPct: tot > 0 ? Math.round((life / tot) * 100) : 0,
  };
  const saldoProjetado = (Number(data.saldoAtual) || 0) - (Number(data.aPagar) || 0);
  const projecao = { saldoAtual: Number(data.saldoAtual) || 0, aPagar: Number(data.aPagar) || 0, saldoProjetado };
  const tip = buildTomTip({
    saldoProjetado, overdueCount: data.overdueCount || 0,
    topCategoria: ranking[0] && ranking[0].label, topPct: ranking[0] && ranking[0].pct,
  });
  return {
    monthLabel: data.monthLabel, receitas: Number(data.receitas) || 0,
    comparativo, ranking, porTipo, projecao, metas: data.goals || [], tip, acoes: buildQuickActions(),
  };
}

module.exports = { buildMonthAnalysis };
