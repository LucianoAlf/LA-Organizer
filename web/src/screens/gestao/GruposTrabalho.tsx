// Grupos de trabalho — gestão (spec 2026-06-10, mockup aprovado).
// Tela NOVA responsiva, 100% tokens DS (lição Anotações). Visível pra
// manager/coordinator/director (rota gated no App.tsx); diretor vê/edita todos,
// líder edita os seus (RLS garante; UI espelha).
import { useState } from 'react';
import { Star, X, Plus, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, type WorkGroup } from '../../hooks/useWorkGroups';
import { useCollabRoster } from '../../hooks/useNotes';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { BottomSheet } from '../../components/BottomSheet';
import { LoadingState } from '../../components/LoadingState';
import { showToast } from '../../components/Toast';

export function GruposTrabalho() {
  const { collaborator, role } = useAuth();
  const { list, createGroup, addMember, removeMember, deactivateGroup, updateGroup, meuId } = useWorkGroups();
  const roster = useCollabRoster();

  const [novoOpen, setNovoOpen] = useState(false);
  const [nome, setNome] = useState('');
  const [lider, setLider] = useState<string>(collaborator?.id ?? '');
  const [membros, setMembros] = useState<string[]>([]);
  const [addFor, setAddFor] = useState<WorkGroup | null>(null);

  const rosterOpts = (roster.data ?? []).map((c) => ({ value: c.id, label: c.full_name }));
  const podeEditar = (g: WorkGroup) => role === 'director' || g.leader_id === meuId;

  async function criar() {
    if (!nome.trim() || !lider) return;
    try {
      await createGroup.mutateAsync({ name: nome, leaderId: lider, memberIds: membros });
      showToast({ kind: 'success', title: `Grupo "${nome.trim()}" criado` });
      setNovoOpen(false); setNome(''); setMembros([]);
    } catch (e) {
      showToast({ kind: 'error', title: 'Não consegui criar o grupo', msg: e instanceof Error ? e.message : undefined });
    }
  }

  async function desativar(g: WorkGroup) {
    if (!window.confirm(`Desativar o grupo "${g.name}"?`)) return;
    try {
      await deactivateGroup.mutateAsync(g.id);
      showToast({ kind: 'success', title: `Grupo "${g.name}" desativado` });
    } catch (e) {
      showToast({ kind: 'error', title: 'Não deu pra desativar', msg: e instanceof Error ? e.message : undefined });
    }
  }

  if (list.isLoading) return <LoadingState />;
  const groups = list.data ?? [];

  return (
    <div className="space-y-lg max-w-content mx-auto w-full pb-2xl">
      <header className="flex items-end justify-between gap-md">
        <div>
          <h2 className="text-section-title">👥 Grupos de trabalho</h2>
          <p className="text-body-sm text-fg-muted mt-xs">
            Pool de tarefas por equipe: todo membro vê e qualquer um conclui. "TOM, cria tarefa pro financeiro" também funciona.
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => { setLider(collaborator?.id ?? ''); setNovoOpen(true); }}>+ Novo grupo</Button>
      </header>

      {groups.length === 0 ? (
        <div className="surface p-lg rounded-md text-center text-body-md text-fg-muted">
          Nenhum grupo ainda. Cria o primeiro — ex.: <em>Financeiro</em> com líder e membros.
        </div>
      ) : (
        <ul className="space-y-sm">
          {groups.map((g) => (
            <li key={g.id} className="surface p-md rounded-md border border-border space-y-sm">
              <div className="flex items-center justify-between gap-sm">
                <span className="text-body-lg">{g.name}</span>
                {podeEditar(g) && (
                  <div className="flex items-center gap-sm">
                    <Button variant="ghost" size="sm" onClick={() => setAddFor(g)}><Plus size={14} /> membro</Button>
                    <Button variant="ghost" size="sm" onClick={() => desativar(g)}>desativar</Button>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-sm">
                {g.members.map((m) => {
                  const isLeader = m.collaborator_id === g.leader_id;
                  return (
                    <span key={m.collaborator_id} className={`inline-flex items-center gap-xs rounded-sm border px-sm py-xs text-body-sm ${isLeader ? 'bg-tom text-black border-tom' : 'bg-bg-elevated text-fg border-border'}`}>
                      {isLeader && <Star size={12} />}
                      {m.full_name.split(' ')[0]}
                      {podeEditar(g) && !isLeader && (
                        <button
                          onClick={() => removeMember.mutate({ groupId: g.id, collaboratorId: m.collaborator_id })}
                          className="focus-ring rounded-sm"
                          aria-label={`Remover ${m.full_name}`}
                        ><X size={12} /></button>
                      )}
                    </span>
                  );
                })}
              </div>
              <p className="text-body-sm text-fg-muted inline-flex items-center gap-xs">
                <Users size={12} /> ★ líder recebe as escalações · lembretes vão pra todos
              </p>
              {podeEditar(g) && role === 'director' && (
                <Field label="Líder" sub="Recebe as escalações de tarefa travada">
                  <CustomSelect
                    value={g.leader_id}
                    options={g.members.map((m) => ({ value: m.collaborator_id, label: m.full_name }))}
                    onChange={(v) => updateGroup.mutate({ id: g.id, leaderId: String(v) })}
                    size="sm"
                  />
                </Field>
              )}
            </li>
          ))}
        </ul>
      )}

      <BottomSheet open={novoOpen} onClose={() => setNovoOpen(false)} title="Novo grupo de trabalho">
        <div className="space-y-md">
          <Field label="Nome do grupo">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder="ex.: Financeiro"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
            />
          </Field>
          <Field label="Líder" sub="Recebe as escalações (e já entra como membro)">
            <CustomSelect value={lider} options={rosterOpts} onChange={(v) => setLider(String(v))} />
          </Field>
          <Field label="Membros">
            <div className="space-y-xs max-h-80 overflow-y-auto">
              {(roster.data ?? []).filter((c) => c.id !== lider).map((c) => {
                const on = membros.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => setMembros((prev) => (on ? prev.filter((x) => x !== c.id) : [...prev, c.id]))}
                    className={`w-full text-left flex items-center justify-between p-sm rounded-sm focus-ring ${on ? 'bg-bg-elevated' : ''}`}
                  >
                    <span className="text-body-md">{c.full_name}</span>
                    {on && <Badge tone="success">membro</Badge>}
                  </button>
                );
              })}
            </div>
          </Field>
          <Button variant="primary" size="md" fullWidth loading={createGroup.isPending} disabled={!nome.trim() || !lider} onClick={criar}>
            Criar grupo
          </Button>
        </div>
      </BottomSheet>

      <BottomSheet open={!!addFor} onClose={() => setAddFor(null)} title={`Adicionar membro — ${addFor?.name ?? ''}`}>
        <div className="space-y-xs max-h-80 overflow-y-auto">
          {(roster.data ?? [])
            .filter((c) => !(addFor?.members ?? []).some((m) => m.collaborator_id === c.id))
            .map((c) => (
              <button
                key={c.id}
                onClick={async () => { if (addFor) { await addMember.mutateAsync({ groupId: addFor.id, collaboratorId: c.id }); setAddFor(null); } }}
                className="w-full text-left p-sm rounded-sm focus-ring hover:bg-bg-elevated text-body-md"
              >{c.full_name}</button>
            ))}
        </div>
      </BottomSheet>
    </div>
  );
}
