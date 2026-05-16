// Visão coord/director: tabela completa + alertas (atrasados, prontos pra cert)
// Visão mentor (collaborator com estagiários): só lista filtrada pelo banco via RLS
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Settings } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLaEducaProgresso } from '../../hooks/useLaEducaProgresso';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { ProgressBar } from './components/ProgressBar';
import { AlertCard } from './components/AlertCard';
import { CustomSelect } from '../../components/CustomSelect';
import { UNIDADE_LABELS, MODALIDADE_LABELS } from '../../lib/laeduca-types';
import type { Unidade } from '../../lib/laeduca-types';

const UNIDADES: Unidade[] = ['campo_grande', 'recreio', 'barra'];

function daysSince(iso: string | null): number {
  if (!iso) return Infinity;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export function LaEducaListaPage() {
  const { collaborator, role } = useAuth();
  const isCoordOrDirector = role === 'coordinator' || role === 'director';
  const [unidade, setUnidade] = useState<string>('');

  const { data, isLoading, error } = useLaEducaProgresso(unidade || undefined);

  const lista = data ?? [];
  const atrasados = useMemo(
    () => lista.filter(e => daysSince(e.ultima_atualizacao) > 14 && e.percentual < 100),
    [lista],
  );
  const prontos = useMemo(
    () => lista.filter(e => e.percentual === 100 && !e.certificado_emitido),
    [lista],
  );

  if (isLoading) return <LoadingState />;
  if (error) return <div className="p-md text-danger">Erro ao carregar estagiários.</div>;

  return (
    <div className="space-y-lg pb-xl">
      <PageHeader
        title="LA EDUCA"
        subtitle="Acompanhamento de estagiários pedagógicos"
        backTo="/mais"
      />

      {isCoordOrDirector && (
        <div className="space-y-sm">
          <AlertCard variant="danger" title="Atrasados (>14 dias sem atualização)" count={atrasados.length}>
            {atrasados.slice(0, 3).map(e => (
              <div key={e.id}>· {e.nome} ({e.mentor_nome || '—'}) — {daysSince(e.ultima_atualizacao)}d</div>
            ))}
          </AlertCard>
          <AlertCard variant="success" title="Prontos para Certificado Alfa" count={prontos.length}>
            {prontos.slice(0, 3).map(e => (
              <div key={e.id}>· {e.nome} ({UNIDADE_LABELS[e.unidade as Unidade]})</div>
            ))}
          </AlertCard>
        </div>
      )}

      {isCoordOrDirector && (
        <div className="flex items-center gap-sm">
          <span className="text-body-sm text-fg-muted shrink-0">Unidade:</span>
          <div className="w-48">
            <CustomSelect
              value={unidade}
              onChange={setUnidade}
              size="sm"
              placeholder="Todas"
              options={[
                { value: '', label: 'Todas' },
                ...UNIDADES.map(u => ({ value: u, label: UNIDADE_LABELS[u] })),
              ]}
            />
          </div>
        </div>
      )}

      {lista.length === 0 ? (
        <EmptyState
          title="Nenhum estagiário"
          description={isCoordOrDirector ? 'Cadastre o primeiro com o botão abaixo.' : 'Você ainda não é mentor de nenhum estagiário.'}
        />
      ) : (
        <ul className="space-y-sm">
          {lista.map(e => (
            <li key={e.id}>
              <Link
                to={`/la-educa/${e.id}`}
                className="block bg-bg-surface rounded-lg p-md border border-border hover:border-tom focus-ring"
              >
                <div className="flex items-baseline justify-between gap-sm">
                  <h3 className="font-semibold text-fg">{e.nome}</h3>
                  <span className="text-[11px] text-fg-muted">{UNIDADE_LABELS[e.unidade as Unidade]}</span>
                </div>
                <div className="text-body-sm text-fg-muted mt-1">
                  {MODALIDADE_LABELS[e.modalidade]}{e.instrumento ? ` · ${e.instrumento}` : ''} · Mentor: {e.mentor_nome || '—'}
                </div>
                <ProgressBar percentual={e.percentual} className="mt-2" />
                <div className="text-[11px] text-fg-muted mt-1">
                  {e.certificado_emitido ? '🏆 Certificado emitido' : `${e.checkpoints_ancorados}/${e.checkpoints_total} checkpoints`}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {isCoordOrDirector && collaborator && (
        <div className="flex items-center justify-between gap-sm flex-wrap">
          <Link
            to="/la-educa/admin"
            className="inline-flex items-center gap-sm bg-bg-surface border border-border hover:border-tom text-fg px-md py-sm rounded-md font-semibold focus-ring"
          >
            <Settings size={16} /> Editar trilha
          </Link>
          <Link
            to="/la-educa/novo"
            className="fixed bottom-20 right-md md:static md:inline-flex inline-flex items-center gap-sm bg-tom text-white px-md py-sm rounded-full shadow-lg focus-ring"
          >
            <Plus size={18} /> Novo estagiário
          </Link>
        </div>
      )}
    </div>
  );
}
