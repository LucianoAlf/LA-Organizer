import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Rocket } from 'lucide-react';
import { supabase, supabaseConfigured } from '../lib/supabase';
import { Tabs } from '../components/Tabs';
import { Badge } from '../components/Badge';
import { LoadingState } from '../components/LoadingState';
import { EmptyState } from '../components/EmptyState';
import { brShort } from '../utils/date';
import type { Project, Task, Checkpoint } from '../types';

type TabId = 'resumo' | 'checkpoints' | 'tarefas' | 'time';

async function fetchProject(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, category, status, progress_percent, start_date, end_date, created_by')
    .eq('id', id).maybeSingle();
  if (error) throw error;
  return data as Project | null;
}

async function fetchCheckpoints(projectId: string): Promise<Checkpoint[]> {
  const { data, error } = await supabase
    .from('project_checkpoints')
    .select('id, project_id, name, due_date, status, completed_at, sort_order')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('due_date', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Checkpoint[];
}

async function fetchProjectTasks(projectId: string): Promise<Task[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, status, context, priority, due_date, scheduled_date, remind_at, eisenhower_quadrant, project_id, assigned_to, created_by, completed_at, projects(name)')
    .eq('project_id', projectId)
    .order('due_date', { ascending: true });
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

export function ProjetoDetalhe() {
  const { id = '' } = useParams();
  const [tab, setTab] = useState<TabId>('resumo');

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

  if (!supabaseConfigured) return <EmptyState icon={<Rocket size={32} />} title="Configure Supabase" />;
  if (pLoading) return <LoadingState rows={4} />;
  if (!project) return <EmptyState title="Projeto não encontrado" action={<Link to="/projetos" className="text-brand">Voltar</Link>} />;

  const next = checkpoints.find(c => c.status !== 'done' && c.status !== 'cancelled');
  const pct = Math.max(0, Math.min(100, project.progress_percent ?? 0));

  return (
    <div className="space-y-lg">
      <header>
        <Link to="/projetos" className="inline-flex items-center gap-2 text-body-sm text-fg-muted hover:text-fg focus-ring">
          <ArrowLeft size={16} /> Projetos
        </Link>
        <div className="mt-md flex items-start gap-md justify-between flex-wrap">
          <div className="min-w-0">
            <h2 className="text-screen-title">{project.name}</h2>
            {project.description && <p className="text-body-md text-fg-muted mt-1 max-w-prose">{project.description}</p>}
          </div>
          <Badge tone="project">{project.category}</Badge>
        </div>

        <div className="mt-md">
          <div className="flex items-center justify-between text-body-sm text-fg-muted mb-1.5 tabular-nums">
            <span>Progresso</span>
            <span>{pct}%</span>
          </div>
          <div className="h-2 w-full bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </header>

      <Tabs<TabId>
        tabs={[
          { id: 'resumo', label: 'Resumo' },
          { id: 'checkpoints', label: 'Checkpoints', badge: checkpoints.length },
          { id: 'tarefas', label: 'Tarefas', badge: tasks.length },
          { id: 'time', label: 'Time', badge: members.length },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'resumo' && (
        <section className="space-y-md">
          <div className="surface p-md">
            <div className="text-label text-fg-muted uppercase tracking-wide">Próximo passo</div>
            {next ? (
              <div className="mt-1.5">
                <div className="text-card-title">{next.name}</div>
                {next.due_date && (
                  <div className="text-body-sm text-fg-muted mt-1">Prazo: <span className="tabular-nums">{brShort(next.due_date)}</span></div>
                )}
              </div>
            ) : (
              <div className="mt-1.5 text-body-md text-fg-muted">Sem checkpoints pendentes.</div>
            )}
          </div>
        </section>
      )}

      {tab === 'checkpoints' && (
        <section className="surface">
          {checkpoints.length === 0 ? (
            <EmptyState title="Sem checkpoints ainda" />
          ) : (
            <ul className="divide-y divide-border">
              {checkpoints.map(c => (
                <li key={c.id} className="p-md flex items-center justify-between gap-md">
                  <div className="min-w-0">
                    <div className="text-body-md">{c.name}</div>
                    {c.due_date && <div className="text-body-sm text-fg-muted tabular-nums">{brShort(c.due_date)}</div>}
                  </div>
                  <Badge tone={
                    c.status === 'done' ? 'success' :
                    c.status === 'in_progress' ? 'warning' :
                    c.status === 'cancelled' ? 'neutral' : 'info'
                  }>{c.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === 'tarefas' && (
        <section className="surface">
          {tasks.length === 0 ? (
            <EmptyState title="Sem tarefas vinculadas" />
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map(t => (
                <li key={t.id} className="p-md flex items-center justify-between gap-md">
                  <div className="min-w-0">
                    <div className={['text-body-md', t.status === 'done' ? 'line-through text-fg-muted' : ''].join(' ')}>{t.title}</div>
                    <div className="text-body-sm text-fg-muted">{t.due_date ? brShort(t.due_date) : '—'}</div>
                  </div>
                  <Badge tone={t.status === 'done' ? 'success' : t.status === 'overdue' ? 'danger' : 'neutral'}>{t.status}</Badge>
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
              {members.map((m: any) => (
                <li key={m.collaborator_id} className="p-md flex items-center justify-between gap-md">
                  <div>
                    <div className="text-body-md">{m.collaborators?.full_name ?? '—'}</div>
                    <div className="text-body-sm text-fg-muted">{m.collaborators?.function_title ?? m.collaborators?.role ?? ''}</div>
                  </div>
                  <Badge tone="neutral">{m.role_in_project}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
