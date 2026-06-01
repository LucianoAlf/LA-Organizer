// Detalhe do cartão: cartão "herói" + fatura corrente + pagar fatura (parcial/total).
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BottomSheet } from '../../components/BottomSheet';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { Button } from '../../components/Button';
import {
  useCards, useCardUsage, useCardInvoice, useAccounts, usePayInvoice, useFinanceiroAuth,
} from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { currentCompetencia, mesDaCompetencia, type CardInvoiceItem } from '../../lib/cartoes';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CAT_ICON: Record<string, string> = {
  moradia: '🏠', alimentacao: '🍔', transporte: '⛽', saude: '💊',
  educacao: '📚', lazer: '🎬', salario: '💼', comissao: '💰', extra: '✨', outros: '🗂️',
};

function ItemRow({ it }: { it: CardInvoiceItem }) {
  const parc = it.installments_total && it.installments_total > 1
    ? ` (${it.installment_no}/${it.installments_total})` : '';
  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-bg-surface border border-border">
      <span className="w-7 h-7 rounded-md bg-bg-elevated flex items-center justify-center text-sm">
        {CAT_ICON[it.category] ?? '🗂️'}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-fg font-medium truncate">{(it.description || 'Compra') + parc}</div>
        <div className="text-label text-fg-muted">{it.category} · {it.transaction_date.slice(8, 10)}/{it.transaction_date.slice(5, 7)}</div>
      </div>
      <div className="font-semibold text-fg">{fmtBRL(it.amount)}</div>
    </div>
  );
}

function PagarSheet({ open, onClose, cardId }: { open: boolean; onClose: () => void; cardId: string }) {
  const cardsQ = useCards();
  const card = cardsQ.data?.find((c) => c.id === cardId);
  const comp = card ? currentCompetencia(card) : undefined;
  const inv = useCardInvoice(cardId, comp);
  const accountsQ = useAccounts();
  const payMut = usePayInvoice();
  const [amount, setAmount] = useState('');
  const [fromAcc, setFromAcc] = useState('');

  const remaining = inv.data?.remaining ?? 0;
  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  async function submit() {
    if (!card || !comp) return;
    const value = Number(amount) > 0 ? Number(amount) : remaining;
    if (value <= 0) return;
    await payMut.mutateAsync({ card, competencia: comp, amount: value, paid_from_account: fromAcc || null });
    setAmount(''); setFromAcc('');
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Pagar fatura">
      <div className="flex flex-col gap-md">
        <p className="text-fg-muted text-body-sm">Fatura atual: <b className="text-fg">{fmtBRL(inv.data?.total ?? 0)}</b> · falta <b className="text-fg">{fmtBRL(remaining)}</b></p>
        <Field label="Valor a pagar" sub="Vazio = paga a fatura toda">
          <input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={fmtBRL(remaining)} />
        </Field>
        <Field label="Sai de qual carteira?">
          <CustomSelect
            value={fromAcc}
            options={(accountsQ.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
            onChange={setFromAcc}
            placeholder="Selecione a conta"
          />
        </Field>
        <Button variant="primary" fullWidth loading={payMut.isPending} onClick={submit}>
          Registrar pagamento
        </Button>
      </div>
    </BottomSheet>
  );
}

export function CartaoDetalhePage() {
  const { id = '' } = useParams();
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_cards', 'pf_card_payments', 'pf_transactions'], cid);
  const cardsQ = useCards();
  const card = cardsQ.data?.find((c) => c.id === id);
  const usage = useCardUsage(card);
  const comp = card ? currentCompetencia(card) : undefined;
  const inv = useCardInvoice(id, comp);
  const [paying, setPaying] = useState(false);

  if (!card) {
    return (
      <div className="p-md md:max-w-5xl md:mx-auto">
        <Link to="/financeiro/cartoes" className="text-label text-fg-muted">← Cartões</Link>
        <p className="text-fg-muted mt-4">{cardsQ.isLoading ? 'Carregando…' : 'Cartão não encontrado.'}</p>
      </div>
    );
  }

  const pct = usage.data ? Math.round(usage.data.pct * 100) : 0;
  const color = card.color || '#820ad1';

  return (
    <div className="flex flex-col gap-md pb-32 md:pb-md">
      <header>
        <Link to="/financeiro/cartoes" className="text-label text-fg-muted">← Cartões</Link>
        <h1 className="text-xl font-bold text-fg">{card.name}</h1>
      </header>

      {/* Cartão herói */}
      <div className="rounded-lg p-md text-white shadow-soft" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <div className="flex justify-between text-body-sm opacity-90">
          <span>{card.name}</span><span>{(card.brand || '').toUpperCase()}</span>
        </div>
        <div className="mt-4 text-body-sm opacity-90">Fatura de {mesDaCompetencia(comp ?? '')}</div>
        <div className="text-3xl font-bold">{fmtBRL(inv.data?.total ?? 0)}</div>
        <div className="mt-3 h-2 rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-label opacity-90">
          <span>{fmtBRL(usage.data?.used ?? 0)} de {fmtBRL(card.credit_limit)} · {pct}%</span>
          <span>livre {fmtBRL(usage.data?.available ?? card.credit_limit)}</span>
        </div>
      </div>

      {/* Fecha / Vence */}
      <div className="grid grid-cols-2 gap-md">
        <div className="rounded-md border border-border bg-bg-surface p-3">
          <div className="text-label text-fg-muted">Fecha dia</div>
          <div className="font-semibold text-fg">{card.closing_day}</div>
        </div>
        <div className="rounded-md border border-border bg-bg-surface p-3">
          <div className="text-label text-fg-muted">Vence dia</div>
          <div className="font-semibold text-fg">{card.due_day}</div>
        </div>
      </div>

      {/* Fatura */}
      <div className="flex items-center justify-between mt-2">
        <h2 className="text-label uppercase tracking-wide text-fg-muted font-bold">Fatura de {mesDaCompetencia(comp ?? '')}</h2>
        {inv.data && inv.data.paid > 0 && !inv.data.isPaid && (
          <span className="text-label text-fg-muted">pago {fmtBRL(inv.data.paid)}</span>
        )}
      </div>

      {inv.data && inv.data.items.length === 0 && (
        <p className="text-fg-muted text-body-sm">Sem lançamentos nesta fatura.</p>
      )}
      <div className="flex flex-col gap-2">
        {inv.data?.items.map((it) => <ItemRow key={it.id} it={it} />)}
      </div>

      {inv.data && inv.data.total > 0 && (
        <div className="mt-2">
          <div className="flex justify-between items-center mb-3">
            <span className="text-fg-muted">Total da fatura</span>
            <span className="text-xl font-bold text-fg">{fmtBRL(inv.data.total)}</span>
          </div>
          <Button variant="primary" fullWidth onClick={() => setPaying(true)} disabled={inv.data.isPaid}>
            {inv.data.isPaid ? 'Fatura quitada ✓' : 'Pagar fatura'}
          </Button>
        </div>
      )}

      <PagarSheet open={paying} onClose={() => setPaying(false)} cardId={card.id} />
    </div>
  );
}
