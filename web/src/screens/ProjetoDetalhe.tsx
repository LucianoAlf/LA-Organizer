import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Rocket, Check, AlertTriangle, Plus, ChevronDown, ChevronRight, MoreVertical } from 'lucide-react';
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

// Sprint 22.21b — Checkpoint vira container das tarefas. Conceitualmente alinha
// com Musicolandia: marco (checkpoint) + acoes (tarefas dentro dele). Drop aba
// "Tarefas" — fica 3 abas: Checkpoints / Contingencias / Time.

type TabId = 'checkpoints' | 'contingencias' | 'time';

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

  const renameCheckpoint = useMutation({
    mutationFn: async ({ id: cpId, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('project_checkpoints').update({ name }).eq('id', cpId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] }),
  });

  const deleteCheckpoint = useMutation({
    mutationFn: async (cpId: string) => {
      // Tasks vinculadas viram orfas (checkpoint_id = NULL) — nao queremos deletar tasks junto.
      await supabase.from('tasks').update({ checkpoint_id: null }).eq('checkpoint_id', cpId);
      const { error } = await supabase.from('project_checkpoints').delete().eq('id', cpId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] });
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
    },
  });

  const renameTask = useMutation({
    mutationFn: async ({ id: tId, title }: { id: string; title: string }) => {
      const { error } = await supabase.from('tasks').update({ title }).eq('id', tId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] }),
  });

  const deleteTask = useMutation({
    mutationFn: async (tId: string) => {
      const { error } = await supabase.from('tasks').delete().eq('id', tId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', id, 'tasks'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const createCheckpoint = useMutation({
    mutationFn: async (name: string) => {
      if (!collaborator) throw new Error('no_auth');
      const maxOrder = checkpoints.reduce((m, c) => Math.max(m, c.sort_order ?? 0), -1);
      const { error } = await supabase.from('project_checkpoints').insert({
        project_id: id,
        name: name.slice(0, 200),
        status: 'pending',
        sort_order: maxOrder + 1,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', id, 'checkpoints'] }),
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
  const totalTaskCount = tasks.length;

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
        <section className="space-y-sm">
          {checkpoints.length === 0 && totalTaskCount === 0 ? (
            <div className="surface">
              <EmptyState
                title="Sem checkpoints ainda"
                description="Marcos do projeto. Peça pro TOM estruturar pelo WhatsApp ou crie manualmente quando o CRUD inline subir."
              />
            </div>
          ) : (
            <>
              {checkpoints.map(cp => (
                <CheckpointCard
                  key={cp.id}
                  checkpoint={cp}
                  tasks={tasksByCheckpoint.get(cp.id) ?? []}
                  onToggleCheckpoint={() => toggleCheckpoint.mutate(cp)}
                  onToggleTask={(t) => toggleTask.mutate(t)}
                  onRenameCheckpoint={(name) => renameCheckpoint.mutate({ id: cp.id, name })}
                  onDeleteCheckpoint={() => deleteCheckpoint.mutate(cp.id)}
                  onRenameTask={(tId, title) => renameTask.mutate({ id: tId, title })}
                  onDeleteTask={(tId) => deleteTask.mutate(tId)}
                  toggleDisabled={toggleCheckpoint.isPending}
                  projectId={id}
                  collaboratorId={collaborator?.id ?? null}
                />
              ))}
              {orphanTasks.length > 0 && (
                <div className="surface p-md">
                  <div className="text-label text-fg-muted uppercase tracking-wide mb-2">
                    Tarefas sem checkpoint
                  </div>
                  <ul className="divide-y divide-border">
                    {orphanTasks.map(t => (
                      <TaskListItem
                        key={t.id}
                        task={t}
                        onToggle={() => toggleTask.mutate(t)}
                        onRename={(title) => renameTask.mutate({ id: t.id, title })}
                        onDelete={() => deleteTask.mutate(t.id)}
                      />
                    ))}
                  </ul>
                </div>
              )}
              <CreateCheckpointInline onCreate={(name) => createCheckpoint.mutate(name)} />
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

function TaskListItem({
  task,
  onToggle,
  onRename,
  onDelete,
}: {
  task: Task;
  onToggle: () => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
}) {
  const isDone = task.status === 'done';
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.title);

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== task.title && onRename) onRename(v.slice(0, 200));
    setEditing(false);
  }

  return (
    <li className="py-2 flex items-start gap-md group">
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
        {editing ? (
          <input
            type="text"
            autoFocus
            value={editValue}
            maxLength={200}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
              if (e.key === 'Escape') { setEditValue(task.title); setEditing(false); }
            }}
            className="w-full h-8 px-2 -ml-2 rounded-sm bg-bg-elevated border border-border text-body-md text-fg focus-ring"
          />
        ) : (
          <div className={['text-body-md', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
            {task.title}
          </div>
        )}
        {task.due_date && !editing && (
          <div className="text-body-sm text-fg-muted tabular-nums mt-0.5">
            {brShort(task.due_date)}
          </div>
        )}
      </div>
      {(onRename || onDelete) && !editing && (
        <RowMenu
          items={[
            ...(onRename ? [{ label: 'Editar', onClick: () => { setEditValue(task.title); setEditing(true); } }] : []),
            ...(onDelete ? [{ label: 'Excluir tarefa', danger: true, confirm: 'Excluir essa tarefa?', onClick: () => onDelete() }] : []),
          ]}
        />
      )}
    </li>
  );
}

function CheckpointCard({
  checkpoint,
  tasks,
  onToggleCheckpoint,
  onToggleTask,
  onRenameCheckpoint,
  onDeleteCheckpoint,
  onRenameTask,
  onDeleteTask,
  toggleDisabled,
  projectId,
  collaboratorId,
}: {
  checkpoint: CheckpointFull;
  tasks: Task[];
  onToggleCheckpoint: () => void;
  onToggleTask: (t: Task) => void;
  onRenameCheckpoint: (name: string) => void;
  onDeleteCheckpoint: () => void;
  onRenameTask: (taskId: string, title: string) => void;
  onDeleteTask: (taskId: string) => void;
  toggleDisabled: boolean;
  projectId: string;
  collaboratorId: string | null;
}) {
  const isDone = checkpoint.status === 'done';
  const [expanded, setExpanded] = useState(!isDone);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(checkpoint.name);
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'done').length;

  function commitEdit() {
    const v = editValue.trim();
    if (v && v !== checkpoint.name) onRenameCheckpoint(v.slice(0, 200));
    setEditing(false);
  }

  return (
    <article className="surface overflow-hidden">
      {/* Header — visual de "marco/container". Padding maior, fundo do surface, checkbox quadrado grande. */}
      <div className="p-md flex items-start gap-md">
        <button
          type="button"
          onClick={onToggleCheckpoint}
          disabled={toggleDisabled}
          aria-label={isDone ? 'Reabrir checkpoint' : 'Marcar como feito'}
          className={[
            'mt-0.5 h-7 w-7 shrink-0 rounded-md border-2 grid place-items-center transition-colors focus-ring',
            isDone
              ? 'bg-tom border-tom text-white hover:bg-tom-shade'
              : 'bg-tom/10 border-tom/40 text-transparent hover:border-tom hover:bg-tom/20',
          ].join(' ')}
        >
          {isDone && <Check size={16} strokeWidth={3} />}
        </button>

        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              type="text"
              autoFocus
              value={editValue}
              maxLength={200}
              onChange={e => setEditValue(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                if (e.key === 'Escape') { setEditValue(checkpoint.name); setEditing(false); }
              }}
              className="w-full h-9 px-2 -ml-2 rounded-md bg-bg-elevated border border-border text-card-title text-fg focus-ring"
            />
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
              className="w-full text-left focus-ring rounded-sm"
            >
              <div className={['text-card-title', isDone ? 'line-through text-fg-muted' : ''].join(' ')}>
                {checkpoint.name}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-body-sm text-fg-muted tabular-nums">
                {checkpoint.due_date && <span>{brShort(checkpoint.due_date)}</span>}
                {total > 0 && <span>· {done}/{total} {total === 1 ? 'tarefa' : 'tarefas'}</span>}
              </div>
            </button>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1">
          <RowMenu
            items={[
              { label: 'Editar nome', onClick: () => { setEditValue(checkpoint.name); setEditing(true); } },
              {
                label: 'Excluir checkpoint',
                danger: true,
                confirm: 'Excluir? Tarefas viram sem checkpoint.',
                onClick: () => onDeleteCheckpoint(),
              },
            ]}
          />
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-label={expanded ? 'Recolher' : 'Expandir'}
            className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
          >
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>

      {/* Corpo — fundo levemente diferente + border-top pra dar separacao visual de container. */}
      {expanded && (
        <div className="space-y-3 bg-bg-subtle border-t border-border px-md pt-3 pb-md">
          {checkpoint.rationale && (
            <div className="bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
              <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
              <p className="whitespace-pre-line">{checkpoint.rationale}</p>
            </div>
          )}
          <div>
            <div className="text-label text-fg-muted uppercase tracking-wide mb-1">Checklist</div>
            <div className="border-l-2 border-border pl-md">
              {tasks.length > 0 && (
                <ul className="divide-y divide-border">
                  {tasks.map(t => (
                    <TaskListItem
                      key={t.id}
                      task={t}
                      onToggle={() => onToggleTask(t)}
                      onRename={(title) => onRenameTask(t.id, title)}
                      onDelete={() => onDeleteTask(t.id)}
                    />
                  ))}
                </ul>
              )}
              <div className={tasks.length > 0 ? 'pt-2' : ''}>
                <CreateTaskInline
                  projectId={projectId}
                  checkpointId={checkpoint.id}
                  collaboratorId={collaboratorId}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </article>
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
        className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-tom focus-ring rounded-sm px-1 py-0.5"
      >
        <Plus size={14} /> Tarefa
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
      <input
        type="text"
        autoFocus
        value={title}
        maxLength={200}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="O que precisa fazer..."
        className="flex-1 min-w-0 basis-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <div className="flex items-center gap-2 ml-auto">
        <button
          type="button"
          onClick={() => { setOpen(false); setTitle(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!title.trim() || createTask.isPending}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Salvar
        </button>
      </div>
    </form>
  );
}

// ---- RowMenu — ⋯ acionador com dropdown e confirmação inline pra acoes destrutivas.
type MenuItem = {
  label: string;
  onClick: () => void;
  danger?: boolean;
  /** Quando presente, click no item nao executa direto — exibe confirm inline. */
  confirm?: string;
};

function RowMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmIdx(null);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setConfirmIdx(null); }}
        aria-label="Mais ações"
        className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-md border border-border bg-bg-surface shadow-card overflow-hidden">
          {items.map((item, i) => {
            const isConfirming = confirmIdx === i;
            if (isConfirming && item.confirm) {
              return (
                <div key={i} className="px-3 py-2 border-b border-border last:border-b-0 bg-danger/5">
                  <div className="text-body-sm text-fg mb-2">{item.confirm}</div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmIdx(null); }}
                      className="flex-1 h-7 px-2 rounded-sm text-body-sm text-fg-muted hover:text-fg border border-border focus-ring"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); item.onClick(); setOpen(false); setConfirmIdx(null); }}
                      className="flex-1 h-7 px-2 rounded-sm text-body-sm font-semibold bg-danger text-white focus-ring"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={i}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (item.confirm) { setConfirmIdx(i); return; }
                  item.onClick();
                  setOpen(false);
                }}
                className={[
                  'w-full px-3 py-2 text-left text-body-sm hover:bg-bg-elevated transition-colors',
                  item.danger ? 'text-danger' : 'text-fg',
                ].join(' ')}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- CreateCheckpointInline — botao + form inline pra criar checkpoint.
function CreateCheckpointInline({ onCreate }: { onCreate: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  function commit(e: FormEvent) {
    e.preventDefault();
    const v = name.trim();
    if (!v) return;
    onCreate(v);
    setName('');
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="surface w-full p-md flex items-center gap-2 text-body-md text-fg-muted hover:text-tom hover:border-tom/40 transition-colors focus-ring"
      >
        <Plus size={16} /> Adicionar checkpoint
      </button>
    );
  }

  return (
    <form onSubmit={commit} className="surface p-md space-y-2">
      <div className="text-label text-fg-muted uppercase tracking-wide">Novo checkpoint</div>
      <input
        type="text"
        autoFocus
        value={name}
        maxLength={200}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setName(''); } }}
        placeholder="Ex: Reservar local"
        className="w-full h-10 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg placeholder:text-fg-muted focus-ring"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => { setOpen(false); setName(''); }}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={!name.trim()}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold disabled:opacity-50 focus-ring"
        >
          Criar
        </button>
      </div>
    </form>
  );
}
