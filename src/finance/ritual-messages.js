// Builders puros das mensagens de ritual financeiro (PRD §6.1/§6.2/§6.4/§6.5).
// Recebem dados JA consultados e retornam string. NUMERO vem daqui (codigo), nunca do LLM.

function bar(pct) {
  const filled = Math.max(0, Math.min(10, Math.round((pct || 0) / 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

// Ritual mensal (dia 10) — panorama do mes + meta + conta vencendo.
function buildMonthlyFinance({ nome, receitas, despesas, goals = [], bills = [] }) {
  const saldo = Number(receitas) - Number(despesas);
  const sinal = saldo >= 0 ? '+' : '';
  let m = `👽 E aí, ${nome}. Papo financeiro rápido.\n\n💰 *Seu mês até agora:*\n📈 Receitas: R$${receitas}\n📉 Despesas: R$${despesas}\n💵 Saldo: ${sinal}R$${saldo}`;
  const g = (goals || [])[0];
  if (g) {
    const pct = Math.round((Number(g.current_amount) / Number(g.target_amount)) * 100);
    m += `\n\n🎯 *Meta: ${g.name}*\n${bar(pct)} ${pct}% (R$${g.current_amount}/R$${g.target_amount})`;
  }
  const b = (bills || [])[0];
  if (b) m += `\n\n⚠️ Vence em breve: ${b.name} (R$${b.amount}, dia ${b.due_day})`;
  m += `\n\nLembra: pague-se primeiro. Bora! 💪`;
  return m;
}

// Lembrete de conta (diario 8h) — modes: previo | dia | atrasada (PRD §6.2).
function buildBillReminder({ nome, bill, mode, dias }) {
  const v = `R$${bill.amount}`;
  if (mode === 'previo') return `💰 ${nome}, lembrete: ${bill.name} (${v}) vence em ${dias} dias (dia ${bill.due_day}).`;
  if (mode === 'dia') return `💰 Hoje vence: ${bill.name} (${v}). Já pagou? Responde "paguei ${bill.name}" pra eu marcar.`;
  return `⚠️ ${bill.name} (${v}) venceu dia ${bill.due_day} e tá pendente. Resolve isso hoje se puder!`;
}

// Relatorio mensal (dia 1, mes anterior).
function buildMonthlyReport({ nome, mes, receitas, despesas, top = [], goals = [] }) {
  const saldo = Number(receitas) - Number(despesas);
  const sinal = saldo >= 0 ? '+' : '';
  let m = `👽 ${nome}, fechou ${mes}! Teu resumo:\n\n📈 Receitas: R$${receitas}\n📉 Despesas: R$${despesas}\n💵 Saldo: ${sinal}R$${saldo}`;
  if (top && top.length) m += `\n\n📊 *Onde foi o dinheiro:*\n` + top.map(([c, val]) => `${c}: R$${val}`).join('\n');
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
  return bills.map((b) => `💰 Vence hoje: ${b.name} (R$${b.amount})`).join('\n');
}

module.exports = { buildMonthlyFinance, buildBillReminder, buildMonthlyReport, buildBriefingFinanceLine, bar };
