import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fab } from '../../components/Fab';
import { useBills, useCategoryLookup, useFinanceiroAuth, usePayBill } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { deriveBillStatus } from '../../lib/financeiro';
import type { BillStatus, PfBill } from '../../lib/financeiro';
import { BillSheet } from './components/BillSheet';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function badgeFor(status: BillStatus): { label: string; cls: string } {
  if (status === 'paga') return { label: 'paga', cls: 'bg-success/10 text-success border-success/30' };
  if (status === 'atrasada') return { label: 'atrasada', cls: 'bg-danger/10 text-danger border-danger/30' };
  // a-vencer
  return { label: 'a vencer', cls: 'bg-amber-500/10 text-amber-500 border-amber-500/30' };
}

function BillRow({ bill, onPay, onEdit }: { bill: PfBill; onPay: (b: PfBill) => void; onEdit: (b: PfBill) => void }) {
  const status = deriveBillStatus(bill);
  const b = badgeFor(status);
  const catLookup = useCategoryLookup();
  return (
    <li className="px-md py-2.5 flex items-center justify-between gap-3">
      {/* Área clicável para editar (nome + badge + dia) */}
      <button
        type="button"
        onClick={() => onEdit(bill)}
        className="flex items-center gap-3 min-w-0 flex-1 text-left focus-ring rounded"
      >
        <span aria-hidden className="text-base shrink-0">{catLookup.emoji(bill.category)}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-body-md text-fg">{bill.name}</span>
            <span className={`inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${b.cls}`}>
              {b.label}
            </span>
          </div>
          <div className="text-body-sm text-fg-muted tabular-nums">Dia {bill.due_day}</div>
        </div>
      </button>
      {/* Valor + botão Pagar (não propaga para editar) */}
      <div className="flex items-center gap-3 shrink-0">
        <span className={`text-body-md tabular-nums font-semibold ${bill.type === 'income' ? 'text-success' : 'text-fg'}`}>
          R$ {brl(Number(bill.amount))}
        </span>
        {status !== 'paga' && bill.type === 'expense' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPay(bill); }}
            className="text-body-sm text-tom hover:underline focus-ring rounded"
          >
            Marcar paga
          </button>
        )}
      </div>
    </li>
  );
}

export function ContasFixasPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_bills', 'pf_transactions'], cid);

  const billsQ = useBills();
  const payMut = usePayBill();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PfBill | null>(null);

  const { aPagar, aReceber } = useMemo(() => {
    const list = billsQ.data ?? [];
    return {
      aPagar: list.filter((b) => b.type === 'expense'),
      aReceber: list.filter((b) => b.type === 'income'),
    };
  }, [billsQ.data]);

  async function pay(bill: PfBill) {
    if (!confirm(`Marcar "${bill.name}" como paga (R$${brl(Number(bill.amount))})?`)) return;
    try { await payMut.mutateAsync(bill); } catch (e) { alert((e as Error).message); }
  }

  const empty = !billsQ.isLoading && (billsQ.data?.length ?? 0) === 0;

  return (
    <div className="flex flex-col gap-md pb-32 md:pb-md">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title">Contas fixas</h2>
        <button
          type="button"
          onClick={() => navigate('/financeiro')}
          className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded"
        >
          ← Voltar
        </button>
      </header>

      {empty && (
        <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
          <div className="text-[44px] leading-none mb-2" aria-hidden>🧾</div>
          <p className="text-body-md text-fg mb-1">Nenhuma conta fixa cadastrada.</p>
          <p className="text-body-sm text-fg-muted mb-md max-w-md mx-auto">
            Cadastra pelo + ou manda um zap: <em>"cadastra conta Netflix de 40 reais dia 2"</em>. O TOM lembra antes de vencer.
          </p>
        </section>
      )}

      {aPagar.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
          <header className="px-md pt-md pb-2 flex items-baseline justify-between">
            <h3 className="text-label text-fg-muted uppercase tracking-wide">A pagar</h3>
            <span className="text-body-sm text-fg-muted tabular-nums">{aPagar.length}</span>
          </header>
          <ul className="divide-y divide-border">
            {aPagar.map((b) => <BillRow key={b.id} bill={b} onPay={pay} onEdit={setEditing} />)}
          </ul>
        </section>
      )}

      {aReceber.length > 0 && (
        <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
          <header className="px-md pt-md pb-2 flex items-baseline justify-between">
            <h3 className="text-label text-fg-muted uppercase tracking-wide">A receber</h3>
            <span className="text-body-sm text-fg-muted tabular-nums">{aReceber.length}</span>
          </header>
          <ul className="divide-y divide-border">
            {aReceber.map((b) => <BillRow key={b.id} bill={b} onPay={pay} onEdit={setEditing} />)}
          </ul>
        </section>
      )}

      {/* Sheet criar */}
      <BillSheet open={creating} onClose={() => setCreating(false)} />
      {/* Sheet editar */}
      <BillSheet open={!!editing} initial={editing ?? undefined} onClose={() => setEditing(null)} />

      <Fab label="Nova conta" ariaLabel="Cadastrar conta fixa" onClick={() => setCreating(true)} />
    </div>
  );
}
