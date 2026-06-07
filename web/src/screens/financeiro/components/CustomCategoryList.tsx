import { Trash2 } from 'lucide-react';
import { useCategories, useDeactivateCategory } from '../../../hooks/useFinanceiro';
import type { PfCategoryRow } from '../../../lib/categorias';

// Lista + exclusão das categorias PERSONALIZADAS de um tipo. Reutilizado pela CategoriasPage
// (página de gerenciamento) e pelo NovaCategoriaSheet (gerenciar no seletor do lançamento).
export function CustomCategoryList({ type }: { type: 'expense' | 'income' }) {
  const catsQ = useCategories();
  const deactivate = useDeactivateCategory();
  const items = (catsQ.data ?? []).filter((c) => c.is_custom && c.is_active && c.type === type);

  async function handleDelete(c: PfCategoryRow) {
    if (!window.confirm(`Remover a categoria "${c.label}"? Lançamentos existentes continuam com o rótulo histórico.`)) return;
    await deactivate.mutateAsync(c.id);
  }

  if (catsQ.isLoading) return <p className="text-body-sm text-fg-muted">Carregando…</p>;
  if (catsQ.isError) return <p className="text-body-sm text-danger">Erro ao carregar categorias.</p>;
  if (items.length === 0) {
    return <p className="text-body-sm text-fg-muted">Nenhuma categoria personalizada de {type === 'income' ? 'receita' : 'despesa'} ainda.</p>;
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
