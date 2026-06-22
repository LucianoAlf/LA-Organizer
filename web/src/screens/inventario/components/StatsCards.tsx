import { useAccess } from '../../../hooks/useAccess';
import { useInventarioStats } from '../../../hooks/useInventarioStats';
import type { InventarioStatusTipo } from '../../../lib/inventario-status';

interface Props { unidadeId?: string; onCardClick?: (tipo: InventarioStatusTipo) => void; }

export function StatsCards({ unidadeId, onCardClick }: Props) {
  const { data } = useInventarioStats(unidadeId);
  const valorAccess = useAccess('valor_patrimonial');
  if (!data) return null;

  const Card = ({ label, value, tone, onClick }: any) => (
    <div onClick={onClick} className={`bg-bg-surface border border-border rounded-lg p-sm ${onClick ? 'cursor-pointer hover:border-tom' : ''}`}>
      <div className="text-[10px] uppercase tracking-wide text-fg-muted font-semibold">{label}</div>
      <div className={`text-xl font-bold mt-1 ${tone === 'warn' ? 'text-warning' : tone === 'danger' ? 'text-danger' : tone === 'tom' ? 'text-tom' : 'text-fg'}`}>{value}</div>
    </div>
  );

  const cols = valorAccess.allowed ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className={`grid ${cols} gap-2`}>
      <Card label="Total itens" value={data.total} />
      {valorAccess.allowed && <Card label="Valor total" value={`R$ ${data.valor.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`} tone="tom" />}
      <Card label="Em manutenção" value={data.manutencao} tone="warn" onClick={data.manutencao > 0 && onCardClick ? () => onCardClick('manutencao') : undefined} />
      <Card label="Atenção" value={data.atencao} tone="danger" onClick={data.atencao > 0 && onCardClick ? () => onCardClick('atencao') : undefined} />
    </div>
  );
}
