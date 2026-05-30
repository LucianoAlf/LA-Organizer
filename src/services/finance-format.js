// Formatação de mensagens financeiras do TOM (linguagem hierárquica/semântica).
// Texto puro do WhatsApp: *negrito*, _itálico_, barra em blocos de caractere.
const SEP = '━━━━━━━━━━━━━━━';

function money(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function bar(pct) { // pct 0..1 → [████░░░░░░] 37%
  const filled = Math.max(0, Math.min(10, Math.round(pct * 10)));
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${Math.round(pct * 100)}%`;
}
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
function mesDaComp(comp) { return MES[parseInt(String(comp).slice(5, 7), 10) - 1] || ''; }

function txnRegistered(card, p, usage) {
  const parc = p.installments > 1 ? ` em *${p.installments}x de ${money(p.amount / p.installments)}*` : '';
  return [
    '👽 *Lançado na fatura!*', SEP,
    `🧾 *${p.description || 'Compra'}*`,
    `💰 *${money(p.amount)}*${parc}`,
    `💳 Cartão: *${card.name}*`,
    `🗂️ Categoria: ${p.category}`,
    `📅 Vai na fatura de: *${mesDaComp(p.competencia)}*`, SEP,
    `📊 Limite: ${bar(usage.pct)}`,
    `✅ Disponível: *${money(usage.available)}*`,
    '',
    '💡 _Quer ajustar? "era 2.900" · "exclui essa"_',
  ].join('\n');
}
function invoiceSummary(card, inv, usage) {
  const parcial = inv.paid > 0 && !inv.isPaid ? ` _(pago parcial ${money(inv.paid)})_` : '';
  return [
    `${card.icon || '💳'} *${card.name} · fatura de ${mesDaComp(inv.competencia)}*`, SEP,
    `💰 Fatura atual: *${money(inv.total)}*${parcial}`,
    `📊 Limite: ${bar(usage.pct)}`,
    `   _${money(usage.used)} de ${money(usage.limit)} · livre ${money(usage.available)}_`,
    `📅 Vence dia ${card.due_day}`, SEP,
    `⚡ _"extrato ${card.name.toLowerCase()}" · "pagar fatura"_`,
  ].join('\n');
}
function limitAlert(card, band, usage) {
  const hot = band >= 90;
  const head = hot ? '🚨 *Opa — segura o freio!*' : `⚠️ *Atenção no ${card.name}*`;
  return [
    head,
    `Você passou de *${band}%* do limite do *${card.name}*.`,
    bar(usage.pct),
    `💰 ${money(usage.used)} de ${money(usage.limit)} · restam *${money(usage.available)}*`,
  ].join('\n');
}
function dueReminder(card, inv, days) {
  return [
    `🔔 *Fatura ${card.name}*`, SEP,
    `💰 ${money(inv.remaining)} vence em *${days} ${days === 1 ? 'dia' : 'dias'}* (dia ${card.due_day}).`,
    `💡 _Diga "paguei a fatura do ${card.name.toLowerCase()}" quando quitar._`,
  ].join('\n');
}

module.exports = { money, bar, mesDaComp, txnRegistered, invoiceSummary, limitAlert, dueReminder, SEP };
