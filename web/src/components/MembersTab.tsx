import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, UserPlus, ExternalLink, GripVertical } from 'lucide-react';
import { CustomSelect } from './CustomSelect';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useSortableSensors } from '../lib/sortableSensors';
import { dragLiftStyle } from '../lib/sortableStyle';
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
    mutationFn: async ({ collabId, role, fn }: { collabId: string; role: ProjectMemberRole; fn: string }) => {
      const { error } = await supabase.from('project_members').insert({
        project_id: projectId,
        collaborator_id: collabId,
        role_in_project: role,
        function_in_project: fn || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] });
      setAdding(null);
    },
  });

  const updateFunction = useMutation({
    mutationFn: async ({ memberId, fn }: { memberId: string; fn: string }) => {
      const { error } = await supabase
        .from('project_members')
        .update({ function_in_project: fn || null })
        .eq('id', memberId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] }),
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

  // Sprint 22.22m — reorder com optimistic update (mesmo padrao de projetos/checkpoints)
  const reorderMembers = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((mid, idx) =>
          supabase.from('project_members').update({ sort_position: idx }).eq('id', mid).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: ['project', projectId, 'members'] });
      const prev = qc.getQueryData<ProjectMember[]>(['project', projectId, 'members']);
      qc.setQueryData<ProjectMember[]>(['project', projectId, 'members'], (old) => {
        if (!old) return old;
        const map = new Map(old.map(m => [m.id, m]));
        return orderedIds.map((mid, idx) => ({ ...(map.get(mid)!), sort_position: idx } as ProjectMember));
      });
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', projectId, 'members'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'members'] }),
  });

  const sensors = useSortableSensors();

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = members.map(m => m.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    reorderMembers.mutate(arrayMove(ids, oldIndex, newIndex));
  }

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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={members.map(m => m.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {members.map(m => (
                <SortableMemberRow
                  key={m.id}
                  member={m}
                  canEdit={canEdit}
                  onUpdateRole={(role) => updateRole.mutate({ memberId: m.id, role })}
                  onUpdateFunction={(fn) => updateFunction.mutate({ memberId: m.id, fn })}
                  onRemove={() => removeMember.mutate(m.id)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
              onSubmit={(collabId, role, fn) => addInternal.mutate({ collabId, role, fn })}
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

// ---- SortableMemberRow — wrapper drag-and-drop -----------------------------
function SortableMemberRow(props: {
  member: ProjectMember;
  canEdit: boolean;
  onUpdateRole: (role: ProjectMemberRole) => void;
  onUpdateFunction: (fn: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.member.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <MemberRow
      {...props}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={props.canEdit ? listeners : undefined}
      isDragging={isDragging}
    />
  );
}

// ---- MemberRow — linha de um membro com badge de role + acoes -------------

function MemberRow({
  member,
  canEdit,
  onUpdateRole,
  onUpdateFunction,
  onRemove,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  member: ProjectMember;
  canEdit: boolean;
  onUpdateRole: (role: ProjectMemberRole) => void;
  onUpdateFunction: (fn: string) => void;
  onRemove: () => void;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editingFn, setEditingFn] = useState(false);
  const [fnVal, setFnVal] = useState(member.function_in_project ?? '');
  const isExternal = !member.collaborator_id;
  const displayName = isExternal
    ? member.guest_name
    : member.collaborator?.full_name ?? '—';
  // Sprint 22.22j — funcao no projeto eh prioridade. Fallback pra cargo do
  // collaborator (function_title) ou guest_role.
  const displayFunction = member.function_in_project
    ?? (isExternal ? member.guest_role : member.collaborator?.function_title);

  function commitFn() {
    const v = fnVal.trim().slice(0, 100);
    if (v !== (member.function_in_project ?? '')) onUpdateFunction(v);
    setEditingFn(false);
  }

  // Sprint 22.22k — borda lateral colorida por papel (hierarquia visual)
  const accentClass = isExternal
    ? 'border-l-fg-muted/30 border-dashed'
    : member.role_in_project === 'owner'
      ? 'border-l-tom'
      : member.role_in_project === 'coordinator'
        ? 'border-l-warning'
        : 'border-l-border';

  return (
    <li
      ref={sortableRef as ((node: HTMLLIElement | null) => void) | undefined}
      style={dragLiftStyle(isDragging, sortableStyle)}
      className={['surface p-md flex items-center justify-between gap-md border-l-4', accentClass].join(' ')}
      {...(sortableAttributes ?? {})}
    >
      {sortableListeners && (
        <span aria-hidden className="text-fg-muted/40 cursor-grab shrink-0 touch-none" style={{ touchAction: 'none' }}
          {...sortableListeners}>
          <GripVertical size={14} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-body-md flex items-center gap-2">
          <span className="truncate">{displayName}</span>
          {isExternal && (
            <span className="text-[10px] uppercase tracking-wide text-fg-muted/60 bg-bg-elevated rounded-sm px-1.5 py-0.5 border border-border shrink-0">
              Externo
            </span>
          )}
        </div>
        {editingFn && canEdit && !isExternal ? (
          <input
            type="text"
            autoFocus
            value={fnVal}
            maxLength={100}
            onChange={e => setFnVal(e.target.value)}
            onBlur={commitFn}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitFn(); }
              if (e.key === 'Escape') { setFnVal(member.function_in_project ?? ''); setEditingFn(false); }
            }}
            placeholder="Função no projeto (ex: Repertório, Logística)"
            className="mt-1 w-full h-8 px-2 rounded-sm bg-bg-elevated border border-border text-body-sm text-fg focus-ring"
          />
        ) : displayFunction ? (
          <button
            type="button"
            disabled={!canEdit || isExternal}
            onClick={() => { setFnVal(member.function_in_project ?? ''); setEditingFn(true); }}
            className={[
              'text-body-sm text-fg-muted truncate text-left',
              canEdit && !isExternal ? 'hover:text-fg cursor-pointer focus-ring rounded-sm' : 'cursor-default',
            ].join(' ')}
          >
            {displayFunction}
          </button>
        ) : canEdit && !isExternal ? (
          <button
            type="button"
            onClick={() => { setFnVal(''); setEditingFn(true); }}
            className="text-body-sm text-fg-muted/60 italic hover:text-fg-muted focus-ring rounded-sm"
          >
            + função no projeto
          </button>
        ) : null}
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
  onSubmit: (collabId: string, role: ProjectMemberRole, fn: string) => void;
}) {
  const [collabId, setCollabId] = useState('');
  const [role, setRole] = useState<ProjectMemberRole>('member');
  const [fn, setFn] = useState('');

  function submit() {
    if (!collabId) return;
    onSubmit(collabId, role, fn.trim().slice(0, 100));
  }

  const collabOptions = available.map(c => ({
    value: c.id,
    label: c.full_name,
    sublabel: c.function_title ?? undefined,
  }));

  const roleOptions: Array<{ value: ProjectMemberRole; label: string; sublabel: string }> = [
    { value: 'member', label: 'Membro', sublabel: 'executa' },
    { value: 'coordinator', label: 'Coordenador', sublabel: 'vê tudo do projeto' },
    { value: 'owner', label: 'Owner', sublabel: 'criador / lidera' },
  ];

  return (
    <div className="surface p-md space-y-2">
      <CustomSelect
        value={collabId}
        placeholder="— Escolher pessoa —"
        options={collabOptions}
        onChange={setCollabId}
        prefer="up"
        size="sm"
      />
      <input
        type="text"
        value={fn}
        onChange={e => setFn(e.target.value)}
        placeholder="Função no projeto (ex: Repertório, Técnico de som)"
        maxLength={100}
        className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring"
      />
      <CustomSelect
        value={role}
        options={roleOptions}
        onChange={(v) => setRole(v as ProjectMemberRole)}
        prefer="up"
        size="sm"
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
          disabled={!collabId}
          className="flex-1 h-9 rounded-md text-body-sm font-semibold bg-tom text-black focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Adicionar
        </button>
      </div>
    </div>
  );
}

// CustomSelect extraido pra components/CustomSelect.tsx (Sprint 22.25 audit Hoje).

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
          className="flex-1 h-9 rounded-md text-body-sm font-semibold bg-tom text-black focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Adicionar externo
        </button>
      </div>
    </div>
  );
}

// Suprime warning de import nao usado
void Plus;
