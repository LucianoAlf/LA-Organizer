import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { RowMenu } from './RowMenu';

// Sprint 22.22r — Runbook T-minus pra projetos category=event.
// Bloco = momento (T-2h, T-10min, T+5min, etc) com itens checkaveis dentro.
// offset_minutes negativo = antes do evento, 0 = abertura, positivo = depois.

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

interface Props {
  projectId: string;
  canEdit: boolean;
}

async function fetchBlocks(projectId: string): Promise<RunbookBlock[]> {
  const { data, error } = await supabase
    .from('event_runbook_blocks')
    .select('id, project_id, offset_minutes, label, description, position, created_at')
    .eq('project_id', projectId)
    .order('offset_minutes', { ascending: true })
    .order('position', { ascending: true });
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

// Formata offset_minutes em label tipo "2H ANTES" / "40MIN" / "ABERTURA" / "5MIN DEPOIS"
export function formatOffset(min: number): string {
  if (min === 0) return 'ABERTURA';
  const abs = Math.abs(min);
  const suffix = min < 0 ? 'ANTES' : 'DEPOIS';
  if (abs >= 60 && abs % 60 === 0) return `${abs / 60}H ${suffix}`;
  if (abs >= 60) {
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${h}H${m}MIN ${suffix}`;
  }
  return `${abs}MIN ${suffix}`;
}

export function RunbookTab({ projectId, canEdit }: Props) {
  const qc = useQueryClient();
  const [addingBlock, setAddingBlock] = useState(false);

  const { data: blocks = [] } = useQuery({
    queryKey: ['project', projectId, 'runbook-blocks'],
    queryFn: () => fetchBlocks(projectId),
  });
  const { data: items = [] } = useQuery({
    queryKey: ['project', projectId, 'runbook-items'],
    queryFn: () => fetchItems(projectId),
  });

  const itemsByBlock = new Map<string, RunbookItem[]>();
  for (const it of items) {
    if (!itemsByBlock.has(it.block_id)) itemsByBlock.set(it.block_id, []);
    itemsByBlock.get(it.block_id)!.push(it);
  }

  const totalItems = items.length;
  const doneItems = items.filter(i => i.done).length;
  const overallPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

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
      const block = blocks.find(b => b.id === blockId);
      const blockItems = itemsByBlock.get(blockId) ?? [];
      const { error } = await supabase.from('event_runbook_items').insert({
        block_id: blockId,
        text: text.slice(0, 500),
        position: blockItems.length,
      });
      if (error) throw error;
      void block;
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
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['project', projectId, 'runbook-items'], ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-items'] }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('event_runbook_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['project', projectId, 'runbook-items'] }),
  });

  if (blocks.length === 0 && !addingBlock) {
    return (
      <section className="space-y-sm">
        <div className="surface p-md">
          <EmptyState
            title="Sem runbook ainda"
            description="Crie blocos com offset (2H ANTES, 40MIN, ABERTURA, 10MIN DEPOIS) e cada um com seu checklist próprio. Útil pra orquestrar o dia do evento minuto a minuto."
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
      {/* Resumo geral */}
      {blocks.length > 0 && (
        <div className="surface p-md">
          <div className="flex items-center justify-between text-body-sm mb-2 tabular-nums">
            <span className="text-fg-muted">Roteiro do dia · {blocks.length} {blocks.length === 1 ? 'bloco' : 'blocos'}</span>
            <span className="text-fg">{doneItems}/{totalItems} itens · {overallPct}%</span>
          </div>
          <div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
            <div className="h-full bg-tom transition-[width]" style={{ width: `${overallPct}%` }} />
          </div>
        </div>
      )}

      {/* Blocos */}
      {blocks.map(b => (
        <RunbookBlockCard
          key={b.id}
          block={b}
          items={itemsByBlock.get(b.id) ?? []}
          canEdit={canEdit}
          onUpdate={(patch) => updateBlock.mutate({ id: b.id, patch })}
          onDelete={() => deleteBlock.mutate(b.id)}
          onCreateItem={(text) => createItem.mutate({ blockId: b.id, text })}
          onToggleItem={(it) => toggleItem.mutate(it)}
          onDeleteItem={(id) => deleteItem.mutate(id)}
        />
      ))}

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

// ---- RunbookBlockCard ------------------------------------------------------
function RunbookBlockCard({
  block,
  items,
  canEdit,
  onUpdate,
  onDelete,
  onCreateItem,
  onToggleItem,
  onDeleteItem,
}: {
  block: RunbookBlock;
  items: RunbookItem[];
  canEdit: boolean;
  onUpdate: (patch: Partial<RunbookBlock>) => void;
  onDelete: () => void;
  onCreateItem: (text: string) => void;
  onToggleItem: (it: RunbookItem) => void;
  onDeleteItem: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [addingItem, setAddingItem] = useState(false);
  const [editing, setEditing] = useState(false);
  const [labelVal, setLabelVal] = useState(block.label);
  const [offsetVal, setOffsetVal] = useState(String(block.offset_minutes));

  const total = items.length;
  const done = items.filter(i => i.done).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

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
    <article className="surface">
      <div className="p-md flex items-start gap-md">
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
                placeholder="Offset em minutos (negativo=antes, 0=abertura, positivo=depois)"
                className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring tabular-nums"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => { setLabelVal(block.label); setOffsetVal(String(block.offset_minutes)); setEditing(false); }}
                  className="h-8 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={commitEdit}
                  className="h-8 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring"
                >
                  Salvar
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="w-full text-left focus-ring rounded-sm"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wide font-semibold text-tom bg-tom/15 rounded-sm px-1.5 py-0.5 border border-tom/30 tabular-nums">
                  {formatOffset(block.offset_minutes)}
                </span>
                <span className="text-card-title">{block.label}</span>
              </div>
              {total > 0 && (
                <div className="mt-2 flex items-center gap-2 text-body-sm text-fg-muted tabular-nums">
                  <div className="flex-1 h-1 bg-bg-elevated rounded-full overflow-hidden">
                    <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
                  </div>
                  <span>{done}/{total}</span>
                </div>
              )}
            </button>
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
  const [offset, setOffset] = useState('-120'); // default: 2h antes

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
      <div>
        <input
          type="number"
          value={offset}
          onChange={e => setOffset(e.target.value)}
          placeholder="Offset em minutos"
          className="w-full h-9 px-3 rounded-md bg-bg-elevated border border-border text-body-sm text-fg focus-ring tabular-nums"
        />
        <div className="text-[11px] text-fg-muted/60 mt-1">
          Negativo = antes do evento · 0 = abertura · Positivo = depois. Ex: -120 (2h antes), -10, 0, 5.
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="h-9 px-3 rounded-md text-body-sm text-fg-muted hover:text-fg focus-ring"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!label.trim() || isNaN(parseInt(offset, 10))}
          className="h-9 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring disabled:opacity-40"
        >
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
      <button
        type="button"
        onClick={onCancel}
        className="h-8 px-2 text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={submit}
        disabled={!text.trim()}
        className="h-8 px-3 rounded-md bg-tom text-white text-body-sm font-semibold focus-ring disabled:opacity-40"
      >
        Adicionar
      </button>
    </div>
  );
}
