import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Fab } from '../../components/Fab';
import { Tabs } from '../../components/Tabs';
import { useBills, useBillOverrides, useCategoryLookup, useClosedUnpaidInvoices, useClosedPaidInvoices, useInvoicesByCompetencia, useFinanceiroAuth } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { deriveBillStatus, groupExpenseBillsByStatus, resolveBillsForMonth } from '../../lib/financeiro';
import type { BillStatus, PfBill } from '../../lib/financeiro';
import { mesDaCompetencia, type ClosedInvoice } from '../../lib/cartoes';
import { BillSheet } from './components/BillSheet';
import { PagarContaSheet } from './components/PagarContaSheet';
import { PagarFaturaSheet } from './components/PagarFaturaSheet';
import { AjustarValorMesSheet } from './components/AjustarValorMesSheet';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
// YYYY-MM local (sem UTC shift no fim do mês após 21h BRT).
function localYm(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
}
function ymToCompetencia(ym: string): string { return `${ym}-01`; }
function ymLabel(ym: string): string { const [y, m] = ym.split('-').map(Number); return `${PT_MONTHS[m - 1]} ${y}`; }

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
        {status !== 'paga' && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPay(bill); }}
            className="text-body-sm text-tom hover:underline focus-ring rounded"
          >
            {bill.type === 'income' ? 'Marcar recebido' : 'Marcar paga'}
          </button>
        )}
      </div>
    </li>
  );
}

type TabId = 'todas' | 'apagar';

const TABS: { id: TabId; label: string }[] = [
  { id: 'todas', label: 'Todas' },
  { id: 'apagar', label: 'A pagar' },
];

/**
 * Faturas de cartão JÁ PAGAS. Existe porque, até 13/08/2026, fatura quitada não aparecia em
 * lugar nenhum: saía da lista "a pagar" (certo) e a seção "✅ Pagas" só listava contas fixas.
 * A Rose pagou o Itaú às 20:56 e às 20:57 avisou que a fatura tinha sumido — e tinha mesmo.
 *
 * Some sem deixar rastro é indistinguível de "perdi meu dinheiro".
 */
function FaturasPagasSection({ invoices }: { invoices: ClosedInvoice[] }) {
  if (invoices.length === 0) return null;
  const total = invoices.reduce((s, i) => s + i.paid, 0);
  return (
    <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
      <header className="px-md pt-md pb-2 flex items-baseline justify-between">
        <h3 className="text-label text-fg-muted uppercase tracking-wide">✅ Faturas pagas</h3>
        <span className="text-body-sm text-fg-muted tabular-nums">{invoices.length} · R$ {brl(total)}</span>
      </header>
      <ul className="divide-y divide-border">
        {invoices.map((inv) => (
          <li key={`${inv.card.id}-${inv.competencia}`} className="px-md py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-body-md text-fg truncate">{inv.card.name}</p>
              <p className="text-body-sm text-fg-muted">fatura {mesDaCompetencia(inv.competencia)} · quitada</p>
            </div>
            <span className="text-body-md font-semibold text-fg tabular-nums shrink-0">R$ {brl(inv.paid)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function FaturasSection({ invoices, onPay }: { invoices: ClosedInvoice[]; onPay: (inv: ClosedInvoice) => void }) {
  if (invoices.length === 0) return null;
  const total = invoices.reduce((s, i) => s + i.remaining, 0);
  return (
    <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
      <header className="px-md pt-md pb-2 flex items-baseline justify-between">
        <h3 className="text-label text-fg-muted uppercase tracking-wide">💳 Faturas de cartão</h3>
        <span className="text-body-sm text-fg-muted tabular-nums">{invoices.length} · R$ {brl(total)}</span>
      </header>
      <ul className="divide-y divide-border">
        {invoices.map((inv) => (
          <li key={inv.card.id + inv.competencia} className="px-md py-2.5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span aria-hidden className="text-base shrink-0">💳</span>
              <div className="min-w-0">
                <div className="text-body-md text-fg truncate">{inv.card.name}</div>
                <div className="text-body-sm text-fg-muted tabular-nums">
                  fatura {mesDaCompetencia(inv.competencia)} · vence dia {inv.card.due_day}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-body-md tabular-nums font-semibold text-fg">R$ {brl(inv.remaining)}</span>
              <button
                type="button"
                onClick={() => onPay(inv)}
                className="text-body-sm text-tom hover:underline focus-ring rounded"
              >
                Pagar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Lista de PREVISÃO de um mês. As contas (onAdjust) viram clicáveis pra ajustar o valor SÓ daquele
// mês (override). Faturas de cartão (sem onAdjust) seguem só-leitura — são derivadas das compras.
function PrevisaoSection({ title, items, adjustedIds, onAdjust }: {
  title: string;
  items: { key: string; emoji: string; name: string; sub: string; amount: number }[];
  adjustedIds?: Set<string>;
  onAdjust?: (billId: string) => void;
}) {
  if (items.length === 0) return null;
  const total = items.reduce((s, i) => s + i.amount, 0);
  return (
    <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
      <header className="px-md pt-md pb-2 flex items-baseline justify-between">
        <h3 className="text-label text-fg-muted uppercase tracking-wide">{title}</h3>
        <span className="text-body-sm text-fg-muted tabular-nums">{items.length} · R$ {brl(total)}</span>
      </header>
      <ul className="divide-y divide-border">
        {items.map((it) => {
          const ajustado = !!adjustedIds?.has(it.key);
          const body = (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <span aria-hidden className="text-base shrink-0">{it.emoji}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-body-md text-fg truncate">{it.name}</span>
                    {ajustado && (
                      <span className="inline-flex items-center text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border bg-tom/10 text-tom border-tom/30">ajustado</span>
                    )}
                  </div>
                  <div className="text-body-sm text-fg-muted tabular-nums">{it.sub}</div>
                </div>
              </div>
              <span className="text-body-md tabular-nums font-semibold text-fg">R$ {brl(it.amount)}</span>
            </>
          );
          return onAdjust ? (
            <li key={it.key}>
              <button
                type="button"
                onClick={() => onAdjust(it.key)}
                className="w-full px-md py-2.5 flex items-center justify-between gap-3 text-left hover:bg-bg-elevated focus-ring"
              >
                {body}
              </button>
            </li>
          ) : (
            <li key={it.key} className="px-md py-2.5 flex items-center justify-between gap-3">
              {body}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function BillSection({ title, bills, onPay, onEdit }: {
  title: string;
  bills: PfBill[];
  onPay: (b: PfBill) => void;
  onEdit: (b: PfBill) => void;
}) {
  if (bills.length === 0) return null;
  const total = bills.reduce((s, b) => s + Number(b.amount), 0);
  return (
    <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
      <header className="px-md pt-md pb-2 flex items-baseline justify-between">
        <h3 className="text-label text-fg-muted uppercase tracking-wide">{title}</h3>
        <span className="text-body-sm text-fg-muted tabular-nums">{bills.length} · R$ {brl(total)}</span>
      </header>
      <ul className="divide-y divide-border">
        {bills.map((b) => <BillRow key={b.id} bill={b} onPay={onPay} onEdit={onEdit} />)}
      </ul>
    </section>
  );
}

// Referência estável p/ o fallback de overrides (evita recomputar os useMemo a cada render).
const EMPTY_OVERRIDES: Record<string, { amount: number }> = {};

export function ContasFixasPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_bills', 'pf_transactions', 'pf_card_payments', 'pf_bill_overrides'], cid);

  const monthNow = localYm();
  const [monthYear, setMonthYear] = useState(monthNow);
  const isCurrentMonth = monthYear === monthNow;

  const billsQ = useBills();
  const invoicesQ = useClosedUnpaidInvoices();
  const invoicesPagasQ = useClosedPaidInvoices();
  const prevInvoicesQ = useInvoicesByCompetencia(isCurrentMonth ? undefined : ymToCompetencia(monthYear));
  // Overrides de valor da competência EXIBIDA (mês corrente OU o navegado). 0 overrides => valor base.
  const overridesQ = useBillOverrides(ymToCompetencia(monthYear));
  const overrides = overridesQ.data ?? EMPTY_OVERRIDES;
  const catLookup = useCategoryLookup();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PfBill | null>(null);
  const [payingBill, setPayingBill] = useState<PfBill | null>(null);
  const [payingInvoice, setPayingInvoice] = useState<{ cardId: string; competencia: string } | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('todas');
  const [adjusting, setAdjusting] = useState<{ bill: PfBill; override: number | null } | null>(null);
  // ids com override no mês exibido (pra badge "ajustado").
  const adjustedIds = useMemo(() => new Set(Object.keys(overrides)), [overrides]);
  function onAdjust(billId: string) {
    const bill = (billsQ.data ?? []).find((b) => b.id === billId); // bill CRUA = valor base
    if (!bill) return;
    const ov = overrides[billId];
    setAdjusting({ bill, override: ov ? Number(ov.amount) : null });
  }

  const { groups, aReceber } = useMemo(() => {
    // Resolve o valor de cada conta pela competência exibida (override ?? base) numa fonte só.
    const list = resolveBillsForMonth(billsQ.data ?? [], overrides);
    return {
      groups: groupExpenseBillsByStatus(list),
      aReceber: list.filter((b) => b.type === 'income'),
    };
  }, [billsQ.data, overrides]);

  const faturas = invoicesQ.data ?? [];
  const faturasPagas = invoicesPagasQ.data ?? [];
  const faturasTotal = faturas.reduce((s, i) => s + i.remaining, 0);

  // Previsão de OUTRO mês: contas que se aplicam (recorrentes + únicas que vencem nele)
  // + faturas daquela competência. Total = bruto do mês (planejamento).
  const billsDoMes = useMemo(() => {
    const list = (billsQ.data ?? []).filter((b) => b.type === 'expense')
      .filter((b) => b.recurrence === 'monthly' || (b.recurrence === 'once' && (b.due_date ?? '').slice(0, 7) === monthYear));
    return resolveBillsForMonth(list, overrides);
  }, [billsQ.data, monthYear, overrides]);
  const faturasDoMes = prevInvoicesQ.data ?? [];
  const totalPrevisto = billsDoMes.reduce((s, b) => s + Number(b.amount), 0) + faturasDoMes.reduce((s, f) => s + f.total, 0);

  function pay(bill: PfBill) {
    setPayingBill(bill);
  }
  function payInvoice(inv: ClosedInvoice) {
    setPayingInvoice({ cardId: inv.card.id, competencia: inv.competencia });
  }

  const empty = !billsQ.isLoading && (billsQ.data?.length ?? 0) === 0;

  const totalAPagar = groups.atrasadas.length + groups.aVencer.length + faturas.length;

  const tabs = TABS.map((t) => ({
    ...t,
    badge: t.id === 'apagar' && totalAPagar > 0 ? totalAPagar : undefined,
  }));

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

      {/* Stepper de mês — navega a previsão pra frente/trás (Sug Rose 5b+) */}
      <div className="flex items-center justify-between rounded-lg border border-border bg-bg-surface px-md py-2">
        <button type="button" onClick={() => setMonthYear((m) => shiftMonth(m, -1))} aria-label="Mês anterior"
          className="w-8 h-8 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring">‹</button>
        <span className="text-body-md text-fg font-semibold tabular-nums">
          {ymLabel(monthYear)}{isCurrentMonth ? ' · este mês' : ''}
        </span>
        <button type="button" onClick={() => setMonthYear((m) => shiftMonth(m, 1))} aria-label="Próximo mês"
          className="w-8 h-8 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring">›</button>
      </div>

      {!isCurrentMonth ? (
        <>
          {/* Previsão do mês — total bruto (contas + faturas da competência) */}
          <section className="rounded-lg border border-border bg-bg-surface px-md py-3 flex items-baseline justify-between">
            <span className="text-body-sm text-fg-muted">Total previsto · {ymLabel(monthYear)}</span>
            <span className="text-body-lg font-bold text-fg tabular-nums">R$ {brl(totalPrevisto)}</span>
          </section>
          <PrevisaoSection
            title="Contas do mês"
            items={billsDoMes.map((b) => ({ key: b.id, emoji: catLookup.emoji(b.category), name: b.name, sub: `Dia ${b.due_day}`, amount: Number(b.amount) }))}
            adjustedIds={adjustedIds}
            onAdjust={onAdjust}
          />
          <PrevisaoSection
            title="💳 Faturas de cartão"
            items={faturasDoMes.map((f) => ({ key: f.card.id + f.competencia, emoji: '💳', name: f.card.name, sub: `vence dia ${f.card.due_day}`, amount: f.total }))}
          />
          {billsDoMes.length === 0 && faturasDoMes.length === 0 && (
            <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
              <div className="text-[44px] leading-none mb-2" aria-hidden>🗓️</div>
              <p className="text-body-md text-fg mb-1">Nada previsto pra {ymLabel(monthYear)}.</p>
              <p className="text-body-sm text-fg-muted">Sem contas ou faturas caindo nesse mês.</p>
            </section>
          )}
        </>
      ) : (
        <>
          <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} />

          {empty && (
            <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
              <div className="text-[44px] leading-none mb-2" aria-hidden>🧾</div>
              <p className="text-body-md text-fg mb-1">Nenhuma conta fixa cadastrada.</p>
              <p className="text-body-sm text-fg-muted mb-md max-w-md mx-auto">
                Cadastra pelo + ou manda um zap: <em>"cadastra conta Netflix de 40 reais dia 2"</em>. O TOM lembra antes de vencer.
              </p>
            </section>
          )}

          {activeTab === 'todas' && (
            <>
              <BillSection title="🔴 Atrasadas" bills={groups.atrasadas} onPay={pay} onEdit={setEditing} />
              <BillSection title="🟡 A vencer" bills={groups.aVencer} onPay={pay} onEdit={setEditing} />
              <FaturasSection invoices={faturas} onPay={payInvoice} />
              <BillSection title="✅ Pagas" bills={groups.pagas} onPay={pay} onEdit={setEditing} />
              <FaturasPagasSection invoices={faturasPagas} />
              <BillSection title="A receber" bills={aReceber} onPay={pay} onEdit={setEditing} />
            </>
          )}

          {activeTab === 'apagar' && (
            <>
              {(groups.atrasadas.length > 0 || groups.aVencer.length > 0 || faturas.length > 0) && (
                <section className="rounded-lg border border-border bg-bg-surface px-md py-3 flex items-baseline justify-between">
                  <span className="text-body-sm text-fg-muted">Total a pagar</span>
                  <span className="text-body-md font-bold text-fg tabular-nums">
                    R$ {brl([...groups.atrasadas, ...groups.aVencer].reduce((s, b) => s + Number(b.amount), 0) + faturasTotal)}
                  </span>
                </section>
              )}
              {groups.atrasadas.length === 0 && groups.aVencer.length === 0 && faturas.length === 0 && (
                <section className="rounded-lg border border-dashed border-border bg-bg-surface px-md py-lg text-center">
                  <div className="text-[44px] leading-none mb-2" aria-hidden>✅</div>
                  <p className="text-body-md text-fg mb-1">Tudo em dia!</p>
                  <p className="text-body-sm text-fg-muted">Nenhuma conta pendente ou atrasada.</p>
                </section>
              )}
              <BillSection title="🔴 Atrasadas" bills={groups.atrasadas} onPay={pay} onEdit={setEditing} />
              <BillSection title="🟡 A vencer" bills={groups.aVencer} onPay={pay} onEdit={setEditing} />
              <FaturasSection invoices={faturas} onPay={payInvoice} />
            </>
          )}
        </>
      )}

      {/* Sheet criar */}
      <BillSheet open={creating} onClose={() => setCreating(false)} />
      {/* Sheet editar */}
      <BillSheet open={!!editing} initial={editing ?? undefined} onClose={() => setEditing(null)} />
      {/* Sheet pagar */}
      <PagarContaSheet open={!!payingBill} bill={payingBill} onClose={() => setPayingBill(null)} />
      {/* Sheet pagar fatura de cartão */}
      <PagarFaturaSheet
        open={!!payingInvoice}
        cardId={payingInvoice?.cardId ?? ''}
        competencia={payingInvoice?.competencia}
        onClose={() => setPayingInvoice(null)}
      />
      {/* Sheet ajustar valor previsto do mês (override) — só na previsão (meses futuros) */}
      <AjustarValorMesSheet
        open={!!adjusting}
        bill={adjusting?.bill ?? null}
        baseAmount={adjusting ? Number(adjusting.bill.amount) : 0}
        currentOverride={adjusting?.override ?? null}
        competencia={ymToCompetencia(monthYear)}
        mesLabel={ymLabel(monthYear)}
        onClose={() => setAdjusting(null)}
      />

      <Fab label="Nova conta" ariaLabel="Cadastrar conta fixa" onClick={() => setCreating(true)} />
    </div>
  );
}
