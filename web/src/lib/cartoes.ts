// PWA: CRUD de cartões de crédito (pf_cards / pf_card_payments) via Supabase JWT (RLS owner-only).
// SEGURANÇA: collaboratorId vem do auth context (caller passa). RLS WITH CHECK valida.
// REGRA: espelha a lógica de _remote/src/services/financeiro-service.js (competência/limite iguais).
import { supabase } from './supabase';
import type { PfCategory } from './financeiro';

export interface PfCard {
  id: string; name: string; brand: string | null; color: string | null;
  credit_limit: number; closing_day: number; due_day: number; icon: string | null;
}
export interface CardInvoiceItem {
  id: string; description: string | null; category: PfCategory; amount: number;
  transaction_date: string; installment_no: number | null; installments_total: number | null;
}
export interface CardInvoice {
  competencia: string; items: CardInvoiceItem[];
  total: number; paid: number; isPaid: boolean; remaining: number;
}
export interface CardUsage { used: number; available: number; pct: number; limit: number; }

const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Competência (YYYY-MM-01) da fatura. day <= closing → mês atual; senão próximo.
export function competenciaFor(baseDate: Date, closingDay: number): string {
  const y = baseDate.getUTCFullYear(), m = baseDate.getUTCMonth(), day = baseDate.getUTCDate();
  const off = day <= closingDay ? 0 : 1;
  return new Date(Date.UTC(y, m + off, 1)).toISOString().slice(0, 10);
}
export function currentCompetencia(card: Pick<PfCard, 'closing_day'>): string {
  return competenciaFor(new Date(), card.closing_day);
}
export function mesDaCompetencia(comp: string): string {
  return MES[parseInt(comp.slice(5, 7), 10) - 1] ?? '';
}

export function addMonthsToCompetencia(compStr: string, n: number): string {
  const d = new Date(compStr + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}

// Divide `amount` em `n` parcelas; o resto de centavos vai na última. Espelha o backend.
export function splitInstallments(amount: number, n: number): number[] {
  const total = Math.max(1, Math.floor(n));
  const cents = Math.round(Number(amount) * 100);
  const per = Math.floor(cents / total);
  return Array.from({ length: total }, (_, i) =>
    ((i === total - 1 ? per + (cents - per * total) : per) / 100)
  );
}

export async function listCards(collaboratorId: string): Promise<PfCard[]> {
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, brand, color, credit_limit, closing_day, due_day, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return (data as PfCard[]) ?? [];
}

export async function createCard(collaboratorId: string, input: {
  name: string; brand?: string | null; color?: string | null;
  credit_limit: number; closing_day: number; due_day: number; icon?: string | null;
}): Promise<PfCard> {
  const { data, error } = await supabase.from('pf_cards')
    .insert({
      collaborator_id: collaboratorId, name: input.name, brand: input.brand ?? null,
      color: input.color ?? null, credit_limit: input.credit_limit,
      closing_day: input.closing_day, due_day: input.due_day, icon: input.icon ?? '💳',
    })
    .select().single();
  if (error) throw error;
  return data as PfCard;
}

export async function deactivateCard(collaboratorId: string, id: string): Promise<void> {
  const { error } = await supabase.from('pf_cards')
    .update({ is_active: false }).eq('id', id).eq('collaborator_id', collaboratorId);
  if (error) throw error;
}

// Limite usado = total lançado no cartão − total já pago (todas as competências não pagas).
export async function cardUsage(collaboratorId: string, card: PfCard): Promise<CardUsage> {
  const [txRes, payRes] = await Promise.all([
    supabase.from('pf_transactions').select('amount').eq('collaborator_id', collaboratorId).eq('card_id', card.id),
    supabase.from('pf_card_payments').select('amount').eq('card_id', card.id),
  ]);
  if (txRes.error) throw txRes.error;
  if (payRes.error) throw payRes.error;
  const charged = (txRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const paid = (payRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const used = Math.max(charged - paid, 0);
  const limit = Number(card.credit_limit);
  return { used, available: limit - used, pct: limit > 0 ? used / limit : 0, limit };
}

export async function cardInvoice(collaboratorId: string, cardId: string, competencia: string): Promise<CardInvoice> {
  const [itemsRes, payRes] = await Promise.all([
    supabase.from('pf_transactions')
      .select('id, description, category, amount, transaction_date, installment_no, installments_total')
      .eq('collaborator_id', collaboratorId).eq('card_id', cardId).eq('competencia', competencia)
      .order('transaction_date', { ascending: false }),
    supabase.from('pf_card_payments').select('amount').eq('card_id', cardId).eq('competencia', competencia),
  ]);
  if (itemsRes.error) throw itemsRes.error;
  if (payRes.error) throw payRes.error;
  const items = (itemsRes.data as CardInvoiceItem[]) ?? [];
  const total = items.reduce((s, r) => s + Number(r.amount), 0);
  const paid = (payRes.data ?? []).reduce((s, r) => s + Number(r.amount), 0);
  return { competencia, items, total, paid, isPaid: paid >= total && total > 0, remaining: Math.max(total - paid, 0) };
}

export async function payCardInvoice(collaboratorId: string, args: {
  card: PfCard; competencia: string; amount: number; paid_from_account: string | null;
}): Promise<void> {
  const { error } = await supabase.from('pf_card_payments').insert({
    collaborator_id: collaboratorId, card_id: args.card.id, competencia: args.competencia,
    amount: args.amount, paid_from_account: args.paid_from_account ?? null,
  });
  if (error) throw error; // trigger debita o saldo da conta de origem
}

// Lista cartões já com o uso de limite calculado (pro chip de resumo do dashboard).
export async function cardsWithUsage(collaboratorId: string): Promise<{ card: PfCard; usage: CardUsage }[]> {
  const cards = await listCards(collaboratorId);
  return Promise.all(cards.map(async (card) => ({ card, usage: await cardUsage(collaboratorId, card) })));
}

// F2 — Saldos consolidados: posição financeira agregada (contas + limite de cartões).
export interface Position { totalSaldo: number; limiteDisponivel: number; totalDisponivel: number; }
export function computePosition(
  accounts: { balance: number }[],
  cardsUsage: { usage: { available: number } }[],
): Position {
  const totalSaldo = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  const limiteDisponivel = cardsUsage.reduce((s, c) => s + Math.max(0, Number(c.usage?.available || 0)), 0);
  return { totalSaldo, limiteDisponivel, totalDisponivel: totalSaldo + limiteDisponivel };
}

export async function createCardPurchase(
  collaboratorId: string,
  input: { cardId: string; closingDay: number; amount: number; category: string;
           description?: string | null; installments?: number; firstDate?: string }
) {
  const base = input.firstDate ? new Date(input.firstDate + 'T00:00:00Z') : new Date();
  const dateStr = base.toISOString().slice(0, 10);
  const baseComp = competenciaFor(base, input.closingDay);
  const n = Math.max(1, Math.floor(input.installments ?? 1));
  const values = splitInstallments(input.amount, n);
  const rows: Record<string, unknown>[] = values.map((amt, i) => ({
    collaborator_id: collaboratorId, card_id: input.cardId, type: 'expense' as const,
    category: input.category, description: input.description ?? null,
    transaction_date: dateStr, via: 'pwa',
    ...(n > 1 ? { installment_no: i + 1, installments_total: n } : {}),
    competencia: addMonthsToCompetencia(baseComp, i),
    amount: amt,
  }));
  const { data, error } = await supabase.from('pf_transactions').insert(rows).select();
  if (error) throw error;
  if (n > 1) {
    const groupId = (data!.find((d: { installment_no?: number }) => d.installment_no === 1)?.id) || data![0].id;
    const upd = await supabase.from('pf_transactions').update({ purchase_group: groupId })
      .in('id', data!.map((d: { id: string }) => d.id)).eq('collaborator_id', collaboratorId);
    if (upd.error) throw upd.error;
  }
  return data;
}
