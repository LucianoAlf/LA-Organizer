'use strict';
const { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions } = require('../report-analysis');
const { CAT_META } = require('../../services/finance-format');

// report: { from, to, days, receitas, despesas, byCategory:[{slug,total,count}], count, label? }
// prev:   { despesas } | null
function buildPeriodExpenses(report, prev) {
  const desp = Number(report.despesas) || 0;
  const cats = report.byCategory || [];
  const top5 = cats.slice().sort((a, b) => b.total - a.total).slice(0, 5).map((c) => ({
    slug: c.slug, label: (CAT_META[c.slug] || {}).label || c.slug,
    total: c.total, count: c.count, pct: desp > 0 ? Math.round((c.total / desp) * 100) : 0,
  }));
  let ess = 0, life = 0;
  for (const c of cats) {
    const t = classifyExpenseType(c.slug);
    if (t === 'essential') ess += c.total; else if (t === 'lifestyle') life += c.total;
  }
  const tot = ess + life;
  const porTipo = {
    essenciais: ess, estilo: life,
    essPct: tot > 0 ? Math.round((ess / tot) * 100) : 0,
    estiloPct: tot > 0 ? Math.round((life / tot) * 100) : 0,
  };
  const comparativo = prev ? { atual: desp, anterior: Number(prev.despesas) || 0, variation: calcVariation(desp, prev.despesas) } : null;
  const tip = top5.length ? buildTomTip({ saldoProjetado: 0, overdueCount: 0, topCategoria: top5[0].label, topPct: top5[0].pct }) : null;
  const days = Number(report.days) || 1;
  return {
    label: report.label || `Gastos do período`,
    total: desp, count: Number(report.count) || 0,
    mediaDiaria: days > 0 ? desp / days : desp,
    top5, porTipo, comparativo, tip, acoes: buildQuickActions(),
  };
}

module.exports = { buildPeriodExpenses };
