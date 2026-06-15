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

// Fatura real (Pluggy /bills): mostra a fatura A PAGAR (próxima a vencer). Se a do mês ainda não
// sincronizou (todas as bills já venceram), cai no SALDO DEVEDOR + honestidade. NUNCA usa
// account.balance como "fatura" (é saldo devedor total). todayYmd injetado (testável). (D5)
function buildFaturaMsg(cartoes, todayYmd) {
  const cs = cartoes || [];
  if (!cs.length) return 'Não achei cartão conectado pra te mostrar a fatura. 🤔';
  const hoje = todayYmd || new Date().toISOString().slice(0, 10);
  return cs.map((c) => {
    const bills = (c.bills || []).filter((b) => b && b.vencimento).sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    const aVencer = bills.find((b) => b.vencimento >= hoje);   // a fatura fechada a pagar
    const ultima = bills[bills.length - 1];                     // a mais recente
    let s;
    if (aVencer) {
      s = `💳 *Fatura ${c.banco}*: R$ ${brl(aVencer.valor)}\n📅 Vence ${ddmmyyyy(aVencer.vencimento)}`;
      if (c.minimo) s += `\n🔻 Mínimo: R$ ${brl(c.minimo)}`;
    } else {
      s = `💳 *${c.banco}* — em aberto agora: R$ ${brl(c.saldoDevedor)} (saldo devedor do cartão)`;
      if (ultima) s += `\n🧾 Última fatura fechada: R$ ${brl(ultima.valor)} (venceu ${ddmmyyyy(ultima.vencimento)})`;
      s += `\n⚠️ A fatura deste mês ainda tá sincronizando com o banco (Open Finance) — costuma cair em 1-3 dias.`;
    }
    if (c.disponivel != null) s += `\n✅ Limite disponível: R$ ${brl(c.disponivel)}`;
    return s;
  }).join('\n\n');
}

function buildInvestMsg(inv) {
  if (!inv || !inv.count) return 'Não achei investimentos/caixinhas conectados. 🤔';
  return `🏦 Você tem *R$ ${brl(inv.total)}* investido em ${inv.count} aplicaç${inv.count > 1 ? 'ões' : 'ão'} (CDBs/caixinhas) — tempo real.`;
}

module.exports = { buildSaldoMsg, buildFaturaMsg, buildInvestMsg };
