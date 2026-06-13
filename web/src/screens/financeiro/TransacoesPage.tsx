import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CustomSelect } from '../../components/CustomSelect';
import { Fab } from '../../components/Fab';
import { useCategories, useCategoryLookup, useFinanceiroAuth, useTransactions } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import type { PfCategory, PfTransaction, PfTxType } from '../../lib/financeiro';
import { LancamentoSheet } from './components/LancamentoSheet';
import { TransactionSheet } from './components/TransactionSheet';

const PT_MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Item de cartão é bucketizado pela FATURA (competência), não pela data da compra → mostra "fatura mês/ano".
function cashflowLabel(t: PfTransaction): string {
  if (t.card_id && t.competencia) {
    const m = parseInt(t.competencia.slice(5, 7), 10) - 1;
    return `fatura ${PT_MONTHS[m]}/${t.competencia.slice(0, 4)}`;
  }
  return t.transaction_date;
}

function recentMonths(n = 6): { value: string; label: string }[] {
  const now = new Date();
  const arr: { value: string; label: string }[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const value = d.toISOString().slice(0, 7); // YYYY-MM
    arr.push({ value, label: `${PT_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` });
  }
  return arr;
}

const TYPE_FILTERS: { value: string; label: string }[] = [
  { value: '',        label: 'Todos os tipos' },
  { value: 'expense', label: 'Só despesas' },
  { value: 'income',  label: 'Só receitas' },
];

export function TransacoesPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_transactions'], cid);
  const catsQ = useCategories();
  const catLookup = useCategoryLookup();

  const months = useMemo(() => recentMonths(6), []);
  const [monthYear, setMonthYear] = useState<string>(months[0].value);
  const [category, setCategory] = useState<string>(''); // '' = todas
  const [type, setType] = useState<string>('');         // '' = todos
  const [editing, setEditing] = useState<PfTransaction | null>(null);
  const [novoLanc, setNovoLanc] = useState(false);

  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // ?new=1 ao chegar abre o LancamentoSheet (legado: links externos ainda podem usar esse param).
  useEffect(() => {
    if (params.get('new') === '1') {
      setNovoLanc(true);
      const next = new URLSearchParams(params);
      next.delete('new');
      setParams(next, { replace: true });
    }
  }, [params, setParams]);

  const txQ = useTransactions({
    monthYear,
    category: (category || undefined) as PfCategory | undefined,
    type: (type || undefined) as PfTxType | undefined,
  });

  const totalIn = useMemo(
    () => (txQ.data ?? []).filter((t) => t.type === 'income' && !t.is_adjustment).reduce((s, t) => s + Number(t.amount), 0),
    [txQ.data],
  );
  const totalOut = useMemo(
    () => (txQ.data ?? []).filter((t) => t.type === 'expense' && !t.is_adjustment).reduce((s, t) => s + Number(t.amount), 0),
    [txQ.data],
  );

  const monthOptions = months;
  const categoryOptions: { value: string; label: string }[] = [
    { value: '', label: 'Todas as categorias' },
    ...(catsQ.data ?? []).filter((c) => c.is_active).map((c) => ({ value: c.slug, label: `${c.emoji}  ${c.label}` })),
  ];

  return (
    <div className="flex flex-col gap-md pb-32 md:pb-md">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-section-title">Transações</h2>
        <button
          type="button"
          onClick={() => navigate('/financeiro')}
          className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded"
        >
          ← Voltar
        </button>
      </header>

      {/* Resumo da janela filtrada */}
      <section className="rounded-lg border border-border bg-bg-surface px-md py-3 flex items-baseline gap-md tabular-nums">
        <div>
          <div className="text-label text-fg-muted uppercase tracking-wide">Receitas</div>
          <div className="text-body-lg font-semibold text-success">+R$ {brl(totalIn)}</div>
        </div>
        <div>
          <div className="text-label text-fg-muted uppercase tracking-wide">Despesas</div>
          <div className="text-body-lg font-semibold text-danger">−R$ {brl(totalOut)}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-label text-fg-muted uppercase tracking-wide">Resultado</div>
          <div className={`text-body-lg font-semibold ${totalIn - totalOut < 0 ? 'text-danger' : 'text-tom'}`}>
            {totalIn - totalOut < 0 ? '−' : '+'}R$ {brl(Math.abs(totalIn - totalOut))}
          </div>
        </div>
      </section>

      {/* Filtros */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <CustomSelect value={monthYear} options={monthOptions} onChange={setMonthYear} size="sm" />
        <CustomSelect value={category} options={categoryOptions} onChange={setCategory} size="sm" />
        <CustomSelect value={type} options={TYPE_FILTERS} onChange={setType} size="sm" />
      </section>

      {/* Lista */}
      <section className="rounded-lg border border-border bg-bg-surface overflow-hidden">
        {txQ.isLoading ? (
          <div className="px-md py-lg text-center text-body-sm text-fg-muted">Carregando…</div>
        ) : !txQ.data || txQ.data.length === 0 ? (
          <div className="px-md py-lg text-center">
            <div className="text-[36px] leading-none mb-1" aria-hidden>📭</div>
            <p className="text-body-md text-fg">Nada por aqui ainda.</p>
            <p className="text-body-sm text-fg-muted mt-0.5">Registra pelo + ou manda um zap pro TOM.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {txQ.data.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="w-full text-left px-md py-2.5 flex items-center justify-between gap-3 hover:bg-bg-elevated focus-ring transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span aria-hidden className="text-base shrink-0">{catLookup.emoji(t.category)}</span>
                    <div className="min-w-0">
                      <div className="text-body-md text-fg truncate">{t.description || catLookup.label(t.category)}</div>
                      <div className="text-body-sm text-fg-muted tabular-nums">
                        {cashflowLabel(t)} · {catLookup.label(t.category)}
                      </div>
                    </div>
                  </div>
                  <span className={`text-body-md tabular-nums font-semibold shrink-0 ${t.type === 'income' ? 'text-success' : 'text-danger'}`}>
                    {t.type === 'income' ? '+' : '−'}R$ {brl(Number(t.amount))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <LancamentoSheet open={novoLanc} onClose={() => setNovoLanc(false)} />

      <TransactionSheet
        open={!!editing}
        onClose={() => setEditing(null)}
        initial={editing ?? undefined}
      />

      <Fab label="Registrar" ariaLabel="Registrar transação" onClick={() => setNovoLanc(true)} />
    </div>
  );
}
