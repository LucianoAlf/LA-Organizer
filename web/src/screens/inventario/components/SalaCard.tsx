import { Badge } from '../../../components/Badge';
import type { ReportSala } from '../../../lib/lareport-types';
import { iconeParaTipoSala } from '../../../lib/lareport-types';

interface Props {
  sala: ReportSala;
  onClick: () => void;
}

export function SalaCard({ sala, onClick }: Props) {
  const itens = sala.itens_count ?? 0;
  const semItens = itens === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-bg-surface rounded-lg border border-border p-md flex items-center gap-sm hover:border-tom transition text-left"
    >
      <div className="w-9 h-9 rounded-md bg-bg-app flex items-center justify-center text-lg flex-shrink-0">
        {iconeParaTipoSala(sala.tipo_sala)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-fg truncate">{sala.nome}</div>
        <div className="text-[11px] text-fg-muted">
          {sala.tipo_sala || 'Multiuso'}
          {sala.capacidade_maxima ? ` · ${sala.capacidade_maxima} alunos` : ''}
        </div>
      </div>
      <Badge tone={semItens ? 'danger' : 'neutral'}>{itens} itens</Badge>
      <span className="text-fg-muted">›</span>
    </button>
  );
}
