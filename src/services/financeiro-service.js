// Service de Financas Pessoais (pf_*). Client service_role do projeto principal.
// SEGURANCA: collaboratorId e SEMPRE o 1o parametro e filtra TODA query (RLS nao vale no caminho service_role).
const supabase = require('../supabase/client');

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
async function createAccount(collaboratorId, { name, type = 'checking', icon, goal_monthly }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name, type, icon, goal_monthly })
    .select().single();
  if (error) throw error;
  return data;
}
async function listAccounts(collaboratorId) {
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, type, balance, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}

// ---- Transacoes ----
async function insertTransaction(collaboratorId, { type, category, amount, description, transaction_date, account_id }) {
  const row = { collaborator_id: collaboratorId, type, category, amount, description: description || null, account_id: account_id || null };
  if (transaction_date) row.transaction_date = transaction_date;
  const { data, error } = await supabase.from('pf_transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}
async function monthCategoryTotal(collaboratorId, category, { excludeId } = {}) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('amount, id')
    .eq('collaborator_id', collaboratorId).eq('type', 'expense').eq('category', category)
    .gte('transaction_date', start).lt('transaction_date', end);
  if (error) throw error;
  return (data || []).filter((r) => r.id !== excludeId).reduce((s, r) => s + Number(r.amount), 0);
}
async function querySummary(collaboratorId) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end);
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
async function createBill(collaboratorId, { name, amount, due_day, category, type = 'expense', remind_days_before = 2 }) {
  const { data, error } = await supabase.from('pf_bills')
    .insert({ collaborator_id: collaboratorId, name, amount, due_day, category, type, remind_days_before })
    .select().single();
  if (error) throw error;
  return data;
}
async function findBills(collaboratorId, billName) {
  const { data, error } = await supabase.from('pf_bills')
    .select('id, name, amount, category, type')
    .eq('collaborator_id', collaboratorId).eq('is_active', true)
    .ilike('name', `%${billName}%`);
  if (error) throw error;
  return data || [];
}
async function payBill(collaboratorId, bill) {
  const today = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await supabase.from('pf_bills')
    .update({ last_paid_at: today, status: 'paid' })
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (e1) throw e1;
  await insertTransaction(collaboratorId, {
    type: bill.type, category: bill.category, amount: bill.amount, description: bill.name, transaction_date: today,
  });
  return { ...bill, last_paid_at: today };
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
async function addToGoal(collaboratorId, goal, addAmount) {
  const novo = Number(goal.current_amount) + Number(addAmount);
  const { data, error } = await supabase.from('pf_goals')
    .update({ current_amount: novo, updated_at: new Date().toISOString() })
    .eq('id', goal.id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
async function listGoals(collaboratorId) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('created_at');
  if (error) throw error;
  return data || [];
}

module.exports = {
  monthBounds,
  createAccount, listAccounts,
  insertTransaction, monthCategoryTotal, querySummary,
  setBudget, getBudget, queryBudget,
  createBill, findBills, payBill,
  createGoal, findGoal, addToGoal, listGoals,
};
