import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus } from 'lucide-react';
import { useFinanceiroAuth } from '../../hooks/useFinanceiro';
import { useRealtimeFinance } from '../../hooks/useRealtimeFinance';
import { CustomCategoryList } from './components/CustomCategoryList';
import { NovaCategoriaSheet } from './components/NovaCategoriaSheet';

export function CategoriasPage() {
  const cid = useFinanceiroAuth();
  useRealtimeFinance(['pf_categories'], cid);
  const [novaCat, setNovaCat] = useState<null | 'expense' | 'income'>(null);

  function NewBtn({ type, label }: { type: 'expense' | 'income'; label: string }) {
    return (
      <button
        type="button"
        onClick={() => setNovaCat(type)}
        className="inline-flex items-center gap-1 text-body-sm font-medium text-tom hover:opacity-80 focus-ring rounded px-1.5 py-0.5"
      >
        <Plus size={15} /> {label}
      </button>
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
        Crie e gerencie suas próprias categorias. As padrão do app não podem ser removidas.
        Dica: dá pra criar uma categoria nova na hora de lançar uma transação também.
      </p>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body-md font-semibold text-fg">Despesas</h2>
          <NewBtn type="expense" label="Nova" />
        </div>
        <CustomCategoryList type="expense" />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-body-md font-semibold text-fg">Receitas</h2>
          <NewBtn type="income" label="Nova" />
        </div>
        <CustomCategoryList type="income" />
      </section>

      <NovaCategoriaSheet
        open={novaCat !== null}
        type={novaCat ?? 'expense'}
        showManage={false}
        onClose={() => setNovaCat(null)}
        onCreated={() => setNovaCat(null)}
      />
    </div>
  );
}
