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

// ---- Transação de carteira/dinheiro (NÃO cartão) — mesma gramática semântica do txnRegistered ----
const CAT_META = {
  salario:    { emoji: '💼', label: 'Salário' },
  comissao:   { emoji: '💰', label: 'Comissão' },
  extra:      { emoji: '💵', label: 'Extra' },
  moradia:    { emoji: '🏠', label: 'Moradia' },
  alimentacao:{ emoji: '🍔', label: 'Alimentação' },
  transporte: { emoji: '🚗', label: 'Transporte' },
  saude:      { emoji: '🏥', label: 'Saúde' },
  educacao:   { emoji: '📚', label: 'Educação' },
  lazer:      { emoji: '🎮', label: 'Lazer' },
  outros:     { emoji: '📦', label: 'Outros' },
};

// Dicas de educação financeira — SÓ comandos que o TOM executa hoje (sem editar/excluir).
const EDU_TIPS = [
  '_💡 Já separou algo pra sua meta esse mês?_',
  '_💡 Quer ver pra onde foi tudo? "quanto gastei esse mês?"_',
  '_💡 Dá pra pôr um teto: "define orçamento de alimentação 500"._',
  '_💡 Seus saldos: "quais minhas carteiras?"_',
];

// Rodapé educativo contextual. Prioridade: categoria > carteira > dica rotativa.
function buildTxnFooter({ categoryMissing, accountLinked, tipSeed = 0, type = 'expense' }) {
  if (categoryMissing) {
    return '_💡 Faltou a categoria. Da próxima, diga pra onde foi:_\n'
         + '_"gastei 30 no Nubank com lazer" — assim eu organizo certo._';
  }
  if (!accountLinked) {
    return type === 'income'
      ? '_💡 Em qual conta caiu? Ex: "...no Nubank" ou "...no Itaú"._'
      : '_💡 De onde saiu? Ex: "gastei 30 no Nubank" ou "...no dinheiro"._';
  }
  return EDU_TIPS[((tipSeed % EDU_TIPS.length) + EDU_TIPS.length) % EDU_TIPS.length];
}

// Pergunta de fonte quando a transação chega sem origem resolvível. Não grava até responder.
function buildSourceQuestion({ type, amount, accounts = [], cards = [] }) {
  const income = type === 'income';
  const emoji = income ? '💰' : '💸';
  const head = income ? 'Entrada' : 'Gasto';
  const verbo = income ? 'caiu em qual conta' : 'saiu de qual conta';
  const opts = accounts.map((a) => `${a.icon || '🏦'} ${a.name}`);
  if (!income) cards.forEach((c) => opts.push(`💳 ${c.name} (cartão)`));
  if (!accounts.some((a) => String(a.name).toLowerCase() === 'dinheiro')) opts.push('💵 Dinheiro');
  const numbered = opts.map((o, i) => `${i + 1}️⃣ ${o}`).join('\n');
  return `${emoji} *${head} de ${money(amount)}* — ${verbo}?\n${SEP}\n${numbered}\n\n_Responda o número ou o nome._`;
}

// Card de confirmação de gasto/receita de carteira. Mesma estrutura do txnRegistered:
// título → SEP → atributos → (SEP → saldo/orçamento) → linha em branco → rodapé.
function buildTxnConfirmation({ type, description, amount, categoryLabel, account, newBalance, budgetBlock, assumedSource, footer }) {
  const header = type === 'income' ? '💰 *Receita registrada!*' : '💸 *Gasto registrado!*';
  const out = [header, SEP, `🧾 *${description || categoryLabel}*`, `💰 *${money(amount)}*`, `🗂️ Categoria: ${categoryLabel}`];
  if (account) out.push(`${account.icon || '🏦'} Carteira: *${account.name}*`);
  const tail = [];
  if (account) {
    const nb = Number(newBalance);
    tail.push(`💼 Saldo ${account.name}: *${nb < 0 ? '−' : '+'}${money(Math.abs(nb))}*`);
  }
  if (budgetBlock) tail.push(budgetBlock);
  if (assumedSource) {
    const safe = String(assumedSource).replace(/[*_~`]/g, '');
    tail.push(`_lancei na sua conta principal (${safe})_`);
  }
  if (tail.length) { out.push(SEP, ...tail); }
  if (footer) { out.push('', footer); }
  return out.join('\n');
}

module.exports = { money, bar, mesDaComp, txnRegistered, invoiceSummary, limitAlert, dueReminder, SEP, CAT_META, buildTxnFooter, buildTxnConfirmation, buildSourceQuestion };
