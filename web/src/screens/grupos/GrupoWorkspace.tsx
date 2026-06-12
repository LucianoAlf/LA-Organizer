// web/src/screens/grupos/GrupoWorkspace.tsx
// Workspace do grupo (spec 2026-06-10) — o "escritório" do time: stats, pool por
// urgência, pacotes do mês e feitas recentes. Rota /grupos/:groupId (Task 6 liga).
// Fiel ao mockup aprovado (docs/superpowers/specs/assets/2026-06-10-workspace-grupos-mockup.html §2).
import { useState, useCallback, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Plus, Settings, MessageSquare } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, useMyGroupIds } from '../../hooks/useWorkGroups';
import { useGroupWorkspace, type PoolTaskRow } from '../../hooks/useGroupWorkspace';
import { useGroupChat } from '../../hooks/useGroupChat';
import { unreadCount } from '../../lib/groupChat';
import { GroupChatDrawer } from './chat/GroupChatDrawer';
import { doneWhenLabel } from '../../lib/groupWorkspace';
import { toggleChildWithCascade } from '../../lib/taskGroups';
import { todaySP, brShort } from '../../utils/date';
import { StatCard } from '../../components/StatCard';
import { TaskCheckbox } from '../../components/TaskCheckbox';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Fab } from '../../components/Fab';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { showToast } from '../../components/Toast';
import { QuickCreateSheet } from '../../components/QuickCreateSheet';
import { TaskGroupSheet } from '../../components/TaskGroupSheet';
import { GroupTaskSheet } from './GroupTaskSheet';
import { GroupConfigPanel } from './GroupConfigPanel';
import type { Task } from '../../types';

const first = (name: string | null | undefined) => (name ?? '').split(' ')[0];

function daysLate(due: string, today: string): number {
  const a = new Date(`${due}T12:00:00Z`).getTime();
  const b = new Date(`${today}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000));
}

// Filha do pacote vem com done_by embedado (PKG_SELECT) — Task base não tem o campo.
type PkgChild = Task & { done_by?: { full_name: string } | null };

function SectionLabel({ danger, children }: { danger?: boolean; children: ReactNode }) {
  return (
    <div className={`text-label uppercase tracking-wide mb-xs ${danger ? 'text-danger' : 'text-fg-muted'}`}>
      {children}
    </div>
  );
}

// Linha do pool — checkbox + título clicável + badge de prazo/conclusão + criador.
function PoolRow({ t, today, busy, onToggle, onOpen }: {
  t: PoolTaskRow;
  today: string;
  busy: boolean;
  onToggle: (t: PoolTaskRow, done: boolean) => void;
  onOpen: (t: PoolTaskRow) => void;
}) {
  const done = t.status === 'done';
  const overdue = !done && Boolean(t.due_date && t.due_date < today);

  let badge: ReactNode = null;
  if (done && t.completed_at) {
    badge = (
      <Badge tone="success">
        por {first(t.completed_by_name) || '—'} · {doneWhenLabel(t.completed_at, new Date().toISOString())}
      </Badge>
    );
  } else if (t.due_date) {
    if (t.due_date < today) badge = <Badge tone="danger">{daysLate(t.due_date, today)}d atrasada</Badge>;
    else if (t.due_date === today) badge = <Badge tone="warning">hoje</Badge>;
    else badge = <Badge tone="warning">{brShort(t.due_date)}</Badge>;
  }

  return (
    <div className="flex items-center gap-sm px-md py-sm border-b border-border last:border-b-0">
      <TaskCheckbox done={done} overdue={overdue} disabled={busy} onClick={() => onToggle(t, !done)} />
      <button
        type="button"
        onClick={() => onOpen(t)}
        className={`flex-1 min-w-0 text-left text-body-md truncate focus-ring rounded-sm ${
          done ? 'line-through text-fg-muted' : 'text-fg'
        }`}
      >
        {t.title}
      </button>
      {badge}
      {!done && t.creator_name && (
        <span className="text-body-sm text-fg-muted whitespace-nowrap max-md:hidden">por {first(t.creator_name)}</span>
      )}
    </div>
  );
}

export function GrupoWorkspace() {
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { role } = useAuth();
  const { list, meuId } = useWorkGroups();
  const myIds = useMyGroupIds();
  const ws = useGroupWorkspace(groupId, meuId || undefined);

  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<'task' | 'group'>('task');
  const [editing, setEditing] = useState<PoolTaskRow | null>(null);
  const [openPkgId, setOpenPkgId] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [childBusy, setChildBusy] = useState<string | null>(null);

  // Chat de grupo (Fase 1): drawer + badge de não-lidas (last_read em localStorage).
  const [chatOpen, setChatOpen] = useState(false);
  const [chatFull, setChatFull] = useState(false);
  const chatPeek = useGroupChat(groupId);
  const lastReadKey = `chat-read-${groupId ?? ''}`;
  const [lastRead, setLastRead] = useState<string | null>(() => localStorage.getItem(lastReadKey));
  const unread = unreadCount(chatPeek.messages.data ?? [], lastRead, chatPeek.meId);
  const markSeen = useCallback(() => {
    const iso = new Date().toISOString();
    localStorage.setItem(lastReadKey, iso);
    setLastRead(iso);
  }, [lastReadKey]);

  const today = todaySP();

  async function onToggle(t: PoolTaskRow, done: boolean) {
    setRowBusy(t.id);
    try {
      await ws.toggleDone.mutateAsync({ task: t, done });
    } catch (e) {
      if (e instanceof Error && e.message === 'JA_CONCLUIDA') {
        showToast({ kind: 'info', title: '✋ Já concluída por outra pessoa', msg: 'Atualizei a lista.' });
      } else {
        showToast({ kind: 'error', title: 'Não consegui atualizar a tarefa' });
      }
    } finally {
      setRowBusy(null);
    }
  }

  async function onToggleChild(k: Task) {
    const done = k.status === 'done';
    setChildBusy(k.id);
    try {
      await toggleChildWithCascade(k, !done);
    } catch {
      showToast({ kind: 'error', title: 'Não consegui atualizar a subtarefa' });
    } finally {
      setChildBusy(null);
      ws.invalidate();
    }
  }

  function openCreate(kind: 'task' | 'group') {
    setCreateKind(kind);
    setCreateOpen(true);
  }

  // —— guards (depois de TODOS os hooks) ——
  if (list.isLoading || myIds.isLoading) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <LoadingState rows={4} label="Carregando o grupo…" />
      </div>
    );
  }

  const backBtn = (
    <Button variant="secondary" size="md" onClick={() => navigate('/grupos')}>
      <ChevronLeft size={14} aria-hidden /> Voltar pros grupos
    </Button>
  );

  if (list.isError) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <EmptyState title="Não consegui carregar o grupo" description="Confere a conexão e tenta de novo." action={backBtn} />
      </div>
    );
  }

  const group = (list.data ?? []).find(g => g.id === groupId);

  if (!group) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <EmptyState title="Grupo não encontrado" description="Esse grupo não existe ou foi desativado." action={backBtn} />
      </div>
    );
  }

  const isMember = Boolean(groupId && (myIds.data ?? []).includes(groupId));
  const canManage =
    role === 'director' || role === 'coordinator' || role === 'manager' || group.leader_id === meuId;

  if (!isMember && !canManage) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <EmptyState
          title="Você não está neste grupo"
          description="Pede pro líder ou pra direção te adicionar pela engrenagem do grupo."
          action={backBtn}
        />
      </div>
    );
  }

  const leader = group.members.find(m => m.collaborator_id === group.leader_id);
  const others = group.members.filter(m => m.collaborator_id !== group.leader_id);
  const membersLine = [leader ? `★ ${first(leader.full_name)}` : null, ...others.map(m => first(m.full_name))]
    .filter(Boolean)
    .join(' · ');

  const { buckets, stats } = ws;
  const pkgs = ws.packages.data ?? [];
  const wsLoading = ws.pool.isLoading || ws.packages.isLoading;
  const wsError = ws.pool.isError || ws.packages.isError;
  const isEmpty =
    !wsLoading && !wsError && (ws.pool.data ?? []).length === 0 && pkgs.length === 0;

  const gearBtn = (extra: string) => (
    <button
      type="button"
      onClick={() => setConfigOpen(true)}
      aria-label="Configurações do grupo"
      className={`grid place-items-center rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring ${extra}`}
    >
      <Settings size={18} />
    </button>
  );

  const surfaceCls = 'rounded-md border bg-bg-surface shadow-card dark:shadow-none overflow-hidden';

  return (
    <div className="flex gap-lg w-full">
      {/* coluna de conteúdo — reserva espaço à direita (pr) quando o chat (fixo na viewport) abre */}
      <div className={`flex-1 min-w-0 space-y-lg pb-2xl ${chatOpen ? 'md:pr-[404px]' : ''}`}>
      {/* header */}
      <header className="flex items-start gap-md">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => navigate('/grupos')}
            className="inline-flex items-center gap-xs text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm"
          >
            <ChevronLeft size={14} aria-hidden /> Grupos
          </button>
          <div className="flex items-center gap-sm">
            <h1 className="text-screen-title truncate">👥 {group.name}</h1>
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              aria-label={`Abrir chat${unread > 0 ? ` · ${unread} não lidas` : ''}`}
              className="md:hidden ml-auto relative grid place-items-center h-9 w-9 rounded-md border border-border bg-bg-surface text-fg hover:bg-bg-elevated focus-ring"
            >
              <MessageSquare size={18} />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 grid place-items-center rounded-full bg-tom text-black text-[10px] font-bold">{unread}</span>
              )}
            </button>
            {canManage && <div className="md:hidden">{gearBtn('h-9 w-9')}</div>}
          </div>
          <p className="text-body-sm text-fg-muted mt-xs">{membersLine} — qualquer um conclui</p>
        </div>
        <div className="max-md:hidden flex items-center gap-sm shrink-0 pt-md">
          <Button
            variant={chatOpen ? 'primary' : 'secondary'}
            size="md"
            leadingIcon={<MessageSquare size={16} />}
            onClick={() => setChatOpen(v => !v)}
          >
            Chat{unread > 0 ? ` · ${unread}` : ''}
          </Button>
          <Button variant="secondary" size="md" onClick={() => openCreate('group')}>
            🗂️ + Pacote mensal
          </Button>
          <Button variant="primary" size="md" leadingIcon={<Plus size={16} />} onClick={() => openCreate('task')}>
            Nova tarefa
          </Button>
          {canManage && gearBtn('h-11 w-11')}
        </div>
      </header>

      {/* stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-sm">
        <StatCard label="Abertas" value={stats.abertas} tone="neutral" />
        <StatCard label="Vence em breve" value={stats.venceEmBreve} tone={stats.venceEmBreve > 0 ? 'warning' : 'neutral'} />
        <StatCard label="Atrasadas" value={stats.atrasadas} tone={stats.atrasadas > 0 ? 'danger' : 'neutral'} />
        <StatCard label="Feitas no mês" value={stats.feitasNoMes} tone={stats.feitasNoMes > 0 ? 'success' : 'neutral'} />
      </div>

      {wsLoading && <LoadingState rows={3} />}

      {wsError && (
        <EmptyState
          title="Não consegui carregar as tarefas do grupo"
          description="Recarrega a página ou tenta de novo já já."
        />
      )}

      {isEmpty && (
        <EmptyState
          title="Pool vazio"
          description={`Cria a primeira tarefa pelo botão ou manda no WhatsApp: "TOM, cria uma tarefa pro ${group.name}".`}
          action={
            <Button variant="primary" size="md" leadingIcon={<Plus size={16} />} onClick={() => openCreate('task')}>
              Nova tarefa
            </Button>
          }
        />
      )}

      {/* 🔴 atrasadas */}
      {buckets.overdue.length > 0 && (
        <section>
          <SectionLabel danger>🔴 Atrasadas</SectionLabel>
          <div className={`${surfaceCls} border-danger/35`}>
            {buckets.overdue.map(t => (
              <PoolRow key={t.id} t={t as PoolTaskRow} today={today} busy={rowBusy === t.id} onToggle={onToggle} onOpen={setEditing} />
            ))}
          </div>
        </section>
      )}

      {/* ⏰ vence em breve */}
      {buckets.dueSoon.length > 0 && (
        <section>
          <SectionLabel>⏰ Vence em breve</SectionLabel>
          <div className={`${surfaceCls} border-border`}>
            {buckets.dueSoon.map(t => (
              <PoolRow key={t.id} t={t as PoolTaskRow} today={today} busy={rowBusy === t.id} onToggle={onToggle} onOpen={setEditing} />
            ))}
          </div>
        </section>
      )}

      {/* 🗂️ pacotes do mês */}
      {pkgs.length > 0 && (
        <section>
          <SectionLabel>🗂️ Pacotes do mês</SectionLabel>
          <div className="space-y-sm">
            {pkgs.map(pkg => {
              const subs = ((pkg.subtasks ?? []) as PkgChild[]).filter(s => s.status !== 'cancelled');
              const doneCount = subs.filter(s => s.status === 'done').length;
              const pct = subs.length > 0 ? Math.round((doneCount / subs.length) * 100) : 0;
              return (
                <div key={pkg.id} className="rounded-md border border-border bg-bg-surface shadow-card dark:shadow-none p-md">
                  <div className="flex items-center gap-sm min-w-0">
                    <button
                      type="button"
                      onClick={() => setOpenPkgId(pkg.id)}
                      className="text-left text-body-lg font-semibold text-fg hover:text-tom truncate focus-ring rounded-sm"
                    >
                      {pkg.title}
                    </button>
                    {pkg.recurrence_parent_id && <Badge tone="neutral">mensal</Badge>}
                    <span className="ml-auto text-body-sm text-fg-muted tabular-nums shrink-0">
                      {doneCount}/{subs.length}
                    </span>
                  </div>
                  <div className="h-1 rounded-full bg-bg-subtle overflow-hidden my-sm">
                    <div className="h-full bg-tom" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="space-y-xs">
                    {subs.map(s => {
                      const sDone = s.status === 'done';
                      const day = s.due_date ? String(Number(s.due_date.slice(8, 10))) : null;
                      const by = sDone ? first(s.done_by?.full_name) : '';
                      const right = [day ? `dia ${day}` : null, by ? `por ${by}` : null].filter(Boolean).join(' · ');
                      return (
                        <div key={s.id} className="flex items-center gap-sm py-xs">
                          <TaskCheckbox
                            done={sDone}
                            size="sm"
                            disabled={childBusy === s.id}
                            onClick={() => onToggleChild(s)}
                            ariaLabel={`${sDone ? 'Reabrir' : 'Concluir'} ${s.title}`}
                          />
                          <span className={`flex-1 min-w-0 truncate text-body-md ${sDone ? 'line-through text-fg-muted' : 'text-fg'}`}>
                            {s.title}
                          </span>
                          {right && <span className="text-body-sm text-fg-muted whitespace-nowrap">{right}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 📅 mais pra frente */}
      {buckets.later.length > 0 && (
        <section>
          <SectionLabel>📅 Mais pra frente · sem prazo</SectionLabel>
          <div className={`${surfaceCls} border-border`}>
            {buckets.later.map(t => (
              <PoolRow key={t.id} t={t as PoolTaskRow} today={today} busy={rowBusy === t.id} onToggle={onToggle} onOpen={setEditing} />
            ))}
          </div>
        </section>
      )}

      {/* ✅ feitas recentemente */}
      {buckets.doneRecent.length > 0 && (
        <section>
          <SectionLabel>✅ Feitas recentemente</SectionLabel>
          <div className={`${surfaceCls} border-border opacity-85`}>
            {buckets.doneRecent.map(t => (
              <PoolRow key={t.id} t={t as PoolTaskRow} today={today} busy={rowBusy === t.id} onToggle={onToggle} onOpen={setEditing} />
            ))}
          </div>
        </section>
      )}

      {/* FAB mobile — nova tarefa */}
      <div className="md:hidden">
        <Fab label="Nova tarefa" ariaLabel="Nova tarefa do grupo" onClick={() => openCreate('task')} />
      </div>

      {/* sheets */}
      <QuickCreateSheet
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          ws.invalidate();
        }}
        defaultKind={createKind}
        defaultGroupId={group.id}
      />
      <GroupTaskSheet
        open={Boolean(editing)}
        task={editing}
        groupName={group.name}
        readOnly={!isMember}
        onClose={() => setEditing(null)}
        onSave={i => ws.saveTask.mutateAsync(i)}
        onCancelTask={id => ws.cancelTask.mutateAsync(id)}
        onReopen={t => void onToggle(t, false)}
      />
      <TaskGroupSheet
        open={Boolean(openPkgId)}
        groupId={openPkgId}
        onClose={() => {
          setOpenPkgId(null);
          ws.invalidate();
        }}
      />
      {canManage && <GroupConfigPanel open={configOpen} group={group} onClose={() => setConfigOpen(false)} />}
      </div>{/* fim da coluna de conteúdo */}

      {/* Chat do grupo (Fase 1) — drawer 380px que empurra o conteúdo; tela cheia/mobile via overlay. */}
      {chatOpen && groupId && (
        <GroupChatDrawer
          groupId={groupId}
          groupName={group.name}
          membersLine={membersLine}
          fullscreen={chatFull}
          onToggleFullscreen={() => setChatFull(v => !v)}
          onClose={() => { setChatFull(false); setChatOpen(false); }}
          onSeen={markSeen}
        />
      )}
    </div>
  );
}
