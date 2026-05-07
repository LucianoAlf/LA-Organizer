import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, ChevronDown, ChevronRight, MoreVertical, GripVertical, Clock, AlertTriangle } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '../lib/supabase';
import { Button } from './Button';
import { EmptyState } from './EmptyState';

// Sprint 22.22r-s — Runbook T-minus pra projetos category=event.
// Bloco = momento (T-2h, T-10min, T+5min, etc) com itens checkaveis dentro.
// Sprint 22.22s — DnD em blocos, edit inline do offset, indicador de atraso.

interface RunbookBlock {
  id: string;
  project_id: string;
  offset_minutes: number;
  label: string;
  description: string | null;
  position: number;
  created_at: string;
}

interface RunbookItem {
  id: string;
  block_id: string;
  text: string;
  done: boolean;
  done_at: string | null;
  position: number;
}

interface ProjectMinimal {
  event_date: string | null;
  event_start_time: string | null;
}

interface Props {
  projectId: string;
  canEdit: boolean;
}

async function fetchBlocks(projectId: string): Promise<RunbookBlock[]> {
  const { data, error } = await supabase
    .from('event_runbook_blocks')
    .select('id, project_id, offset_minutes, label, description, position, created_at')
    .eq('project_id', projectId)
    .order('position', { ascending: true })
    .order('offset_minutes', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RunbookBlock[];
}

async function fetchItems(projectId: string): Promise<RunbookItem[]> {
  const { data: blocks } = await supabase
    .from('event_runbook_blocks')
    .select('id')
    .eq('project_id', projectId);
  const blockIds = (blocks ?? []).map(b => b.id);
  if (blockIds.length === 0) return [];
  const { data, error } = await supabase
    .from('event_runbook_items')
    .select('id, block_id, text, done, done_at, position')
    .in('block_id', blockIds)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as RunbookItem[];
}

async function fetchProjectTimes(projectId: string): Promise<ProjectMinimal | null> {
  const { data } = await supabase
    .from('projects')
    .select('event_date, event_start_time')
    .eq('id', projectId)
    .single();
  return (data as ProjectMinimal | null) ?? null;
}

export function formatOffset(min: number): string {
  if (min === 0) return 'ABERTURA';
  const abs = Math.abs(min);
  const suffix = min < 0 ? 'antes' : 'depois';
  if (abs >= 60 && abs % 60 === 0) return `${abs / 60}h ${suffix}`;
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${h}h${m}min ${suffix}`;
  }
  return `${abs}min ${suffix}`;
}

// Sprint 22.22s — converte event_date + event_start_time + offset_minutes em Date absoluto.
function blockExpectedTime(p: ProjectMinimal | null, offsetMin: number): Date | null {
  if (!p?.event_date || !p?.event_start_time) return null;
  const [y, mo, d] = p.event_date.split('-').map(Number);
  const [hh, mm] = p.event_start_time.split(':').map(Number);
  const base = new Date(y, (mo || 1) - 1, d, hh || 0, mm || 0, 0, 0);
  base.setMinutes(base.getMinutes() + offsetMin);
  return base;
}

function fmtTimeBR(d: Date | null): string {
  if (!d) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function RunbookTab({ projectId, canEdit }: Props) {
  const qc = useQueryClient();
  const [addingBlock, setAddingBlock] = useState(false);
  const [now, setNow] = useState(() => new Date());

  // Tick a cada 30s pra atualizar atrasos sem forçar reload
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const { data: blocks = [] } = useQuery({
    queryKey: ['project', projectId, 'runbook-blocks'],
    queryFn: () => fetchBlocks(projectId),
  });
  const { data: items = [] } = useQuery({
    queryKey: ['project', projectId, 'runbook-items'],
    queryFn: () => fetchItems(projectId),
  });
  const { data: projectTimes = null } = useQuery({
    queryKey: ['project', projectId, 'runbook-times'],
    queryFn: () => fetchProjectTimes(projectId),
  });

  const itemsByBlock = new Map<string, RunbookItem[]>();
  for (const it of items) {
    if (!itemsByBlock.has(it.block_id)) itemsByBlock.set(it.block_id, []);
    itemsByBlock.get(it.block_id)!.push(it);
  }

  const totalItems = items.length;
  const doneItems = items.filter(i => i.done).length;
  const overallPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const reorderBlocks = useMutation({
    mutationFn: async (orderedIds: string[]) => {
      await Promise.all(
        orderedIds.map((bid, idx) =>
          supabase.from('event_runbook_blocks').update({ position: idx }).eq('id', bid).then(({ error }) => {
            if (error) throw error;
          }),
        ),
      );
    },
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: ['project', projectId, 'runbook-blocks'] });
      const prev = qc.getQueryData<RunbookBlock[]>(['project', projectId, 'runbook-blocks']);
      qc.setQueryData<RunbookBlock[]>(['project', projectId, 'runbook-blocks'], (old) => {
        if (!old) return old;
        const map = new Map(old.map(b => [b.id, b]));
        return orderedIds.map((bid, idx) => ({ ...(map.get(bid)!), position: idx }));
      });
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['project', projectId, 'runbook-blocks'], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-blocks'] }),
  });

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = blocks.map(b => b.id);
    const oldIdx = ids.indexOf(String(active.id));
    const newIdx = ids.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    reorderBlocks.mutate(arrayMove(ids, oldIdx, newIdx));
  }

  const createBlock = useMutation({
    mutationFn: async ({ label, offsetMinutes }: { label: string; offsetMinutes: number }) => {
      const { error } = await supabase.from('event_runbook_blocks').insert({
        project_id: projectId,
        label: label.slice(0, 200),
        offset_minutes: offsetMinutes,
        position: blocks.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-blocks'] });
      setAddingBlock(false);
    },
  });

  const updateBlock = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<RunbookBlock> }) => {
      const { error } = await supabase.from('event_runbook_blocks').update(patch).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-blocks'] }),
  });

  const deleteBlock = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_runbook_blocks').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-blocks'] });
      qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-items'] });
    },
  });

  const createItem = useMutation({
    mutationFn: async ({ blockId, text }: { blockId: string; text: string }) => {
      const blockItems = itemsByBlock.get(blockId) ?? [];
      const { error } = await supabase.from('event_runbook_items').insert({
        block_id: blockId,
        text: text.slice(0, 500),
        position: blockItems.length,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-items'] }),
  });

  const toggleItem = useMutation({
    mutationFn: async (it: RunbookItem) => {
      const next = !it.done;
      const { error } = await supabase.from('event_runbook_items').update({
        done: next,
        done_at: next ? new Date().toISOString() : null,
      }).eq('id', it.id);
      if (error) throw error;
    },
    onMutate: async (it) => {
      await qc.cancelQueries({ queryKey: ['project', projectId, 'runbook-items'] });
      const prev = qc.getQueryData<RunbookItem[]>(['project', projectId, 'runbook-items']);
      qc.setQueryData<RunbookItem[]>(['project', projectId, 'runbook-items'], (old) =>
        (old || []).map(x => x.id === it.id ? { ...x, done: !x.done } : x),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => { if (ctx?.prev) qc.setQueryData(['project', projectId, 'runbook-items'], ctx.prev); },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-items'] }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_runbook_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-items'] }),
  });

  const updateProjectStartTime = useMutation({
    mutationFn: async (time: string | null) => {
      const { error } = await supabase.from('projects').update({ event_start_time: time }).eq('id', projectId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-times'] }),
  });

  // Atraso global: se algum bloco esperado já passou e ainda tem items pendentes
  let globalDelay: number | null = null;
  if (projectTimes?.event_date && projectTimes?.event_start_time) {
    for (const b of blocks) {
      const expected = blockExpectedTime(projectTimes, b.offset_minutes);
      if (!expected) continue;
      const its = itemsByBlock.get(b.id) ?? [];
      const allDone = its.length > 0 && its.every(i => i.done);
      if (!allDone && now > expected) {
        const delay = Math.floor((now.getTime() - expected.getTime()) / 60000);
        if (globalDelay === null || delay > globalDelay) globalDelay = delay;
      }
    }
  }

  if (blocks.length === 0 && !addingBlock) {
    return (
      <section className="space-y-sm">
        <div className="surface p-md">
          <EmptyState
            title="Sem runbook ainda"
            description="Crie blocos com offset (2h antes, 40min, abertura, 10min depois) e cada um com seu checklist próprio. Útil pra orquestrar o dia do evento minuto a minuto."
            action={canEdit ? (
              <Button variant="primary" leadingIcon={<Plus size={18} />} onClick={() => setAddingBlock(true)}>
                Criar primeiro bloco
              </Button>
            ) : undefined}
          />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-sm">
      {/* Header: hora de abertura + atraso global */}
      <div className="surface p-md space-y-2">
        <StartTimeRow
          time={projectTimes?.event_start_time ?? null}
          eventDate={projectTimes?.event_date ?? null}
          canEdit={canEdit}
          onChange={(t) => updateProjectStartTime.mutate(t)}
        />
        {globalDelay !== null && globalDelay >= 5 && (
          <div className="flex items-start gap-2 bg-danger/10 border border-danger/30 rounded-sm p-2 text-body-sm text-danger">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Evento atrasado em {globalDelay} min.</div>
              <div className="text-fg-secondary text-[12px] mt-0.5">
                Sugestão: encurtar intervalos, reduzir falas de abertura, agilizar trocas de palco.
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between text-body-sm tabular-nums">
          <span className="text-fg-muted">{blocks.length} {blocks.length === 1 ? 'bloco' : 'blocos'}</span>
          <span className="text-fg">{doneItems}/{totalItems} itens · {overallPct}%</span>
        </div>
        <div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
          <div className="h-full bg-tom transition-[width]" style={{ width: `${overallPct}%` }} />
        </div>
      </div>

      {/* Blocos com DnD */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={blocks.map(b => b.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-sm">
            {blocks.map(b => (
              <SortableRunbookBlockCard
                key={b.id}
                block={b}
                items={itemsByBlock.get(b.id) ?? []}
                canEdit={canEdit}
                projectTimes={projectTimes}
                now={now}
                onUpdate={(patch) => updateBlock.mutate({ id: b.id, patch })}
                onDelete={() => deleteBlock.mutate(b.id)}
                onCreateItem={(text) => createItem.mutate({ blockId: b.id, text })}
                onToggleItem={(it) => toggleItem.mutate(it)}
                onDeleteItem={(id) => deleteItem.mutate(id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* Adicionar bloco */}
      {canEdit && (
        addingBlock ? (
          <AddBlockInline
            onCancel={() => setAddingBlock(false)}
            onCreate={(label, offsetMinutes) => createBlock.mutate({ label, offsetMinutes })}
          />
        ) : (
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Plus size={16} />}
            onClick={() => setAddingBlock(true)}
          >
            Adicionar bloco
          </Button>
        )
      )}
    </section>
  );
}

// ---- StartTimeRow — set/edit horario base do evento -----------------------
function StartTimeRow({
  time,
  eventDate,
  canEdit,
  onChange,
}: {
  time: string | null;
  eventDate: string | null;
  canEdit: boolean;
  onChange: (time: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [hh, setHh] = useState(time?.slice(0, 2) ?? '');
  const [mm, setMm] = useState(time?.slice(3, 5) ?? '');

  function commit() {
    const h = hh.padStart(2, '0').slice(0, 2);
    const m = mm.padStart(2, '0').slice(0, 2);
    const hN = parseInt(h, 10);
    const mN = parseInt(m, 10);
    if (isNaN(hN) || isNaN(mN) || hN < 0 || hN > 23 || mN < 0 || mN > 59) {
      // Invalido → reverte sem mudar
      setHh(time?.slice(0, 2) ?? '');
      setMm(time?.slice(3, 5) ?? '');
      setEditing(false);
      return;
    }
    if (!h || !m) {
      onChange(null);
    } else {
      onChange(`${h}:${m}:00`);
    }
    setEditing(false);
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setTimeout(commit, 100);
    }
  }

  if (editing && canEdit) {
    return (
      <div className="flex items-center gap-2" onBlur={handleBlur}>
        <Clock size={14} className="text-fg-muted shrink-0" />
        <span className="text-body-sm text-fg-muted">Abertura</span>
        <div className="inline-flex items-center gap-1 h-9 px-2 rounded-md bg-bg-elevated border border-border focus-within:border-tom focus-within:ring-2 focus-within:ring-tom/30">
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            value={hh}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 2);
              setHh(v);
              if (v.length === 2) {
                // Pula automatico pro campo de minutos
                const next = e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[data-mm]');
                next?.focus();
              }
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setHh(time?.slice(0, 2) ?? ''); setMm(time?.slice(3, 5) ?? ''); setEditing(false); }
            }}
            placeholder="HH"
            maxLength={2}
            className="w-7 text-center bg-transparent text-body-sm text-fg tabular-nums outline-none"
          />
          <span className="text-fg-muted">:</span>
          <input
            type="text"
            inputMode="numeric"
            data-mm
            value={mm}
            onChange={e => setMm(e.target.value.replace(/\D/g, '').slice(0, 2))}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { setHh(time?.slice(0, 2) ?? ''); setMm(time?.slice(3, 5) ?? ''); setEditing(false); }
              if (e.key === 'Backspace' && mm === '') {
                const prev = e.currentTarget.parentElement?.querySelector<HTMLInputElement>('input:not([data-mm])');
                prev?.focus();
              }
            }}
            placeholder="MM"
            maxLength={2}
            className="w-7 text-center bg-transparent text-body-sm text-fg tabular-nums outline-none"
          />
        </div>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={commit}
          className="h-8 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring"
        >
          Salvar
        </button>
        {time && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setHh(''); setMm(''); onChange(null); setEditing(false); }}
            className="h-8 px-2 text-body-sm text-fg-muted hover:text-danger focus-ring rounded-sm"
          >
            Limpar
          </button>
        )}
      </div>
    );
  }

  if (!time) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        onClick={() => { setHh(''); setMm(''); setEditing(true); }}
        className="flex items-center gap-2 text-body-sm text-fg-muted/70 italic hover:text-fg-muted focus-ring rounded-sm"
      >
        <Clock size={14} />
        <span>+ horário de abertura</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={!canEdit}
      onClick={() => { setHh(time.slice(0, 2)); setMm(time.slice(3, 5)); setEditing(true); }}
      className={['flex items-center gap-2 text-body-sm text-fg', canEdit ? 'hover:text-fg cursor-pointer focus-ring rounded-sm' : 'cursor-default'].join(' ')}
    >
      <Clock size={14} className="text-fg-muted" />
      <span className="tabular-nums">
        Abertura: <strong>{time.slice(0, 5)}</strong>
        {eventDate && <span className="text-fg-muted ml-1">· {eventDate.slice(8, 10)}/{eventDate.slice(5, 7)}</span>}
      </span>
    </button>
  );
}

// ---- SortableRunbookBlockCard — wrapper drag-and-drop ---------------------
function SortableRunbookBlockCard(props: {
  block: RunbookBlock;
  items: RunbookItem[];
  canEdit: boolean;
  projectTimes: ProjectMinimal | null;
  now: Date;
  onUpdate: (patch: Partial<RunbookBlock>) => void;
  onDelete: () => void;
  onCreateItem: (text: string) => void;
  onToggleItem: (it: RunbookItem) => void;
  onDeleteItem: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.block.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <RunbookBlockCard
      {...props}
      sortableRef={setNodeRef}
      sortableStyle={style}
      sortableAttributes={attributes}
      sortableListeners={props.canEdit ? listeners : undefined}
      isDragging={isDragging}
    />
  );
}

// ---- RunbookBlockCard ------------------------------------------------------
function RunbookBlockCard({
  block,
  items,
  canEdit,
  projectTimes,
  now,
  onUpdate,
  onDelete,
  onCreateItem,
  onToggleItem,
  onDeleteItem,
  sortableRef,
  sortableStyle,
  sortableAttributes,
  sortableListeners,
  isDragging,
}: {
  block: RunbookBlock;
  items: RunbookItem[];
  canEdit: boolean;
  projectTimes: ProjectMinimal | null;
  now: Date;
  onUpdate: (patch: Partial<RunbookBlock>) => void;
  onDelete: () => void;
  onCreateItem: (text: string) => void;
  onToggleItem: (it: RunbookItem) => void;
  onDeleteItem: (id: string) => void;
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const [addingItem, setAddingItem] = useState(false);
  const [editing, setEditing] = useState(false);
  const [labelVal, setLabelVal] = useState(block.label);
  const [offsetVal, setOffsetVal] = useState(String(block.offset_minutes));

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  const expected = blockExpectedTime(projectTimes, block.offset_minutes);
  const isLate = !!expected && !allDone && now > expected;
  const delayMin = isLate && expected ? Math.floor((now.getTime() - expected.getTime()) / 60000) : 0;

  function commitEdit() {
    const lbl = labelVal.trim();
    const offs = parseInt(offsetVal, 10);
    if (!lbl || isNaN(offs)) { setEditing(false); return; }
    if (lbl !== block.label || offs !== block.offset_minutes) {
      onUpdate({ label: lbl.slice(0, 200), offset_minutes: offs });
    }
    setEditing(false);
  }

  return (
    <article
      ref={sortableRef as ((node: HTMLElement | null) => void) | undefined}
      style={{ ...sortableStyle, opacity: isDragging ? 0.5 : undefined, zIndex: isDragging ? 20 : undefined }}
      className={[
        'surface touch-none border-l-4',
        isLate ? 'border-l-danger' : allDone ? 'border-l-tom' : 'border-l-border',
      ].join(' ')}
      {...(sortableAttributes ?? {})}
      {...(sortableListeners ?? {})}
    >
      <div className="p-md flex items-start gap-2">
        {sortableListeners && (
          <span aria-hidden className="mt-1 text-fg-muted/40 cursor-grab shrink-0">
            <GripVertical size={14} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <input
                type="text"
                autoFocus
                value={labelVal}
                onChange={e => setLabelVal(e.target.value)}
                placeholder="Label (ex: Chegada e Estrutura)"
                maxLength={200}
                className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring"
              />
              <input
                type="number"
                value={offsetVal}
                onChange={e => setOffsetVal(e.target.value)}
                placeholder="Offset em minutos"
                className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring tabular-nums"
              />
              <div className="text-[11px] text-fg-muted/60">
                Negativo = antes · 0 = abertura · Positivo = depois.
              </div>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setLabelVal(block.label); setOffsetVal(String(block.offset_minutes)); setEditing(false); }} className="h-8 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring">
                  Cancelar
                </button>
                <button type="button" onClick={commitEdit} className="h-8 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring">
                  Salvar
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Chips/badges fora do botao de expand pra permitir clique no offset */}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <button
                  type="button"
                  disabled={!canEdit}
                  onClick={(e) => {
                    if (!canEdit) return;
                    e.stopPropagation();
                    setLabelVal(block.label);
                    setOffsetVal(String(block.offset_minutes));
                    setEditing(true);
                  }}
                  className={[
                    'text-[10px] uppercase tracking-wide font-semibold rounded-sm px-1.5 py-0.5 border tabular-nums',
                    canEdit ? 'cursor-pointer hover:opacity-80 focus-ring' : 'cursor-default',
                    isLate ? 'text-danger bg-danger/10 border-danger/30'
                          : allDone ? 'text-tom bg-tom/15 border-tom/30'
                          : 'text-tom bg-tom/15 border-tom/30',
                  ].join(' ')}
                  title={canEdit ? 'Tap pra editar' : ''}
                >
                  {formatOffset(block.offset_minutes)}
                </button>
                {expected && (
                  <span className="text-[11px] text-fg-muted tabular-nums">
                    {fmtTimeBR(expected)}
                  </span>
                )}
                {isLate && (
                  <span className="text-[11px] font-semibold text-danger tabular-nums flex items-center gap-1">
                    <AlertTriangle size={11} /> atrasado {delayMin}min
                  </span>
                )}
                {allDone && <span className="text-[11px] text-tom font-semibold">✓ feito</span>}
              </div>
              {/* Botao de expand: titulo + progresso */}
              <button
                type="button"
                onClick={() => setExpanded(v => !v)}
                className="w-full text-left focus-ring rounded-sm"
              >
                <div className="text-card-title">{block.label}</div>
                {total > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-body-sm text-fg-muted tabular-nums">
                    <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
                      <div className={['h-full transition-[width]', isLate ? 'bg-danger/70' : 'bg-tom'].join(' ')} style={{ width: `${pct}%` }} />
                    </div>
                    <span>{done}/{total}</span>
                  </div>
                )}
              </button>
            </div>
          )}
        </div>

        {!editing && (
          <div className="shrink-0 flex items-center gap-1">
            {canEdit && (
              <RowMenu
                items={[
                  { label: 'Editar bloco', onClick: () => setEditing(true) },
                  { label: 'Excluir bloco', danger: true, confirm: 'Excluir esse bloco e todos os itens?', onClick: onDelete },
                ]}
              />
            )}
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              aria-label={expanded ? 'Recolher' : 'Expandir'}
              className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
            >
              {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            </button>
          </div>
        )}
      </div>

      {expanded && !editing && (
        <div className="border-t border-border px-md py-2 space-y-1">
          {items.map(it => (
            <RunbookItemRow
              key={it.id}
              item={it}
              canEdit={canEdit}
              onToggle={() => onToggleItem(it)}
              onDelete={() => onDeleteItem(it.id)}
            />
          ))}
          {canEdit && (
            addingItem ? (
              <AddItemInline
                onCancel={() => setAddingItem(false)}
                onCreate={(text) => { onCreateItem(text); setAddingItem(false); }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAddingItem(true)}
                className="w-full text-left py-2 text-body-sm text-fg-muted/70 hover:text-fg-muted focus-ring rounded-sm"
              >
                + Adicionar item
              </button>
            )
          )}
        </div>
      )}
    </article>
  );
}

// ---- RunbookItemRow --------------------------------------------------------
function RunbookItemRow({
  item,
  canEdit,
  onToggle,
  onDelete,
}: {
  item: RunbookItem;
  canEdit: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="py-1.5 flex items-center gap-2 group">
      <button
        type="button"
        onClick={onToggle}
        aria-label={item.done ? 'Desmarcar item' : 'Marcar item'}
        className={[
          'h-5 w-5 shrink-0 rounded-md border-2 grid place-items-center transition-colors focus-ring',
          item.done ? 'bg-tom border-tom text-white' : 'border-fg-muted text-transparent hover:border-tom',
        ].join(' ')}
      >
        {item.done && <Check size={12} strokeWidth={3} />}
      </button>
      <span className={['flex-1 text-body-md', item.done ? 'line-through text-fg-muted' : ''].join(' ')}>
        {item.text}
      </span>
      {canEdit && (
        <RowMenu
          items={[
            { label: 'Excluir item', danger: true, confirm: 'Excluir esse item?', onClick: onDelete },
          ]}
        />
      )}
    </div>
  );
}

// ---- Inline forms ---------------------------------------------------------
function AddBlockInline({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (label: string, offsetMinutes: number) => void;
}) {
  const [label, setLabel] = useState('');
  const [offset, setOffset] = useState('-120');

  function submit() {
    const lbl = label.trim();
    const offs = parseInt(offset, 10);
    if (!lbl || isNaN(offs)) return;
    onCreate(lbl, offs);
    setLabel('');
    setOffset('-120');
  }

  return (
    <div className="surface p-md space-y-2">
      <div className="text-label text-fg-muted uppercase tracking-wide">Novo bloco</div>
      <input
        type="text"
        autoFocus
        value={label}
        onChange={e => setLabel(e.target.value)}
        placeholder="Label (ex: Chegada e Estrutura)"
        maxLength={200}
        className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-md text-fg focus-ring"
      />
      <input
        type="number"
        value={offset}
        onChange={e => setOffset(e.target.value)}
        placeholder="Offset em minutos"
        className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring tabular-nums"
      />
      <div className="text-[11px] text-fg-muted/60">
        Negativo = antes · 0 = abertura · Positivo = depois. Ex: -120 (2h antes), -10, 0, 5.
      </div>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring">
          Cancelar
        </button>
        <button type="button" onClick={submit} disabled={!label.trim() || isNaN(parseInt(offset, 10))} className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring disabled:opacity-40">
          Criar bloco
        </button>
      </div>
    </div>
  );
}

function AddItemInline({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (text: string) => void;
}) {
  const [text, setText] = useState('');

  function submit() {
    const t = text.trim();
    if (!t) return;
    onCreate(t);
    setText('');
  }

  return (
    <div className="py-2 flex gap-2 items-center">
      <input
        type="text"
        autoFocus
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); submit(); }
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="Novo item"
        maxLength={500}
        className="flex-1 h-8 px-2 rounded-sm bg-bg-elevated border border-border text-body-md text-fg focus-ring"
      />
      <button type="button" onClick={onCancel} className="h-8 px-2 text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm">
        Cancelar
      </button>
      <button type="button" onClick={submit} disabled={!text.trim()} className="h-8 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring disabled:opacity-40">
        Adicionar
      </button>
    </div>
  );
}

// ---- RowMenu local ---------------------------------------------------------
function RowMenu({ items }: { items: Array<{ label: string; onClick: () => void; danger?: boolean; confirm?: string }> }) {
  const [open, setOpen] = useState(false);
  const [confirmIdx, setConfirmIdx] = useState<number | null>(null);
  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setTimeout(() => { setOpen(false); setConfirmIdx(null); }, 150);
  }
  return (
    <div className="relative" data-no-nav onBlur={handleBlur}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); setConfirmIdx(null); }}
        aria-label="Mais ações"
        className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"
      >
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden">
          {items.map((it, idx) => {
            if (confirmIdx === idx && it.confirm) {
              return (
                <div key={idx} className="px-3 py-2 bg-danger/5 border-t border-border">
                  <div className="text-body-sm text-fg mb-2">{it.confirm}</div>
                  <div className="flex gap-2">
                    <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmIdx(null); }} className="flex-1 h-7 px-2 rounded-sm text-body-sm text-fg-muted border border-border focus-ring">Cancelar</button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); it.onClick(); setOpen(false); setConfirmIdx(null); }} className="flex-1 h-7 px-2 rounded-sm text-body-sm font-semibold bg-danger text-white focus-ring">Confirmar</button>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={idx}
                type="button"
                onClick={(e) => { e.stopPropagation(); if (it.confirm) setConfirmIdx(idx); else { it.onClick(); setOpen(false); } }}
                className={['w-full px-3 py-2 text-left text-body-sm hover:bg-bg-elevated', it.danger ? 'text-danger' : 'text-fg'].join(' ')}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
