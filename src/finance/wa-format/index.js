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
  if (!model.count) {
    return '📋 *Suas Contas Fixas*\nVocê ainda não cadastrou nenhuma conta fixa. Quer adicionar? Ex: _"conta de luz 250 todo dia 10"_.';
  }
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

function _semaforo(balance) { return Number(balance) < 0 ? '🔴' : '✅'; }
function balanceLine(acc) {
  const st = acc.status || _semaforo(acc.balance);
  return `${acc.icon || '🏦'} *${acc.name}* ${money(Number(acc.balance) || 0)} ${st}`;
}
function positionBlock(p) {
  return ['📊 *Posição*',
    `🏦 Saldo em contas: ${money(p.totalSaldo)}`,
    `💳 Limite disponível: ${money(p.limiteDisponivel)}`,
    `📈 Total disponível: ${money(p.totalDisponivel)}`].join('\n');
}
function renderBalances(model) {
  if ((!model.accounts || !model.accounts.length) && !model.limiteDisponivel) {
    return 'Você ainda não tem carteiras nem cartões. Quer criar? Ex: _"cria carteira Nubank"_.';
  }
  const linhas = model.accounts.map(balanceLine).join('\n');
  return assemble([
    header('💰', 'Seus Saldos'),
    linhas,
    totalHighlight('', model.totalSaldo),
    positionBlock(model),
    quickActions(['extrato', 'minhas contas a pagar', 'quanto gastei esse mês']),
  ]);
}

function _checkupItem(b) {
  const valor = b.hasValue ? money(b.amount) : 'não informado';
  return `⚠️ *${b.name}*\n💰 ${valor}\n📅 Vence: ${b.dueLabel}\n💬 ${b.message}`;
}
function renderCheckup(model) {
  if (!model.count) return `🩺 *Checkup das contas*\n${model.headline}`;
  const blocks = [`🩺 *Checkup das contas*\n${model.headline}`];
  if (model.tiers.urgente.length) {
    blocks.push(`🔴 *Mais urgentes* (${model.tiers.urgente.length})\n` + model.tiers.urgente.map(_checkupItem).join('\n\n'));
  }
  if (model.tiers.importante.length) {
    blocks.push(`🟠 *Importantes* (${model.tiers.importante.length})\n` + model.tiers.importante.map(_checkupItem).join('\n\n'));
  }
  blocks.push('_Quer ajuda com a mais urgente? Me chama._');
  return blocks.join('\n\n');
}

const _MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
function rankingTopN(items) {
  return (items || []).map((it, i) => `${_MEDALS[i] || '•'} ${it.label}: ${money(it.total)} (${it.pct}%)`).join('\n');
}
function comparison(c) {
  return `📈 *Comparativo*\n• Este mês: ${money(c.atual)}\n• Mês anterior: ${money(c.anterior)}\n• Variação: ${c.variation.label}`;
}
function goalsBlock(goals) {
  if (!goals || !goals.length) return '';
  const lines = goals.slice(0, 3).map((g) => `• ${g.name}: ${g.pct}%\n  ${money(g.current)} / ${money(g.target)}`).join('\n');
  return `🎯 *Metas*\n${lines}`;
}
function analysisProjection(p) {
  const ok = p.saldoProjetado >= 0 ? '✅' : '🔴';
  return `💰 *Projeção do mês*\n• Saldo atual: ${money(p.saldoAtual)}\n• A pagar: ${money(p.aPagar)}\n• Projetado: ${money(p.saldoProjetado)} ${ok}`;
}
function analysisByType(t) {
  return `🏷️ *Por tipo*\n🏠 Essenciais: ${t.essPct}% (${money(t.essenciais)})\n🎯 Estilo de vida: ${t.estiloPct}% (${money(t.estilo)})`;
}
function renderMonthAnalysis(m) {
  return assemble([
    header('📊', `Análise de ${m.monthLabel}`),
    comparison(m.comparativo),
    (m.ranking && m.ranking.length) ? `🏆 *Top gastos*\n${rankingTopN(m.ranking)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    analysisProjection(m.projecao),
    goalsBlock(m.metas),
    tomTip(m.tip),
    quickActions(m.acoes),
  ]);
}

module.exports = { header, sep, totalHighlight, tomTip, quickActions, severityTiers, billItem, assemble, money, SEP, renderFixedBills, renderBillsToPay, balanceLine, positionBlock, renderBalances, renderCheckup, rankingTopN, comparison, goalsBlock, analysisProjection, analysisByType, renderMonthAnalysis };
