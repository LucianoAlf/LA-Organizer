// Sprint 22.21b — Checkpoint vira container das tarefas. Conceitualmente alinha
// com Musicolandia: marco (checkpoint) + acoes (tarefas dentro dele).
// Sprint 22.23 — refactor: arquivo era 1939 linhas, virou casca de ~250.
// Componentes/hooks foram extraidos pra:
//   - components/{TaskListItem, ProjectHeader, RowMenu}
//   - hooks/{useProjectMembers, useProjectCheckpoints, useProjectTasks, useProjectContingencies}
//   - tabs/{CheckpointsTab, ContingenciasTab, DiaDBanner}
//   - lib/sortableSensors, utils/overdue, types/projectDetail

import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Rocket } from 'lucide-react';

import { supabase, supabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Tabs } from '../components/Tabs';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { MembersTab } from '../components/MembersTab';
import { RunbookTab } from '../components/RunbookTab';
import { ProjectHeader } from '../components/ProjectHeader';
import { CheckpointsTab } from '../tabs/CheckpointsTab';
import { ContingenciasTab } from '../tabs/ContingenciasTab';
import { DiaDBanner } from '../tabs/DiaDBanner';
import { useProjectMembers } from '../hooks/useProjectMembers';
import { useProjectCheckpoints, type CreateCheckpointInput } from '../hooks/useProjectCheckpoints';
import { computeCheckpointResponsavel } from '../hooks/useCheckpointResponsavel';
import { useProjectTasks } from '../hooks/useProjectTasks';
import { useProjectContingencies } from '../hooks/useProjectContingencies';
import { brShort } from '../utils/date';
import { celebrateTask, celebrateCheckpoint, celebrateProject } from '../utils/celebrate';
import { notifyCelebration } from '../lib/tomEngine';

import type { Task } from '../types';
import type { CheckpointFull, ProjectFull, TabId } from '../types/projectDetail';

async function fetchProject(id: string): Promise<ProjectFull | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, category, status, progress_percent, start_date, end_date, event_date, event_start_time, created_by, justification, methodology, location, estimated_hours_week, requires_approval, approved_by, approved_at, rejection_reason')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data as ProjectFull | null;
}

export function ProjetoDetalhe() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const [tab, setTab] = useState<TabId>('checkpoints');
  const [viewMode, setViewMode] = useState<'by_checkpoint' | 'by_person'>('by_checkpoint');

  const { data: project, isLoading: pLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id),
    enabled: Boolean(id && supabaseConfigured),
  });

  const { members, canSeeAll, assigneeOptions } = useProjectMembers(id);
  const checkpointsApi = useProjectCheckpoints(id);
  const tasksApi = useProjectTasks(id);
  const contingenciesApi = useProjectContingencies(id);

  const { checkpoints, togglePending } = checkpointsApi;
  const { tasks } = tasksApi;
  const { contingencies } = contingenciesApi;

  const updateProject = useMutation({
    mutationFn: async (patch: Partial<ProjectFull>) => {
      const { error } = await supabase.from('projects').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id] }),
  });

  const deleteProject = useMutation({
    mutationFn: async () => {
      // Tasks vinculadas viram orfas. Checkpoints e contingencias caem em CASCADE
      // (FK ON DELETE CASCADE). project_members tambem.
      await supabase.from('tasks').update({ project_id: null, checkpoint_id: null }).eq('project_id', id);
      const { error } = await supabase.from('projects').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      navigate('/projetos');
    },
  });

  // Sprint 22.22o — wrappers de toggle com celebracao quando vira 'done'.
  // Detecta se foi a ultima task do checkpoint (festa de checkpoint) e
  // se foi o ultimo checkpoint do projeto (festa de projeto).
  function handleToggleCheckpoint(cp: CheckpointFull) {
    const wasDone = cp.status === 'done';
    checkpointsApi.toggle(cp);
    if (!wasDone) {
      celebrateCheckpoint();
      notifyCelebration('checkpoint', id, cp.id);
      const allOthersDone = checkpoints.filter(c => c.id !== cp.id).every(c => c.status === 'done');
      if (allOthersDone && checkpoints.length > 0) {
        setTimeout(() => celebrateProject(), 900);
        notifyCelebration('project', id);
      }
    }
  }

  function handleToggleTask(t: Task) {
    const wasDone = t.status === 'done';
    tasksApi.toggle(t);
    if (!wasDone) {
      celebrateTask();
      // Se foi a ultima task de um checkpoint pendente → festa de checkpoint
      const cpId = (t as Task & { checkpoint_id?: string | null }).checkpoint_id;
      if (cpId) {
        const cpTasks = tasks.filter(x =>
          (x as Task & { checkpoint_id?: string | null }).checkpoint_id === cpId,
        );
        const allOthersDone = cpTasks.filter(x => x.id !== t.id).every(x => x.status === 'done');
        if (allOthersDone && cpTasks.length > 1) {
          setTimeout(() => celebrateCheckpoint(), 600);
          notifyCelebration('checkpoint', id, cpId);
        }
      }
    }
  }

  if (!supabaseConfigured) return <EmptyState icon={<Rocket size={32} />} title="Configure Supabase" />;
  if (pLoading) return <LoadingState rows={4} />;
  if (!project) return <EmptyState title="Projeto não encontrado" action={<Link to="/projetos" className="text-tom">Voltar</Link>} />;

  const next = checkpoints.find(c => c.status !== 'done' && c.status !== 'cancelled');
  const checklistTotal = checkpoints.length;
  const checklistDone = checkpoints.filter(c => c.status === 'done').length;
  const pctRuntime = checklistTotal > 0 ? Math.round((checklistDone / checklistTotal) * 100) : 0;
  const pct = checklistTotal > 0 ? pctRuntime : Math.max(0, Math.min(100, project.progress_percent ?? 0));

  // Agrupa tasks por checkpoint_id. Tasks sem checkpoint vão pra um grupo "soltas".
  const tasksByCheckpoint = new Map<string | null, Task[]>();
  for (const t of tasks) {
    const k = (t as Task & { checkpoint_id?: string | null }).checkpoint_id ?? null;
    if (!tasksByCheckpoint.has(k)) tasksByCheckpoint.set(k, []);
    tasksByCheckpoint.get(k)!.push(t);
  }
  const orphanTasks = tasksByCheckpoint.get(null) ?? [];
  const totalTaskCount = tasks.length;

  // Nome do dono do projeto — fallback mostrado no picker de responsável quando
  // nenhum checkpoint owner é escolhido (= herda do projeto).
  const ownerFallbackName = members.find(m => m.collaborator_id === project.created_by)?.collaborator?.full_name ?? '—';

  // Sprint — Map de responsavel computado por checkpoint. useCheckpointResponsavel
  // e hook puro (sem useState/useEffect) — chamar em loop e seguro.
  const responsavelByCheckpoint = new Map<string, { name: string; isFallback: boolean }>();
  for (const cp of checkpoints) {
    const r = computeCheckpointResponsavel(cp, project, members);
    responsavelByCheckpoint.set(cp.id, { name: r.displayName, isFallback: r.isFallback });
  }

  return (
    <div className="space-y-md">
      <ProjectHeader
        project={project}
        pct={pct}
        members={members}
        onRename={(name) => updateProject.mutate({ name })}
        onUpdateDescription={(description) => updateProject.mutate({ description: description || null })}
        onUpdateEventDate={(event_date) => updateProject.mutate({ event_date: event_date || null })}
        onUpdateStartDate={(start_date) => updateProject.mutate({ start_date: start_date || null })}
        onUpdateEndDate={(end_date) => updateProject.mutate({ end_date: end_date || null })}
        onUpdateCategory={(category) => updateProject.mutate({ category })}
        onUpdateFull={(patch) => updateProject.mutate(patch)}
        onDelete={() => deleteProject.mutate()}
      />

      {/* Próximo passo — sempre visível, independente da aba. */}
      {next && (
        <div className="surface p-md">
          <div className="text-label text-fg-muted uppercase tracking-wide">Próximo passo</div>
          <div className="mt-1.5">
            <div className="text-card-title">{next.name}</div>
            {next.due_date && (
              <div className="text-body-sm text-fg-muted mt-1">
                Prazo: <span className="tabular-nums">{brShort(next.due_date)}</span>
              </div>
            )}
            {next.rationale && (
              <div className="mt-2 bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
                <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
                <p className="whitespace-pre-line">{next.rationale}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <DiaDBanner project={project} active={tab === 'dia_d'} onClick={() => setTab('dia_d')} />

      <Tabs<TabId>
        tabs={[
          { id: 'checkpoints', label: 'Checkpoints', badge: checkpoints.length },
          { id: 'contingencias', label: 'Contingências', badge: contingencies.length },
          { id: 'time', label: 'Time', badge: members.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'checkpoints' && (
        <CheckpointsTab
          projectId={id}
          collaboratorId={collaborator?.id ?? null}
          canSeeAll={canSeeAll}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          checkpoints={checkpoints}
          tasks={tasks}
          members={members}
          tasksByCheckpoint={tasksByCheckpoint}
          orphanTasks={orphanTasks}
          totalTaskCount={totalTaskCount}
          assigneeOptions={assigneeOptions}
          togglePending={togglePending}
          onToggleCheckpoint={handleToggleCheckpoint}
          onToggleTask={handleToggleTask}
          onRenameCheckpoint={(cpId, name) => checkpointsApi.rename({ id: cpId, name })}
          onDeleteCheckpoint={(cpId) => checkpointsApi.remove(cpId)}
          onRenameTask={(tId, title) => tasksApi.rename({ id: tId, title })}
          onDeleteTask={(tId) => tasksApi.remove(tId)}
          onAssignTask={(tId, cId) => tasksApi.assign({ taskId: tId, collabId: cId })}
          onReorderCheckpoints={(ids) => checkpointsApi.reorder(ids)}
          onReorderTasks={(cpId, ids) => tasksApi.reorder({ checkpointId: cpId, orderedIds: ids })}
          onCreateCheckpoint={(input: CreateCheckpointInput) => checkpointsApi.create(input)}
          ownerFallbackName={ownerFallbackName}
          responsavelByCheckpoint={responsavelByCheckpoint}
          onChangeCheckpointResponsavel={
            canSeeAll
              ? (cpId, collabId) => checkpointsApi.update({ id: cpId, assigned_to: collabId })
              : undefined
          }
        />
      )}

      {tab === 'contingencias' && (
        <ContingenciasTab
          contingencies={contingencies}
          onCreate={(scenario, protocol) => contingenciesApi.create({ scenario, protocol })}
          onUpdate={(ctId, scenario, protocol) => contingenciesApi.update({ id: ctId, scenario, protocol })}
          onDelete={(ctId) => contingenciesApi.remove(ctId)}
          onReorder={(ids) => contingenciesApi.reorder(ids)}
        />
      )}

      {tab === 'time' && (
        <MembersTab
          projectId={id}
          members={members}
          canEdit={canSeeAll}
        />
      )}

      {tab === 'dia_d' && project?.category === 'event' && (
        <RunbookTab projectId={id} canEdit={canSeeAll} />
      )}
    </div>
  );
}
