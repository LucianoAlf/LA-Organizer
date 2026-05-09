import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  unitLabel,
  STATUS_LABEL_OPERATIONAL,
  PRIORITY_INDICATOR,
  timeAgo,
} from '../types';
import type { OperationalTask, TaskPriority } from '../types';
import { PageHeader } from '../components/PageHeader';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { Button } from '../components/Button';
import { showToast } from '../components/Toast';

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

function isOverdue(due: string | null | undefined): boolean {
  if (!due) return false;
  const today = new Date().toISOString().slice(0, 10);
  return due.slice(0, 10) < today;
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
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const [commentBody, setCommentBody] = useState('');

  const { data: task, isLoading, error, refetch } = useQuery({
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

  const { data: comments = [], error: commentsError } = useQuery({
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

  const statusMutation = useMutation({
    mutationFn: async (next: string) => {
      if (!id) throw new Error('sem id');
      const { error } = await supabase.from('tasks').update({ status: next }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_v, next) => {
      qc.invalidateQueries({ queryKey: ['operacao-detail', id] });
      qc.invalidateQueries({ queryKey: ['operacao-comments', id] });
      qc.invalidateQueries({ queryKey: ['operational-tasks'] });
      showToast({ kind: 'success', title: 'Status atualizado', msg: STATUS_LABEL_OPERATIONAL[next] ?? next });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao atualizar', msg: err.message });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!id || !collaborator?.id) throw new Error('sem auth');
      const { error } = await supabase.from('task_comments').insert({
        task_id: id,
        body: body.trim(),
        comment_type: 'manual',
        created_by: collaborator.id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setCommentBody('');
      qc.invalidateQueries({ queryKey: ['operacao-comments', id] });
      showToast({ kind: 'success', title: 'Comentário registrado' });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao comentar', msg: err.message });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-md">
        <PageHeader title="Demanda" backTo="/mais/operacoes" />
        <LoadingState rows={4} />
      </div>
    );
  }
  if (error || !task) {
    return (
      <div className="space-y-md">
        <PageHeader title="Demanda" backTo="/mais/operacoes" />
        <ErrorState
          title="Não consegui carregar"
          description={error ? (error as Error).message : 'Demanda não encontrada.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  const priorityInfo = PRIORITY_INDICATOR[task.priority];
  const overdue = isOverdue(task.due_date);
  const canApprove = role === 'director' || role === 'coordinator';

  // Status transition buttons available per current state
  function actionButtons() {
    const s = task!.status;
    if (s === 'pending') {
      return (
        <Button
          onClick={() => statusMutation.mutate('in_progress')}
          disabled={statusMutation.isPending}
          variant="primary"
        >
          Iniciar
        </Button>
      );
    }
    if (s === 'in_progress') {
      return (
        <Button
          onClick={() => statusMutation.mutate('awaiting_confirmation')}
          disabled={statusMutation.isPending}
          variant="primary"
        >
          Marcar pronto
        </Button>
      );
    }
    if (s === 'awaiting_confirmation' && canApprove) {
      return (
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => statusMutation.mutate('done')} disabled={statusMutation.isPending} variant="primary">
            Aprovar
          </Button>
          <Button onClick={() => statusMutation.mutate('in_progress')} disabled={statusMutation.isPending} variant="ghost">
            Reabrir
          </Button>
        </div>
      );
    }
    if (s === 'awaiting_confirmation') {
      return <p className="text-body-sm text-fg-muted">Aguardando aprovação da coordenação.</p>;
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={task.title}
        subtitle={`${priorityInfo.emoji} ${PRIORITY_LABEL[task.priority]} · ${task.request_type?.label ?? '—'} · ${STATUS_LABEL_OPERATIONAL[task.status] ?? task.status}`}
        backTo="/mais/operacoes"
      />

      {/* Ações */}
      {actionButtons() && (
        <section className="bg-bg-surface rounded-xl border border-border p-4">
          {actionButtons()}
        </section>
      )}

      {/* Resumo */}
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
          <span className={`text-body ${overdue ? 'text-danger font-semibold' : 'text-fg'}`}>
            {formatDate(task.due_date)}
            {overdue && ' · atrasada'}
          </span>

          <span className="text-body-sm text-fg-muted">Criado em</span>
          <span className="text-body text-fg">{task.created_at ? timeAgo(task.created_at) : '—'}</span>
        </div>
      </section>

      {/* Descrição */}
      {task.description && (
        <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
          <p className="text-caption uppercase font-semibold text-fg-muted">Descrição</p>
          <p className="text-body text-fg" style={{ whiteSpace: 'pre-wrap' }}>{task.description}</p>
        </section>
      )}

      {/* Notes */}
      {task.notes && (
        <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
          <p className="text-caption uppercase font-semibold text-fg-muted">Notas</p>
          <p className="text-body-sm text-fg-muted italic">{task.notes}</p>
        </section>
      )}

      {/* Histórico + form de comentário */}
      <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-3">
        <p className="text-caption uppercase font-semibold text-fg-muted">Histórico</p>

        {commentsError ? (
          <p className="text-danger text-body-sm">Não consegui carregar comentários.</p>
        ) : comments.length === 0 ? (
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

        <form
          className="space-y-2 pt-2 border-t border-border"
          onSubmit={(e) => {
            e.preventDefault();
            const body = commentBody.trim();
            if (!body || commentMutation.isPending) return;
            commentMutation.mutate(body);
          }}
        >
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            rows={2}
            placeholder="Comentar (progresso, dúvida, próximo passo)…"
            className="w-full rounded-lg border border-border bg-bg-app px-3 py-2 text-body resize-none focus:outline-none focus:border-brand"
          />
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!commentBody.trim() || commentMutation.isPending}
              variant="primary"
            >
              {commentMutation.isPending ? 'Enviando…' : 'Comentar'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
