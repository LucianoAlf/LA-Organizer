// Lista de checkpoints de UM pilar pra avaliação
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useLaEducaEstagiario } from '../../hooks/useLaEducaEstagiario';
import { useLaEducaPilares } from '../../hooks/useLaEducaPilares';
import { useLaEducaResponsaveis } from '../../hooks/useLaEducaResponsaveis';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { CheckpointRow } from './components/CheckpointRow';
import { ancorarAvaliacao } from '../../lib/laeduca';
import { showToast } from '../../components/Toast';

export function LaEducaPilarPage() {
  const { id, pilar } = useParams<{ id: string; pilar: string }>();
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useLaEducaEstagiario(id);
  const { data: pilares, isLoading: pilaresLoading } = useLaEducaPilares();
  const { data: responsaveis = [] } = useLaEducaResponsaveis(id);

  if (isLoading || pilaresLoading) return <LoadingState />;
  if (error || !data) return <div className="p-md text-danger">Estagiário não encontrado.</div>;

  const pilarObj = (pilares ?? []).find(p => p.codigo === pilar);
  if (!pilarObj) return <div className="p-md text-danger">Pilar inválido.</div>;

  const items = data.avaliacoes_por_pilar[pilarObj.codigo] ?? [];

  const responsavelDoPilar = responsaveis.find(r => r.pilar_codigo === pilarObj.codigo);
  const responsavelNome = responsavelDoPilar
    ? responsavelDoPilar.instrutor_nome
    : (data.progresso.mentor_nome ?? '—');
  const ehInstrutor = !!responsavelDoPilar;

  async function handleAncorar(avaliacaoId: string, params: { nota: number; observacoes: string; justificativaBaixa: string | null }) {
    if (!collaborator) return;
    try {
      await ancorarAvaliacao({
        avaliacaoId,
        nota: params.nota,
        observacoes: params.observacoes.trim() || null,
        justificativaBaixa: params.justificativaBaixa,
        avaliadorId: collaborator.id,
      });
      qc.invalidateQueries({ queryKey: ['laeduca-estagiario', id] });
      qc.invalidateQueries({ queryKey: ['laeduca-progresso'] });
      showToast({ kind: 'success', title: 'Checkpoint ancorado.' });
    } catch (e) {
      showToast({ kind: 'error', title: 'Falha', msg: (e as Error).message });
    }
  }

  return (
    <div className="space-y-md pb-xl">
      <PageHeader
        title={pilarObj.nome}
        subtitle={`${data.estagiario.nome} · ${items.filter(i => i.ancorado).length}/${items.length} ancorados`}
        backTo={`/la-educa/${id}`}
      />

      <div className="bg-bg-surface rounded-lg p-sm border border-border text-body-sm text-fg-muted">
        Responsável por este pilar:{' '}
        <strong className="text-fg">{responsavelNome}</strong>
        {!ehInstrutor && <span> (mentor)</span>}
      </div>

      {pilarObj.foco && (
        <div className="bg-warning/10 border-l-4 border-warning rounded-r-lg p-md">
          <div className="text-body-sm font-semibold text-warning mb-1">Foco do pilar</div>
          <p className="text-body-sm text-fg-muted">{pilarObj.foco}</p>
        </div>
      )}

      <ul className="space-y-sm">
        {items.map(item => (
          <li key={item.id}>
            <CheckpointRow item={item} onAncorar={p => handleAncorar(item.id, p)} />
          </li>
        ))}
      </ul>
    </div>
  );
}
