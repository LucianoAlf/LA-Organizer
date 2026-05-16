// Lista de checkpoints de UM pilar pra avaliação
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useLaEducaEstagiario } from '../../hooks/useLaEducaEstagiario';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { CheckpointRow } from './components/CheckpointRow';
import { ancorarAvaliacao } from '../../lib/laeduca';
import type { PilarId } from '../../lib/laeduca-types';
import { PILAR_NOMES } from '../../lib/laeduca-types';
import { showToast } from '../../components/Toast';

const PILARES_VALIDOS: PilarId[] = ['p1', 'p2', 'p3', 'p4'];

export function LaEducaPilarPage() {
  const { id, pilar } = useParams<{ id: string; pilar: string }>();
  const { collaborator } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, error } = useLaEducaEstagiario(id);

  if (isLoading) return <LoadingState />;
  if (error || !data) return <div className="p-md text-danger">Estagiário não encontrado.</div>;

  const pilarId = PILARES_VALIDOS.includes(pilar as PilarId) ? (pilar as PilarId) : null;
  if (!pilarId) return <div className="p-md text-danger">Pilar inválido.</div>;

  const items = data.avaliacoes_por_pilar[pilarId];

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
        title={PILAR_NOMES[pilarId]}
        subtitle={`${data.estagiario.nome} · ${items.filter(i => i.ancorado).length}/${items.length} ancorados`}
        backTo={`/la-educa/${id}`}
      />

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
