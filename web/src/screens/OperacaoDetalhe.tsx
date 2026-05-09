import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  unitLabel,
  STATUS_LABEL_OPERATIONAL,
  PRIORITY_INDICATOR,
  timeAgo,
} from '../types';
import type { OperationalTask, TaskPriority } from '../types';
import { PageHeader } from '../components/PageHeader';

const COMMENT_TYPE_LABEL: Record<string, string> = {
  manual: 'Comentário',
  agent_note: 'TOM',
  status_change: 'Mudança de status',
  delegation: 'Delegação',
  deadline_extension: 'Extensão de prazo',
};

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  critical: 'Urgente',
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Sem prazo';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

type TaskWithCreator = OperationalTask & {
  creator?: { id: string; full_name: string } | null;
};

interface TaskComment {
  id: string;
  body: string;
  comment_type: string;
  created_at: string;
  created_by: string;
  author?: { full_name: string } | null;
}

export function OperacaoDetalhe() {
  const { id } = useParams<{ id: string }>();

  const { data: task, isLoading, error } = useQuery({
    queryKey: ['operacao-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          id, title, description, status, priority, due_date, notes, created_at,
          assigned_to, created_by, department_id, request_type_id,
          request_type:department_request_types!tasks_request_type_id_fkey(id, slug, label),
          department:departments!tasks_department_id_fkey(id, slug, name),
          collaborator:collaborators!tasks_assigned_to_fkey(id, full_name, unit),
          creator:collaborators!tasks_created_by_fkey(id, full_name)
        `)
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data as unknown as TaskWithCreator;
    },
    enabled: !!id,
  });

  const { data: comments = [] } = useQuery({
    queryKey: ['operacao-comments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('id, body, comment_type, created_at, created_by, author:collaborators!task_comments_created_by_fkey(full_name)')
        .eq('task_id', id)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as TaskComment[];
    },
    enabled: !!id,
  });

  if (isLoading) return <p className="text-body-sm text-fg-muted">Carregando...</p>;
  if (error || !task) return (
    <div className="space-y-3">
      <Link to="/mais/operacoes" className="text-caption text-fg-muted underline">← Voltar</Link>
      <p className="text-danger text-body-sm">Demanda não encontrada.</p>
    </div>
  );

  const priorityInfo = PRIORITY_INDICATOR[task.priority];

  return (
    <div className="space-y-4">
      {/* Header */}
      <PageHeader
        title={task.title}
        subtitle={`${priorityInfo.emoji} ${PRIORITY_LABEL[task.priority]} · ${task.request_type?.label ?? '—'} · ${STATUS_LABEL_OPERATIONAL[task.status] ?? task.status}`}
        backTo="/mais/operacoes"
      />

      {/* Bloco 1 — Resumo */}
      <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
        <p className="text-caption uppercase font-semibold text-fg-muted">Resumo</p>

        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <span className="text-body-sm text-fg-muted">Tipo</span>
          <span className="text-body text-fg">{task.request_type?.label ?? '—'}</span>

          <span className="text-body-sm text-fg-muted">Prioridade</span>
          <span className="text-body text-fg">
            {priorityInfo.emoji} {PRIORITY_LABEL[task.priority]}
          </span>

          <span className="text-body-sm text-fg-muted">Status</span>
          <span className="text-body text-fg">{STATUS_LABEL_OPERATIONAL[task.status] ?? task.status}</span>

          <span className="text-body-sm text-fg-muted">Responsável</span>
          <span className="text-body text-fg">
            {task.collaborator?.full_name ?? '—'}
            {task.collaborator?.unit ? ` · ${unitLabel(task.collaborator.unit)}` : ''}
          </span>

          <span className="text-body-sm text-fg-muted">Criado por</span>
          <span className="text-body text-fg">{task.creator?.full_name ?? '—'}</span>

          <span className="text-body-sm text-fg-muted">Prazo</span>
          <span className="text-body text-fg">{formatDate(task.due_date)}</span>

          <span className="text-body-sm text-fg-muted">Criado em</span>
          <span className="text-body text-fg">{task.created_at ? timeAgo(task.created_at) : '—'}</span>
        </div>
      </section>

      {/* Bloco 2 — Descrição */}
      {task.description && (
        <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
          <p className="text-caption uppercase font-semibold text-fg-muted">Descrição</p>
          <p className="text-body text-fg" style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p>
        </section>
      )}

      {/* Bloco 3 — Notes */}
      {task.notes && (
        <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
          <p className="text-caption uppercase font-semibold text-fg-muted">Notas</p>
          <p className="text-body-sm text-fg-muted italic">{task.notes}</p>
        </section>
      )}

      {/* Bloco 4 — Histórico */}
      <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
        <p className="text-caption uppercase font-semibold text-fg-muted">Histórico</p>

        {comments.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Sem comentários ainda.</p>
        ) : (
          <div className="space-y-3">
            {comments.map(c => (
              <div key={c.id} className="border-t border-border pt-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-body-sm font-medium text-fg">
                    {c.author?.full_name ?? '—'}
                  </span>
                  <span className="text-caption text-fg-muted">
                    {COMMENT_TYPE_LABEL[c.comment_type] ?? c.comment_type}
                    {' · '}
                    {timeAgo(c.created_at)}
                  </span>
                </div>
                <p className="text-body text-fg" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
