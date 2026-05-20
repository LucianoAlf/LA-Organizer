import { Badge } from '../../../components/Badge';
import type { ReportProduto } from '../../../lib/lareport-types';

interface Props {
  produto: ReportProduto;
  /** Opcional: abre formulário de edição. Só renderiza o botão se fornecido. */
  onEdit?: () => void;
  /** Opcional: desativa o produto. Só renderiza o botão se fornecido. */
  onDeactivate?: () => void;
}

export function ProdutoCard({ produto, onEdit, onDeactivate }: Props) {
  const tone: 'success' | 'warning' | 'danger' = produto.zerado
    ? 'danger'
    : produto.abaixo_minimo
    ? 'warning'
    : 'success';
  const label = produto.zerado
    ? `Estoque: 0 ⚠`
    : produto.abaixo_minimo
    ? `Estoque: ${produto.estoque_atual} (mín ${produto.estoque_minimo}) ⚠`
    : `Estoque: ${produto.estoque_atual}`;
  return (
    <div className="bg-bg-surface rounded-lg border border-border p-sm flex gap-sm">
      <div className="w-14 h-14 rounded-md bg-bg-app flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
        {produto.foto_url ? (
          <img src={produto.foto_url} alt={produto.nome} className="w-full h-full object-cover" />
        ) : (
          <span>{produto.loja_categorias?.icone || '🛍'}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-fg truncate">{produto.nome}</div>
        {produto.sku && (
          <div className="text-[10px] font-mono text-fg-muted">{produto.sku}</div>
        )}
        <div className="text-body-sm text-fg-muted mt-0.5">
          {produto.custo !== null && `Custo: R$${produto.custo} · `}Venda: R${produto.preco}
        </div>
        <div className="mt-1">
          <Badge tone={tone}>{label}</Badge>
        </div>
        {(onEdit || onDeactivate) && (
          <div className="mt-1.5 flex gap-2">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="text-[11px] text-fg-muted hover:text-tom transition-colors px-1.5 py-0.5 rounded border border-border hover:border-tom"
              >
                ✏️ Editar
              </button>
            )}
            {onDeactivate && (
              <button
                type="button"
                onClick={onDeactivate}
                className="text-[11px] text-fg-muted hover:text-danger transition-colors px-1.5 py-0.5 rounded border border-border hover:border-danger"
              >
                🗑️ Desativar
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end justify-center text-fg font-bold text-lg px-1">
        R${produto.preco}
      </div>
    </div>
  );
}
