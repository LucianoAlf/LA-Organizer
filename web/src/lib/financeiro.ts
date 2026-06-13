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

export interface PfAccount {
  id: string; name: string; type: PfAccountType; balance: number; icon: string | null; is_primary: boolean;
  bank_slug: string | null; color: string | null; goal_monthly: number | null; is_active?: boolean;
}
export interface PfTransaction {
  id: string; type: PfTxType; category: PfCategory; amount: number;
  description: string | null; transaction_date: string; account_id: string | null;
  card_id?: string | null; // preenchido = compra no cartão (fora do caixa; vive na fatura)
  competencia?: string | null; // YYYY-MM-01: fatura que a parcela cai (só cartão)
  cashflow_competencia?: string; // mês de fluxo de caixa: competencia (cartão) OU mês do transaction_date (caixa)
  purchase_group?: string | null;
  is_adjustment?: boolean; // true = acerto de caixa; conta no saldo, mas fora dos relatórios
}
export interface PfBill {
  id: string; name: string; amount: number; due_day: number; category: PfCategory;
  type: PfBillType; status: 'pending' | 'paid' | 'overdue'; last_paid_at: string | null;
  recurrence: 'monthly' | 'once'; due_date: string | null;
}
export interface PfGoal {
  id: string; name: string; target_amount: number; current_amount: number;
  monthly_contribution: number | null; deadline: string | null; icon: string | null;
  is_active?: boolean;
}
export interface PfGoalContribution {
  id: string; goal_id: string; amount: number; note: string | null; contributed_at: string;
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
    .select('id, name, type, balance, icon, is_primary, bank_slug, color, goal_monthly')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return (data as PfAccount[]) ?? [];
}
export async function createAccount(collaboratorId: string, input: { name: string; type?: PfAccountType; icon?: string | null; goal_monthly?: number | null; bank_slug?: string | null; color?: string | null }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name: input.name, type: input.type ?? 'checking',
              icon: input.icon ?? null, goal_monthly: input.goal_monthly ?? null,
              bank_slug: input.bank_slug ?? null, color: input.color ?? null })
    .select().single();
  if (error) throw error;
  return data;
}
export async function updateAccount(collaboratorId: string, id: string, patch: { name?: string; type?: PfAccountType; icon?: string | null; goal_monthly?: number | null; bank_slug?: string | null; color?: string | null }) {
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'type', 'icon', 'goal_monthly', 'bank_slug', 'color'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_accounts')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}

// Transferência: insere em pf_transfers; TRIGGER no banco ajusta os 2 saldos (sem math manual).
export async function createTransfer(collaboratorId: string, input: { from_account: string; to_account: string; amount: number; description?: string | null; transfer_date?: string }) {
  const row: Record<string, unknown> = {
    collaborator_id: collaboratorId, from_account: input.from_account, to_account: input.to_account,
    amount: input.amount, description: input.description ?? null,
  };
  if (input.transfer_date) row.transfer_date = input.transfer_date;
  const { data, error } = await supabase.from('pf_transfers').insert(row).select().single();
  if (error) throw error;
  return data;
}

// Extrato da carteira: lançamentos (caixa) dessa conta, recentes primeiro.
// monthYear (YYYY-MM) → filtra pelo mês do transaction_date (navegação mês a mês na carteira).
export async function listAccountTransactions(collaboratorId: string, accountId: string, opts: { monthYear?: string; limit?: number } = {}): Promise<PfTransaction[]> {
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, purchase_group, is_adjustment')
    .eq('collaborator_id', collaboratorId).eq('account_id', accountId)
    .order('transaction_date', { ascending: false });
  if (opts.monthYear) {
    const { start, end } = monthBoundsFromYYYYMM(opts.monthYear);
    q = q.gte('transaction_date', start).lt('transaction_date', end);
  }
  q = q.limit(opts.limit ?? 50);
  const { data, error } = await q;
  if (error) throw error;
  return (data as PfTransaction[]) ?? [];
}

// Extrato UNIFICADO da carteira no mês: lançamentos (caixa) + transferências (entrada/saída entre
// contas) + pagamentos de fatura que saíram da conta. Resolve "não aparece" quando o saldo veio de
// transferência (Sug Rose). Transferências/pagamentos filtrados por mês em JS (a data pode vir nula).
export interface AccountLedgerItem {
  id: string;            // chave única (prefixada por fonte)
  date: string;          // YYYY-MM-DD (data efetiva da movimentação)
  kind: 'txn' | 'transfer_in' | 'transfer_out' | 'card_payment';
  label: string;
  amount: number;        // sempre positivo
  direction: 'in' | 'out';
  txn?: PfTransaction;   // presente só em lançamentos (linha editável)
}
export async function listAccountLedger(collaboratorId: string, accountId: string, monthYear: string): Promise<AccountLedgerItem[]> {
  const { start, end } = monthBoundsFromYYYYMM(monthYear);
  const inMonth = (d: string) => !!d && d >= start && d < end;
  const dayOf = (primary: string | null, fallbackTs: string | null) => primary || (fallbackTs ? fallbackTs.slice(0, 10) : '');

  const [txRes, trRes, payRes, accRes, cardRes] = await Promise.all([
    supabase.from('pf_transactions')
      .select('id, type, category, amount, description, transaction_date, account_id, card_id, competencia, is_adjustment, bill_id')
      .eq('collaborator_id', collaboratorId).eq('account_id', accountId)
      .gte('transaction_date', start).lt('transaction_date', end),
    supabase.from('pf_transfers')
      .select('id, amount, transfer_date, created_at, description, from_account, to_account')
      .eq('collaborator_id', collaboratorId).or(`from_account.eq.${accountId},to_account.eq.${accountId}`),
    supabase.from('pf_card_payments')
      .select('id, amount, paid_at, created_at, card_id')
      .eq('collaborator_id', collaboratorId).eq('paid_from_account', accountId),
    supabase.from('pf_accounts').select('id, name').eq('collaborator_id', collaboratorId),
    supabase.from('pf_cards').select('id, name').eq('collaborator_id', collaboratorId),
  ]);
  for (const r of [txRes, trRes, payRes, accRes, cardRes]) if (r.error) throw r.error;
  const accName = new Map<string, string>((accRes.data ?? []).map((a) => [(a as { id: string; name: string }).id, (a as { id: string; name: string }).name]));
  const cardName = new Map<string, string>((cardRes.data ?? []).map((c) => [(c as { id: string; name: string }).id, (c as { id: string; name: string }).name]));

  const items: AccountLedgerItem[] = [];
  for (const t of (txRes.data ?? []) as PfTransaction[]) {
    items.push({ id: `t_${t.id}`, date: t.transaction_date, kind: 'txn', label: t.description || t.category, amount: Number(t.amount), direction: t.type === 'income' ? 'in' : 'out', txn: t });
  }
  for (const tr of (trRes.data ?? []) as { id: string; amount: number; transfer_date: string | null; created_at: string | null; description: string | null; from_account: string; to_account: string }[]) {
    const d = dayOf(tr.transfer_date, tr.created_at);
    if (!inMonth(d)) continue;
    if (tr.to_account === accountId) {
      items.push({ id: `ti_${tr.id}`, date: d, kind: 'transfer_in', label: tr.description || `Transferência de ${accName.get(tr.from_account) ?? 'outra conta'}`, amount: Number(tr.amount), direction: 'in' });
    } else {
      items.push({ id: `to_${tr.id}`, date: d, kind: 'transfer_out', label: tr.description || `Transferência para ${accName.get(tr.to_account) ?? 'outra conta'}`, amount: Number(tr.amount), direction: 'out' });
    }
  }
  for (const p of (payRes.data ?? []) as { id: string; amount: number; paid_at: string | null; created_at: string | null; card_id: string }[]) {
    const d = dayOf(p.paid_at, p.created_at);
    if (!inMonth(d)) continue;
    items.push({ id: `p_${p.id}`, date: d, kind: 'card_payment', label: `Pagamento fatura ${cardName.get(p.card_id) ?? ''}`.trim(), amount: Number(p.amount), direction: 'out' });
  }
  items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return items;
}

// Saldo no FIM do mês selecionado (âncora de conciliação) = saldo ATUAL − movimentos APÓS o mês.
// Inclui lançamentos (com ajustes, que mexem no saldo), transferências e pagamentos de fatura —
// as 3 fontes que o trigger de saldo considera. Mês atual ≈ saldo atual (sem movimentos futuros).
export async function accountBalanceAtMonthEnd(collaboratorId: string, accountId: string, monthYear: string, currentBalance: number): Promise<number> {
  const { end } = monthBoundsFromYYYYMM(monthYear);
  const dayOf = (primary: string | null, fallbackTs: string | null) => primary || (fallbackTs ? fallbackTs.slice(0, 10) : '');
  const [txRes, trRes, payRes] = await Promise.all([
    supabase.from('pf_transactions').select('type, amount, transaction_date')
      .eq('collaborator_id', collaboratorId).eq('account_id', accountId).gte('transaction_date', end),
    supabase.from('pf_transfers').select('amount, transfer_date, created_at, from_account, to_account')
      .eq('collaborator_id', collaboratorId).or(`from_account.eq.${accountId},to_account.eq.${accountId}`),
    supabase.from('pf_card_payments').select('amount, paid_at, created_at')
      .eq('collaborator_id', collaboratorId).eq('paid_from_account', accountId),
  ]);
  for (const r of [txRes, trRes, payRes]) if (r.error) throw r.error;
  let net = 0; // soma assinada dos movimentos com data >= fim do mês (que ainda estão no saldo atual)
  for (const t of (txRes.data ?? []) as { type: PfTxType; amount: number }[]) net += t.type === 'income' ? Number(t.amount) : -Number(t.amount);
  for (const tr of (trRes.data ?? []) as { amount: number; transfer_date: string | null; created_at: string | null; from_account: string; to_account: string }[]) {
    if (dayOf(tr.transfer_date, tr.created_at) >= end) net += tr.to_account === accountId ? Number(tr.amount) : -Number(tr.amount);
  }
  for (const p of (payRes.data ?? []) as { amount: number; paid_at: string | null; created_at: string | null }[]) {
    if (dayOf(p.paid_at, p.created_at) >= end) net -= Number(p.amount);
  }
  return currentBalance - net;
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
  let q = supabase.from('pf_transactions')
    .select('id, type, category, amount, description, transaction_date, account_id, card_id, competencia, cashflow_competencia, purchase_group, is_adjustment')
    .eq('collaborator_id', collaboratorId)
    .order('transaction_date', { ascending: false });
  // Mês = fluxo de caixa: cartão pela COMPETÊNCIA (fatura), caixa pelo mês do transaction_date.
  // cashflow_competencia (coluna gerada) unifica os dois → uma parcela aparece no mês da sua fatura.
  // Sem monthYear (ex.: "últimas N") não filtra por mês. FIN-CARTAO-CASHFLOW-COMPETENCIA.
  if (opts?.monthYear || !opts?.limit) {
    const { start } = opts?.monthYear ? monthBoundsFromYYYYMM(opts.monthYear) : monthBounds();
    q = q.eq('cashflow_competencia', start);
  }
  if (opts?.category) q = q.eq('category', opts.category);
  if (opts?.type) q = q.eq('type', opts.type);
  if (opts?.limit) q = q.limit(opts.limit);
  const { data, error } = await q;
  if (error) throw error;
  return (data as PfTransaction[]) ?? [];
}
// Meses (YYYY-MM) que têm lançamento, pelo mês de FLUXO DE CAIXA (cartão = fatura). Alimenta o
// seletor da tela Transações — inclui faturas futuras (parcelas) sem precisar de horizonte fixo.
export async function listTransactionMonths(collaboratorId: string): Promise<string[]> {
  const { data, error } = await supabase.from('pf_transactions')
    .select('cashflow_competencia')
    .eq('collaborator_id', collaboratorId);
  if (error) throw error;
  const set = new Set<string>();
  for (const r of (data ?? []) as { cashflow_competencia: string | null }[]) {
    if (r.cashflow_competencia) set.add(r.cashflow_competencia.slice(0, 7));
  }
  return [...set];
}
export async function createTransaction(collaboratorId: string, input: { type: PfTxType; category: PfCategory; amount: number; description?: string | null; transaction_date?: string; account_id?: string | null; is_adjustment?: boolean; bill_id?: string | null }) {
  const row = {
    collaborator_id: collaboratorId, type: input.type, category: input.category, amount: input.amount,
    description: input.description ?? null, account_id: input.account_id ?? null,
    is_adjustment: input.is_adjustment ?? false, bill_id: input.bill_id ?? null,
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
    .select('type, amount, transaction_date, card_id, is_adjustment')
    .eq('collaborator_id', collaboratorId)
    .gte('transaction_date', start).lt('transaction_date', end);
  if (error) throw error;
  return (data ?? []) as { type: PfTxType; amount: number; transaction_date: string; card_id: string | null; is_adjustment?: boolean }[];
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
export interface ExpenseBillGroups { atrasadas: PfBill[]; aVencer: PfBill[]; pagas: PfBill[]; }
// Agrupa as contas de DESPESA por status (relação completa). today injetável p/ teste.
export function groupExpenseBillsByStatus(bills: PfBill[], today = new Date()): ExpenseBillGroups {
  const g: ExpenseBillGroups = { atrasadas: [], aVencer: [], pagas: [] };
  for (const b of bills.filter((x) => x.type === 'expense')) {
    const s = deriveBillStatus(b, today);
    if (s === 'paga') g.pagas.push(b);
    else if (s === 'atrasada') g.atrasadas.push(b);
    else g.aVencer.push(b);
  }
  return g;
}

export async function listBills(collaboratorId: string) {
  const { data, error } = await supabase.from('pf_bills')
    .select('id, name, amount, due_day, category, type, status, last_paid_at, recurrence, due_date')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('due_day');
  if (error) throw error;
  return (data as PfBill[]) ?? [];
}
export async function createBill(collaboratorId: string, input: { name: string; amount: number; due_day?: number; category: PfCategory; type?: PfBillType; remind_days_before?: number; recurrence?: 'monthly' | 'once'; due_date?: string | null }) {
  const recurrence = input.recurrence === 'once' ? 'once' : 'monthly';
  const row: Record<string, unknown> = {
    collaborator_id: collaboratorId, name: input.name, amount: input.amount,
    category: input.category, type: input.type ?? 'expense',
    remind_days_before: input.remind_days_before ?? 2, recurrence,
  };
  if (recurrence === 'once') {
    if (!input.due_date) throw new Error('Conta única exige data de vencimento.');
    row.due_date = input.due_date;
    row.due_day = Number(input.due_date.slice(8, 10));
  } else {
    row.due_day = input.due_day;
  }
  const { data, error } = await supabase.from('pf_bills').insert(row).select().single();
  if (error) throw error;
  return data;
}
// YMD local (BRT) — NUNCA toISOString().slice(0,10) (desloca o dia após 21h BRT). Ver utils/date.
function localYmd(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Paga a conta no valor REAL (default = previsto), por método (cartão/carteira/nenhum).
// NUNCA altera bill.amount (previsto). card = { id, closing_day } pra calcular a competência.
// IMPORTANTE: `date` = ONDE o lançamento cai (transação/competência da fatura — pode ser backdated
// pra mirar uma fatura passada). `last_paid_at` = QUANDO a conta foi QUITADA (hoje), e dirige o
// status do mês. Os dois são SEPARADOS: pagar mirando a fatura de maio não pode deixar a conta
// eternamente "atrasada" em junho (caso Rose 13/06 — FIN-PAYBILL-DATE-COUPLING).
export async function payBill(
  collaboratorId: string,
  bill: PfBill,
  opts: { amount?: number; account_id?: string | null; card?: { id: string; closing_day: number } | null; date?: string; paid_at?: string } = {},
) {
  const today = localYmd();
  const txnDate = opts.date || today;     // lançamento/fatura (pode mirar mês passado)
  const paidAt = opts.paid_at || today;   // quitação da conta (status do mês)
  const amount = (opts.amount != null && opts.amount > 0) ? opts.amount : Number(bill.amount);
  if (opts.card && bill.type !== 'income') {
    const { createCardPurchase } = await import('./cartoes'); // import dinâmico evita ciclo cartoes↔financeiro
    await createCardPurchase(collaboratorId, {
      cardId: opts.card.id, closingDay: opts.card.closing_day, amount,
      category: bill.category, description: bill.name, installments: 1, firstDate: txnDate, billId: bill.id,
    });
  } else if (opts.account_id) {
    await createTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: txnDate, account_id: opts.account_id, bill_id: bill.id });
  } else {
    await createTransaction(collaboratorId, { type: bill.type, category: bill.category, amount, description: bill.name, transaction_date: txnDate, bill_id: bill.id });
  }
  const patch: Record<string, unknown> = { last_paid_at: paidAt, status: 'paid' };
  if (bill.recurrence === 'once') patch.is_active = false;
  const { error } = await supabase.from('pf_bills')
    .update(patch).eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

export async function updateBill(collaboratorId: string, id: string, patch: { name?: string; amount?: number; due_day?: number; category?: PfCategory; type?: PfBillType; remind_days_before?: number; recurrence?: 'monthly' | 'once'; due_date?: string | null }) {
  const allowed: Record<string, unknown> = {};
  for (const k of ['name', 'amount', 'due_day', 'category', 'type', 'remind_days_before', 'recurrence', 'due_date'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_bills')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}

export async function deactivateBill(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_bills')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// Histórico de pagamentos de uma conta: lançamentos vinculados (bill_id), recentes primeiro.
// Nome de conta/cartão é resolvido no componente (via useAccounts/useCards). Depende do
// vínculo bill_id (FIN-BILL-DELETE-REVERT) → só lista pagamentos feitos após o vínculo existir.
export interface BillPayment {
  id: string; amount: number; transaction_date: string;
  account_id: string | null; card_id: string | null;
}
export async function listBillPayments(collaboratorId: string, billId: string): Promise<BillPayment[]> {
  const { data, error } = await supabase.from('pf_transactions')
    .select('id, amount, transaction_date, account_id, card_id')
    .eq('collaborator_id', collaboratorId).eq('bill_id', billId)
    .order('transaction_date', { ascending: false });
  if (error) throw error;
  return (data as BillPayment[]) ?? [];
}

// Apaga TODAS as parcelas de um grupo (compra parcelada).
export async function deleteTransactionGroup(collaboratorId: string, purchaseGroup: string) {
  const { error } = await supabase.from('pf_transactions')
    .delete().eq('purchase_group', purchaseGroup).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// ---- Metas (D7: contribuição NÃO vira transação) ----
export async function listGoals(collaboratorId: string) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon, is_active')
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
export async function addToGoal(collaboratorId: string, goalId: string, amount: number, opts?: { note?: string | null; date?: string }) {
  const row: Record<string, unknown> = { collaborator_id: collaboratorId, goal_id: goalId, amount, note: opts?.note ?? null };
  if (opts?.date) row.contributed_at = opts.date;
  const { data, error } = await supabase.from('pf_goal_contributions').insert(row).select().single();
  if (error) throw error;
  return data;
}
export async function updateGoal(collaboratorId: string, id: string, patch: { name?: string; target_amount?: number; monthly_contribution?: number | null; deadline?: string | null; icon?: string | null }) {
  const allowed: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of ['name', 'target_amount', 'monthly_contribution', 'deadline', 'icon'] as const) {
    if (patch[k] !== undefined) allowed[k] = patch[k];
  }
  const { data, error } = await supabase.from('pf_goals')
    .update(allowed).eq('id', id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
export async function deactivateGoal(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_goals')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
export async function listGoalContributions(collaboratorId: string, goalId: string): Promise<PfGoalContribution[]> {
  const { data, error } = await supabase.from('pf_goal_contributions')
    .select('id, goal_id, amount, note, contributed_at')
    .eq('collaborator_id', collaboratorId).eq('goal_id', goalId)
    .order('contributed_at', { ascending: false });
  if (error) throw error;
  return (data as PfGoalContribution[]) ?? [];
}
export async function deleteGoalContribution(collaboratorId: string, id: string) {
  const { error } = await supabase.from('pf_goal_contributions')
    .delete().eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}
