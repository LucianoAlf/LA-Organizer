import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
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
import { RowMenu } from '../components/RowMenu';
import { DemandaSheet } from '../components/DemandaSheet';
import { showToast } from '../components/Toast';
import { botoesDaEspera, modoComFallback, rotuloStatus } from '../lib/aprovacaoTarefa';
import { useModoEspera, decidirAprovacao } from '../hooks/useTarefaAprovacao';

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

type TaskWithCreator = Omit<OperationalTask, 'request_type'> & {
  request_type?: { id: string; slug: string; label: string; requires_approval?: boolean | null } | null;
  creator?: { id: string; full_name: string } | null;
};

interface TaskComment {
  id: string;
  content: string;
  comment_type: string;
  created_at: string;
  created_by: string;
  author?: { full_name: string } | null;
}

export function OperacaoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const { collaborator, role } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [commentBody, setCommentBody] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  // Rejeição de compra/obra: motivo opcional antes de confirmar (vai pro aviso de quem pediu).
  const [rejeitando, setRejeitando] = useState(false);
  const [motivoRejeicao, setMotivoRejeicao] = useState('');

  const { data: task, isLoading, error, refetch } = useQuery({
    queryKey: ['operacao-detail', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tasks')
        .select(`
          id, title, description, status, priority, due_date, notes, created_at,
          assigned_to, created_by, department_id, request_type_id,
          request_type:department_request_types!tasks_request_type_id_fkey(id, slug, label, requires_approval),
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

  // BOTAO-APROVAR-OPERACOES (05/10): awaiting_confirmation = aprovação pra EXECUTAR (compra/obra) ou
  // confirmação de CONCLUSÃO ("Marcar pronto"). Quem diz qual é o TOM (trilha tasks_audit); se ele
  // não responder, cai no tipo da demanda — o POST confere de novo no servidor.
  const modoQuery = useModoEspera(task?.id, task?.status);
  const modoEspera = modoComFallback({
    modoServidor: modoQuery.data,
    falhou: modoQuery.isError,
    requerAprovacao: task?.request_type?.requires_approval,
  });

  const { data: comments = [], error: commentsError } = useQuery({
    queryKey: ['operacao-comments', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_comments')
        .select('id, content, comment_type, created_at, created_by, author:collaborators!task_comments_created_by_fkey(full_name)')
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
      // Audit trail: registra como task_comment status_change
      if (collaborator?.id) {
        const fromLabel = task ? rotuloStatus(task.status, modoEspera) : '?';
        const toLabel = STATUS_LABEL_OPERATIONAL[next] ?? next;
        await supabase.from('task_comments').insert({
          task_id: id,
          content: `${fromLabel} → ${toLabel}`,
          comment_type: 'status_change',
          created_by: collaborator.id,
        });
      }
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

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('sem id');
      const { error } = await supabase.from('tasks').update({ status: 'cancelled' }).eq('id', id);
      if (error) throw error;
      if (collaborator?.id && task) {
        await supabase.from('task_comments').insert({
          task_id: id,
          content: `${rotuloStatus(task.status, modoEspera)} → Cancelada`,
          comment_type: 'status_change',
          created_by: collaborator.id,
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['operational-tasks'] });
      qc.invalidateQueries({ queryKey: ['operational-tasks-counts'] });
      showToast({ kind: 'success', title: 'Demanda cancelada' });
      navigate('/mais/operacoes');
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao cancelar', msg: err.message });
    },
  });

  // Aprovar/Rejeitar compra/obra: MESMO funil do WhatsApp (decidirAprovacaoDeTarefa no TOM) —
  // 'pending'/'cancelled', fecha o APROV-XXXX, avisa quem pediu. Nunca 'done'.
  const decisaoMutation = useMutation({
    mutationFn: async (args: { decisao: 'approve' | 'reject'; motivo?: string }) => {
      if (!id) throw new Error('sem id');
      const r = await decidirAprovacao(id, args.decisao, args.motivo ?? null);
      if (collaborator?.id) {
        const motivo = args.decisao === 'reject' && args.motivo?.trim() ? ` — motivo: ${args.motivo.trim()}` : '';
        await supabase.from('task_comments').insert({
          task_id: id,
          content: `Aguardando aprovação → ${args.decisao === 'approve' ? 'Aprovada (Pendente)' : 'Rejeitada (Cancelada)'}${motivo}`,
          comment_type: 'status_change',
          created_by: collaborator.id,
        });
      }
      return r;
    },
    onSuccess: (r, args) => {
      setRejeitando(false);
      setMotivoRejeicao('');
      showToast({
        kind: 'success',
        title: args.decisao === 'approve' ? 'Aprovada — vai pra execução' : 'Rejeitada e cancelada',
        msg: r.avisou ? 'Avisei quem pediu no WhatsApp.' : 'Não consegui avisar quem pediu no WhatsApp.',
      });
    },
    onError: (err: Error) => {
      showToast({ kind: 'error', title: 'Falha ao decidir', msg: err.message });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['operacao-detail', id] });
      qc.invalidateQueries({ queryKey: ['operacao-comments', id] });
      qc.invalidateQueries({ queryKey: ['operational-tasks'] });
      qc.invalidateQueries({ queryKey: ['operational-tasks-counts'] });
      qc.invalidateQueries({ queryKey: ['tarefa-aprovacao-modo', id] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async (body: string) => {
      if (!id || !collaborator?.id) throw new Error('sem auth');
      const { error } = await supabase.from('task_comments').insert({
        task_id: id,
        content: body.trim(),
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
    if (s !== 'awaiting_confirmation') return null;
    const b = botoesDaEspera(modoEspera, canApprove);
    if (b.tipo === 'carregando') {
      return <p className="text-body-sm text-fg-muted">Conferindo se é aprovação ou conclusão…</p>;
    }
    if (b.tipo === 'aviso') {
      return <p className="text-body-sm text-fg-muted">{b.texto}</p>;
    }
    if (b.tipo === 'conclusao') {
      // (b) "Marcar pronto" → confirmar conclusão (done) ou reabrir (in_progress), direto no app.
      return (
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => statusMutation.mutate(b.confirmar.proximo)} disabled={statusMutation.isPending} variant="primary">
            {b.confirmar.rotulo}
          </Button>
          <Button onClick={() => statusMutation.mutate(b.reabrir.proximo)} disabled={statusMutation.isPending} variant="ghost">
            {b.reabrir.rotulo}
          </Button>
        </div>
      );
    }
    // (a) compra/obra aguardando aprovação pra ser feita → TOM decide e avisa quem pediu.
    const ocupado = decisaoMutation.isPending;
    if (rejeitando) {
      return (
        <div className="space-y-2">
          <textarea
            value={motivoRejeicao}
            onChange={(e) => setMotivoRejeicao(e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Motivo (opcional) — vai no aviso pra quem pediu"
            className="w-full rounded-lg border border-border bg-bg-app px-3 py-2 text-body resize-none focus:outline-none focus:border-brand"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              onClick={() => decisaoMutation.mutate({ decisao: 'reject', motivo: motivoRejeicao })}
              disabled={ocupado}
              variant="danger"
            >
              {ocupado ? 'Rejeitando…' : 'Confirmar rejeição'}
            </Button>
            <Button onClick={() => { setRejeitando(false); setMotivoRejeicao(''); }} disabled={ocupado} variant="ghost">
              Voltar
            </Button>
          </div>
        </div>
      );
    }
    return (
      <div className="flex gap-2 flex-wrap">
        <Button onClick={() => decisaoMutation.mutate({ decisao: 'approve' })} disabled={ocupado} variant="primary">
          {ocupado ? 'Aprovando…' : b.aprovar}
        </Button>
        <Button onClick={() => setRejeitando(true)} disabled={ocupado} variant="ghost">
          {b.rejeitar}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={task.title}
        subtitle={`${priorityInfo.emoji} ${PRIORITY_LABEL[task.priority]} · ${task.request_type?.label ?? '—'} · ${rotuloStatus(task.status, modoEspera)}`}
        backTo="/mais/operacoes"
        right={
          <RowMenu
            items={[
              { label: 'Editar', onClick: () => setEditOpen(true) },
              {
                label: 'Cancelar demanda',
                danger: true,
                confirm: 'Cancelar essa demanda?',
                onClick: () => cancelMutation.mutate(),
              },
            ]}
          />
        }
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
          <span className="text-body text-fg">{rotuloStatus(task.status, modoEspera)}</span>

          <span className="text-body-sm text-fg-muted">Responsável</span>
          <span className="text-body text-fg">
            {task.collaborator?.id ? (
              <Link to={`/time/${task.collaborator.id}`} className="text-brand underline focus-ring rounded-sm">
                {task.collaborator.full_name}
              </Link>
            ) : (
              task.collaborator?.full_name ?? '—'
            )}
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

      {/* Notas (contexto/origem capturado pelo TOM) */}
      {task.notes && (
        <section className="bg-bg-surface rounded-xl border border-border p-4 space-y-2">
          <p className="text-caption uppercase font-semibold text-fg-muted">Notas</p>
          <p className="text-body text-fg" style={{ whiteSpace: 'pre-wrap' }}>{task.notes}</p>
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
                <p className="text-body text-fg" style={{ whiteSpace: 'pre-wrap' }}>{c.content}</p>
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

      <DemandaSheet
        open={editOpen}
        onClose={() => setEditOpen(false)}
        mode={{ kind: 'edit', task }}
      />
    </div>
  );
}
