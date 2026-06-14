// src/finance/reconcile-report.js — PURO: mensagens do relatório de conciliação (D3).
// Recebe dados JÁ consultados. Número vem do código. (Fase D / D3 — Alf 14/06)
function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pendLine(p) {
  const seta = p.direction === 'out' ? '→' : '←';
  return `• ${p.emoji || '💸'} R$ ${brl(p.amount)} ${seta} ${p.label}${p.date ? ` (${p.date})` : ''}`;
}

// Relatório completo das 18h.
function buildReconcileReport({ nome, conciliadoCount = 0, pendentes = [], backlogExtra = 0, healthLine = '', saldoReal = null }) {
  const pend = pendentes || [];
  if (!conciliadoCount && !pend.length) return '';
  let m = `👽 ${nome}, fechamento do dia 👇`;
  if (conciliadoCount) m += `\n\n✅ Tá tudo certo: *${conciliadoCount}* movimento${conciliadoCount > 1 ? 's' : ''} bateram com o que você lançou.`;
  if (pend.length) {
    m += `\n\n❌ *Me conta o que foi* (não achei lançamento):\n` + pend.map(pendLine).join('\n');
    if (backlogExtra > 0) m += `\n…e mais *${backlogExtra}* dos últimos meses (revisa no app quando puder).`;
  }
  if (healthLine) m += `\n\n${healthLine}`;
  if (saldoReal != null) m += `\n💰 Saldo real das contas hoje: *R$ ${brl(saldoReal)}*`;
  if (pend.length) m += `\n\nResponde o que foi cada um que eu lanço pra você. 👇`;
  return m;
}

// --- helpers de formatação dos pendentes (usados pelo service pra montar os items) ---
const PLUGGY_EMOJI = {
  'Food delivery': '🍔', 'Eating out': '🍽️', 'Groceries': '🛒', 'Shopping': '🛍️', 'Electronics': '💻',
  'Transfers': '💸', 'Transfer - PIX': '💸', 'Transfer - Bank Slip': '🧾', 'Transfer - Check': '💸',
  'Digital services': '💳', 'Telecommunications': '📱', 'Education': '🎓', 'Health insurance': '🏥',
  'Insurance': '🛡️', 'Gas stations': '⛽', 'Parking': '🅿️', 'Pharmacy': '💊', 'Taxi and ride-hailing': '🚗',
  'Services': '🔧', 'Houseware': '🏠', 'Bank fees': '🏦', 'Credit card fees': '💳', 'Education ': '🎓',
};
function emojiForPluggyCat(cat, direction) { return direction === 'in' ? '💰' : (PLUGGY_EMOJI[cat] || '💸'); }
function cleanLabel(desc) {
  let s = String(desc || '').replace(/^.*\|/, '').trim(); // "Transferência enviada|X" → "X"
  s = s.replace(/^(transfer[êe]ncia (enviada|recebida)|pix (enviado|recebido|transf)|pagamento (de boleto|efetuado|de pix qr code|de)|compra no d[ée]bito|compra)\b\s*/i, '').trim();
  s = s.replace(/^[a-z]{2,8}\*/i, '').trim(); // "IFD*JATOBA" → "JATOBA"
  return (s || String(desc || '')).slice(0, 32).trim();
}
function ddmm(ymd) { const p = String(ymd).split('-'); return (p[1] && p[2]) ? `${p[2]}/${p[1]}` : String(ymd); }

// Toque leve do meio-dia: só dispara se houver pendente relevante.
function buildNoonNudge({ nome, pendentes = [] }) {
  const pend = pendentes || [];
  if (!pend.length) return '';
  return `👽 Oi ${nome}, vi uns movimentos que talvez você não tenha lançado:\n` + pend.map(pendLine).join('\n')
    + `\n\nMe conta o que foi? (ou deixa que às 18h eu te mando o resumo completo)`;
}

module.exports = { buildReconcileReport, buildNoonNudge, emojiForPluggyCat, cleanLabel, ddmm };
