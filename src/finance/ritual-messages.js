// Builders puros das mensagens de ritual financeiro (PRD §6.1/§6.2/§6.4/§6.5).
// Recebem dados JA consultados e retornam string. NUMERO vem daqui (codigo), nunca do LLM.

function bar(pct) {
  const filled = Math.max(0, Math.min(10, Math.round((pct || 0) / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// Formata como moeda BR (1234.5 → "1.234,50"). Evita float cru no WhatsApp.
function brl(n) {
  return Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Bloco do Financial Health Score (Fase E). score null → '' (nao anexa). Numero vem do codigo.
function buildHealthScoreLine(hs) {
  if (!hs || hs.score == null) return '';
  let m = `🩺 *Saúde financeira: ${hs.score}/100* ${hs.band}`;
  if (hs.topLever) m += `\nMaior alavanca: ${hs.topLever.hint}.`;
  else m += `\nTá redondo, segue assim! 🚀`;
  return m;
}

// Ritual mensal (dia 10) — panorama do mes + meta + conta vencendo + saude financeira.
function buildMonthlyFinance({ nome, receitas, despesas, goals = [], bills = [], health = null }) {
  const saldo = Number(receitas) - Number(despesas);
  const saldoFmt = `${saldo >= 0 ? '+' : '-'}R$${brl(Math.abs(saldo))}`;
  let m = `👽 E aí, ${nome}. Papo financeiro rápido.\n\n💰 *Seu mês até agora:*\n📈 Receitas: R$${brl(receitas)}\n📉 Despesas: R$${brl(despesas)}\n💵 Saldo: ${saldoFmt}`;
  const g = (goals || [])[0];
  if (g) {
    const pct = Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100);
    m += `\n\n🎯 *Meta: ${g.name}*\n${bar(pct)} ${pct}% (R$${brl(g.current_amount)}/R$${brl(g.target_amount)})`;
  }
  const b = (bills || [])[0];
  if (b) m += `\n\n⚠️ Vence em breve: ${b.name} (R$${brl(b.amount)}, dia ${b.due_day})`;
  const hl = buildHealthScoreLine(health);
  if (hl) m += `\n\n${hl}`;
  m += `\n\nLembra: pague-se primeiro. Bora! 💪`;
  return m;
}

// Lembrete de conta (diario 8h) — modes: previo | dia | atrasada (PRD §6.2).
// Boleto (Alf 17/07): quando bill.barcode existe, anexa a linha digitável formatada pra copiar
// (nos modes 'dia' e 'atrasada' — é quando o Alf vai de fato pagar). formatLinhaDigitavel é puro.
function buildBillReminder({ nome, bill, mode, dias }) {
  const v = `R$${brl(bill.amount)}`;
  let cod = '';
  if (bill.barcode && (mode === 'dia' || mode === 'atrasada')) {
    const { formatLinhaDigitavel } = require('./boleto-parse');
    cod = `\n\nCódigo pra copiar:\n\`${formatLinhaDigitavel(bill.barcode)}\``;
  }
  if (mode === 'previo') return `💰 ${nome}, lembrete: ${bill.name} (${v}) vence em ${dias} dias (dia ${bill.due_day}).`;
  if (mode === 'dia') return `💰 Hoje vence: ${bill.name} (${v}). Já pagou? Responde "paguei ${bill.name}" pra eu marcar.${cod}`;
  return `⚠️ ${bill.name} (${v}) venceu dia ${bill.due_day} e tá pendente. Resolve isso hoje se puder!${cod}`;
}

// Relatorio mensal (dia 1, mes anterior).
function buildMonthlyReport({ nome, mes, receitas, despesas, top = [], goals = [] }) {
  const saldo = Number(receitas) - Number(despesas);
  const saldoFmt = `${saldo >= 0 ? '+' : '-'}R$${brl(Math.abs(saldo))}`;
  let m = `👽 ${nome}, fechou ${mes}! Teu resumo:\n\n📈 Receitas: R$${brl(receitas)}\n📉 Despesas: R$${brl(despesas)}\n💵 Saldo: ${saldoFmt}`;
  if (top && top.length) m += `\n\n📊 *Onde foi o dinheiro:*\n` + top.map(([c, val]) => `${c}: R$${brl(val)}`).join('\n');
  const g = (goals || [])[0];
  if (g) {
    const pct = Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100);
    m += `\n\n🎯 *Meta ${g.name}:* ${bar(pct)} ${pct}%`;
  }
  if (Number(despesas) > Number(receitas)) m += `\n\n⚠️ Gastou mais do que ganhou esse mês. Bora ajustar?`;
  return m;
}

// Linha pronta pro briefing pessoal (contas vencendo hoje). Vazio se nao houver.
function buildBriefingFinanceLine(bills) {
  if (!bills || !bills.length) return '';
  return bills.map((b) => `💰 Vence hoje: ${b.name} (R$${brl(b.amount)})`).join('\n');
}

module.exports = { buildMonthlyFinance, buildBillReminder, buildMonthlyReport, buildBriefingFinanceLine, buildHealthScoreLine, bar };
