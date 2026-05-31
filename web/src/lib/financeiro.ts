// PWA: CRUD direto contra Supabase via JWT (RLS owner-only protege).
// SEGURANÇA: `collaboratorId` vem SEMPRE do auth context do PWA (caller passa).
// RLS WITH CHECK valida que bate com current_collab_id() — não tem como gravar pra outro.
// REGRA: mudou algo de schema/validação aqui? espelha no _remote/src/services/financeiro-service.js (Fase A).

import { supabase } from './supabase';

// Categoria = slug data-driven (tabela pf_categories). Era union fechada de 10.
export type PfCategory = string;
export type PfTxType = 'income' | 'expense';
export type PfAccountType = 'checking' | 'savings' | 'wallet' | 'investment';
export type PfBillType = 'expense' | 'income';

export interface PfAccount { id: string; name: string; type: PfAccountType; balance: number; icon: string | null; is_primary: boolean; }
export interface PfTransaction {
  id: string; type: PfTxType; category: PfCategory; amount: number;
  description: string | null; transaction_date: string; account_id: string | null;
  card_id?: string | null; // preenchido = compra no cartão (fora do caixa; vive na fatura)
  purchase_group?: string | null;
}
export interface PfBill {
  id: string; name: string; amount: number; due_day: number; category: PfCategory;
  type: PfBillType; status: 'pending' | 'paid' | 'overdue'; last_paid_at: string | null;
}
export interface PfGoal {
  id: string; name: string; target_amount: number; current_amount: number;
  monthly_contribution: number | null; deadline: string | null; icon: string | null;
}

// Janela do mês corrente em UTC (start incluso, end excluso).
export function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  return { start, end, monthYear: start.slice(0, 7) };
}

function monthBoundsFromYYYYMM(monthYear: string) {
  const [y, m] = monthYear.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { start, end };
}

// ---- Carteiras ----
export async function listAccounts(collaboratorId: string): Promise<PfAccount[]> {
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, type, balance, icon, is_primary')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return (data as PfAccount[]) ?? [];
}
export async function createAccount(collaboratorId: string, input: { name: string; type?: PfAccountType; icon?: string | null; goal_monthly?: number | null }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name: input.name, type: input.type ?? 'checking', icon: input.icon ?? null, goal_monthly: input.goal_monthly ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
export async function deactivateAccount(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_accounts').update({ is_active: false })
    .eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
export async function setPrimaryAccount(collaboratorId: string, id: string) {
  await supabase.from('pf_accounts')
    .update({ is_primary: false })
    .eq('collaborator_id', collaboratorId).eq('is_primary', true);
  const { error } = await supabase.from('pf_accounts')
    .update({ is_primary: true })
    .eq('collaborator_id', collaboratorId).eq('id', id);
  if (error) throw error;
}

// ---- Transações ----
export async function listTransactions(collaboratorId: string, opts?: { monthYear?: string; category?: PfCategory; type?: PfTxType; limit?: number }) {
  const { start, end } = opts?.monthYear ? monthBoundsFromYYYYMM(opts.monthYear) : monthBounds();
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group')
    .eq('collaborator_id', collaboratorId)
    .gte('transaction_date', start).lt('transaction_date', end)
    .order('transaction_date', { ascending: false });
  if (opts?.category) q = q.eq('category', opts.category);
  if (opts?.type) q = q.eq('type', opts.type);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data as PfTransaction[]) ?? [];
}
export async function createTransaction(collaboratorId: string, input: { type: PfTxType; category: PfCategory; amount: number; description?: string | null; transaction_date?: string; account_id?: string | null }) {
  const row = {
    collaborator_id: collaboratorId, type: input.type, category: input.category, amount: input.amount,
    description: input.description ?? null, account_id: input.account_id ?? null,
    via: 'pwa', ...(input.transaction_date ? { transaction_date: input.transaction_date } : {}),
  };
  const { data, error } = await supabase.from('pf_transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}
export async function deleteTransaction(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_transactions').delete()
    .eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
export async function updateTransaction(collaboratorId: string, id: string, patch: { type?: PfTxType; category?: PfCategory; amount?: number; description?: string | null; transaction_date?: string; account_id?: string | null }) {
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['type', 'category', 'amount', 'description', 'transaction_date', 'account_id'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_transactions')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}
// Range multi-mês — usado pela linha de 6 meses do Dashboard.
export async function listTransactionsRange(collaboratorId: string, start: string, end: string) {
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, amount, transaction_date, card_id')
    .eq('collaborator_id', collaboratorId)
    .gte('transaction_date', start).lt('transaction_date', end);
  if (error) throw error;
  return (data ?? []) as { type: PfTxType; amount: number; transaction_date: string; card_id: string | null }[];
}

// ---- Orçamento ----
export async function listBudgets(collaboratorId: string, monthYear = monthBounds().monthYear) {
  const { data, error } = await supabase.from('pf_budgets')
    .select('category, monthly_limit')
    .eq('collaborator_id', collaboratorId).eq('month_year', monthYear);
  if (error) throw error;
  return (data ?? []) as { category: PfCategory; monthly_limit: number }[];
}
export async function setBudget(collaboratorId: string, input: { category: PfCategory; monthly_limit: number }) {
  const monthYear = monthBounds().monthYear;
  const { data, error } = await supabase.from('pf_budgets')
    .upsert({ collaborator_id: collaboratorId, category: input.category, monthly_limit: input.monthly_limit, month_year: monthYear },
            { onConflict: 'collaborator_id,category,month_year' })
    .select().single();
  if (error) throw error;
  return data;
}

// ---- Contas fixas (status derivado de last_paid_at — D6) ----
export type BillStatus = 'paga' | 'a-vencer' | 'atrasada';
export function deriveBillStatus(bill: PfBill, today = new Date()): BillStatus {
  const { start } = monthBounds(today);
  if (bill.last_paid_at && bill.last_paid_at >= start) return 'paga';
  const dom = today.getUTCDate();
  return bill.due_day < dom ? 'atrasada' : 'a-vencer';
}
export async function listBills(collaboratorId: string) {
  const { data, error } = await supabase.from('pf_bills')
    .select('id, name, amount, due_day, category, type, status, last_paid_at')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('due_day');
  if (error) throw error;
  return (data as PfBill[]) ?? [];
}
export async function createBill(collaboratorId: string, input: { name: string; amount: number; due_day: number; category: PfCategory; type?: PfBillType; remind_days_before?: number }) {
  const { data, error } = await supabase.from('pf_bills')
    .insert({ collaborator_id: collaboratorId, name: input.name, amount: input.amount, due_day: input.due_day,
              category: input.category, type: input.type ?? 'expense', remind_days_before: input.remind_days_before ?? 2 })
    .select().single();
  if (error) throw error;
  return data;
}
export async function payBill(collaboratorId: string, bill: PfBill) {
  const today = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await supabase.from('pf_bills')
    .update({ last_paid_at: today, status: 'paid' })
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (e1) throw e1;
  await createTransaction(collaboratorId, {
    type: bill.type, category: bill.category, amount: bill.amount, description: bill.name, transaction_date: today,
  });
}

// ---- Metas (D7: contribuição NÃO vira transação) ----
export async function listGoals(collaboratorId: string) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('created_at');
  if (error) throw error;
  return (data as PfGoal[]) ?? [];
}
export async function createGoal(collaboratorId: string, input: { name: string; target_amount: number; monthly_contribution?: number | null; deadline?: string | null; icon?: string | null }) {
  const { data, error } = await supabase.from('pf_goals')
    .insert({ collaborator_id: collaboratorId, name: input.name, target_amount: input.target_amount,
              monthly_contribution: input.monthly_contribution ?? null, deadline: input.deadline ?? null, icon: input.icon ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
export async function addToGoal(collaboratorId: string, goal: PfGoal, addAmount: number) {
  // Read-modify-write no cliente (igual o engine). Dívida v1.1: trocar por rpc('pf_goal_add').
  const novo = Number(goal.current_amount) + Number(addAmount);
  const { data, error } = await supabase.from('pf_goals')
    .update({ current_amount: novo, updated_at: new Date().toISOString() })
    .eq('id', goal.id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data;
}
