// Service de Financas Pessoais (pf_*). Client service_role do projeto principal.
// SEGURANCA: collaboratorId e SEMPRE o 1o parametro e filtra TODA query (RLS nao vale no caminho service_role).
const supabase = require('../supabase/client');
const { classifySource } = require('../finance/source');

// Janela do mes corrente: [start, end) e 'YYYY-MM'.
function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  const monthYear = start.slice(0, 7);
  return { start, end, monthYear };
}

// ---- Carteiras ----
// ---- Catálogo de bancos (auto-detecção por nome) ----
const BANK_CATALOG = {
  nubank:{color:'#820ad1',name:'nubank'}, itau:{color:'#003399',name:'itau'}, bradesco:{color:'#cc092f',name:'bradesco'},
  santander:{color:'#ec0000',name:'santander'}, bb:{color:'#fcbf00',name:'banco do brasil'}, caixa:{color:'#005ca9',name:'caixa'},
  c6:{color:'#242424',name:'c6 bank'}, inter:{color:'#ff7a00',name:'inter'}, mercadopago:{color:'#00b1ea',name:'mercado pago'},
  picpay:{color:'#21c25e',name:'picpay'}, neon:{color:'#00e5a0',name:'neon'}, will:{color:'#ff0066',name:'will bank'},
  pagbank:{color:'#00a651',name:'pagbank'}, btg:{color:'#00263a',name:'btg'}, next:{color:'#00dc5a',name:'next'}, original:{color:'#00a868',name:'original'},
};
function _normBank(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim(); }
// Normaliza competência explícita ("fatura de maio" → o LLM emite YYYY-MM ou YYYY-MM-DD) → YYYY-MM-01; senão null.
function _normCompetencia(c){ const m=String(c||'').match(/^(\d{4})-(\d{2})/); return m?`${m[1]}-${m[2]}-01`:null; }
function matchBankSlug(name){
  const n=_normBank(name); if(!n) return null;
  for (const slug of Object.keys(BANK_CATALOG)){ if (n===slug || n.includes(slug) || n.includes(BANK_CATALOG[slug].name)) return slug; }
  return null;
}
function bankColor(slug){ return (BANK_CATALOG[slug]||{}).color || null; }

async function createAccount(collaboratorId, { name, type = 'checking', icon, goal_monthly, is_primary = false, bank_slug, color }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name, type, icon, goal_monthly, is_primary, bank_slug, color })
    .select().single();
  if (error) throw error;
  return data;
}

async function updateAccount(collaboratorId, accountId, patch){
  const allowed={}; for (const k of ['name','type','icon','goal_monthly','bank_slug','color']) if (patch[k]!==undefined) allowed[k]=patch[k];
  allowed.updated_at=new Date().toISOString();
  const { data, error } = await supabase.from('pf_accounts').update(allowed).eq('id',accountId).eq('collaborator_id',collaboratorId).select().single();
  if (error) throw error; return data;
}
async function listAccounts(collaboratorId) {
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, type, balance, icon, is_primary')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}
// Resolve carteira por nome ("gastei 50 no Nubank" → linka account_id). Match parcial, 1ª ativa.
async function findAccountByName(collaboratorId, name) {
  if (!name) return null;
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, balance, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true)
    .ilike('name', `%${name}%`);
  if (error) throw error;
  return (data && data[0]) || null;
}
// Garante a carteira "Dinheiro" (caixa físico). Idempotente.
async function ensureDinheiro(collaboratorId) {
  const existing = (await listAccounts(collaboratorId)).find((a) => String(a.name).toLowerCase() === 'dinheiro');
  if (existing) return existing;
  return createAccount(collaboratorId, { name: 'Dinheiro', type: 'wallet', icon: '💵' });
}
// Conta principal (default silencioso pra transações sem fonte explícita).
async function findPrimaryAccount(collaboratorId) {
  const accounts = await listAccounts(collaboratorId);
  const primary = accounts.find((a) => a.is_primary);
  if (primary) return primary;
  // Sem principal explícita: se há exatamente 1 carteira, ela é a principal de fato.
  return accounts.length === 1 ? accounts[0] : null;
}

// Define `id` como única principal do colaborador (zera as outras antes).
async function setPrimaryAccount(collaboratorId, id) {
  const { error: resetErr } = await supabase.from('pf_accounts')
    .update({ is_primary: false })
    .eq('collaborator_id', collaboratorId).eq('is_primary', true);
  if (resetErr) throw resetErr;
  const { data, error } = await supabase.from('pf_accounts')
    .update({ is_primary: true })
    .eq('collaborator_id', collaboratorId).eq('id', id)
    .select().single();
  if (error) throw error;
  return data;
}

// Resolve a FONTE de uma transação: {kind, account?, card?, accounts?, cards?}.
// kind: account | card | ambiguous | none. Faz o I/O e converte nomes→objetos (classifySource é puro).
async function resolveSource(collaboratorId, name, opts = {}) {
  const accounts = await listAccounts(collaboratorId);
  const cards = await listCards(collaboratorId);
  const cls = classifySource(name, accounts.map((a) => a.name), cards.map((c) => c.name), opts);
  if (cls.kind === 'cash') return { kind: 'account', account: await ensureDinheiro(collaboratorId) };
  if (cls.kind === 'account') return { kind: 'account', account: accounts.find((a) => a.name === cls.accountName) };
  if (cls.kind === 'card') return { kind: 'card', card: cards.find((c) => c.name === cls.cardName) };
  if (cls.kind === 'ambiguous') return {
    kind: 'ambiguous',
    account: accounts.find((a) => a.name === cls.accountName),
    card: cards.find((c) => c.name === cls.cardName),
  };
  return { kind: 'none', accounts, cards };
}

// ---- Categorias ----
// Categorias válidas pro usuário: defaults (collaborator_id null) + custom ativas dele.
async function listCategorySlugs(collaboratorId, type) {
  let q = supabase.from('pf_categories').select('slug, label, type, collaborator_id, is_active')
    .or(`collaborator_id.is.null,collaborator_id.eq.${collaboratorId}`)
    .eq('is_active', true);
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// ---- Transacoes ----
async function insertTransaction(collaboratorId, { type, category, amount, description, transaction_date, account_id, bill_id }) {
  const row = { collaborator_id: collaboratorId, type, category, amount, description: description || null, account_id: account_id || null };
  if (transaction_date) row.transaction_date = transaction_date;
  if (bill_id) row.bill_id = bill_id; // vínculo p/ reverter status da conta ao deletar (FIN-BILL-DELETE-REVERT)
  const { data, error } = await supabase.from('pf_transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}
// Atualiza campos de uma transação. O trigger pf_sync_account_balance reajusta o saldo
// (reverte OLD, aplica NEW) — inclusive se account_id mudar. NÃO mexe em parcela in-place.
async function updateTransaction(collaboratorId, id, patch) {
  const allowed = {};
  for (const k of ['type', 'category', 'amount', 'description', 'transaction_date', 'account_id']) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('pf_transactions')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}

// Deleta uma transação (trigger reverte saldo). Retorna a linha deletada.
async function deleteTransaction(collaboratorId, id) {
  const { data, error } = await supabase.from('pf_transactions')
    .delete().eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}

// Deleta todas as parcelas de uma compra de cartão (mesmo purchase_group).
async function deleteTransactionGroup(collaboratorId, purchaseGroup) {
  const { data, error } = await supabase.from('pf_transactions')
    .delete().eq('collaborator_id', collaboratorId).eq('purchase_group', purchaseGroup)
    .select('id');
  if (error) throw error;
  return (data || []).length;
}

// Transações recentes (janela em horas) pra resolver "essa"/"a do mercado". Mais recente primeiro.
async function listRecentTransactions(collaboratorId, { hours = 2, limit = 10 } = {}) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group, installments_total, created_at')
    .eq('collaborator_id', collaboratorId)
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Consulta de leitura. Filtros opcionais: category, type, account_id, card_id, dateFrom, dateTo (YYYY-MM-DD).
async function queryTransactions(collaboratorId, { category, type, account_id, card_id, dateFrom, dateTo, limit = 8 } = {}) {
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, via')
    .eq('collaborator_id', collaboratorId)
    .neq('is_adjustment', true)
    .order('transaction_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (category) q = q.eq('category', category);
  if (type) q = q.eq('type', type);
  if (account_id) q = q.eq('account_id', account_id);
  if (card_id) q = q.eq('card_id', card_id);
  if (dateFrom) q = q.gte('transaction_date', dateFrom);
  if (dateTo) q = q.lte('transaction_date', dateTo);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function monthCategoryTotal(collaboratorId, category, { excludeId } = {}) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('amount, id')
    .eq('collaborator_id', collaboratorId).eq('type', 'expense').eq('category', category)
    .eq('cashflow_competencia', start)
    .neq('is_adjustment', true);
  if (error) throw error;
  return (data || []).filter((r) => r.id !== excludeId).reduce((s, r) => s + Number(r.amount), 0);
}
async function querySummary(collaboratorId) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).eq('cashflow_competencia', start)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCategoria = {};
  for (const r of rows) if (r.type === 'expense') porCategoria[r.category] = (porCategoria[r.category] || 0) + Number(r.amount);
  const top = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { receitas, despesas, saldo: receitas - despesas, top };
}

// ---- Orcamento ----
async function setBudget(collaboratorId, { category, monthly_limit }) {
  const { monthYear } = monthBounds();
  const { data, error } = await supabase.from('pf_budgets')
    .upsert({ collaborator_id: collaboratorId, category, monthly_limit, month_year: monthYear },
            { onConflict: 'collaborator_id,category,month_year' })
    .select().single();
  if (error) throw error;
  return data;
}
async function getBudget(collaboratorId, category) {
  const { monthYear } = monthBounds();
  const { data, error } = await supabase.from('pf_budgets')
    .select('monthly_limit')
    .eq('collaborator_id', collaboratorId).eq('category', category).eq('month_year', monthYear)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.monthly_limit) : null;
}
async function queryBudget(collaboratorId) {
  const { monthYear } = monthBounds();
  const { data: budgets, error } = await supabase.from('pf_budgets')
    .select('category, monthly_limit').eq('collaborator_id', collaboratorId).eq('month_year', monthYear);
  if (error) throw error;
  const out = [];
  for (const b of budgets || []) {
    const gasto = await monthCategoryTotal(collaboratorId, b.category);
    out.push({ category: b.category, limit: Number(b.monthly_limit), spent: gasto });
  }
  return out;
}

// ---- Contas fixas (status derivado de last_paid_at, D6) ----
async function createBill(collaboratorId, { name, amount, due_day, category, type = 'expense', remind_days_before = 2, recurrence = 'monthly', due_date = null }) {
  const row = { collaborator_id: collaboratorId, name, amount, category, type, remind_days_before, recurrence };
  if (recurrence === 'once') {
    if (!due_date) throw new Error('conta única exige due_date');
    row.due_date = due_date;
    row.due_day = Number(due_date.slice(8, 10)); // dia da data cheia (satisfaz NOT NULL)
  } else {
    // DUE_DAY-NULL (Rose 14/06): conta fixa recorrente sem dia estourava NOT NULL no insert.
    // Rede final — valida aqui (o handler já pede o dia antes via bill_ask_day). Erro tratável.
    const dd = Number(due_day);
    if (!Number.isInteger(dd) || dd < 1 || dd > 31) {
      const e = new Error('conta fixa recorrente exige due_day válido (1-31)');
      e.code = 'BILL_NO_DUE_DAY';
      throw e;
    }
    row.due_day = dd;
  }
  const { data, error } = await supabase.from('pf_bills').insert(row).select().single();
  if (error) throw error;
  return data;
}
async function findBills(collaboratorId, billName) {
  const { data, error } = await supabase.from('pf_bills')
    .select('id, name, amount, category, type, recurrence')
    .eq('collaborator_id', collaboratorId).eq('is_active', true)
    .ilike('name', `%${billName}%`);
  if (error) throw error;
  return data || [];
}
// Remove (desativa) uma conta fixa. Soft-delete (is_active=false) — pf_bills não tem updated_at.
async function deactivateBill(collaboratorId, billId) {
  const { error } = await supabase.from('pf_bills')
    .update({ is_active: false })
    .eq('id', billId).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
// Só marca a conta como paga (não insere lançamento). Usado quando o lançamento é
// gravado à parte (ex.: pay_bill no engine via recordCardPurchase/writeCashTransaction).
// `date` = data da QUITAÇÃO (last_paid_at, dirige o status do mês). NUNCA a competência da
// fatura: pagar mirando a fatura de maio não pode deixar a conta atrasada em junho. Default
// = hoje (a quitação acontece agora). FIN-PAYBILL-DATE-COUPLING (caso Rose 13/06).
async function markBillPaid(collaboratorId, bill, date) {
  const day = date || new Date().toISOString().slice(0, 10);
  const patch = { last_paid_at: day, status: 'paid' };
  if (bill.recurrence === 'once') patch.is_active = false;
  const { error } = await supabase.from('pf_bills')
    .update(patch)
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
  return { ...bill, last_paid_at: day };
}

// Paga a conta: marca paga + insere o lançamento no valor REAL (default = previsto),
// roteando por método. NUNCA altera bill.amount (previsto). opts:
//   { amount?, account_id?, card_id?, date? }
async function payBill(collaboratorId, bill, opts = {}) {
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const amount = (opts.amount != null && Number(opts.amount) > 0) ? Number(opts.amount) : Number(bill.amount);
  if (opts.card_id && bill.type !== 'income') {
    const card = (await listCards(collaboratorId)).find((c) => c.id === opts.card_id);
    if (card) {
      await insertCardPurchase(collaboratorId, card, {
        category: bill.category, amount, description: bill.name, transaction_date: date, installments: 1, bill_id: bill.id,
      });
    } else {
      await insertTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date, bill_id: bill.id });
    }
  } else if (opts.account_id) {
    await insertTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date, account_id: opts.account_id, bill_id: bill.id });
  } else {
    await insertTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: date, bill_id: bill.id });
  }
  // Quitação = HOJE (markBillPaid default), desacoplado de `date` (data do lançamento/fatura,
  // que pode mirar um mês passado). FIN-PAYBILL-DATE-COUPLING.
  const marked = await markBillPaid(collaboratorId, bill);
  return { ...marked, paid_amount: amount };
}

// ---- Metas (contribuicao NAO vira transacao, D7) ----
async function createGoal(collaboratorId, { name, target_amount, monthly_contribution, deadline, icon }) {
  const { data, error } = await supabase.from('pf_goals')
    .insert({ collaborator_id: collaboratorId, name, target_amount, monthly_contribution, deadline, icon })
    .select().single();
  if (error) throw error;
  return data;
}
async function findGoal(collaboratorId, goalName) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).ilike('name', `%${goalName}%`);
  if (error) throw error;
  return data || [];
}
async function listGoals(collaboratorId) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('created_at');
  if (error) throw error;
  return data || [];
}
async function addGoalContribution(collaboratorId, goalId, { amount, note = null, date = null }) {
  const row = { collaborator_id: collaboratorId, goal_id: goalId, amount, note };
  if (date) row.contributed_at = date;
  const { data, error } = await supabase.from('pf_goal_contributions').insert(row).select().single();
  if (error) throw error; // trigger atualiza pf_goals.current_amount
  return data;
}
async function listGoalContributions(collaboratorId, goalId) {
  const { data, error } = await supabase.from('pf_goal_contributions')
    .select('id, goal_id, amount, note, contributed_at')
    .eq('collaborator_id', collaboratorId).eq('goal_id', goalId)
    .order('contributed_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function deleteGoalContribution(collaboratorId, contributionId) {
  const { error } = await supabase.from('pf_goal_contributions')
    .delete().eq('id', contributionId).eq('collaborator_id', collaboratorId);
  if (error) throw error; // trigger reverte
}
async function updateGoal(collaboratorId, goalId, patch) {
  const allowed = {};
  for (const k of ['name', 'target_amount', 'monthly_contribution', 'deadline', 'icon']) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  allowed.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('pf_goals')
    .update(allowed).eq('id', goalId).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
async function deactivateGoal(collaboratorId, goalId) {
  const { error } = await supabase.from('pf_goals')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', goalId).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// ---- Queries para rituais (Fase B) ----

// Contas a vencer nos proximos `days` dias OU atrasadas (venceram este mes e nao pagas).
// status derivado de last_paid_at (D6). EDGE: conta com due_day no comeco do mes seguinte
// (ex: hoje=30, due_day=2) nao entra como "a vencer" deste ciclo — aceitavel no v1.
async function billsDueWithin(collaboratorId, days = 5) {
  const { isBillDue } = require('../finance/bill-due');
  const now = new Date();
  const dom = now.getUTCDate();
  const todayStr = now.toISOString().slice(0, 10);
  const horizonStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
  const { start } = monthBounds();
  const { data, error } = await supabase.from('pf_bills')
    .select('name, amount, due_day, due_date, recurrence, type, last_paid_at, category')
    .eq('collaborator_id', collaboratorId).eq('is_active', true);
  if (error) throw error;
  const ctx = { dom, todayStr, horizonStr, monthStart: start };
  return (data || []).filter((b) => isBillDue(b, ctx));
}

// Todas as contas fixas ativas (sem filtro de vencimento) — pra action query_bills.
// O recorte ("a pagar dia X" / "em aberto") é feito na lógica pura bills-query.js.
async function listActiveBills(collaboratorId) {
  const { data, error } = await supabase.from('pf_bills')
    .select('name, amount, due_day, due_date, recurrence, type, last_paid_at, category')
    .eq('collaborator_id', collaboratorId).eq('is_active', true);
  if (error) throw error;
  return data || [];
}

// Faturas de cartão EM ABERTO (competência corrente, com saldo a pagar) — pra entrar no "a pagar".
async function pendingCardInvoices(collaboratorId) {
  const cards = await listCards(collaboratorId);
  const out = [];
  for (const card of cards) {
    const comp = currentCompetencia(card);
    const inv = await cardInvoice(collaboratorId, card.id, comp);
    if (inv && Number(inv.remaining) > 0 && !inv.isPaid) {
      out.push({ cardName: card.name, remaining: Number(inv.remaining), dueDay: card.due_day });
    }
  }
  return out;
}

// Relatorio do mes de referencia (default mes corrente): receitas, despesas, saldo, top 3.
async function monthlyReport(collaboratorId, ref = new Date()) {
  const { start, end } = monthBounds(ref);
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).eq('cashflow_competencia', start)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCat = {};
  for (const r of rows) if (r.type === 'expense') porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
  const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { receitas, despesas, saldo: receitas - despesas, top, temAtividade: rows.length > 0 };
}

// Quebra do mês: receitas, despesas e por categoria (total + contagem). Base pf_transactions
// (mesma fonte de querySummary/monthlyReport). ref = qualquer Date dentro do mês desejado.
async function monthCategoryBreakdown(collaboratorId, ref = new Date()) {
  const { start, end } = monthBounds(ref);
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).eq('cashflow_competencia', start)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const by = {};
  for (const r of rows) if (r.type === 'expense') {
    by[r.category] = by[r.category] || { total: 0, count: 0 };
    by[r.category].total += Number(r.amount); by[r.category].count += 1;
  }
  const byCategory = Object.entries(by).map(([slug, v]) => ({ slug, total: v.total, count: v.count }));
  return { receitas, despesas, byCategory };
}

// Relatório de período arbitrário [from, to] INCLUSIVE: receitas, despesas, byCategory (total+count), count de gastos, days.
async function queryPeriodReport(collaboratorId, from, to) {
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId)
    .gte('transaction_date', from).lte('transaction_date', to)
    .neq('is_adjustment', true);
  if (error) throw error;
  const rows = data || [];
  let receitas = 0, despesas = 0, count = 0;
  const byCat = {};
  for (const r of rows) {
    const amt = Number(r.amount) || 0;
    if (r.type === 'income') { receitas += amt; continue; }
    despesas += amt; count += 1;
    const k = r.category || 'outros';
    if (!byCat[k]) byCat[k] = { total: 0, count: 0 };
    byCat[k].total += amt; byCat[k].count += 1;
  }
  const byCategory = Object.entries(byCat).map(([slug, v]) => ({ slug, total: v.total, count: v.count }));
  const days = Math.max(1, Math.round((new Date(`${to}T12:00:00Z`) - new Date(`${from}T12:00:00Z`)) / 86400000) + 1);
  return { from, to, days, receitas, despesas, byCategory, count };
}

// Colaboradores com >=1 transacao (alvo dos rituais financeiros) — so os ids.
async function collaboratorsWithActivity() {
  const { data, error } = await supabase.from('pf_transactions').select('collaborator_id');
  if (error) throw error;
  return [...new Set((data || []).map((r) => r.collaborator_id))];
}

// Helper: enriquece uma lista de ids com phone+nome dos colaboradores ativos.
async function _enrichCollabs(ids) {
  if (!ids.length) return [];
  const { data, error } = await supabase.from('collaborators')
    .select('id, full_name, phone')
    .in('id', ids).eq('is_active', true);
  if (error) throw error;
  return data || [];
}

// Colaboradores com transacao (alvo de financeiro_mensal e relatorio) — com phone+nome.
async function collaboratorsForFinanceRitual() {
  return _enrichCollabs(await collaboratorsWithActivity());
}

// Colaboradores com CONTA ativa (alvo do lembrete_conta, PRD §6.2) — com phone+nome.
// NAO usa transacao: quem so tem conta cadastrada tambem recebe lembrete.
async function collaboratorsWithActiveBills() {
  const { data, error } = await supabase.from('pf_bills').select('collaborator_id').eq('is_active', true);
  if (error) throw error;
  const ids = [...new Set((data || []).map((r) => r.collaborator_id))];
  return _enrichCollabs(ids);
}

// ============ CARTÃO DE CRÉDITO (Sprint cartão) ============

// Competência (1º dia do mês YYYY-MM-01) da fatura de uma compra.
// day <= closing → fatura que fecha neste mês; senão, próxima.
function competenciaFor(baseDate, closingDay) {
  const y = baseDate.getUTCFullYear(), m = baseDate.getUTCMonth(), day = baseDate.getUTCDate();
  const off = day <= closingDay ? 0 : 1;
  return new Date(Date.UTC(y, m + off, 1)).toISOString().slice(0, 10);
}
function addMonthsToCompetencia(compStr, n) {
  const d = new Date(compStr + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}
function currentCompetencia(card) { return competenciaFor(new Date(), card.closing_day); }

async function createCard(collaboratorId, { name, brand, color, credit_limit, closing_day, due_day, icon }) {
  const { data, error } = await supabase.from('pf_cards')
    .insert({ collaborator_id: collaboratorId, name, brand: brand || null, color: color || null,
              credit_limit, closing_day, due_day, icon: icon || '💳' })
    .select().single();
  if (error) throw error;
  return data;
}
async function updateCard(collaboratorId, cardId, patch) {
  const clean = {};
  for (const k of ['name', 'brand', 'color', 'credit_limit', 'closing_day', 'due_day', 'icon']) {
    if (patch[k] !== undefined && patch[k] !== null) clean[k] = patch[k];
  }
  clean.updated_at = new Date().toISOString();
  const { data, error } = await supabase.from('pf_cards')
    .update(clean).eq('id', cardId).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
async function listCards(collaboratorId) {
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, brand, color, credit_limit, closing_day, due_day, icon, alert_cycle, alert_threshold')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}
async function findCard(collaboratorId, cardName) {
  // Match acento-INSENSÍVEL (caso Rose 11/06: "Cartão Itaú Matheus" digitado vs "Cartão Itáu
  // Matheus" salvo). ILIKE do Postgres é acento-sensível → não casava. Busca todos os ativos
  // e filtra em JS com NFD-strip, bidirecional (espelha classifySource).
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, brand, color, credit_limit, closing_day, due_day, icon, alert_cycle, alert_threshold')
    .eq('collaborator_id', collaboratorId).eq('is_active', true);
  if (error) throw error;
  const all = data || [];
  const q = _normBank(cardName);
  if (!q) return all; // sem nome → devolve todos (engine pergunta qual)
  return all.filter((c) => { const x = _normBank(c.name); return x.includes(q) || q.includes(x); });
}

// Lança compra no cartão. installments>=2 → N parcelas agrupadas por purchase_group.
// NÃO mexe no saldo (card_id setado, account_id null → trigger trg_pf_sync_balance ignora).
async function insertCardPurchase(collaboratorId, card, { category, amount, description, transaction_date, installments, competencia, bill_id, import_key }) {
  const baseDate = transaction_date ? new Date(transaction_date + 'T00:00:00Z') : new Date();
  const n = Math.max(1, parseInt(installments || 1, 10));
  // Override explícito da fatura ("põe na fatura de maio") vence o cálculo por data+fechamento.
  const baseComp = _normCompetencia(competencia) || competenciaFor(baseDate, card.closing_day);
  const dateStr = baseDate.toISOString().slice(0, 10);
  if (n === 1) {
    const { data, error } = await supabase.from('pf_transactions').insert({
      collaborator_id: collaboratorId, card_id: card.id, type: 'expense', category,
      amount, description: description || null, transaction_date: dateStr, competencia: baseComp, via: 'tom',
      ...(bill_id ? { bill_id } : {}),
      ...(import_key ? { import_key } : {}),
    }).select().single();
    if (error) {
      if (error.code === '23505') return []; // import_key já existe → reimport idempotente, pula
      throw error;
    }
    return [data];
  }
  const cents = Math.round(Number(amount) * 100);
  const per = Math.floor(cents / n);
  const rows = Array.from({ length: n }, (_, i) => ({
    collaborator_id: collaboratorId, card_id: card.id, type: 'expense', category,
    description: description || null, transaction_date: dateStr, via: 'tom',
    installment_no: i + 1, installments_total: n,
    competencia: addMonthsToCompetencia(baseComp, i),
    amount: ((i === n - 1 ? per + (cents - per * n) : per) / 100),
    ...(bill_id ? { bill_id } : {}),
  }));
  const ins = await supabase.from('pf_transactions').insert(rows).select();
  if (ins.error) throw ins.error;
  const groupId = ins.data.find((d) => d.installment_no === 1)?.id || ins.data[0].id;
  const upd = await supabase.from('pf_transactions').update({ purchase_group: groupId })
    .in('id', ins.data.map((d) => d.id));
  if (upd.error) throw upd.error;
  return ins.data;
}

async function cardInvoice(collaboratorId, cardId, competencia) {
  const { data: items, error } = await supabase.from('pf_transactions')
    .select('id, description, category, amount, transaction_date, installment_no, installments_total')
    .eq('collaborator_id', collaboratorId).eq('card_id', cardId).eq('competencia', competencia)
    .order('transaction_date', { ascending: false });
  if (error) throw error;
  const total = (items || []).reduce((s, r) => s + Number(r.amount), 0);
  const { data: pays, error: e2 } = await supabase.from('pf_card_payments')
    .select('amount').eq('card_id', cardId).eq('competencia', competencia);
  if (e2) throw e2;
  const paid = (pays || []).reduce((s, r) => s + Number(r.amount), 0);
  return { competencia, items: items || [], total, paid, isPaid: paid >= total && total > 0, remaining: Math.max(total - paid, 0) };
}

// Limite usado = total lançado no cartão − total já pago (todas as competências não pagas).
async function cardUsage(collaboratorId, card) {
  const { data: tx, error } = await supabase.from('pf_transactions')
    .select('amount').eq('collaborator_id', collaboratorId).eq('card_id', card.id);
  if (error) throw error;
  const charged = (tx || []).reduce((s, r) => s + Number(r.amount), 0);
  const { data: pays, error: e2 } = await supabase.from('pf_card_payments')
    .select('amount').eq('card_id', card.id);
  if (e2) throw e2;
  const paid = (pays || []).reduce((s, r) => s + Number(r.amount), 0);
  const used = Math.max(charged - paid, 0);
  const limit = Number(card.credit_limit);
  return { used, available: limit - used, pct: limit > 0 ? used / limit : 0, limit };
}

async function payCardInvoice(collaboratorId, card, { competencia, amount, paid_from_account }) {
  const { data, error } = await supabase.from('pf_card_payments').insert({
    collaborator_id: collaboratorId, card_id: card.id, competencia,
    amount, paid_from_account: paid_from_account || null,
  }).select().single();
  if (error) throw error; // trigger debita o saldo da conta de origem
  return data;
}

async function createTransfer(collaboratorId, { from_account, to_account, amount, description, transfer_date }) {
  const row = { collaborator_id: collaboratorId, from_account, to_account, amount, description: description || null };
  if (transfer_date) row.transfer_date = transfer_date;
  const { data, error } = await supabase.from('pf_transfers').insert(row).select().single();
  if (error) throw error; // trigger ajusta os dois saldos
  return data;
}

const ALERT_BANDS = [50, 70, 80, 90];
// Retorna { band, usage } a alertar (ou null). Atualiza alert_cycle/alert_threshold no cartão.
async function checkAndMarkLimitAlert(collaboratorId, card) {
  const usage = await cardUsage(collaboratorId, card);
  const pctInt = Math.floor(usage.pct * 100);
  const cycle = currentCompetencia(card);
  const threshold = card.alert_cycle === cycle ? (card.alert_threshold || 0) : 0;
  const crossed = ALERT_BANDS.filter((b) => pctInt >= b && b > threshold);
  if (!crossed.length) {
    if (card.alert_cycle !== cycle) {
      await supabase.from('pf_cards').update({ alert_cycle: cycle, alert_threshold: 0 }).eq('id', card.id);
    }
    return null;
  }
  const band = Math.max(...crossed);
  await supabase.from('pf_cards').update({ alert_cycle: cycle, alert_threshold: band }).eq('id', card.id);
  return { band, usage };
}

// Todos os cartões ativos + phone/nome do dono (alvo dos rituais de alerta).
async function cardsForAlerts() {
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, icon, credit_limit, closing_day, due_day, alert_cycle, alert_threshold, collaborator_id')
    .eq('is_active', true);
  if (error) throw error;
  const ids = [...new Set((data || []).map((c) => c.collaborator_id))];
  const collabs = await _enrichCollabs(ids);
  const byId = Object.fromEntries(collabs.map((c) => [c.id, c]));
  return (data || []).map((c) => ({ ...c, collab: byId[c.collaborator_id] })).filter((c) => c.collab);
}

// Junta numa só chamada o que entra no digest financeiro matinal: contas (atrasadas/hoje/
// em ≤2 dias) + faturas de cartão a vencer (≤2 dias, não pagas), classificadas por urgência.
// SEGURANÇA: tudo filtrado por collaboratorId (service_role ignora RLS).
// Item: { name, amount, dia, isCard }. Retorno: { atrasadas, hoje, emBreve }.
async function dueItemsForDigest(collaboratorId, { dom, ymd }) {
  const out = { atrasadas: [], hoje: [], emBreve: [] };
  // Contas fixas vencendo em ≤2 dias (inclui atrasadas, mesma janela do ritual antigo).
  const bills = await billsDueWithin(collaboratorId, 2);
  for (const b of bills) {
    if (b.type === 'income') continue; // digest é "contas a PAGAR"; receitas previstas (ex: Salário) não entram
    const dias = b.due_day - dom;
    const item = { name: b.name, amount: Number(b.amount), dia: b.due_day, isCard: false };
    if (dias < 0) out.atrasadas.push(item);
    else if (dias === 0) out.hoje.push(item);
    else out.emBreve.push(item);
  }
  // Faturas de cartão (mesma lógica do antigo checkCardDueReminders).
  const DAYS_BEFORE = 2;
  const y = Number(ymd.slice(0, 4)), mo = Number(ymd.slice(5, 7));
  const cards = (await cardsForAlerts()).filter((c) => c.collaborator_id === collaboratorId);
  for (const card of cards) {
    if (card.due_day < dom || card.due_day > dom + DAYS_BEFORE) continue;
    const monthOff = card.due_day >= card.closing_day ? 0 : -1;
    const dueComp = new Date(Date.UTC(y, (mo - 1) + monthOff, 1)).toISOString().slice(0, 10);
    const inv = await cardInvoice(collaboratorId, card.id, dueComp);
    if (inv.isPaid || inv.total <= 0) continue;
    const item = { name: 'Fatura ' + card.name, amount: inv.remaining, dia: card.due_day, isCard: true };
    if (card.due_day - dom === 0) out.hoje.push(item); else out.emBreve.push(item);
  }
  return out;
}

module.exports = {
  monthBounds,
  createAccount, updateAccount, listAccounts, findAccountByName, ensureDinheiro, resolveSource,
  findPrimaryAccount, setPrimaryAccount, matchBankSlug, bankColor,
  listCategorySlugs,
  insertTransaction, updateTransaction, deleteTransaction, deleteTransactionGroup,
  listRecentTransactions, queryTransactions, queryPeriodReport,
  monthCategoryTotal, querySummary,
  setBudget, getBudget, queryBudget,
  createBill, findBills, deactivateBill, payBill, markBillPaid,
  createGoal, findGoal, listGoals,
  addGoalContribution, listGoalContributions, deleteGoalContribution, updateGoal, deactivateGoal,
  billsDueWithin, listActiveBills, pendingCardInvoices, monthlyReport, monthCategoryBreakdown, collaboratorsWithActivity, collaboratorsForFinanceRitual,
  collaboratorsWithActiveBills,
  // cartão
  competenciaFor, addMonthsToCompetencia, currentCompetencia,
  createCard, updateCard, listCards, findCard, insertCardPurchase,
  cardInvoice, cardUsage, payCardInvoice, createTransfer,
  checkAndMarkLimitAlert, cardsForAlerts, ALERT_BANDS,
  dueItemsForDigest,
};
