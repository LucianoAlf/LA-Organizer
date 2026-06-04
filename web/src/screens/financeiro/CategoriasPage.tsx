import { Link } from 'react-router-dom';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useCategories, useDeactivateCategory, useFinanceiroAuth } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import type { PfCategoryRow } from '../../lib/categorias';

export function CategoriasPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_categories'], cid);
  const catsQ = useCategories();
  const deactivate = useDeactivateCategory();

  const cats = (catsQ.data ?? []).filter((c) => c.is_custom && c.is_active);
  const expenses = cats.filter((c) => c.type === 'expense');
  const incomes = cats.filter((c) => c.type === 'income');

  async function handleDelete(c: PfCategoryRow) {
    if (!cid) return;
    if (!window.confirm(`Remover a categoria "${c.label}"? Lançamentos existentes continuam com o rótulo histórico.`)) return;
    await deactivate.mutateAsync(c.id);
  }

  function CatList({ items }: { items: PfCategoryRow[] }) {
    if (items.length === 0) {
      return <p className="text-body-sm text-fg-muted">Nenhuma categoria personalizada ainda.</p>;
    }
    return (
      <ul className="flex flex-col gap-2">
        {items.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg bg-bg-elevated border border-border px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl shrink-0" aria-hidden>{c.emoji}</span>
              <span className="text-body-md text-fg truncate">{c.label}</span>
            </div>
            <button
              type="button"
              onClick={() => handleDelete(c)}
              aria-label={`Remover ${c.label}`}
              disabled={deactivate.isPending}
              className="shrink-0 h-8 w-8 grid place-items-center rounded-md text-fg-muted hover:text-danger hover:bg-danger/10 focus-ring disabled:opacity-50 transition-colors"
            >
              <Trash2 size={16} />
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-md pb-32 md:pb-md px-md pt-md">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/financeiro"
          className="h-9 w-9 grid place-items-center rounded-md text-fg-muted hover:bg-bg-elevated focus-ring"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-card-title text-fg">Categorias personalizadas</h1>
      </div>

      <p className="text-body-sm text-fg-muted">
        Apenas suas categorias criadas aqui. As categorias padrão do app não podem ser removidas.
      </p>

      {catsQ.isLoading && <p className="text-body-sm text-fg-muted">Carregando…</p>}
      {catsQ.isError && <p className="text-body-sm text-danger">Erro ao carregar categorias.</p>}

      {!catsQ.isLoading && (
        <>
          <section className="flex flex-col gap-3">
            <h2 className="text-body-md font-semibold text-fg">Despesas</h2>
            <CatList items={expenses} />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="text-body-md font-semibold text-fg">Receitas</h2>
            <CatList items={incomes} />
          </section>
        </>
      )}
    </div>
  );
}
