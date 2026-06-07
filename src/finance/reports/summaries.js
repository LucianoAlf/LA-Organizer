'use strict';
const { classifyExpenseType, calcVariation, buildQuickActions } = require('../report-analysis');
const { CAT_META } = require('../../services/finance-format');

function _rank(byCategory, despesas, n) {
  return (byCategory || []).slice().sort((a, b) => b.total - a.total).slice(0, n).map((c) => ({
    slug: c.slug, label: (CAT_META[c.slug] || {}).label || c.slug,
    total: c.total, count: c.count, pct: despesas > 0 ? Math.round((c.total / despesas) * 100) : 0,
  }));
}

function _porTipo(byCategory) {
  let ess = 0, life = 0;
  for (const c of (byCategory || [])) {
    const t = classifyExpenseType(c.slug);
    if (t === 'essential') ess += c.total; else if (t === 'lifestyle') life += c.total;
  }
  const tot = ess + life;
  return { essenciais: ess, estilo: life, essPct: tot > 0 ? Math.round((ess / tot) * 100) : 0, estiloPct: tot > 0 ? Math.round((life / tot) * 100) : 0 };
}

// R-DIARIO — { label, report, saldoTotal }
function buildDailySummary({ label, report, saldoTotal }) {
  const receitas = Number(report.receitas) || 0, despesas = Number(report.despesas) || 0;
  return {
    label, receitas, despesas, resultado: receitas - despesas, saldoTotal: Number(saldoTotal) || 0,
    count: Number(report.count) || 0, top: _rank(report.byCategory, despesas, 3),
    temAtividade: receitas > 0 || despesas > 0,
  };
}

// R-SEMANA — { label, report, prev }
function buildWeeklySummary({ label, report, prev }) {
  const receitas = Number(report.receitas) || 0, despesas = Number(report.despesas) || 0;
  return {
    label, receitas, despesas, resultado: receitas - despesas, count: Number(report.count) || 0,
    top: _rank(report.byCategory, despesas, 5), porTipo: _porTipo(report.byCategory),
    comparativo: prev ? { atual: despesas, anterior: Number(prev.despesas) || 0, variation: calcVariation(despesas, prev.despesas) } : null,
    temAtividade: receitas > 0 || despesas > 0, acoes: buildQuickActions(),
  };
}

// R-MENSAL (fechamento — mês FECHADO, sem projeção) — { label, report, prev, goals }
function buildMonthlyClosing({ label, report, prev, goals = [] }) {
  const receitas = Number(report.receitas) || 0, despesas = Number(report.despesas) || 0;
  const resultado = receitas - despesas;
  const tip = resultado < 0
    ? 'Fechou no vermelho: gastou mais do que ganhou. Bora ajustar o próximo mês?'
    : 'Fechou no azul! Que tal mandar parte do saldo pra uma meta ou reserva?';
  return {
    label, receitas, despesas, resultado, count: Number(report.count) || 0,
    top: _rank(report.byCategory, despesas, 5), porTipo: _porTipo(report.byCategory),
    comparativo: prev ? { atual: despesas, anterior: Number(prev.despesas) || 0, variation: calcVariation(despesas, prev.despesas) } : null,
    metas: goals, tip, acoes: buildQuickActions(),
  };
}

module.exports = { buildDailySummary, buildWeeklySummary, buildMonthlyClosing };
