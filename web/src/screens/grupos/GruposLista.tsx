// web/src/screens/grupos/GruposLista.tsx
// Lista de grupos (spec/mockup 2026-06-10 §1). Membro vê os seus; gestão vê todos.
// 1 grupo só e sem gestão → entra direto no workspace. Rota /grupos (Task 6 liga).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useWorkGroups, useMyGroupIds, type WorkGroup } from '../../hooks/useWorkGroups';
import { useGroupsOverview } from '../../hooks/useGroupWorkspace';
import { useCollabRoster } from '../../hooks/useNotes';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Field } from '../../components/Field';
import { CustomSelect } from '../../components/CustomSelect';
import { BottomSheet } from '../../components/BottomSheet';
import { EmptyState } from '../../components/EmptyState';
import { LoadingState } from '../../components/LoadingState';
import { showToast } from '../../components/Toast';

// Mesmo idioma de superfície do GrupoWorkspace (não existe utility `surface` no DS).
const surfaceCls = 'rounded-md border bg-bg-surface shadow-card dark:shadow-none';

export function GruposLista() {
  const navigate = useNavigate();
  const { collaborator, role } = useAuth();
  const { list, createGroup, meuId } = useWorkGroups();
  const myIds = useMyGroupIds();
  const roster = useCollabRoster();
  const canManage = role === 'director' || role === 'coordinator' || role === 'manager';
  // Criar grupo liberado pra TODO colaborador (decisão do Alf 15/06). canManage segue valendo
  // só pra VISIBILIDADE (gestão vê todos os grupos; membro vê só os seus).
  const canCreate = Boolean(collaborator);

  const visible = useMemo(() => {
    const all = list.data ?? [];
    if (canManage) return all;
    const mine = new Set(myIds.data ?? []);
    return all.filter(g => mine.has(g.id) || g.leader_id === meuId);
  }, [list.data, myIds.data, canManage, meuId]);

  const groupIds = useMemo(() => visible.map(g => g.id), [visible]);
  const counts = useGroupsOverview(groupIds);

  // Atalho do mockup: 1 grupo e sem gestão → cai direto no workspace.
  const redirected = useRef(false);
  useEffect(() => {
    if (redirected.current) return;
    if (!canManage && !list.isLoading && !myIds.isLoading && visible.length === 1) {
      redirected.current = true;
      navigate(`/grupos/${visible[0].id}`, { replace: true });
    }
  }, [canManage, list.isLoading, myIds.isLoading, visible, navigate]);

  const [novoOpen, setNovoOpen] = useState(false);
  const [nome, setNome] = useState('');
  const [lider, setLider] = useState<string>(collaborator?.id ?? '');
  const [membros, setMembros] = useState<string[]>([]);
  const rosterOpts = (roster.data ?? []).map(c => ({ value: c.id, label: c.full_name }));

  async function criar() {
    if (!nome.trim() || !lider) return;
    try {
      const gid = await createGroup.mutateAsync({ name: nome, leaderId: lider, memberIds: membros });
      showToast({ kind: 'success', title: `Grupo "${nome.trim()}" criado` });
      setNovoOpen(false);
      setNome('');
      setMembros([]);
      navigate(`/grupos/${gid}`);
    } catch (e) {
      showToast({ kind: 'error', title: 'Não consegui criar o grupo', msg: e instanceof Error ? e.message : undefined });
    }
  }

  if (list.isLoading || myIds.isLoading) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <LoadingState rows={3} label="Carregando os grupos…" />
      </div>
    );
  }

  if (list.isError) {
    return (
      <div className="space-y-lg w-full pb-2xl">
        <EmptyState title="Não consegui carregar os grupos" description="Confere a conexão e tenta de novo." />
      </div>
    );
  }

  return (
    <div className="space-y-lg w-full pb-2xl">
      <header className="flex items-end justify-between gap-md">
        <div className="min-w-0">
          <h2 className="text-section-title">👥 Grupos de trabalho</h2>
          <p className="text-body-sm text-fg-muted mt-xs">
            O ambiente da equipe: todo membro vê e qualquer um conclui. "TOM, cria tarefa pro financeiro" também funciona.
          </p>
        </div>
        {canCreate && (
          <Button
            variant="primary"
            size="md"
            className="shrink-0"
            onClick={() => { setLider(collaborator?.id ?? ''); setNovoOpen(true); }}
          >
            + Novo grupo
          </Button>
        )}
      </header>

      {visible.length === 0 ? (
        <EmptyState
          title={canManage ? 'Nenhum grupo ainda' : 'Você ainda não está em nenhum grupo'}
          description={canManage ? 'Cria o primeiro — ex.: Financeiro.' : 'Crie o seu ou peça pro seu líder te adicionar.'}
          action={canCreate ? (
            <Button variant="primary" size="md" onClick={() => { setLider(collaborator?.id ?? ''); setNovoOpen(true); }}>
              + Novo grupo
            </Button>
          ) : undefined}
        />
      ) : (
        <ul className="space-y-sm">
          {visible.map((g: WorkGroup) => {
            const c = counts.data?.[g.id];
            const pct = c && c.totalMes > 0 ? Math.round((c.feitasNoMes / c.totalMes) * 100) : 0;
            return (
              <li key={g.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/grupos/${g.id}`)}
                  className={`${surfaceCls} border-border w-full text-left p-md flex items-center gap-md focus-ring hover:bg-bg-elevated transition-colors`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-card-title text-fg truncate">{g.name}</div>
                    <div className="text-body-sm text-fg-muted truncate">
                      {g.members
                        .map(m => `${m.collaborator_id === g.leader_id ? '★ ' : ''}${m.full_name.split(' ')[0]}`)
                        .join(' · ')}
                    </div>
                  </div>
                  {c && c.totalMes > 0 && (
                    <div className="w-32 shrink-0 max-md:hidden">
                      <div className="text-body-sm text-fg-muted text-right mb-xs tabular-nums">
                        {c.feitasNoMes} de {c.totalMes} no mês
                      </div>
                      <div className="h-1 bg-bg-subtle rounded-full overflow-hidden">
                        <div className="h-full bg-tom" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )}
                  {c && c.atrasadas > 0 && (
                    <Badge tone="danger">{c.atrasadas} atrasada{c.atrasadas > 1 ? 's' : ''}</Badge>
                  )}
                  {c && c.atrasadas === 0 && c.venceEmBreve > 0 && (
                    <Badge tone="warning">{c.venceEmBreve} vence em breve</Badge>
                  )}
                  <span className="text-fg-muted shrink-0" aria-hidden>→</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <BottomSheet open={novoOpen} onClose={() => { setNovoOpen(false); setNome(''); setMembros([]); setLider(collaborator?.id ?? ''); }} title="Novo grupo de trabalho">
        <div className="space-y-md">
          <Field label="Nome do grupo">
            <input
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="ex.: Financeiro"
              className="w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom"
            />
          </Field>
          <Field label="Líder" sub="Recebe as escalações (e já entra como membro)">
            <CustomSelect value={lider} options={rosterOpts} onChange={setLider} placeholder="Escolhe o líder" />
          </Field>
          <Field label="Membros">
            <div className="space-y-xs max-h-80 overflow-y-auto">
              {(roster.data ?? []).filter(c => c.id !== lider).map(c => {
                const on = membros.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setMembros(prev => (on ? prev.filter(x => x !== c.id) : [...prev, c.id]))}
                    className={`w-full text-left flex items-center justify-between p-sm rounded-sm focus-ring hover:bg-bg-elevated ${on ? 'bg-bg-elevated' : ''}`}
                  >
                    <span className="text-body-md text-fg">{c.full_name}</span>
                    {on && <Badge tone="success">membro</Badge>}
                  </button>
                );
              })}
            </div>
          </Field>
          <Button
            variant="primary"
            size="md"
            fullWidth
            loading={createGroup.isPending}
            disabled={!nome.trim() || !lider}
            onClick={criar}
          >
            Criar grupo
          </Button>
        </div>
      </BottomSheet>
    </div>
  );
}
