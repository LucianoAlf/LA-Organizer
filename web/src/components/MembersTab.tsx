import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, UserPlus, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { PROJECT_MEMBER_ROLE_LABELS, type ProjectMember, type ProjectMemberRole, type Collaborator } from '../types';

// Sprint 22.22 — Aba Time com CRUD completo.
// Suporta membros internos (collaborators) E externos (guests/prestadores).

interface Props {
  projectId: string;
  members: ProjectMember[];
  /** Se o user atual pode editar o time (owner/coord do projeto OU coord/director da empresa). */
  canEdit: boolean;
}

async function fetchAllCollaborators(): Promise<Collaborator[]> {
  const { data, error } = await supabase
    .from('collaborators')
    .select('id, full_name, email, phone, role, function_title, unit, is_active, onboarding_completed')
    .eq('is_active', true)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Collaborator[];
}

export function MembersTab({ projectId, members, canEdit }: Props) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState<'internal' | 'external' | null>(null);

  const { data: allColls = [] } = useQuery({
    queryKey: ['collaborators-active'],
    queryFn: fetchAllCollaborators,
    enabled: canEdit,
  });

  // Membros ja no projeto — pra filtrar do dropdown
  const memberCollIds = useMemo(() => new Set(members.map(m => m.collaborator_id).filter(Boolean) as string[]), [members]);
  const availableColls = allColls.filter(c => !memberCollIds.has(c.id));

  const addInternal = useMutation({
    mutationFn: async ({ collabId, role }: { collabId: string; role: ProjectMemberRole }) => {
      const { error } = await supabase.from('project_members').insert({
        project_id: projectId,
        collaborator_id: collabId,
        role_in_project: role,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] });
      setAdding(null);
    },
  });

  const addExternal = useMutation({
    mutationFn: async ({ name, role }: { name: string; role: string }) => {
      const { error } = await supabase.from('project_members').insert({
        project_id: projectId,
        collaborator_id: null,
        guest_name: name.slice(0, 100),
        guest_role: role.slice(0, 100),
        role_in_project: 'member',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] });
      setAdding(null);
    },
  });

  const updateRole = useMutation({
    mutationFn: async ({ memberId, role }: { memberId: string; role: ProjectMemberRole }) => {
      const { error } = await supabase
        .from('project_members')
        .update({ role_in_project: role })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] }),
  });

  const removeMember = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase.from('project_members').delete().eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] }),
  });

  return (
    <section className="space-y-sm">
      {members.length === 0 ? (
        <div className="surface">
          <EmptyState
            title="Sem membros cadastrados"
            description={canEdit ? 'Adicione quem vai trabalhar nesse projeto.' : 'O dono do projeto ainda não montou o time.'}
          />
        </div>
      ) : (
        <ul className="surface divide-y divide-border">
          {members.map(m => (
            <MemberRow
              key={m.id}
              member={m}
              canEdit={canEdit}
              onUpdateRole={(role) => updateRole.mutate({ memberId: m.id, role })}
              onRemove={() => removeMember.mutate(m.id)}
            />
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          {!adding && (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<UserPlus size={16} />}
                onClick={() => setAdding('internal')}
              >
                Adicionar do time
              </Button>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<ExternalLink size={16} />}
                onClick={() => setAdding('external')}
              >
                Adicionar externo
              </Button>
            </div>
          )}

          {adding === 'internal' && (
            <AddInternalForm
              available={availableColls}
              onCancel={() => setAdding(null)}
              onSubmit={(collabId, role) => addInternal.mutate({ collabId, role })}
            />
          )}

          {adding === 'external' && (
            <AddExternalForm
              onCancel={() => setAdding(null)}
              onSubmit={(name, role) => addExternal.mutate({ name, role })}
            />
          )}
        </>
      )}
    </section>
  );
}

// ---- MemberRow — linha de um membro com badge de role + acoes -------------

function MemberRow({
  member,
  canEdit,
  onUpdateRole,
  onRemove,
}: {
  member: ProjectMember;
  canEdit: boolean;
  onUpdateRole: (role: ProjectMemberRole) => void;
  onRemove: () => void;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isExternal = !member.collaborator_id;
  const displayName = isExternal
    ? member.guest_name
    : member.collaborator?.full_name ?? '—';
  const displaySubtitle = isExternal
    ? member.guest_role
    : member.collaborator?.function_title;

  return (
    <li className="p-md flex items-center justify-between gap-md">
      <div className="min-w-0 flex-1">
        <div className="text-body-md flex items-center gap-2">
          <span className="truncate">{displayName}</span>
          {isExternal && (
            <span className="text-[10px] uppercase tracking-wide text-fg-muted/60 bg-bg-elevated rounded-sm px-1.5 py-0.5 border border-border shrink-0">
              Externo
            </span>
          )}
        </div>
        {displaySubtitle && (
          <div className="text-body-sm text-fg-muted truncate">{displaySubtitle}</div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canEdit && !isExternal ? (
          <RolePicker value={member.role_in_project} onChange={onUpdateRole} />
        ) : (
          <span className="text-[11px] font-medium text-fg-muted bg-bg-elevated rounded-sm px-1.5 py-0.5 border border-border">
            {isExternal ? '—' : PROJECT_MEMBER_ROLE_LABELS[member.role_in_project]}
          </span>
        )}
        {canEdit && (
          confirmRemove ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setConfirmRemove(false)}
                className="text-body-sm text-fg-muted hover:text-fg px-2 py-1 focus-ring rounded-sm"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => { onRemove(); setConfirmRemove(false); }}
                className="text-body-sm font-semibold bg-danger text-white px-2 py-1 rounded-sm focus-ring"
              >
                Remover
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemove(true)}
              aria-label="Remover membro"
              className="text-fg-muted hover:text-danger p-1 focus-ring rounded-sm"
            >
              <X size={16} />
            </button>
          )
        )}
      </div>
    </li>
  );
}

// ---- RolePicker — dropdown inline pra trocar role_in_project ---------------

function RolePicker({ value, onChange }: { value: ProjectMemberRole; onChange: (r: ProjectMemberRole) => void }) {
  const [open, setOpen] = useState(false);
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setTimeout(() => setOpen(false), 150);
  }
  return (
    <div className="relative" onBlur={handleBlur}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="text-[11px] font-medium text-fg-muted bg-bg-elevated rounded-sm px-1.5 py-0.5 border border-border hover:text-fg focus-ring cursor-pointer"
      >
        {PROJECT_MEMBER_ROLE_LABELS[value]}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden">
          {(['owner', 'coordinator', 'member'] as ProjectMemberRole[]).map(r => (
            <button
              key={r}
              type="button"
              onClick={() => { onChange(r); setOpen(false); }}
              className={[
                'w-full px-3 py-2 text-left text-body-sm',
                r === value ? 'bg-bg-elevated' : 'hover:bg-bg-elevated',
              ].join(' ')}
            >
              {PROJECT_MEMBER_ROLE_LABELS[r]} {r === value && '✓'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- AddInternalForm — escolher collaborator + role -----------------------

function AddInternalForm({
  available,
  onCancel,
  onSubmit,
}: {
  available: Collaborator[];
  onCancel: () => void;
  onSubmit: (collabId: string, role: ProjectMemberRole) => void;
}) {
  const [collabId, setCollabId] = useState('');
  const [role, setRole] = useState<ProjectMemberRole>('member');

  function submit() {
    if (!collabId) return;
    onSubmit(collabId, role);
  }

  return (
    <div className="surface p-md space-y-2">
      <select
        value={collabId}
        onChange={e => setCollabId(e.target.value)}
        className="w-full h-9 px-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring"
      >
        <option value="">— Escolher pessoa —</option>
        {available.map(c => (
          <option key={c.id} value={c.id}>
            {c.full_name} {c.function_title ? `(${c.function_title})` : ''}
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={e => setRole(e.target.value as ProjectMemberRole)}
        className="w-full h-9 px-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring"
      >
        <option value="member">Membro (executa)</option>
        <option value="coordinator">Coordenador (vê tudo do projeto)</option>
        <option value="owner">Owner (criador / lidera)</option>
      </select>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-9 rounded-md text-body-sm text-fg-muted hover:text-fg border border-border focus-ring"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!collabId}
          className="flex-1 h-9 rounded-md text-body-sm font-semibold bg-tom text-white focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Adicionar
        </button>
      </div>
    </div>
  );
}

// ---- AddExternalForm — nome livre + funcao --------------------------------

function AddExternalForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, role: string) => void;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');

  function submit() {
    const n = name.trim();
    if (!n) return;
    onSubmit(n, role.trim().slice(0, 100));
  }

  return (
    <div className="surface p-md space-y-2">
      <input
        type="text"
        autoFocus
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Nome (ex: Carlos Eduardo)"
        maxLength={100}
        className="w-full h-9 px-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring"
      />
      <input
        type="text"
        value={role}
        onChange={e => setRole(e.target.value)}
        placeholder="Função (ex: iluminador, técnico de som)"
        maxLength={100}
        className="w-full h-9 px-2 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring"
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-9 rounded-md text-body-sm text-fg-muted hover:text-fg border border-border focus-ring"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim()}
          className="flex-1 h-9 rounded-md text-body-sm font-semibold bg-tom text-white focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Adicionar externo
        </button>
      </div>
    </div>
  );
}

// Suprime warning de import nao usado
void Plus;
