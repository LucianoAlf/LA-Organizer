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

// Próximo vencimento (DD/MM) a partir de hoje, dado SÓ o dia de vencimento do cartão (data local).
// ⚠️ NÃO usar pro vencimento da fatura de cartão: ignora o dia de FECHAMENTO → mostra o mês errado
// quando a fatura do mês já fechou (bug Rose 12/07). Pro tile/fatura use currentCycleSummary /
// dueLabelForCompetencia (que respeitam o fechamento). Mantido só p/ contexto sem ciclo de fatura.
export function nextDueLabel(dueDay: number, today = new Date()): string {
  const d = today.getDate();
  const due = new Date(today.getFullYear(), d <= dueDay ? today.getMonth() : today.getMonth() + 1, dueDay);
  return `${String(due.getDate()).padStart(2, '0')}/${String(due.getMonth() + 1).padStart(2, '0')}`;
}

// Vencimento REAL da fatura de uma competência (YYYY-MM-01), dado fechamento + vencimento do cartão.
// Regra de cartão (espelha pf_tx_compute_cashflow no banco): vence no MESMO mês da competência se
// due_day >= closing_day (fecha dia 4, vence dia 10); senão no mês SEGUINTE (fecha dia 30, vence dia 6).
// UTC puro — sem shift de fuso (o dia de vencimento é fixo).
export function dueDateForCompetencia(comp: string, closingDay: number, dueDay: number): Date {
  const d = new Date(comp + 'T00:00:00Z');
  const offset = dueDay >= closingDay ? 0 : 1;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, dueDay));
}
export function dueLabelForCompetencia(comp: string, closingDay: number, dueDay: number): string {
  const due = dueDateForCompetencia(comp, closingDay, dueDay);
  return `${String(due.getUTCDate()).padStart(2, '0')}/${String(due.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Dias corridos até o PRÓXIMO fechamento (o fechamento da fatura ABERTA). Hoje ≤ dia de
// fechamento → fecha neste mês; senão no mês seguinte. UTC-safe (contagem em dias inteiros).
export function daysUntilClosing(closingDay: number, today = new Date()): number {
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), d = today.getUTCDate();
  const nextClose = Date.UTC(y, d <= closingDay ? m : m + 1, closingDay);
  const start = Date.UTC(y, m, d);
  return Math.round((nextClose - start) / 86400000);
}

// Resumo do ciclo da fatura ABERTA (corrente) do cartão — pro tile da lista de cartões.
// FONTE ÚNICA: deriva da competência corrente (competenciaFor, que respeita o fechamento),
// IGUAL ao detalhe (CartaoDetalhePage). Evita o mislabel "vence no mês errado" quando a fatura
// do mês já fechou (fecha dia 7, hoje dia 12 → a fatura aberta é a do mês seguinte).
export function currentCycleSummary(
  card: Pick<PfCard, 'closing_day' | 'due_day'>,
  today = new Date(),
): { dueLabel: string; closesInDays: number } {
  const comp = competenciaFor(today, card.closing_day);
  return {
    dueLabel: dueLabelForCompetencia(comp, card.closing_day, card.due_day),
    closesInDays: daysUntilClosing(card.closing_day, today),
  };
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

export async function updateCard(collaboratorId: string, id: string, patch: {
  name?: string; brand?: string | null; color?: string | null;
  credit_limit?: number; closing_day?: number; due_day?: number; icon?: string | null;
}): Promise<PfCard> {
  const { data, error } = await supabase.from('pf_cards')
    .update(patch).eq('id', id).eq('collaborator_id', collaboratorId)
    .select().single();
  if (error) throw error;
  return data as PfCard;
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

// Estorna o pagamento de uma fatura: apaga TODOS os pagamentos daquela competência → a fatura
// volta a "em aberto". O trigger pf_sync_balance_on_card_payment devolve o valor à conta de origem
// (balance += amount no DELETE). Sug Rose 13/06: "paguei e quis cancelar, tirar de quitada pra em aberto".
export async function cancelCardInvoicePayment(collaboratorId: string, cardId: string, competencia: string): Promise<void> {
  const { error } = await supabase.from('pf_card_payments').delete()
    .eq('collaborator_id', collaboratorId).eq('card_id', cardId).eq('competencia', competencia);
  if (error) throw error;
}

export interface ClosedInvoice {
  card: PfCard; competencia: string; total: number; paid: number; remaining: number;
}
// Faturas FECHADAS e não pagas de todos os cartões ativos: competência ANTERIOR à corrente
// (currentCompetencia, que é a fatura aberta) e com saldo (total lançado − pago > 0). Virtual —
// deriva de pf_transactions + pf_card_payments, não materializa pf_bills. Sug Rose 5b.
export async function listClosedUnpaidInvoices(collaboratorId: string): Promise<ClosedInvoice[]> {
  const cards = await listCards(collaboratorId);
  const out: ClosedInvoice[] = [];
  for (const card of cards) {
    const curr = currentCompetencia(card); // fatura aberta (corrente) — excluída
    const [txRes, payRes] = await Promise.all([
      supabase.from('pf_transactions').select('competencia, amount')
        .eq('collaborator_id', collaboratorId).eq('card_id', card.id)
        .not('competencia', 'is', null).lt('competencia', curr),
      supabase.from('pf_card_payments').select('competencia, amount')
        .eq('collaborator_id', collaboratorId).eq('card_id', card.id).lt('competencia', curr),
    ]);
    if (txRes.error) throw txRes.error;
    if (payRes.error) throw payRes.error;
    const totals = new Map<string, number>();
    for (const r of (txRes.data ?? []) as { competencia: string; amount: number }[]) {
      totals.set(r.competencia, (totals.get(r.competencia) ?? 0) + Number(r.amount));
    }
    const paids = new Map<string, number>();
    for (const r of (payRes.data ?? []) as { competencia: string; amount: number }[]) {
      paids.set(r.competencia, (paids.get(r.competencia) ?? 0) + Number(r.amount));
    }
    for (const [competencia, total] of totals) {
      const paid = paids.get(competencia) ?? 0;
      const remaining = total - paid;
      if (remaining > 0.005) out.push({ card, competencia, total, paid, remaining });
    }
  }
  out.sort((a, b) => (a.competencia < b.competencia ? 1 : -1)); // mais recente primeiro
  return out;
}

// Faturas de uma competência específica (YYYY-MM-01), de todos os cartões ativos — usado na
// previsão mensal das Contas a pagar (navegar mês a mês). Inclui faturas abertas/futuras
// (parcelas já têm competência futura), por isso não filtra por "fechada". total = lançado;
// remaining = total − pago.
export async function listInvoicesByCompetencia(collaboratorId: string, competencia: string): Promise<ClosedInvoice[]> {
  const cards = await listCards(collaboratorId);
  const out: ClosedInvoice[] = [];
  for (const card of cards) {
    const [txRes, payRes] = await Promise.all([
      supabase.from('pf_transactions').select('amount')
        .eq('collaborator_id', collaboratorId).eq('card_id', card.id).eq('competencia', competencia),
      supabase.from('pf_card_payments').select('amount')
        .eq('collaborator_id', collaboratorId).eq('card_id', card.id).eq('competencia', competencia),
    ]);
    if (txRes.error) throw txRes.error;
    if (payRes.error) throw payRes.error;
    const total = (txRes.data ?? []).reduce((s, r) => s + Number((r as { amount: number }).amount), 0);
    const paid = (payRes.data ?? []).reduce((s, r) => s + Number((r as { amount: number }).amount), 0);
    if (total > 0.005) out.push({ card, competencia, total, paid, remaining: total - paid });
  }
  return out;
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
           description?: string | null; installments?: number; firstDate?: string; billId?: string | null }
) {
  const base = input.firstDate ? new Date(input.firstDate + 'T00:00:00Z') : new Date();
  const dateStr = base.toISOString().slice(0, 10);
  const baseComp = competenciaFor(base, input.closingDay);
  const n = Math.max(1, Math.floor(input.installments ?? 1));
  const values = splitInstallments(input.amount, n);
  const rows: Record<string, unknown>[] = values.map((amt, i) => ({
    collaborator_id: collaboratorId, card_id: input.cardId, type: 'expense' as const,
    category: input.category, description: input.description ?? null,
    transaction_date: dateStr, via: 'pwa', bill_id: input.billId ?? null,
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
