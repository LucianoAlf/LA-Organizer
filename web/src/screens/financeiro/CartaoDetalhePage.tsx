// Detalhe do cartão: cartão "herói" + fatura corrente + pagar fatura (parcial/total).
import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { BottomSheet } from '../../components/BottomSheet';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { Button } from '../../components/Button';
import {
  useCards, useCardUsage, useCardInvoice, useAccounts, useFinanceiroAuth,
  useCreateCardPurchase, useDeactivateCard, useDeleteTransaction, useCancelInvoicePayment, useClosedUnpaidInvoices,
} from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { addMonthsToCompetencia, currentCompetencia, dueLabelForCompetencia, mesDaCompetencia, cardTileSummary, type CardInvoiceItem } from '../../lib/cartoes';
import type { PfTransaction } from '../../lib/financeiro';
import { CartaoSheet } from './components/CartaoSheet';
import { PagarFaturaSheet } from './components/PagarFaturaSheet';
import { TransactionSheet } from './components/TransactionSheet';

const fmtBRL = (v: number) =>
  'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CAT_ICON: Record<string, string> = {
  moradia: '🏠', alimentacao: '🍔', transporte: '⛽', saude: '💊',
  educacao: '📚', lazer: '🎬', salario: '💼', comissao: '💰', extra: '✨', outros: '🗂️',
};

function ItemRow({ it, onEdit, onDelete }: {
  it: CardInvoiceItem; onEdit: (it: CardInvoiceItem) => void; onDelete: (it: CardInvoiceItem) => void;
}) {
  const parc = it.installments_total && it.installments_total > 1
    ? ` (${it.installment_no}/${it.installments_total})` : '';
  return (
    <div className="flex items-center gap-1 p-1 pr-2 rounded-md bg-bg-surface border border-border">
      <button type="button" onClick={() => onEdit(it)} aria-label="Editar lançamento"
        className="flex items-center gap-3 flex-1 min-w-0 text-left p-2 rounded-md hover:bg-bg-elevated/60 focus-ring">
        <span className="w-7 h-7 rounded-md bg-bg-elevated flex items-center justify-center text-sm shrink-0">
          {CAT_ICON[it.category] ?? '🗂️'}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-fg font-medium truncate">{(it.description || 'Compra') + parc}</div>
          <div className="text-label text-fg-muted">{it.category} · {it.transaction_date.slice(8, 10)}/{it.transaction_date.slice(5, 7)}</div>
        </div>
        <div className="font-semibold text-fg">{fmtBRL(it.amount)}</div>
      </button>
      <button type="button" onClick={() => onDelete(it)} aria-label="Apagar lançamento"
        className="shrink-0 h-8 w-8 grid place-items-center rounded-md text-fg-muted hover:text-danger hover:bg-danger/10 focus-ring">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

// PagarSheet extraído → components/PagarFaturaSheet.tsx (reusado na tela Contas a pagar / Faturas de cartão).

// Ajustar fatura: espelho do "Saldo atual" da carteira. O usuário diz quanto está a fatura
// hoje e o engine lança a DIFERENÇA como "Ajuste de fatura" na competência corrente.
function AjustarFaturaSheet({ open, onClose, cardId }: { open: boolean; onClose: () => void; cardId: string }) {
  const cardsQ = useCards();
  const card = cardsQ.data?.find((c) => c.id === cardId);
  const comp = card ? currentCompetencia(card) : undefined;
  const inv = useCardInvoice(cardId, comp);
  const createPurchase = useCreateCardPurchase();
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const current = inv.data?.total ?? 0;
  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  async function submit() {
    setError(null);
    if (!card) return;
    const alvo = Number(String(target).replace(',', '.'));
    if (!isFinite(alvo) || alvo < 0) { setError('Informe um valor válido.'); return; }
    const delta = Math.round((alvo - current) * 100) / 100;
    if (delta === 0) { onClose(); return; }
    if (delta < 0) { setError('Pra reduzir a fatura, apague um lançamento dela — aqui eu só somo a diferença.'); return; }
    try {
      await createPurchase.mutateAsync({
        cardId: card.id, closingDay: card.closing_day, amount: delta,
        category: 'outros', description: 'Ajuste de fatura', installments: 1,
      });
      setTarget('');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Ajustar fatura">
      <div className="flex flex-col gap-md">
        <p className="text-fg-muted text-body-sm">Fatura atual no app: <b className="text-fg">{fmtBRL(current)}</b></p>
        <Field label="Quanto está sua fatura hoje? (R$)" sub="Eu lanço a diferença como “Ajuste de fatura” na fatura deste mês.">
          <input className={inputCls} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="900,00" />
        </Field>
        {error && <p className="text-body-sm text-danger">{error}</p>}
        <Button variant="primary" fullWidth loading={createPurchase.isPending} onClick={submit}>
          Ajustar fatura
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
  // Navegação entre competências: offset em meses a partir da fatura ATUAL a pagar.
  const [compOffset, setCompOffset] = useState(0);
  // baseComp = a fatura que você paga a seguir (fechada não paga > aberta vazia) — MESMA fonte do
  // tile (cardTileSummary), pra o detalhe abrir na fatura que a lista mostra (Rose 12/07).
  const closedQ = useClosedUnpaidInvoices();
  const myClosed = (closedQ.data ?? []).filter((i) => i.card.id === id).map((i) => ({ competencia: i.competencia, remaining: i.remaining }));
  const baseComp = card ? cardTileSummary(card, myClosed).competencia : undefined;
  const comp = baseComp ? addMonthsToCompetencia(baseComp, compOffset) : undefined;
  const inv = useCardInvoice(id, comp);
  const [paying, setPaying] = useState(false);
  const [ajustando, setAjustando] = useState(false);
  const [editando, setEditando] = useState(false);
  const [editItem, setEditItem] = useState<PfTransaction | null>(null);
  const navigate = useNavigate();
  const deactivateCard = useDeactivateCard();
  const deleteTxn = useDeleteTransaction();
  const cancelPay = useCancelInvoicePayment();

  async function excluirCartao() {
    if (!card) return;
    if (!confirm(`Excluir o cartão "${card.name}"? Os lançamentos já feitos continuam no histórico.`)) return;
    await deactivateCard.mutateAsync(card.id);
    navigate('/financeiro/cartoes');
  }
  function editarItem(it: CardInvoiceItem) {
    if (!card) return;
    // Compra de cartão: TransactionSheet trava valor/parcelas (card_id setado), libera categoria/descrição/data.
    setEditItem({
      id: it.id, type: 'expense', category: it.category, amount: it.amount,
      description: it.description, transaction_date: it.transaction_date,
      account_id: null, card_id: card.id,
    });
  }
  async function apagarItem(it: CardInvoiceItem) {
    const aviso = it.installments_total && it.installments_total > 1
      ? `Apagar a parcela ${it.installment_no}/${it.installments_total} de "${it.description || 'Compra'}"? (só esta parcela)`
      : `Apagar "${it.description || 'Compra'}" (${fmtBRL(it.amount)}) desta fatura?`;
    if (!confirm(aviso)) return;
    await deleteTxn.mutateAsync(it.id);
  }
  async function estornarPagamento() {
    if (!card || !comp || !inv.data) return;
    if (!confirm(`Estornar o pagamento de ${fmtBRL(inv.data.paid)} da fatura de ${mesDaCompetencia(comp)}? A fatura volta pra "em aberto" e o valor volta pra conta de origem.`)) return;
    await cancelPay.mutateAsync({ cardId: card.id, competencia: comp });
  }

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
      <header className="flex items-start justify-between gap-3">
        <div>
          <Link to="/financeiro/cartoes" className="text-label text-fg-muted">← Cartões</Link>
          <h1 className="text-xl font-bold text-fg">{card.name}</h1>
        </div>
        <button type="button" onClick={() => setEditando(true)} aria-label="Editar cartão"
          className="h-9 w-9 grid place-items-center rounded-md text-fg-muted hover:bg-bg-elevated focus-ring">
          <Pencil size={18} />
        </button>
      </header>

      {/* Cartão herói — toque abre edição (limite/fechamento/vencimento/nome/bandeira) */}
      <button type="button" onClick={() => setEditando(true)} aria-label="Editar cartão"
        className="block w-full text-left rounded-lg p-md text-white shadow-soft focus-ring active:scale-[0.99] transition-transform"
        style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
        <div className="flex justify-between text-body-sm opacity-90">
          <span>{card.name}</span><span>{(card.brand || '').toUpperCase()}</span>
        </div>
        <div className="mt-4 text-body-sm opacity-90">
          Fatura de {mesDaCompetencia(comp ?? '')}
          {comp ? ` · vence ${dueLabelForCompetencia(comp, card.closing_day, card.due_day)}` : ''}
        </div>
        <div className="text-3xl font-bold">{fmtBRL(inv.data?.total ?? 0)}</div>
        <div className="mt-3 h-2 rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <div className="flex justify-between mt-1 text-label opacity-90">
          <span>{fmtBRL(usage.data?.used ?? 0)} de {fmtBRL(card.credit_limit)} · {pct}%</span>
          <span>livre {fmtBRL(usage.data?.available ?? card.credit_limit)}</span>
        </div>
      </button>

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

      {/* Fatura — navegação entre competências (parcelas passadas/futuras) */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setCompOffset((o) => o - 1)} aria-label="Fatura anterior"
            className="h-7 w-7 grid place-items-center rounded-md text-fg-muted hover:bg-bg-elevated focus-ring">
            <ChevronLeft size={16} />
          </button>
          <h2 className="text-label uppercase tracking-wide text-fg-muted font-bold">
            Fatura de {mesDaCompetencia(comp ?? '')}
            {comp && baseComp && comp.slice(0, 4) !== baseComp.slice(0, 4) ? `/${comp.slice(0, 4)}` : ''}
          </h2>
          <button type="button" onClick={() => setCompOffset((o) => o + 1)} aria-label="Próxima fatura"
            className="h-7 w-7 grid place-items-center rounded-md text-fg-muted hover:bg-bg-elevated focus-ring">
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {compOffset !== 0 && (
            <button type="button" onClick={() => setCompOffset(0)}
              className="text-label text-tom hover:underline focus-ring rounded">
              fatura atual
            </button>
          )}
          {inv.data && inv.data.paid > 0 && !inv.data.isPaid && (
            <span className="text-label text-fg-muted">pago {fmtBRL(inv.data.paid)}</span>
          )}
        </div>
      </div>

      {inv.data && inv.data.items.length === 0 && (
        <p className="text-fg-muted text-body-sm">Sem lançamentos nesta fatura.</p>
      )}
      <div className="flex flex-col gap-2">
        {inv.data?.items.map((it) => <ItemRow key={it.id} it={it} onEdit={editarItem} onDelete={apagarItem} />)}
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

      {inv.data && inv.data.paid > 0 && (
        <Button variant="ghost" fullWidth onClick={estornarPagamento} loading={cancelPay.isPending}>
          <span className="text-danger">↩︎ Estornar pagamento ({fmtBRL(inv.data.paid)})</span>
        </Button>
      )}

      {/* "Ajustar fatura" só na fatura ABERTA (o ajuste lança na competência corrente); some ao
          ver a fechada (evita ajustar agosto vendo julho). */}
      {comp && comp === currentCompetencia(card) && (
        <Button variant="secondary" fullWidth onClick={() => setAjustando(true)}>
          Ajustar fatura
        </Button>
      )}

      <Button variant="ghost" fullWidth onClick={excluirCartao} loading={deactivateCard.isPending}>
        <span className="text-danger">Excluir cartão</span>
      </Button>

      <PagarFaturaSheet open={paying} onClose={() => setPaying(false)} cardId={card.id} competencia={comp} />
      <AjustarFaturaSheet open={ajustando} onClose={() => setAjustando(false)} cardId={card.id} />
      <CartaoSheet open={editando} onClose={() => setEditando(false)} card={card} />
      <TransactionSheet open={!!editItem} onClose={() => setEditItem(null)} initial={editItem ?? undefined} cardName={card.name} />
    </div>
  );
}
