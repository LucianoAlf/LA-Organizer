import { Badge } from '../../../components/Badge';
import { iconeParaTipoSala, type ReportSala } from '../../../lib/lareport-types';

interface Props { sala: ReportSala & { manutencoes_pendentes?: number; sala_coringa?: boolean; buffer_operacional?: number }; onClick: () => void; }

export function SalaCardMedio({ sala, onClick }: Props) {
  const itens = sala.itens_count ?? 0;
  const manut = sala.manutencoes_pendentes ?? 0;
  return (
    <button type="button" onClick={onClick} className="w-full bg-bg-surface rounded-lg border border-border p-md text-left hover:border-tom transition">
      <div className="flex items-center gap-sm">
        <div className="w-10 h-10 rounded-md bg-bg-app flex items-center justify-center text-xl flex-shrink-0">
          {iconeParaTipoSala(sala.tipo_sala)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-fg truncate">{sala.nome}</span>
            {sala.sala_coringa && <Badge tone="success">Coringa</Badge>}
          </div>
          <div className="text-[11px] text-fg-muted">{sala.tipo_sala || 'Multiuso'}</div>
        </div>
        <span className="text-fg-muted">›</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-fg-muted">
        <span>👥 {sala.capacidade_maxima ?? '?'} alunos · ⏱️ {sala.buffer_operacional ?? 10}min</span>
        <span className="text-right">📦 {itens} itens{manut > 0 ? ` · 🔧 ${manut}` : ''}</span>
      </div>
    </button>
  );
}
