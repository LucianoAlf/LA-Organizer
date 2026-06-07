'use strict';
const ESSENTIAL = new Set([
  'moradia','contas_consumo','mercado','saude','transporte','educacao','farmacia',
  'alimentacao','combustivel','seguros','impostos','emprestimo','financiamento',
  'filhos','reparos_manutencoes',
]);
function classifyExpenseType(slug) {
  if (slug === 'outros' || slug === 'transferencia_contas') return 'other';
  return ESSENTIAL.has(slug) ? 'essential' : 'lifestyle';
}
function calcVariation(current, previous) {
  const cur = Number(current) || 0, prev = Number(previous) || 0;
  const delta = cur - prev;
  let pct;
  if (prev === 0) pct = cur === 0 ? 0 : 100;
  else pct = Math.round((delta / prev) * 100);
  const arrow = delta > 0 ? '⬆️' : (delta < 0 ? '⬇️' : '➡️');
  const sign = pct > 0 ? '+' : '';
  return { delta, pct, label: `${arrow} ${sign}${pct}%` };
}
function buildTomTip(ctx = {}) {
  if (ctx.saldoProjetado != null && ctx.saldoProjetado < 0)
    return 'Atenção: pelo previsto, o mês fecha no vermelho. Vale segurar gastos não-essenciais ou antecipar uma entrada.';
  if (ctx.overdueCount > 0)
    return `Você tem ${ctx.overdueCount} conta(s) vencida(s). Quitar primeiro evita juros — depois a gente organiza o resto.`;
  if (ctx.topCategoria && ctx.topPct >= 40)
    return `${ctx.topCategoria} puxou ${ctx.topPct}% dos gastos. Se foi pontual, tranquilo; se repete, vale um teto: "define orçamento de ${String(ctx.topCategoria).toLowerCase()} 500".`;
  return 'Saldo saudável! Que tal separar um pouco do excedente pra uma meta ou reserva?';
}
function buildQuickActions() {
  return ['quanto gastei esse mês', 'minhas contas a pagar', 'extrato'];
}
module.exports = { classifyExpenseType, calcVariation, buildTomTip, buildQuickActions, ESSENTIAL };
