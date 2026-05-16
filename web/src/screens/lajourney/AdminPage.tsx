import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/LoadingState';
import { Tabs } from '../../components/Tabs';
import { StatCard } from '../../components/StatCard';
import { useJourneyListaProgresso, useJourneyPendencias } from '../../hooks/useLaJourney';
import { CursoStatusCard } from './components/CursoStatusCard';
import type { Programa } from '../../lib/lajourney-types';

export function LaJourneyAdminPage() {
  const navigate = useNavigate();
  const [programa, setPrograma] = useState<Programa>('school');
  const { data: cursos = [], isLoading } = useJourneyListaProgresso(programa);
  const { data: pendencias = [] } = useJourneyPendencias();

  if (isLoading) return <LoadingState />;

  const todosCheckpoints = cursos.flatMap(c => c.checkpoints);
  const pctGlobal = todosCheckpoints.length === 0
    ? 0
    : Math.round(todosCheckpoints.reduce((s, c) => s + c.percentual, 0) / todosCheckpoints.length);
  const emRevisao = todosCheckpoints.filter(c => c.status === 'em_revisao').length;
  const publicados = todosCheckpoints.filter(c => c.status === 'publicado').length;

  const atrasados = cursos.filter(c =>
    c.checkpoints.some(cp => (cp.dias_sem_editar ?? 0) > 14 && cp.status !== 'publicado' && cp.status !== 'sem_inicio')
  );

  const pendenciasPrograma = pendencias.filter(p => p.programa_id === programa);

  return (
    <div className="space-y-md pb-xl">
      <PageHeader
        title="Governança"
        subtitle="LA Journey"
        backTo="/la-journey"
      />

      <Tabs
        tabs={[{ id: 'school', label: 'School' }, { id: 'kids', label: 'Kids' }]}
        active={programa}
        onChange={(id) => setPrograma(id as Programa)}
      />

      <div className="grid grid-cols-3 gap-sm">
        <StatCard label="Preenchido" value={`${pctGlobal}%`} />
        <StatCard label="Em revisão" value={emRevisao} />
        <StatCard label="Publicado" value={publicados} />
      </div>

      {atrasados.length > 0 && (
        <div className="bg-warning/10 border border-warning/40 border-l-4 rounded-md p-md text-body-sm">
          <strong>⚠️ {atrasados.length} curso{atrasados.length > 1 ? 's' : ''} sem atualização há 14+ dias.</strong>
          {' '}Tom já enviou lembrete pra {atrasados.map(c => c.mentor_principal ?? '?').join(', ')} na segunda.
        </div>
      )}

      <div className="flex items-center gap-sm">
        <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">Status por curso</h3>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="space-y-sm">
        {cursos.map(c => (
          <CursoStatusCard key={c.curso_id} programaId={programa} curso={c} />
        ))}
      </div>

      {pendenciasPrograma.length > 0 && (
        <>
          <div className="flex items-center gap-sm mt-md">
            <h3 className="text-body-sm text-fg-muted font-semibold uppercase tracking-wide">
              Pendências de revisão
            </h3>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="bg-bg-surface border border-border rounded-md divide-y divide-border">
            {pendenciasPrograma.map(p => (
              <button
                key={p.conteudo_id}
                type="button"
                onClick={() => navigate(`/la-journey/${p.checkpoint_id}?curso=${p.curso_id}`)}
                className="w-full flex justify-between items-center p-md text-body-sm hover:bg-bg-app/40"
              >
                <span className="font-semibold text-fg">{p.curso_nome} · {p.checkpoint_nome}</span>
                <span className="text-tom">Revisar →</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
