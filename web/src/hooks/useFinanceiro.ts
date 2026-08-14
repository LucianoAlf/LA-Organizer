// Hooks de Finanças Pessoais (PWA).
// SEGURANÇA: `collaboratorId` resolvido de useAuth().collaborator.id; nunca confiar em params externos.
// Mutations invalidam ['financeiro'] inteira (idem ao realtime).

import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import * as fin from '../lib/financeiro';
import * as cartoes from '../lib/cartoes';
import * as cat from '../lib/categorias';
import { listCategories } from '../lib/categorias';
import type { PfBill, PfCategory, PfTxType } from '../lib/financeiro';

const KEY = ['financeiro'] as const;

// Categorias data-driven (pf_categories): defaults globais + custom do usuário.
// staleTime longo — defaults raramente mudam.
export function useCategories() {
  return useQuery({
    queryKey: ['pf_categories'],
    queryFn: listCategories,
    staleTime: 1000 * 60 * 30,
  });
}

// Lookup por slug pra emoji/label/cor (fallback pra slug desconhecido). Usado nas
// listas/gráficos no lugar dos mapas estáticos de 10 categorias.
export function useCategoryLookup() {
  const { data } = useCategories();
  return useMemo(() => {
    const by = new Map((data ?? []).map((c) => [c.slug, c]));
    return {
      emoji: (slug: string) => by.get(slug)?.emoji ?? '📦',
      label: (slug: string) => by.get(slug)?.label ?? slug,
      color: (slug: string) => by.get(slug)?.color ?? '#9CA3AF',
    };
  }, [data]);
}

// Tolerante: retorna undefined enquanto auth carrega ou se não há sessão.
// ProtectedRoute já bloqueia rotas sem auth; aqui não lançamos pra não quebrar a UI no boot.
export function useFinanceiroAuth(): string | undefined {
  const { collaborator } = useAuth();
  return collaborator?.id;
}

export function useAccounts() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'accounts', cid],
    queryFn: () => fin.listAccounts(cid!),
    enabled: !!cid,
  });
}
export function useTransactions(opts?: { monthYear?: string; category?: PfCategory; type?: PfTxType; limit?: number }) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'tx', cid, opts ?? {}],
    queryFn: () => fin.listTransactions(cid!, opts),
    enabled: !!cid,
  });
}
export function useTransactionsRange(start: string, end: string) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'txRange', cid, start, end],
    queryFn: () => fin.listTransactionsRange(cid!, start, end),
    enabled: !!cid,
  });
}
export function useTransactionMonths() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'txMonths', cid],
    queryFn: () => fin.listTransactionMonths(cid!),
    enabled: !!cid,
  });
}
export function useBills() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'bills', cid],
    queryFn: () => fin.listBills(cid!),
    enabled: !!cid,
  });
}
export function useBillPayments(billId: string | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'bill-payments', billId, cid],
    queryFn: () => fin.listBillPayments(cid!, billId!),
    enabled: !!cid && !!billId,
  });
}
// Overrides de valor por mês (competência YYYY-MM-01), mapa por bill_id. Fatia 1: só leitura.
export function useBillOverrides(competencia: string | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'billOverrides', cid, competencia],
    queryFn: () => fin.listBillOverrides(cid!, competencia!),
    enabled: !!cid && !!competencia,
  });
}
export function useGoals() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'goals', cid],
    queryFn: () => fin.listGoals(cid!),
    enabled: !!cid,
  });
}
export function useBudgets(monthYear?: string) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'budgets', cid, monthYear ?? null],
    queryFn: () => fin.listBudgets(cid!, monthYear),
    enabled: !!cid,
  });
}

// Resumo derivado das transações do mês corrente (puro client-side).
export function useSummary(monthYear?: string) {
  const tx = useTransactions(monthYear ? { monthYear } : undefined);
  if (!tx.data) return { ...tx, summary: undefined };
  // Regime de caixa (Rose): INCLUI cartão — o gasto conta no mês do VENCIMENTO da fatura
  // (cashflow_competencia já = vencimento). Exclui só ajustes de saldo (acerto de caixa, não é despesa real).
  const real = tx.data.filter((r) => !r.is_adjustment);
  const receitas = real.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = real.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  // Gastos por categoria: INCLUI cartão (você quer ver onde gasta), mas EXCLUI ajustes.
  const porCat: Record<string, number> = {};
  for (const r of tx.data) if (r.type === 'expense' && !r.is_adjustment) porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
  return { ...tx, summary: { receitas, despesas, saldo: receitas - despesas, porCat } };
}

function useFinMutation<T, V>(fn: (cid: string, v: V) => Promise<T>) {
  const cid = useFinanceiroAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => {
      if (!cid) return Promise.reject(new Error('Sem sessão. Faça login.'));
      return fn(cid, v);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export const useCreateTransaction = () => useFinMutation(fin.createTransaction);
export const useDeleteTransaction = () => useFinMutation((cid, id: string) => fin.deleteTransaction(cid, id));
export const useDeleteManyTransactions = () => useFinMutation((cid, ids: string[]) => fin.deleteManyTransactions(cid, ids));
export const useUpdateTransaction = () => useFinMutation((cid, args: { id: string; patch: Parameters<typeof fin.updateTransaction>[2] }) => fin.updateTransaction(cid, args.id, args.patch));
export const useCreateBill        = () => useFinMutation(fin.createBill);
export const usePayBill           = () => useFinMutation(
  (cid, args: { bill: PfBill; amount?: number; account_id?: string | null; card?: { id: string; closing_day: number } | null; date?: string }) =>
    fin.payBill(cid, args.bill, { amount: args.amount, account_id: args.account_id, card: args.card, date: args.date })
);
export const useCreateGoal        = () => useFinMutation(fin.createGoal);
export const useAddToGoal = () => useFinMutation(
  (cid, args: { goalId: string; amount: number; note?: string | null; date?: string }) =>
    fin.addToGoal(cid, args.goalId, args.amount, { note: args.note, date: args.date })
);
export const useUpdateGoal = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateGoal>[2] }) => fin.updateGoal(cid, args.id, args.patch)
);
export const useDeactivateGoal = () => useFinMutation((cid, id: string) => fin.deactivateGoal(cid, id));
export const useDeleteGoalContribution = () => useFinMutation((cid, id: string) => fin.deleteGoalContribution(cid, id));
export function useGoalContributions(goalId: string | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'goal-contributions', goalId, cid],
    queryFn: () => fin.listGoalContributions(cid!, goalId!),
    enabled: !!cid && !!goalId,
  });
}
export const useSetBudget         = () => useFinMutation(fin.setBudget);
export const useCreateAccount     = () => useFinMutation(fin.createAccount);
export const useDeactivateAccount = () => useFinMutation((cid, id: string) => fin.deactivateAccount(cid, id));
export const useReactivateAccount = () => useFinMutation((cid, id: string) => fin.reactivateAccount(cid, id));
export function useInactiveAccounts() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'inactiveAccounts', cid],
    queryFn: () => fin.listInactiveAccounts(cid!),
    enabled: !!cid,
  });
}
export const useSetPrimaryAccount = () => useFinMutation((cid, id: string) => fin.setPrimaryAccount(cid, id));
export const useUpdateAccount = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateAccount>[2] }) => fin.updateAccount(cid, args.id, args.patch)
);
export const useCreateTransfer = () => useFinMutation(
  (cid, args: Parameters<typeof fin.createTransfer>[1]) => fin.createTransfer(cid, args)
);
export const useUpdateTransfer = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateTransfer>[2] }) => fin.updateTransfer(cid, args.id, args.patch)
);
export const useDeleteTransfer = () => useFinMutation(
  (cid, id: string) => fin.deleteTransfer(cid, id)
);
export function useAccountTransactions(accountId: string | undefined, monthYear?: string) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'account-tx', accountId, cid, monthYear ?? null],
    queryFn: () => fin.listAccountTransactions(cid!, accountId!, { monthYear }),
    enabled: !!cid && !!accountId,
  });
}
export function useAccountLedger(accountId: string | undefined, monthYear: string) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'account-ledger', accountId, cid, monthYear],
    queryFn: () => fin.listAccountLedger(cid!, accountId!, monthYear),
    enabled: !!cid && !!accountId,
  });
}
export function useAccountBalanceAtMonthEnd(accountId: string | undefined, monthYear: string, currentBalance: number | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'acct-bal-end', accountId, cid, monthYear, currentBalance ?? null],
    queryFn: () => fin.accountBalanceAtMonthEnd(cid!, accountId!, monthYear, currentBalance ?? 0),
    enabled: !!cid && !!accountId && currentBalance != null,
  });
}

// ---- Cartões de crédito ----
export function useCards() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'cards', cid],
    queryFn: () => cartoes.listCards(cid!),
    enabled: !!cid,
  });
}
export function useCardsWithUsage() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'cardsUsage', cid],
    queryFn: () => cartoes.cardsWithUsage(cid!),
    enabled: !!cid,
  });
}
export function useCardUsage(card?: cartoes.PfCard) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'cardUsage', cid, card?.id],
    queryFn: () => cartoes.cardUsage(cid!, card!),
    enabled: !!cid && !!card,
  });
}
export function useCardInvoice(cardId?: string, competencia?: string) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'cardInvoice', cid, cardId, competencia],
    queryFn: () => cartoes.cardInvoice(cid!, cardId!, competencia!),
    enabled: !!cid && !!cardId && !!competencia,
  });
}
export function useClosedUnpaidInvoices() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'closedInvoices', cid],
    queryFn: () => cartoes.listClosedUnpaidInvoices(cid!),
    enabled: !!cid,
  });
}
// Irmã da de cima. Sem ela, fatura quitada não aparecia em tela nenhuma (caso Rose 13/08).
export function useClosedPaidInvoices() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'closedPaidInvoices', cid],
    queryFn: () => cartoes.listClosedPaidInvoices(cid!),
    enabled: !!cid,
  });
}
export function useInvoicesByCompetencia(competencia: string | undefined) {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'invoicesByComp', cid, competencia],
    queryFn: () => cartoes.listInvoicesByCompetencia(cid!, competencia!),
    enabled: !!cid && !!competencia,
  });
}
export const useCreateCard     = () => useFinMutation(cartoes.createCard);
export const useDeactivateCard = () => useFinMutation((cid, id: string) => cartoes.deactivateCard(cid, id));
export const useUpdateCard      = () => useFinMutation(
  (cid, input: { id: string; patch: Parameters<typeof cartoes.updateCard>[2] }) => cartoes.updateCard(cid, input.id, input.patch)
);
export const usePayInvoice     = () => useFinMutation(
  (cid, args: { card: cartoes.PfCard; competencia: string; amount: number; paid_from_account: string | null }) =>
    cartoes.payCardInvoice(cid, args),
);
export const useCancelInvoicePayment = () => useFinMutation(
  (cid, args: { cardId: string; competencia: string }) =>
    cartoes.cancelCardInvoicePayment(cid, args.cardId, args.competencia),
);

export const useCreateCardPurchase    = () => useFinMutation(
  (cid, args: Parameters<typeof cartoes.createCardPurchase>[1]) => cartoes.createCardPurchase(cid, args)
);
export const useUpdateBill            = () => useFinMutation(
  (cid, args: { id: string; patch: Parameters<typeof fin.updateBill>[2] }) => fin.updateBill(cid, args.id, args.patch)
);
export const useDeactivateBill        = () => useFinMutation(
  (cid, id: string) => fin.deactivateBill(cid, id)
);
export const useSetBillOverride = () => useFinMutation(
  (cid, args: { billId: string; competencia: string; amount: number }) => fin.setBillOverride(cid, args.billId, args.competencia, args.amount)
);
export const useDeleteBillOverride = () => useFinMutation(
  (cid, args: { billId: string; competencia: string }) => fin.deleteBillOverride(cid, args.billId, args.competencia)
);
export const useDeleteTransactionGroup = () => useFinMutation(
  (cid, purchaseGroup: string) => fin.deleteTransactionGroup(cid, purchaseGroup)
);

// useFinMutation invalida KEY=['financeiro']; categorias têm queryKey separado ['pf_categories'].
// Estas mutations invalidam ambas pra o picker e lookup reflectirem imediatamente.
function useFinMutationWithCats<T, V>(fn: (cid: string, v: V) => Promise<T>) {
  const cid = useFinanceiroAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => {
      if (!cid) return Promise.reject(new Error('Sem sessão. Faça login.'));
      return fn(cid, v);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['pf_categories'] });
    },
  });
}

export const useCreateCategory = () => useFinMutationWithCats(
  (cid, input: { label: string; emoji: string; type: 'expense' | 'income' }) => cat.createCategory(cid, input)
);
export const useDeactivateCategory = () => useFinMutationWithCats(
  (cid, id: string) => cat.deactivateCategory(cid, id)
);
