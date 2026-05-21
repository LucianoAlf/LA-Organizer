import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader } from '../../components/PageHeader';
import { CustomSelect } from '../../components/CustomSelect';
import { LoadingState } from '../../components/LoadingState';
import { EmptyState } from '../../components/EmptyState';
import { Tabs } from '../../components/Tabs';
import { Badge } from '../../components/Badge';
import { useJourneyCheckpoints, useJourneyCursos, useJourneyListaProgresso } from '../../hooks/useLaJourney';
import { ProgressBar } from './components/ProgressBar';
import type { Programa, StatusConteudo, JourneyCursoProgresso } from '../../lib/lajourney-types';
import { STATUS_LABELS } from '../../lib/lajourney-types';

type CheckpointProgresso = JourneyCursoProgresso['checkpoints'][0];

type TabsKids = 'musicalizacao' | 'iniciacao';

const TABS_PROGRAMA = [
  { id: 'school' as Programa, label: 'School' },
  { id: 'kids' as Programa, label: 'Kids' },
];

const TABS_KIDS = [
  { id: 'musicalizacao' as TabsKids, label: 'Musicalização' },
  { id: 'iniciacao' as TabsKids, label: 'Iniciação' },
];

function statusTone(status: StatusConteudo | 'sem_inicio'): 'success' | 'warning' | 'neutral' {
  if (status === 'publicado') return 'success';
  if (status === 'em_revisao') return 'warning';
  return 'neutral';
}

function statusLabel(status: StatusConteudo | 'sem_inicio'): string {
  if (status === 'sem_inicio') return 'Sem início';
  return STATUS_LABELS[status];
}

export function LaJourneyListaPage() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === 'coordinator' || role === 'director';

  const [programa, setPrograma] = useState<Programa>('school');
  const [tabsKids, setTabsKids] = useState<TabsKids>('musicalizacao');
  const [cursoId, setCursoId] = useState<string>('');

  // Determina o tipo de checkpoint a filtrar
  const tipoFiltro = useMemo(() => {
    if (programa === 'kids' && tabsKids === 'musicalizacao') return 'musicalizacao';
    if (programa === 'kids' && tabsKids === 'iniciacao') return 'iniciacao';
    return 'checkpoint';
  }, [programa, tabsKids]);

  // cursoEfetivo: fixo para musicalização kids, selecionado nos demais
  const cursoEfetivo = useMemo(() => {
    if (programa === 'kids' && tabsKids === 'musicalizacao') return 'musicalizacao_geral';
    return cursoId;
  }, [programa, tabsKids, cursoId]);

  const { data: checkpoints, isLoading: loadingCp } = useJourneyCheckpoints(programa);
  const { data: cursos, isLoading: loadingCursos } = useJourneyCursos(programa);
  const { data: listaProgresso, isLoading: loadingProgresso } = useJourneyListaProgresso(programa);

  // Filtra cursos: remove musicalizacao_geral quando mostra o select
  const cursoOptions = useMemo(() => {
    if (!cursos) return [];
    return cursos
      .filter(c => c.id !== 'musicalizacao_geral')
      .map(c => ({ value: c.id, label: c.nome }));
  }, [cursos]);

  // Auto-seleciona primeiro curso quando programa muda
  const showCursoSelect =
    programa === 'school' || (programa === 'kids' && tabsKids === 'iniciacao');

  // Mapa de progresso indexado por curso_id → checkpoint_id
  const progressoMap = useMemo(() => {
    if (!listaProgresso) return new Map<string, Map<string, CheckpointProgresso>>();
    const map = new Map<string, Map<string, CheckpointProgresso>>();
    for (const cursoProg of listaProgresso) {
      const inner = new Map<string, CheckpointProgresso>();
      for (const cp of cursoProg.checkpoints) {
        inner.set(cp.checkpoint_id, cp);
      }
      map.set(cursoProg.curso_id, inner);
    }
    return map;
  }, [listaProgresso]);

  // Checkpoints filtrados por tipo
  const checkpointsFiltrados = useMemo(() => {
    if (!checkpoints) return [];
    return checkpoints
      .filter(cp => cp.tipo === tipoFiltro)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [checkpoints, tipoFiltro]);

  const isLoading = loadingCp || loadingCursos || loadingProgresso;

  // Quando programa muda, reset tabs kids e cursoId
  function handlePrograma(p: Programa) {
    setPrograma(p);
    setTabsKids('musicalizacao');
    setCursoId('');
  }

  function handleTabsKids(t: TabsKids) {
    setTabsKids(t);
    setCursoId('');
  }

  function handleCursoChange(v: string) {
    setCursoId(v);
  }

  function handleCheckpointClick(checkpointId: string) {
    const params = cursoEfetivo ? `?curso=${cursoEfetivo}` : '';
    navigate(`/la-journey/${checkpointId}${params}`);
  }

  const semCursos = showCursoSelect && !loadingCursos && cursoOptions.length === 0;

  return (
    <div className="space-y-lg">
      <PageHeader
        title="LA Journey"
        subtitle="Jornada pedagógica do aluno"
        backTo="/mais"
        right={
          isAdmin ? (
            <button
              type="button"
              onClick={() => navigate('/la-journey/admin')}
              className="h-9 px-3 rounded-md bg-bg-elevated border border-border text-fg-muted text-body-sm hover:text-fg hover:bg-bg-surface transition-colors focus-ring"
            >
              ⚙ Admin
            </button>
          ) : undefined
        }
      />

      {/* Tabs programa */}
      <Tabs
        tabs={TABS_PROGRAMA}
        active={programa}
        onChange={handlePrograma}
        className="mb-md"
      />

      {/* Tabs kids (só quando programa = kids) */}
      {programa === 'kids' && (
        <Tabs
          tabs={TABS_KIDS}
          active={tabsKids}
          onChange={handleTabsKids}
          className="mb-md"
        />
      )}

      {/* Select de curso */}
      {showCursoSelect && !semCursos && (
        <div className="mb-md">
          <CustomSelect
            value={cursoId}
            options={cursoOptions}
            onChange={handleCursoChange}
            placeholder="Selecionar curso"
            size="sm"
          />
        </div>
      )}

      {/* Estado: sem cursos disponíveis */}
      {semCursos && (
        <EmptyState
          title="Sem cursos disponíveis"
          description="Nenhum curso foi atribuído a este mentor. Entre em contato com a coordenação para configurar a atribuição."
        />
      )}

      {/* Estado: carregando */}
      {isLoading && !semCursos && <LoadingState />}

      {/* Lista de checkpoints */}
      {!isLoading && !semCursos && (
        <div className="grid gap-2 lg:grid-cols-2">
          {checkpointsFiltrados.length === 0 && (
            <EmptyState
              title="Nenhum checkpoint encontrado"
              description="Não há checkpoints cadastrados para este programa."
            />
          )}

          {checkpointsFiltrados.map((cp, index) => {
            const cpProgresso = cursoEfetivo
              ? progressoMap.get(cursoEfetivo)?.get(cp.id)
              : undefined;

            const status: StatusConteudo | 'sem_inicio' = cpProgresso?.status ?? 'sem_inicio';
            const percentual = cpProgresso?.percentual ?? 0;
            const camposPreenchidos = cpProgresso?.campos_preenchidos ?? 0;
            const camposTotal = cpProgresso?.campos_total ?? 0;

            return (
              <button
                key={cp.id}
                type="button"
                onClick={() => handleCheckpointClick(cp.id)}
                className="w-full text-left bg-bg-surface border border-border rounded-lg px-4 py-3 hover:bg-bg-elevated transition-colors focus-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Número badge */}
                    <span className="shrink-0 w-7 h-7 rounded-full bg-bg-elevated border border-border flex items-center justify-center text-body-sm font-semibold text-fg-muted">
                      {index + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="text-body-md font-semibold text-fg">{cp.nome}</span>
                        <Badge tone={statusTone(status)}>
                          {statusLabel(status)}
                        </Badge>
                      </div>

                      {cp.equivalencia && (
                        <p className="text-body-sm text-fg-muted mb-2">{cp.equivalencia}</p>
                      )}

                      <ProgressBar percentual={percentual} className="mb-1.5" />

                      <p className="text-body-sm text-fg-muted">
                        {percentual}% · {camposPreenchidos}/{camposTotal} campos
                      </p>
                    </div>
                  </div>

                  <ChevronRight size={18} className="shrink-0 text-fg-muted mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
