'use strict';
// Kit de blocos da gramática visual dos relatórios (templates-ouro). String puro → string.
// Reusa primitivos do finance-format (money, SEP) — não duplica.
const { money, SEP } = require('../../services/finance-format');

function header(emoji, titulo, sub) {
  return `${emoji} *${titulo}*` + (sub ? ` — ${sub}` : '');
}
function sep() { return SEP; }

function totalHighlight(label, v) {
  return `💰 *Total${label ? ' ' + label : ''}: ${money(v)}*`;
}
function tomTip(texto) {
  return `💡 *Dica do TOM*\n${texto}`;
}
function quickActions(cmds) {
  const list = (cmds || []).slice(0, 4).map((c) => `_"${c}"_`).join(' · ');
  return list ? `⚡ ${list}` : '';
}

// tiers: { key: item[] }. labels: { key: 'cabeçalho' }. Só renderiza tiers com itens.
function severityTiers(tiers, labels) {
  const blocks = [];
  for (const key of Object.keys(labels)) {
    const items = (tiers && tiers[key]) || [];
    if (!items.length) continue;
    const head = `${labels[key]} (${items.length})`;
    const lines = items.map((b) => billItem(b)).join('\n');
    blocks.push(`${head}\n${lines}`);
  }
  return blocks.join('\n\n');
}

// item de conta. b: { name, amount, rel?, due_day? }
function billItem(b) {
  const val = money(Number(b.amount) || 0);
  const rel = b.rel ? ` _(${b.rel})_` : (b.due_day != null ? ` _(dia ${b.due_day})_` : '');
  return `• ${b.name} — ${val}${rel}`;
}

// Intercala SEP entre blocos não-vazios.
function assemble(blocks) {
  return (blocks || []).filter((b) => b && String(b).trim()).join(`\n${SEP}\n`);
}

const _ACOES_CONTAS = ['minhas contas a pagar', 'quanto gastei esse mês', 'meus saldos'];

function renderFixedBills(model) {
  const g = model.groups;
  const tiers = severityTiers(g, {
    vencidas: '🔴 *Vencidas*', pendentes: '⏳ *Pendentes*', pagas: '✅ *Pagas*', semValor: '⚠️ *Sem valor*',
  });
  const total = totalHighlight('a pagar', model.totals.aPagar);
  return assemble([
    header('📋', 'Suas Contas Fixas', `${model.count} no total`),
    tiers,
    `${total}\n_pagas e sem valor não entram no total_`,
    quickActions(_ACOES_CONTAS),
  ]);
}

function renderBillsToPay(model) {
  // Variante filtrada por dia.
  if (model.dueDay != null) {
    if (!model.filtered.length) return `📅 Nada em aberto vencendo dia ${model.dueDay}. 🎉`;
    const lines = model.filtered.map((b) => billItem(b)).join('\n');
    return assemble([
      header('📅', `Contas que vencem dia ${model.dueDay}`, `${model.filtered.length} ${model.filtered.length === 1 ? 'conta' : 'contas'}`),
      lines,
      totalHighlight('', model.totalPendente),
    ]);
  }
  const nAberto = model.vencidas.length + model.proximos7.length + model.restanteMes.length + model.cards.length;
  if (nAberto === 0) return '📋 *Suas Contas a Pagar*\nTá tudo pago por aqui. 🎉';
  const tiers = severityTiers(
    { vencidas: model.vencidas, proximos7: model.proximos7, restanteMes: model.restanteMes, cards: model.cards },
    { vencidas: '🔴 *Vencidas*', proximos7: '🟡 *Próximos 7 dias*', restanteMes: '🟢 *Restante do mês*', cards: '💳 *Faturas*' },
  );
  return assemble([
    header('📋', 'Suas Contas a Pagar'),
    tiers,
    totalHighlight('pendente', model.totalPendente),
    quickActions(['paguei a conta X', 'minhas contas fixas', 'resumo do mês']),
  ]);
}

module.exports = { header, sep, totalHighlight, tomTip, quickActions, severityTiers, billItem, assemble, money, SEP, renderFixedBills, renderBillsToPay };
