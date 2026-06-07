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
function comparison(c, labels) {
  const L = labels || { atual: 'Este mês', anterior: 'Mês anterior' };
  return `📈 *Comparativo*\n• ${L.atual}: ${money(c.atual)}\n• ${L.anterior}: ${money(c.anterior)}\n• Variação: ${c.variation.label}`;
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

// ---- F5: data curta + blocos B14/B16 + renders ----
function _ddmm(d) { const s = String(d || ''); return s.length >= 10 ? `${s.slice(8, 10)}/${s.slice(5, 7)}` : s; }
function _accStatus(b) { b = Number(b) || 0; return b < 0 ? '🔴' : (b === 0 ? '🟡' : '✅'); }

// B16 — resumo de período (gastos)
function periodSummary(r) {
  const n = Number(r.count) || 0;
  return `📊 *${r.label}* — *${money(r.total)}*\n_${n} ${n === 1 ? 'lançamento' : 'lançamentos'} · ${money(r.mediaDiaria)}/dia_`;
}

// B14 — movimentação recente (última entrada/saída + variação 7d)
function recentMovement(m) {
  const lines = ['🔄 *Movimentação recente*'];
  if (m && m.lastIn) lines.push(`🟢 Entrou: ${m.lastIn.desc} +${money(m.lastIn.amount)} _(${_ddmm(m.lastIn.date)})_`);
  if (m && m.lastOut) lines.push(`🔴 Saiu: ${m.lastOut.desc} −${money(m.lastOut.amount)} _(${_ddmm(m.lastOut.date)})_`);
  if (!m || (!m.lastIn && !m.lastOut)) lines.push('_Sem movimentação registrada._');
  const net = Number(m && m.var7d && m.var7d.net) || 0;
  lines.push(`📈 7 dias: ${net >= 0 ? '+' : '−'}${money(Math.abs(net))}`);
  return lines.join('\n');
}

function renderPeriodExpenses(m) {
  if (!m.total) return `📊 *${m.label}*\nNenhum gasto nesse período. 🎉`;
  return assemble([
    periodSummary({ label: m.label, total: m.total, count: m.count, mediaDiaria: m.mediaDiaria }),
    (m.top5 && m.top5.length) ? `🏆 *Top gastos*\n${rankingTopN(m.top5)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    m.comparativo ? comparison(m.comparativo, { atual: 'Neste período', anterior: 'Período anterior' }) : '',
    m.tip ? tomTip(m.tip) : '',
    quickActions(m.acoes),
  ]);
}

function renderAccountDetail(m) {
  return assemble([
    header(m.icon || '🏦', m.name),
    `💼 Saldo atual: *${money(m.balance)}* ${m.status || _accStatus(m.balance)}`,
    recentMovement(m.movement),
    quickActions([`extrato ${String(m.name).toLowerCase()}`, 'meus saldos', 'quanto gastei esse mês']),
  ]);
}

function _stmtLine(it) {
  const sign = it.type === 'income' ? '+' : '−';
  const src = it.source ? ` _·${it.source}_` : '';
  return `${_ddmm(it.date)} ${it.emoji} ${it.desc} *${sign}${money(it.amount)}*${src}`;
}
function renderStatement(m) {
  const titulo = `${m.label}${m.name ? ` · ${m.name}` : ''}`;
  if (!m.items || !m.items.length) return `${m.icon || '🧾'} *${titulo}*\nNenhum lançamento nesse período.`;
  const lines = m.items.map(_stmtLine).join('\n');
  const more = m.hasMore ? `\n_+${m.count - m.shown} lançamentos — diga "completo" pra ver todos_` : '';
  return assemble([
    header(m.icon || '🧾', titulo, `${m.count} ${m.count === 1 ? 'lançamento' : 'lançamentos'}`),
    lines + more,
    `🟢 Entradas: ${money(m.totalIn)}\n🔴 Saídas: ${money(m.totalOut)}`,
    quickActions(['quanto gastei esse mês', 'meus saldos']),
  ]);
}

// B13 — balanço (entrou/saiu/resultado)
function dayBalance(inV, outV, res) {
  const r = Number(res) || 0;
  return `📊 *Balanço*\n🟢 Entrou: ${money(inV)}\n🔴 Saiu: ${money(outV)}\n💵 Resultado: *${r < 0 ? '−' : '+'}${money(Math.abs(r))}* ${r >= 0 ? '🟢' : '🔴'}`;
}

function renderDailySummary(m) {
  if (!m.temAtividade) return `📅 *${m.label}*\nSem movimentação hoje. 😌\n🏦 Saldo total: *${money(m.saldoTotal)}*`;
  return assemble([
    header('📅', m.label),
    dayBalance(m.receitas, m.despesas, m.resultado),
    (m.top && m.top.length) ? `🏆 *Top do dia*\n${rankingTopN(m.top)}` : '',
    `🏦 Saldo total: *${money(m.saldoTotal)}*`,
    quickActions(['quanto gastei esse mês', 'meus saldos']),
  ]);
}

function renderWeeklySummary(m) {
  if (!m.temAtividade) return `🗓️ *${m.label}*\nSemana sem movimentação. 😌`;
  return assemble([
    header('🗓️', m.label),
    dayBalance(m.receitas, m.despesas, m.resultado),
    (m.top && m.top.length) ? `🏆 *Top gastos*\n${rankingTopN(m.top)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    m.comparativo ? comparison(m.comparativo, { atual: 'Esta semana', anterior: 'Semana anterior' }) : '',
    quickActions(m.acoes),
  ]);
}

function renderMonthlyClosing(m) {
  return assemble([
    header('📆', m.label),
    dayBalance(m.receitas, m.despesas, m.resultado),
    (m.top && m.top.length) ? `🏆 *Onde foi o dinheiro*\n${rankingTopN(m.top)}` : '',
    (m.porTipo && (m.porTipo.essenciais || m.porTipo.estilo)) ? analysisByType(m.porTipo) : '',
    m.comparativo ? comparison(m.comparativo, { atual: 'Este mês', anterior: 'Mês anterior' }) : '',
    goalsBlock(m.metas),
    m.tip ? tomTip(m.tip) : '',
    quickActions(m.acoes),
  ]);
}

module.exports = { header, sep, totalHighlight, tomTip, quickActions, severityTiers, billItem, assemble, money, SEP, renderFixedBills, renderBillsToPay, balanceLine, positionBlock, renderBalances, renderCheckup, rankingTopN, comparison, goalsBlock, analysisProjection, analysisByType, renderMonthAnalysis, periodSummary, recentMovement, renderPeriodExpenses, renderAccountDetail, renderStatement, dayBalance, renderDailySummary, renderWeeklySummary, renderMonthlyClosing };
