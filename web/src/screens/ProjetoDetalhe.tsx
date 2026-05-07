import { useState, FormEvent, KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Rocket, Check, AlertTriangle, Plus } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Tabs } from '../components/Tabs';
import { Badge } from '../components/Badge';
import { CategoryTag } from '../components/CategoryTag';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { PROJECT_CATEGORY_LABELS } from '../lib/projectLabels';
import { brShort } from '../utils/date';
import type { Project, Task, Checkpoint } from '../types';

// Sprint 22.21 — refactor de Projetos.
// - Drop aba "Resumo": Próximo passo vira card fixo abaixo do header.
// - 4 abas: Checkpoints / Tarefas / Contingências / Time (cabe em 1 linha).
// - Aba Tarefas agrupada por checkpoint (com `<details>`), + inline pra criar
//   tarefa direto sem precisar do TOM. checkpoint_id já existe em tasks.
// - CRUD completo (tap-to-edit, swipe, delete) vem na próxima fatia (22.21b).

type TabId = 'checkpoints' | 'tarefas' | 'contingencias' | 'time';

interface ProjectFull extends Project {
  event_date?: string | null;
}

interface CheckpointFull extends Checkpoint {
  rationale?: string | null;
}

interface Contingency {
  id: string;
  project_id: string;
  scenario: string;
  protocol: string;
  position: number;
}

async function fetchProject(id: string): Promise<ProjectFull | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, category, status, progress_percent, start_date, end_date, event_date, created_by')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data as ProjectFull | null;
}

async function fetchCheckpoints(projectId: string): Promise<CheckpointFull[]> {
  const { data, error } = await supabase
    .from('project_checkpoints')
    .select('id, project_id, name, due_date, status, completed_at, sort_order, rationale')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CheckpointFull[];
}

async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, checkpoint_id, assigned_to, created_by, completed_at, action_type, source')
    .eq('project_id', projectId)
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []) as unknown as Task[];
}

async function fetchMembers(projectId: string) {
  const { data, error } = await supabase
    .from('project_members')
    .select('collaborator_id, role_in_project, collaborators(id, full_name, role, function_title)')
    .eq('project_id', projectId);
  if (error) throw error;
  return data ?? [];
}

async function fetchContingencies(projectId: string): Promise<Contingency[]> {
  const { data, error } = await supabase
    .from('project_contingencies')
    .select('id, project_id, scenario, protocol, position')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Contingency[];
}

export function ProjetoDetalhe() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<TabId>('checkpoints');
  const { collaborator } = useAuth();
  const qc = useQueryClient();

  const { data: project, isLoading: pLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: checkpoints = [] } = useQuery({
    queryKey: ['project', id, 'checkpoints'],
    queryFn: () => fetchCheckpoints(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: tasks = [] } = useQuery({
    queryKey: ['project', id, 'tasks'],
    queryFn: () => fetchProjectTasks(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: members = [] } = useQuery({
    queryKey: ['project', id, 'members'],
    queryFn: () => fetchMembers(id),
    enabled: Boolean(id && supabaseConfigured),
  });
  const { data: contingencies = [] } = useQuery({
    queryKey: ['project', id, 'contingencies'],
    queryFn: () => fetchContingencies(id),
    enabled: Boolean(id && supabaseConfigured),
  });

  const toggleCheckpoint = useMutation({
    mutationFn: async (cp: CheckpointFull) => {
      if (!collaborator) throw new Error('no_auth');
      const isDone = cp.status === 'done';
      const update = isDone
        ? { status: 'pending', completed_at: null, completed_by: null }
        : { status: 'done', completed_at: new Date().toISOString(), completed_by: collaborator.id };
      const { error } = await supabase.from('project_checkpoints').update(update).eq('id', cp.id);
      if (error) throw error;
    },
    onMutate: async (cp) => {
      await qc.cancelQueries({ queryKey: ['project', id, 'checkpoints'] });
      const prev = qc.getQueryData<CheckpointFull[]>(['project', id, 'checkpoints']);
      qc.setQueryData<CheckpointFull[]>(['project', id, 'checkpoints'], (old) =>
        (old || []).map(x => x.id === cp.id
          ? { ...x, status: x.status === 'done' ? 'pending' : 'done' }
          : x),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', id, 'checkpoints'], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] });
    },
  });

  const toggleTask = useMutation({
    mutationFn: async (task: Task) => {
      const next = task.status === 'done' ? 'pending' : 'done';
      const { error } = await supabase
        .from('tasks')
        .update({ status: next, completed_at: next === 'done' ? new Date().toISOString() : null })
        .eq('id', task.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

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

  return (
    <div className="space-y-md">
      <header>
        <Link to="/projetos" className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-fg focus-ring">
          <ArrowLeft size={16} /> Projetos
        </Link>
        <div className="mt-md flex items-start gap-md justify-between flex-wrap">
          <div className="min-w-0">
            <h2 className="text-screen-title">{project.name}</h2>
            {project.description && <p className="text-body-md text-fg-muted mt-1 max-w-prose">{project.description}</p>}
            {project.event_date && (
              <p className="text-body-sm text-fg-muted mt-1">
                <span aria-hidden>🎯</span>{' '}
                Evento: <span className="text-fg tabular-nums">{brShort(project.event_date)}</span>
              </p>
            )}
          </div>
          <CategoryTag project={project} label={PROJECT_CATEGORY_LABELS[project.category]} className="shrink-0" />
        </div>

        <div className="mt-md">
          <div className="flex items-center justify-between text-body-sm text-fg-muted mb-1.5 tabular-nums">
            <span>Progresso</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      {/* Próximo passo — sempre visível, independente da aba (era a aba Resumo). */}
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

      <Tabs<TabId>
        tabs={[
          { id: 'checkpoints', label: 'Checkpoints', badge: checkpoints.length },
          { id: 'tarefas', label: 'Tarefas', badge: tasks.length },
          { id: 'contingencias', label: 'Contingências', badge: contingencies.length },
          { id: 'time', label: 'Time', badge: members.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'checkpoints' && (
        <section className="surface">
          {checkpoints.length === 0 ? (
            <EmptyState title="Sem checkpoints ainda" description="Marcos do projeto. Peça pro TOM estruturar pelo WhatsApp ou crie manualmente quando o CRUD inline subir." />
          ) : (
            <ul className="divide-y divide-border">
              {checkpoints.map(c => {
                const isDone = c.status === 'done';
                const cpTaskCount = (tasksByCheckpoint.get(c.id) ?? []).length;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggleCheckpoint.mutate(c)}
                      disabled={toggleCheckpoint.isPending}
                      className="w-full p-md flex items-start gap-md hover:bg-bg-elevated focus-ring text-left"
                      aria-label={isDone ? 'Reabrir checkpoint' : 'Marcar como feito'}
                    >
                      <span
                        className={[
                          'mt-0.5 h-6 w-6 shrink-0 rounded-md border-2 grid place-items-center transition-colors',
                          isDone
                            ? 'bg-tom border-tom text-white'
                            : 'border-fg-muted text-transparent',
                        ].join(' ')}
                        aria-hidden
                      >
                        <Check size={14} strokeWidth={3} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={['text-body-md', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
                          {c.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-body-sm text-fg-muted">
                          {c.due_date && <span className="tabular-nums">{brShort(c.due_date)}</span>}
                          {cpTaskCount > 0 && (
                            <span>· <span className="tabular-nums">{cpTaskCount}</span> {cpTaskCount === 1 ? 'tarefa' : 'tarefas'}</span>
                          )}
                        </div>
                        {c.rationale && !isDone && (
                          <div className="mt-2 bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
                            <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
                            <p className="whitespace-pre-line">{c.rationale}</p>
                          </div>
                        )}
                      </div>
                      {c.status === 'in_progress' && <Badge tone="warning">em curso</Badge>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {tab === 'tarefas' && (
        <section className="space-y-sm">
          {checkpoints.length === 0 && tasks.length === 0 ? (
            <div className="surface">
              <EmptyState title="Sem tarefas vinculadas" description="Crie checkpoints primeiro pra agrupar as tarefas." />
            </div>
          ) : (
            <>
              {checkpoints.map(cp => {
                const cpTasks = tasksByCheckpoint.get(cp.id) ?? [];
                return (
                  <CheckpointTasksGroup
                    key={cp.id}
                    checkpoint={cp}
                    tasks={cpTasks}
                    onToggleTask={(t) => toggleTask.mutate(t)}
                    projectId={id}
                    collaboratorId={collaborator?.id ?? null}
                  />
                );
              })}
              {orphanTasks.length > 0 && (
                <div className="surface p-md">
                  <div className="text-label text-fg-muted uppercase tracking-wide mb-2">
                    Sem checkpoint
                  </div>
                  <ul className="divide-y divide-border">
                    {orphanTasks.map(t => (
                      <TaskListItem key={t.id} task={t} onToggle={() => toggleTask.mutate(t)} />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === 'contingencias' && (
        <section className="space-y-sm">
          {contingencies.length === 0 ? (
            <div className="surface p-md">
              <EmptyState
                icon={<AlertTriangle size={32} />}
                title="Sem cenários de contingência"
                description='Defina antes "se X acontecer → faça Y". O TOM cria pelo WhatsApp quando você pede pra mapear riscos do projeto.'
              />
            </div>
          ) : (
            <ul className="space-y-sm">
              {contingencies.map(ct => (
                <li key={ct.id} className="surface p-md">
                  <div className="flex items-start gap-md">
                    <span className="mt-0.5 shrink-0 text-warning" aria-hidden>🚨</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-body-md font-semibold">{ct.scenario}</div>
                      <p className="mt-1 text-body-sm text-fg-muted whitespace-pre-line">{ct.protocol}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'time' && (
        <section className="surface">
          {members.length === 0 ? (
            <EmptyState title="Sem membros cadastrados" />
          ) : (
            <ul className="divide-y divide-border">
              {(members as Array<{ collaborator_id: string; role_in_project: string; collaborators?: { full_name?: string; function_title?: string; role?: string } | { full_name?: string; function_title?: string; role?: string }[] | null }>).map(m => {
                const coll = Array.isArray(m.collaborators) ? m.collaborators[0] : m.collaborators;
                return (
                  <li key={m.collaborator_id} className="p-md flex items-center justify-between gap-md">
                    <div>
                      <div className="text-body-md">{coll?.full_name ?? '—'}</div>
                      <div className="text-body-sm text-fg-muted">{coll?.function_title ?? coll?.role ?? ''}</div>
                    </div>
                    <Badge tone="neutral">{m.role_in_project}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ---- Subcomponentes ----------------------------------------------------------

function TaskListItem({ task, onToggle }: { task: Task; onToggle: () => void }) {
  const isDone = task.status === 'done';
  return (
    <li className="py-2 flex items-start gap-md">
      <button
        type="button"
        onClick={onToggle}
        aria-label={isDone ? 'Reabrir tarefa' : 'Concluir tarefa'}
        className={[
          'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 grid place-items-center transition-colors focus-ring',
          isDone
            ? 'bg-tom border-tom text-white'
            : 'border-fg-muted text-transparent hover:border-tom',
        ].join(' ')}
      >
        {isDone && <Check size={12} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <div className={['text-body-md', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
          {task.title}
        </div>
        {task.due_date && (
          <div className="text-body-sm text-fg-muted tabular-nums mt-0.5">
            {brShort(task.due_date)}
          </div>
        )}
      </div>
    </li>
  );
}

function CheckpointTasksGroup({
  checkpoint,
  tasks,
  onToggleTask,
  projectId,
  collaboratorId,
}: {
  checkpoint: CheckpointFull;
  tasks: Task[];
  onToggleTask: (t: Task) => void;
  projectId: string;
  collaboratorId: string | null;
}) {
  const [expanded, setExpanded] = useState(checkpoint.status !== 'done');
  const isDone = checkpoint.status === 'done';
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;
  return (
    <div className="surface">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full p-md flex items-center justify-between gap-md hover:bg-bg-elevated focus-ring text-left"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className={['text-body-md font-semibold', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
            {checkpoint.name}
          </div>
          <div className="text-body-sm text-fg-muted tabular-nums mt-0.5">
            {total === 0 ? 'sem tarefas' : `${done}/${total}`}
            {checkpoint.due_date && <> · {brShort(checkpoint.due_date)}</>}
          </div>
        </div>
        <span className="text-fg-muted text-body-sm shrink-0" aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="px-md pb-md">
          {tasks.length > 0 && (
            <ul className="divide-y divide-border">
              {tasks.map(t => (
                <TaskListItem key={t.id} task={t} onToggle={() => onToggleTask(t)} />
              ))}
            </ul>
          )}
          <CreateTaskInline
            projectId={projectId}
            checkpointId={checkpoint.id}
            collaboratorId={collaboratorId}
          />
        </div>
      )}
    </div>
  );
}

function CreateTaskInline({
  projectId,
  checkpointId,
  collaboratorId,
}: {
  projectId: string;
  checkpointId: string;
  collaboratorId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const qc = useQueryClient();
  const createTask = useMutation({
    mutationFn: async () => {
      if (!collaboratorId) throw new Error('no_auth');
      const t = title.trim();
      if (!t) return;
      const { error } = await supabase.from('tasks').insert({
        title: t.slice(0, 200),
        project_id: projectId,
        checkpoint_id: checkpointId,
        assigned_to: collaboratorId,
        created_by: collaboratorId,
        source: 'manual',
        status: 'pending',
        context: 'work',
        priority: 'medium',
        action_type: 'task',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle('');
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['project', projectId, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (title.trim()) createTask.mutate();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false);
      setTitle('');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-tom focus-ring rounded-sm px-1 py-0.5"
      >
        <Plus size={14} /> Tarefa
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-2 flex items-center gap-2">
      <input
        type="text"
        autoFocus
        value={title}
        maxLength={200}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="O que precisa fazer..."
        className="flex-1 h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <button
        type="submit"
        disabled={!title.trim() || createTask.isPending}
        className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
      >
        Salvar
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setTitle(''); }}
        className="h-9 px-2 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
      >
        Cancelar
      </button>
    </form>
  );
}
