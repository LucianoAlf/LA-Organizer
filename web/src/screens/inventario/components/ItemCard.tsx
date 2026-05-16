import { Badge } from '../../../components/Badge';
import type { ReportInventarioItem } from '../../../lib/lareport-types';

interface Props { item: ReportInventarioItem; }

function condicaoTone(c: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (c === 'novo' || c === 'bom') return 'success';
  if (c === 'regular') return 'warning';
  if (c === 'ruim') return 'danger';
  return 'neutral';
}
function statusTone(s: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (s === 'ativo') return 'success';
  if (s === 'manutencao') return 'warning';
  if (s === 'baixa' || s === 'inativo') return 'danger';
  return 'neutral';
}

export function ItemCard({ item }: Props) {
  return (
    <div className="bg-bg-surface rounded-lg border border-border p-sm flex gap-sm">
      <div className="w-14 h-14 rounded-md bg-bg-app flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
        {item.foto_url ? (
          <img src={item.foto_url} alt={item.nome} className="w-full h-full object-cover" />
        ) : (
          <span>📦</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-fg truncate">{item.nome}</div>
        {(item.marca || item.modelo) && (
          <div className="text-body-sm text-fg-muted truncate">
            {[item.marca, item.modelo].filter(Boolean).join(' · ')}
          </div>
        )}
        <div className="flex gap-1 items-center mt-1 flex-wrap">
          {item.codigo_patrimonio && (
            <span className="text-[10px] font-mono bg-bg-app px-1 py-0.5 rounded">
              {item.codigo_patrimonio}
            </span>
          )}
          {item.condicao && <Badge tone={condicaoTone(item.condicao)}>{item.condicao}</Badge>}
          {item.status && item.status !== 'ativo' && (
            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
          )}
        </div>
      </div>
      <div className="flex flex-col items-end justify-center text-fg font-bold text-lg px-1">
        {item.quantidade ?? 1}
      </div>
    </div>
  );
}
