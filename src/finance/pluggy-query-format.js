// src/finance/pluggy-query-format.js — PURO: mensagens da consulta realtime (D5).
// Recebe dados JÁ buscados (fresh do Pluggy). Número vem do código. (Fase D / D5)
function brl(n) { return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function ddmmyyyy(ymd) { const p = String(ymd || '').split('-'); return (p[2] && p[1]) ? `${p[2]}/${p[1]}/${p[0]}` : String(ymd || ''); }

function buildSaldoMsg(contas) {
  const cs = contas || [];
  if (!cs.length) return 'Não achei conta conectada pra te dar o saldo agora. 🤔';
  const total = cs.reduce((s, c) => s + (Number(c.saldo) || 0), 0);
  let m = `💰 *Saldo das suas contas* (tempo real):\n` + cs.map((c) => `• ${c.banco}: R$ ${brl(c.saldo)}`).join('\n');
  if (cs.length > 1) m += `\n\n*Total: R$ ${brl(total)}*`;
  return m;
}

function buildFaturaMsg(cartoes) {
  const cs = cartoes || [];
  if (!cs.length) return 'Não achei cartão conectado pra te mostrar a fatura. 🤔';
  return cs.map((c) => {
    let s = `💳 *Fatura ${c.banco}*: R$ ${brl(c.fatura)}`;
    if (c.vencimento) s += `\n📅 Vence ${ddmmyyyy(c.vencimento)}`;
    if (c.minimo) s += `\n🔻 Mínimo: R$ ${brl(c.minimo)}`;
    if (c.disponivel != null) s += `\n✅ Limite disponível: R$ ${brl(c.disponivel)}`;
    return s;
  }).join('\n\n');
}

function buildInvestMsg(inv) {
  if (!inv || !inv.count) return 'Não achei investimentos/caixinhas conectados. 🤔';
  return `🏦 Você tem *R$ ${brl(inv.total)}* investido em ${inv.count} aplicaç${inv.count > 1 ? 'ões' : 'ão'} (CDBs/caixinhas) — tempo real.`;
}

module.exports = { buildSaldoMsg, buildFaturaMsg, buildInvestMsg };
