// Hooks de Finanças Pessoais (PWA).
// SEGURANÇA: `collaboratorId` resolvido de useAuth().collaborator.id; nunca confiar em params externos.
// Mutations invalidam ['financeiro'] inteira (idem ao realtime).

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import * as fin from '../lib/financeiro';
import type { PfBill, PfCategory, PfGoal, PfTxType } from '../lib/financeiro';

const KEY = ['financeiro'] as const;

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
export function useBills() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'bills', cid],
    queryFn: () => fin.listBills(cid!),
    enabled: !!cid,
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
export function useBudgets() {
  const cid = useFinanceiroAuth();
  return useQuery({
    queryKey: [...KEY, 'budgets', cid],
    queryFn: () => fin.listBudgets(cid!),
    enabled: !!cid,
  });
}

// Resumo derivado das transações do mês corrente (puro client-side).
export function useSummary() {
  const tx = useTransactions();
  if (!tx.data) return { ...tx, summary: undefined };
  const receitas = tx.data.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = tx.data.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCat: Record<string, number> = {};
  for (const r of tx.data) if (r.type === 'expense') porCat[r.category] = (porCat[r.category] || 0) + Number(r.amount);
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
export const useCreateBill        = () => useFinMutation(fin.createBill);
export const usePayBill           = () => useFinMutation((cid, bill: PfBill) => fin.payBill(cid, bill));
export const useCreateGoal        = () => useFinMutation(fin.createGoal);
export const useAddToGoal         = () => useFinMutation((cid, args: { goal: PfGoal; amount: number }) => fin.addToGoal(cid, args.goal, args.amount));
export const useSetBudget         = () => useFinMutation(fin.setBudget);
export const useCreateAccount     = () => useFinMutation(fin.createAccount);
export const useDeactivateAccount = () => useFinMutation((cid, id: string) => fin.deactivateAccount(cid, id));
