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

// ---- Queries para rituais (Fase B) ----

// Contas a vencer nos proximos `days` dias OU atrasadas (venceram este mes e nao pagas).
// status derivado de last_paid_at (D6). EDGE: conta com due_day no comeco do mes seguinte
// (ex: hoje=30, due_day=2) nao entra como "a vencer" deste ciclo — aceitavel no v1.
async function billsDueWithin(collaboratorId, days = 5) {
  const dom = new Date().getUTCDate();
  const { start } = monthBounds();
  const { data, error } = await supabase.from('pf_bills')
    .select('name, amount, due_day, type, last_paid_at, category')
    .eq('collaborator_id', collaboratorId).eq('is_active', true);
  if (error) throw error;
  return (data || []).filter((b) => {
    const pagoEsteMes = b.last_paid_at && b.last_paid_at >= start;
    if (pagoEsteMes) return false;
    const aVencer = b.due_day >= dom && b.due_day <= dom + days;
    const atrasada = b.due_day < dom; // venceu este mes e nao foi paga (PRD §6.2)
    return aVencer || atrasada;
  });
}

// Relatorio do mes de referencia (default mes corrente): receitas, despesas, saldo, top 3.
async function monthlyReport(collaboratorId, ref = new Date()) {
  const { start, end } = monthBounds(ref);
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCat = {};
  for (const r of rows) if (r.type === 'expense') porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
  const top = Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { receitas, despesas, saldo: receitas - despesas, top, temAtividade: rows.length > 0 };
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

module.exports = {
  monthBounds,
  createAccount, listAccounts,
  insertTransaction, monthCategoryTotal, querySummary,
  setBudget, getBudget, queryBudget,
  createBill, findBills, payBill,
  createGoal, findGoal, addToGoal, listGoals,
  billsDueWithin, monthlyReport, collaboratorsWithActivity, collaboratorsForFinanceRitual,
  collaboratorsWithActiveBills,
};
