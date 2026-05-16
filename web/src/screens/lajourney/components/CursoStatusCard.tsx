import { useNavigate } from 'react-router-dom';
import type { JourneyCursoProgresso, Programa } from '../../../lib/lajourney-types';

interface Props {
  programaId: Programa;
  curso: JourneyCursoProgresso;
}

function cellClasses(status: string, percentual: number): string {
  if (percentual === 0 && status === 'sem_inicio') return 'bg-bg-app border-border text-fg-muted';
  if (status === 'publicado') return 'bg-success/10 border-success/40 text-success';
  if (status === 'em_revisao') return 'bg-warning/10 border-warning/40 text-warning';
  return 'bg-bg-surface border-border text-fg';
}

function formatRelativa(iso: string): string {
  const dias = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 7) return `${dias} dias`;
  return new Date(iso).toLocaleDateString('pt-BR');
}

export function CursoStatusCard({ curso }: Props) {
  const navigate = useNavigate();
  const apoio = (curso.mentores_apoio ?? []).join(' · ');
  const atrasoDias = curso.checkpoints
    .map(c => c.dias_sem_editar ?? 0)
    .reduce((max, d) => Math.max(max, d), 0);
  const atrasado = atrasoDias > 14;

  const cpEmRevisao = curso.checkpoints.find(c => c.status === 'em_revisao');

  return (
    <div className="bg-bg-surface rounded-lg border border-border p-md">
      <div className="flex items-center gap-sm mb-3">
        <span className="text-2xl">{curso.curso_icone}</span>
        <div className="flex-1">
          <div className="font-semibold text-fg">{curso.curso_nome}</div>
          <div className="text-[11px] text-fg-muted">
            {curso.mentor_principal}{apoio ? ` · ${apoio}` : ''}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 mb-2">
        {curso.checkpoints.map(cp => (
          <button
            key={cp.checkpoint_id}
            type="button"
            onClick={() => navigate(`/la-journey/${cp.checkpoint_id}?curso=${curso.curso_id}`)}
            className={`p-2 rounded-md border text-center hover:shadow-sm transition ${cellClasses(cp.status, cp.percentual)}`}
          >
            <div className="text-[9px] font-semibold truncate">{cp.checkpoint_nome}</div>
            <div className="text-base font-bold">{cp.percentual}%</div>
          </button>
        ))}
      </div>

      <div className="flex justify-between items-center text-[11px] pt-2 border-t border-border">
        <span className={atrasado ? 'text-danger font-semibold' : 'text-fg-muted'}>
          {curso.ultima_edicao
            ? (atrasado ? `⚠ ${atrasoDias}d sem editar` : `Última edição: ${formatRelativa(curso.ultima_edicao)}`)
            : 'Sem edições'}
        </span>
        {cpEmRevisao && (
          <button
            type="button"
            onClick={() => navigate(`/la-journey/${cpEmRevisao.checkpoint_id}?curso=${curso.curso_id}`)}
            className="text-tom font-semibold"
          >
            Revisar {cpEmRevisao.checkpoint_nome} →
          </button>
        )}
      </div>
    </div>
  );
}
