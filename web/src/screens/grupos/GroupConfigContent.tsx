// web/src/screens/grupos/GroupConfigContent.tsx
// Conteúdo de Configurações do grupo — layout EMPILHADO (escolha do Alf 14/06):
// faixa de cima full-width = Time (cabeçalho + 2 colunas: Membros | Líder, com
// divisória); faixa de baixo full-width = 🔔 Notificações (grade 2×2). Empilha no mobile.
// Renderiza dentro da PÁGINA GrupoConfig (rota /grupos/:id/config).
// Sheets de "adicionar membro" e ConfirmDialog seguem como overlays irmãos.
import { useState } from 'react';
import { Star, X, Plus, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, type WorkGroup } from '../../hooks/useWorkGroups';
import { useCollabRoster } from '../../hooks/useNotes';
import { Button } from '../../components/Button';
import { CustomSelect } from '../../components/CustomSelect';
import { BottomSheet } from '../../components/BottomSheet';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { showToast } from '../../components/Toast';
import { GroupNotificationsSection } from './config/GroupNotificationsSection';

export function GroupConfigContent({ group }: { group: WorkGroup }) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const { addMember, removeMember, updateGroup, deactivateGroup, meuId } = useWorkGroups();
  const roster = useCollabRoster();
  const [addOpen, setAddOpen] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const podeEditar = role === 'director' || group.leader_id === meuId;
  const leaderName = group.members.find(m => m.collaborator_id === group.leader_id)?.full_name ?? '—';

  const candidatos = (roster.data ?? []).filter(
    c => !group.members.some(m => m.collaborator_id === c.id),
  );

  return (
    <>
      <div className="space-y-lg">
        {/* Faixa de cima (full-width) — Time: cabeçalho + Membros | Líder */}
        <section className="rounded-md border border-border bg-bg-surface">
          {/* Cabeçalho da faixa */}
          <div className="flex items-center justify-between gap-md border-b border-border px-md py-sm">
            <span className="inline-flex items-center gap-xs text-label uppercase tracking-wide text-fg-muted">
              <Users size={13} aria-hidden /> Time
            </span>
            {podeEditar && (
              <Button variant="ghost" size="sm" onClick={() => setConfirmOff(true)}>
                <span className="text-danger">desativar grupo</span>
              </Button>
            )}
          </div>

          {/* Corpo: 2 colunas (membros flexível · líder fixo) com divisória */}
          <div className="grid gap-md p-md sm:grid-cols-[1fr_300px]">
            {/* Membros */}
            <div className="space-y-sm sm:pr-lg">
              <span className="block text-caption uppercase tracking-wide text-fg-muted">Membros</span>
              <div className="flex flex-wrap items-center gap-sm">
                {group.members.map(m => {
                  const isLeader = m.collaborator_id === group.leader_id;
                  return (
                    <span
                      key={m.collaborator_id}
                      className={`inline-flex items-center gap-xs rounded-full border px-sm py-xs text-body-sm ${
                        isLeader ? 'bg-tom text-black border-tom' : 'bg-bg-elevated text-fg border-border'
                      }`}
                    >
                      {isLeader && <Star size={12} aria-hidden />}
                      {m.full_name.split(' ')[0]}
                      {podeEditar && !isLeader && (
                        <button
                          type="button"
                          disabled={removeMember.isPending}
                          onClick={() =>
                            removeMember.mutate(
                              { groupId: group.id, collaboratorId: m.collaborator_id },
                              { onError: () => showToast({ kind: 'error', title: 'Não consegui remover' }) },
                            )
                          }
                          className="focus-ring rounded-full text-fg-muted hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed"
                          aria-label={`Remover ${m.full_name}`}
                        >
                          <X size={12} />
                        </button>
                      )}
                    </span>
                  );
                })}
                {podeEditar && (
                  <Button variant="ghost" size="sm" leadingIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                    membro
                  </Button>
                )}
              </div>
            </div>

            {/* Líder */}
            <div className="space-y-sm sm:border-l sm:border-border sm:pl-lg">
              <span className="block text-caption uppercase tracking-wide text-fg-muted">Líder</span>
              {role === 'director' ? (
                <CustomSelect
                  value={group.leader_id}
                  options={group.members.map(m => ({ value: m.collaborator_id, label: m.full_name }))}
                  onChange={v =>
                    updateGroup.mutate(
                      { id: group.id, leaderId: v },
                      { onError: () => showToast({ kind: 'error', title: 'Não consegui trocar o líder' }) },
                    )
                  }
                  size="sm"
                />
              ) : (
                <span className="inline-flex items-center gap-xs text-body-sm text-fg">
                  <Star size={12} className="text-tom" aria-hidden /> {leaderName}
                </span>
              )}
              <p className="text-caption text-fg-muted leading-snug">
                Recebe as escalações de tarefa travada · lembretes vão pra todos.
              </p>
            </div>
          </div>
        </section>

        {/* Faixa de baixo (full-width) — Notificações em grade */}
        <section className="min-w-0">
          <GroupNotificationsSection groupId={group.id} />
        </section>
      </div>

      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)} title={`Adicionar membro — ${group.name}`}>
        <div className="space-y-xs max-h-80 overflow-y-auto">
          {candidatos.length === 0 && (
            <p className="text-body-sm text-fg-muted py-sm">Todo mundo que tá ativo já está no grupo.</p>
          )}
          {candidatos.map(c => (
            <button
              key={c.id}
              type="button"
              disabled={addMember.isPending}
              onClick={async () => {
                try {
                  await addMember.mutateAsync({ groupId: group.id, collaboratorId: c.id });
                  setAddOpen(false);
                } catch {
                  showToast({ kind: 'error', title: 'Não consegui adicionar' });
                }
              }}
              className="w-full text-left p-sm rounded-sm focus-ring hover:bg-bg-elevated text-body-md text-fg"
            >
              {c.full_name}
            </button>
          ))}
        </div>
      </BottomSheet>

      <ConfirmDialog
        open={confirmOff}
        title={`Desativar "${group.name}"?`}
        description="O grupo some das listas (tarefas abertas bloqueiam a desativação)."
        confirmLabel="Desativar"
        confirmVariant="danger"
        isPending={deactivateGroup.isPending}
        onConfirm={async () => {
          try {
            await deactivateGroup.mutateAsync(group.id);
            showToast({ kind: 'success', title: 'Grupo desativado' });
            setConfirmOff(false);
            navigate('/grupos');
          } catch (e) {
            setConfirmOff(false);
            showToast({
              kind: 'error',
              title: 'Não deu pra desativar',
              msg: e instanceof Error ? e.message : undefined,
            });
          }
        }}
        onClose={() => setConfirmOff(false)}
      />
    </>
  );
}
