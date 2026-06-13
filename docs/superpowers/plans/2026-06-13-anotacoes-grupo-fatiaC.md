# Anotações do Grupo — Fatia C (Tipos customizados por grupo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Membros do grupo criam tipos de ficha próprios (nome + cor + ícone + modelo de campos), persistidos por grupo, com o TOM escolhendo o tipo certo entre os existentes.

**Architecture:** Nova tabela `group_note_types` (RLS = membro + service_role). O front monta um `TypeIndex` = 5 base globais + custom do grupo, usado por resolvers (cor/ícone/label/template). Select de Tipo ganha "➕ Novo tipo…" (via `footerAction` que o `CustomSelect` já tem) → `NoteTypeForm`. Backend lista os tipos no prompt e valida a key na criação. `group_notes.type` segue texto livre (sem CHECK).

**Tech Stack:** PWA React+TS+Tailwind, vitest; backend Node CJS, `node:test`; Supabase (apply_migration MCP).

**Spec:** `docs/superpowers/specs/2026-06-13-anotacoes-grupo-fatiaC-tipos-customizados.md`

---

## Modelo de deploy (igual Fatias A/B — LER)
- `_remote` NÃO é repo git; **sem `git commit` por task**. Verificação = teste/tsc passando.
- PWA (`web/`) → auto-deploy (Stop hook) no fim do turno. Backend (`src/`) → SCP + `pm2 restart tom` na task final.
- Migration → `apply_migration` MCP (projeto `cesnbnrynvxvgdhfmaua`).
- Comandos (de `D:\la-organizer\_remote`): PWA `cd web && npx tsc --noEmit` / `npx vite build` / `npx vitest run src/lib/groupNotes.test.ts`; backend `node --check src/<f>.js` / `node --test src/services/group-notes.test.js`.
- DS obrigatório, cor `tom`, guardrail mobile/desktop. **Validar no preview com ficha/tipo descartável** (preview mexe em dado real — `feedback_preview_autosave_mutates_real_data`).

## File Structure
**Novos:** migration `group_note_types`; `web/src/hooks/useGroupNoteTypes.ts`; `web/src/screens/grupos/notes/NoteTypeForm.tsx`.
**Modificados:** `web/src/lib/groupNotes.ts` (+ tipos/index/resolvers/IO; `GroupNote.type`→string) + `groupNotes.test.ts`; `NoteEditor.tsx`; `NoteCard.tsx`; `NoteDetail.tsx`; `NotesTypeFilter.tsx`; `GrupoAnotacoes.tsx`; `src/services/group-notes.js` (+ `pickType`/`renderTypesBlock`/listagem no prompt) + `group-notes.test.js`.

---

## Task 1: Migration `group_note_types` + RLS + seed Financeiro

**Files:** migration via `apply_migration` (name: `group_note_types`).

- [ ] **Step 1: Aplicar a migration**

```sql
create table if not exists public.group_note_types (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  key text not null,
  label text not null,
  color text,
  icon text,
  fields jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (group_id, key)
);
create index if not exists group_note_types_group_idx on public.group_note_types(group_id);

alter table public.group_note_types enable row level security;

create policy gnt_member_select on public.group_note_types for select
  using (group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gnt_member_insert on public.group_note_types for insert
  with check (group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gnt_member_update on public.group_note_types for update
  using (group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()))
  with check (group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gnt_member_delete on public.group_note_types for delete
  using (group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gnt_service_all on public.group_note_types for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
```

- [ ] **Step 2: Seed do Financeiro (idempotente)**

```sql
insert into public.group_note_types (group_id, key, label, color, icon, fields) values
('d95f63af-5032-4120-89f2-ca4c49684cbc','fornecedor','Fornecedor','#1D9E75','BuildingStore',
 '[{"label":"Razão social","kind":"text","secret":false},{"label":"CNPJ","kind":"text","secret":false},{"label":"Contato","kind":"text","secret":false},{"label":"Chave PIX","kind":"text","secret":false},{"label":"Obs","kind":"text","secret":false}]'::jsonb),
('d95f63af-5032-4120-89f2-ca4c49684cbc','cartao','Cartão','#534AB7','CreditCard',
 '[{"label":"Bandeira","kind":"text","secret":false},{"label":"Final","kind":"text","secret":false},{"label":"Vencimento da fatura","kind":"text","secret":false},{"label":"Limite","kind":"text","secret":false},{"label":"Responsável","kind":"text","secret":false}]'::jsonb),
('d95f63af-5032-4120-89f2-ca4c49684cbc','conta_pagar','Conta a pagar','#BA7517','Receipt',
 '[{"label":"Descrição","kind":"text","secret":false},{"label":"Vencimento","kind":"text","secret":false},{"label":"Valor","kind":"text","secret":false},{"label":"Código de barras","kind":"text","secret":false},{"label":"Status","kind":"text","secret":false}]'::jsonb)
on conflict (group_id, key) do nothing;
```

- [ ] **Step 3: Verificar**

Rodar via MCP `execute_sql`: `select key,label,color,icon,jsonb_array_length(fields) flen from group_note_types where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' order by label;`
Expected: 3 linhas (cartao, conta_pagar, fornecedor), flen=5 cada.

---

## Task 2: `lib/groupNotes.ts` — tipos, índice, resolvers, IO (TDD)

**Files:** Modify `web/src/lib/groupNotes.ts`; Test `web/src/lib/groupNotes.test.ts`.

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao import do topo de `groupNotes.test.ts`: `buildTypeIndex, typeLabel, templateForType, slugifyType, type GroupNoteType` (junto dos já importados). Adicionar no fim:
```ts
const T = (o: Partial<GroupNoteType>): GroupNoteType => ({ id: 't', group_id: 'g', key: 'fornecedor', label: 'Fornecedor', color: '#1D9E75', icon: 'BuildingStore', fields: [{ label: 'CNPJ', value: '', kind: 'text' }], ...o });

describe('tipos customizados (Fatia C)', () => {
  const idx = buildTypeIndex([T({})]);
  it('buildTypeIndex tem as 5 base + a custom', () => {
    expect(idx.acesso.label).toBe('Acesso');
    expect(idx.fornecedor.label).toBe('Fornecedor');
    expect(idx.fornecedor.color).toBe('#1D9E75');
  });
  it('resolveColor/Icon usam o índice pra tipo custom', () => {
    expect(resolveColor({ type: 'fornecedor', color: null }, idx)).toBe('#1D9E75');
    expect(resolveIcon({ type: 'fornecedor', icon: null }, idx)).toBe('BuildingStore');
  });
  it('override da ficha vence o tipo', () => {
    expect(resolveColor({ type: 'fornecedor', color: '#E24B4A' }, idx)).toBe('#E24B4A');
  });
  it('tipo custom sem cor cai no fallback cinza', () => {
    const i2 = buildTypeIndex([T({ key: 'x', color: null, icon: null })]);
    expect(resolveColor({ type: 'x', color: null }, i2)).toBe('#5F5E5A');
    expect(resolveIcon({ type: 'x', icon: null }, i2)).toBe('FileText');
  });
  it('typeLabel e templateForType (custom e base)', () => {
    expect(typeLabel('fornecedor', idx)).toBe('Fornecedor');
    expect(typeLabel('acesso', idx)).toBe('Acesso');
    expect(templateForType('fornecedor', idx).map(f => f.label)).toEqual(['CNPJ']);
    expect(templateForType('acesso', idx).length).toBeGreaterThan(0);
  });
  it('slugifyType normaliza acento/espaço', () => {
    expect(slugifyType('Conta a Pagar')).toBe('conta_a_pagar');
    expect(slugifyType('Cartão')).toBe('cartao');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd web && npx vitest run src/lib/groupNotes.test.ts`
Expected: FAIL — funções/tipo não exportados.

- [ ] **Step 3: Implementar em `groupNotes.ts`**

(a) Widen do tipo da nota — trocar em `interface GroupNote`:
```ts
  id: string; group_id: string; type: string; category: string; tags: string[];
```
(`NoteType` segue como união das 5 base, usada nos defaults.)

(b) Adicionar (perto de `resolveColor`):
```ts
export interface GroupNoteType {
  id: string; group_id: string; key: string; label: string;
  color: string | null; icon: string | null; fields: NoteField[];
}
export type TypeMeta = { label: string; color: string; icon: string; fields: NoteField[] };
export type TypeIndex = Record<string, TypeMeta>;

// 5 base globais + custom do grupo (custom sobrepõe se mesma key).
export function buildTypeIndex(custom: GroupNoteType[] = []): TypeIndex {
  const idx: TypeIndex = {};
  for (const t of NOTE_TYPES) idx[t] = { label: NOTE_TYPE_META[t].label, color: TYPE_DEFAULTS[t].color, icon: TYPE_DEFAULTS[t].icon, fields: TEMPLATES[t] };
  for (const c of custom) idx[c.key] = { label: c.label, color: c.color ?? '#5F5E5A', icon: c.icon ?? 'FileText', fields: Array.isArray(c.fields) ? c.fields : [] };
  return idx;
}
export const typeLabel = (type: string, idx?: TypeIndex): string =>
  idx?.[type]?.label ?? NOTE_TYPE_META[type as NoteType]?.label ?? type;
export function templateForType(type: string, idx?: TypeIndex): NoteField[] {
  const f = idx?.[type]?.fields ?? TEMPLATES[type as NoteType] ?? [];
  return f.map((x) => ({ ...x }));
}
export function slugifyType(label: string): string {
  return (label || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'tipo';
}
```

(c) Trocar `resolveColor`/`resolveIcon` por versões com índice (retrocompatível):
```ts
export const resolveColor = (n: Pick<GroupNote, 'type' | 'color'>, idx?: TypeIndex): string =>
  n.color ?? idx?.[n.type]?.color ?? TYPE_DEFAULTS[n.type as NoteType]?.color ?? '#5F5E5A';
export const resolveIcon = (n: Pick<GroupNote, 'type' | 'icon'>, idx?: TypeIndex): string =>
  n.icon ?? idx?.[n.type]?.icon ?? TYPE_DEFAULTS[n.type as NoteType]?.icon ?? 'FileText';
```

(d) `typesWithCount` passa a derivar das notas (base na ordem + custom presentes):
```ts
export function typesWithCount(notes: GroupNote[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const n of notes) counts.set(n.type, (counts.get(n.type) || 0) + 1);
  const ordered = NOTE_TYPES.filter((t) => counts.has(t));
  const custom = [...counts.keys()].filter((t) => !NOTE_TYPES.includes(t as NoteType));
  return [...ordered, ...custom].map((type) => ({ type, count: counts.get(type)! }));
}
```

(e) I/O dos tipos (perto de `loadGroupNotes`):
```ts
export async function loadGroupNoteTypes(groupId: string): Promise<GroupNoteType[]> {
  const { data, error } = await supabase.from('group_note_types').select('*').eq('group_id', groupId).order('label', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((t) => ({ ...t, fields: Array.isArray(t.fields) ? t.fields : [] })) as GroupNoteType[];
}
export async function upsertGroupNoteType(groupId: string, createdBy: string, t: Partial<GroupNoteType> & { id?: string }): Promise<GroupNoteType> {
  const payload: Record<string, unknown> = {
    group_id: groupId, key: t.key || slugifyType(t.label || ''), label: (t.label || '').trim() || 'Tipo',
    color: t.color ?? null, icon: t.icon ?? null, fields: t.fields || [],
  };
  if (t.id) payload.id = t.id; else payload.created_by = createdBy;
  const { data, error } = await supabase.from('group_note_types').upsert(payload).select('*').single();
  if (error) throw error;
  const row = data as GroupNoteType;
  return { ...row, fields: Array.isArray(row.fields) ? row.fields : [] };
}
export async function deleteGroupNoteType(id: string): Promise<void> {
  const { error } = await supabase.from('group_note_types').delete().eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd web && npx vitest run src/lib/groupNotes.test.ts`
Expected: PASS (antigos + novos). Se `typesWithCount` quebrar algum teste antigo de ordem, conferir que base permanece em ordem de `NOTE_TYPES`.

---

## Task 3: Hook `useGroupNoteTypes`

**Files:** Create `web/src/hooks/useGroupNoteTypes.ts`.

- [ ] **Step 1: Criar o hook** (espelha `useGroupNotes`)

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadGroupNoteTypes, upsertGroupNoteType, deleteGroupNoteType, type GroupNoteType } from '../lib/groupNotes';
import { useAuth } from '../contexts/AuthContext';

export function useGroupNoteTypes(groupId: string) {
  const qc = useQueryClient();
  const { collaborator } = useAuth();
  const meId = collaborator?.id ?? '';
  const key = ['group-note-types', groupId];
  const list = useQuery({ queryKey: key, queryFn: () => loadGroupNoteTypes(groupId), enabled: !!groupId });
  const inval = () => qc.invalidateQueries({ queryKey: key });
  const saveType = useMutation({ mutationFn: (t: Partial<GroupNoteType> & { id?: string }) => upsertGroupNoteType(groupId, meId, t), onSuccess: inval });
  const removeType = useMutation({ mutationFn: (id: string) => deleteGroupNoteType(id), onSuccess: inval });
  return { types: list.data ?? [], loading: list.isLoading, saveType, removeType };
}
```

- [ ] **Step 2: Typecheck** — `cd web && npx tsc --noEmit` → PASS.

---

## Task 4: `NoteTypeForm.tsx` (criar tipo)

**Files:** Create `web/src/screens/grupos/notes/NoteTypeForm.tsx`.

- [ ] **Step 1: Criar o componente**

```tsx
import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import { NOTE_COLORS, NOTE_ICONS, slugifyType, type NoteField, type FieldKind } from '../../../lib/groupNotes';
import { useGroupNoteTypes } from '../../../hooks/useGroupNoteTypes';
import { NoteGlyph } from './IconRegistry';
import { Button } from '../../../components/Button';
import { showToast } from '../../../components/Toast';

const KINDS: { value: FieldKind; label: string }[] = [
  { value: 'text', label: 'Texto' }, { value: 'password', label: 'Senha' }, { value: 'url', label: 'Link' },
];

export function NoteTypeForm({ groupId, onSaved, onClose }: { groupId: string; onSaved: (key: string) => void; onClose: () => void }) {
  const { saveType } = useGroupNoteTypes(groupId);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string>(NOTE_COLORS[5]);
  const [icon, setIcon] = useState<string>('FileText');
  const [fields, setFields] = useState<NoteField[]>([{ label: '', value: '', kind: 'text' }]);
  const [saving, setSaving] = useState(false);

  function setField(i: number, p: Partial<NoteField>) { setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, ...p } : f))); }
  function addField() { setFields((fs) => [...fs, { label: '', value: '', kind: 'text' }]); }
  function removeField(i: number) { setFields((fs) => fs.filter((_, idx) => idx !== i)); }

  async function save() {
    const name = label.trim();
    if (!name) { showToast({ kind: 'error', title: 'Dá um nome pro tipo' }); return; }
    setSaving(true);
    try {
      const cleanFields = fields.filter((f) => f.label.trim()).map((f) => ({ label: f.label.trim(), value: '', kind: f.kind || 'text', secret: f.kind === 'password' }));
      const created = await saveType.mutateAsync({ key: slugifyType(name), label: name, color, icon, fields: cleanFields });
      onSaved(created.key);
    } catch {
      showToast({ kind: 'error', title: 'Não consegui criar o tipo' });
    } finally { setSaving(false); }
  }

  const inputCls = 'w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-bg-app border border-border rounded-lg w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-sm p-md border-b border-border shrink-0">
          <Plus size={18} className="text-tom" />
          <h3 className="text-body-lg font-semibold text-fg flex-1">Novo tipo de ficha</h3>
          <button onClick={onClose} aria-label="Fechar" className="text-fg-muted hover:text-fg p-1 focus-ring rounded-sm"><X size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto p-md space-y-md">
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Nome</div>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex.: Fornecedor" className={inputCls} autoFocus />
          </div>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Cor</div>
            <div className="flex flex-wrap gap-xs">
              {NOTE_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Cor ${c}`} onClick={() => setColor(c)} className="w-6 h-6 rounded-full focus-ring shrink-0"
                  style={{ background: c, outline: color === c ? '2px solid var(--color-fg, currentColor)' : 'none', outlineOffset: 2 }} />
              ))}
            </div>
          </div>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Ícone</div>
            <div className="flex flex-wrap gap-xs">
              {NOTE_ICONS.map((ic) => (
                <button key={ic} type="button" aria-label={ic} onClick={() => setIcon(ic)}
                  className={`grid place-items-center w-8 h-8 rounded-md border shrink-0 ${icon === ic ? 'border-tom text-tom' : 'border-border text-fg-muted'}`}>
                  <NoteGlyph name={ic} size={16} color={icon === ic ? color : undefined} />
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Campos do modelo</div>
            <div className="space-y-xs">
              {fields.map((f, i) => (
                <div key={i} className="flex items-center gap-xs">
                  <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="Rótulo do campo"
                    className="flex-1 min-w-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
                  <select value={f.kind || 'text'} onChange={(e) => setField(i, { kind: e.target.value as FieldKind })}
                    className="shrink-0 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom">
                    {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeField(i)} aria-label="Remover campo" className="text-fg-muted hover:text-danger p-1 shrink-0 focus-ring rounded-sm"><X size={15} /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addField} className="inline-flex items-center gap-1 text-body-sm text-tom mt-xs focus-ring rounded-sm"><Plus size={14} /> Adicionar campo</button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-sm p-md border-t border-border shrink-0">
          <Button variant="secondary" size="md" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" size="md" onClick={save} loading={saving}>Criar tipo</Button>
        </div>
      </div>
    </div>
  );
}
```
> Nota: usa `<select>` nativo só pro kind do campo (3 opções, edição secundária). Se o `tsc`/DS reclamar, trocar por `CustomSelect` size="sm".

- [ ] **Step 2: Typecheck** — `cd web && npx tsc --noEmit` → PASS (vai falhar enquanto NoteEditor não usar; ok prosseguir pra Task 5).

---

## Task 5: `NoteEditor.tsx` — select com "Novo tipo" + índice

**Files:** Modify `web/src/screens/grupos/notes/NoteEditor.tsx`.

- [ ] **Step 1: Aceitar `typeIndex` e abrir o form**

Trocar o import de `groupNotes` pra incluir `typeLabel, templateForType, type TypeIndex` e remover `NOTE_TYPES, NOTE_TYPE_META` (não mais usados pra montar opções). Adicionar import: `import { NoteTypeForm } from './NoteTypeForm';`.

Na interface `Props`, adicionar `typeIndex: TypeIndex;`. Na assinatura: `function NoteEditor({ note, onSave, onDone, onBack, typeIndex }: Props)`.

Trocar `const typeOpts = ...` por (dentro do componente, antes do return):
```tsx
  const [showTypeForm, setShowTypeForm] = useState(false);
  const typeOpts = Object.entries(typeIndex).map(([value, m]) => ({ value, label: m.label }));
```
Trocar `changeType`:
```tsx
  function changeType(t: string) {
    const pristine = (draft.fields || []).every(f => !f.value);
    patch(pristine ? { type: t, fields: templateForType(t, typeIndex) } : { type: t });
  }
```
Trocar `activeColor`/`activeIcon`:
```tsx
  const draftType = (draft.type as string) || 'acesso';
  const activeColor = resolveColor({ type: draftType, color: draft.color ?? null }, typeIndex);
  const activeIcon = resolveIcon({ type: draftType, icon: draft.icon ?? null }, typeIndex);
```

- [ ] **Step 2: CustomSelect com footerAction + render do form**

Trocar o bloco do CustomSelect de Tipo por:
```tsx
        <CustomSelect value={draft.type || 'acesso'} options={typeOpts} onChange={v => changeType(v)} size="sm"
          footerAction={{ label: '➕ Novo tipo…', onClick: () => setShowTypeForm(true) }} />
```
Antes do `</div>` final do componente, adicionar:
```tsx
      {showTypeForm && note.group_id && (
        <NoteTypeForm groupId={note.group_id} onClose={() => setShowTypeForm(false)}
          onSaved={(key) => { setShowTypeForm(false); changeType(key); }} />
      )}
```

- [ ] **Step 3: Typecheck** — `cd web && npx tsc --noEmit` (vai apontar GrupoAnotacoes não passando `typeIndex`; resolve na Task 7).

---

## Task 6: `NoteCard` / `NoteDetail` / `NotesTypeFilter` — usar índice

**Files:** Modify os três em `web/src/screens/grupos/notes/`.

- [ ] **Step 1: NoteCard** — aceitar `idx`:

Import: add `type TypeIndex`. Assinatura: `function NoteCard({ note, active, onClick, idx }: { note: GroupNote; active: boolean; onClick: () => void; idx?: TypeIndex })`. Trocar as duas chamadas: `resolveColor(note, idx)` e `resolveIcon(note, idx)` (no `style` borderLeftColor, e no `<NoteGlyph color/name>`).

- [ ] **Step 2: NoteDetail** — aceitar `idx` + label via `typeLabel`:

Import add `typeLabel, type TypeIndex`. Na `interface Props` add `idx?: TypeIndex`. Assinatura inclui `idx`. Trocar `const meta = NOTE_TYPE_META[note.type];` por **remover** essa linha. Onde usa `<NoteGlyph name={resolveIcon(note)} color={resolveColor(note)} .../>` → passar `idx`. Trocar o chip `{meta.label}` por `{typeLabel(note.type, idx)}`. (remover import `NOTE_TYPE_META` se ficar sem uso.)

- [ ] **Step 3: NotesTypeFilter** — chips com label do índice + filtro string:

Abrir o arquivo; trocar a tipagem do valor de filtro de `NoteType` para `string` e o rótulo do chip de `NOTE_TYPE_META[t].label` para `typeLabel(t, idx)` (receber `idx?: TypeIndex` por prop). `typesWithCount(notes)` já retorna `{type:string,count}` (Task 2).

- [ ] **Step 4: Typecheck parcial** — `cd web && npx tsc --noEmit` (resta GrupoAnotacoes).

---

## Task 7: `GrupoAnotacoes.tsx` — carregar tipos + propagar índice

**Files:** Modify `web/src/screens/grupos/GrupoAnotacoes.tsx`.

- [ ] **Step 1: Carregar tipos e montar índice**

Imports: `import { useGroupNoteTypes } from '../../hooks/useGroupNoteTypes';` e de `groupNotes` add `buildTypeIndex`. Trocar `type NoteType` em `useState<NoteType | null>` por `string`.

Após `const { notes, ... } = useGroupNotes(...)`:
```tsx
  const { types } = useGroupNoteTypes(groupId || '');
  const typeIndex = useMemo(() => buildTypeIndex(types), [types]);
```

- [ ] **Step 2: Propagar `idx`/`typeIndex` aos filhos**

- `NotesTypeFilter`: add prop `idx={typeIndex}`.
- `SortableNoteCard`: add `idx` na assinatura e repassar a `<NoteCard ... idx={idx} />`; nas chamadas de `SortableNoteCard`/`NoteCard` na lista, passar `idx={typeIndex}`.
- `NoteDetail`: add `idx={typeIndex}`.
- `NoteEditor`: add `typeIndex={typeIndex}`.

- [ ] **Step 3: Typecheck + build** — `cd web && npx tsc --noEmit && npx vite build` → PASS.

---

## Task 8: Backend `group-notes.js` — prompt lista tipos + valida key (TDD)

**Files:** Modify `src/services/group-notes.js`; Test `src/services/group-notes.test.js`.

- [ ] **Step 1: Testes que falham** (puros, append no test existente)

Import: trocar a linha de require pra incluir `pickType, renderTypesBlock`. Adicionar:
```js
test('pickType: aceita base e key custom permitida; coage o resto', () => {
  const allowed = new Set(['acesso','cnpj','conta','reuniao','livre','fornecedor']);
  assert.strictEqual(pickType('fornecedor', allowed), 'fornecedor');
  assert.strictEqual(pickType('acesso', allowed), 'acesso');
  assert.strictEqual(pickType('xpto', allowed), 'livre');
});
test('renderTypesBlock lista key — label e instrui não inventar', () => {
  const b = renderTypesBlock([{ key: 'fornecedor', label: 'Fornecedor' }]);
  assert.ok(b.includes('fornecedor') && b.includes('Fornecedor'));
  assert.ok(/n[ãa]o invente/i.test(b));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `node --test src/services/group-notes.test.js` → FAIL (não exportados).

- [ ] **Step 3: Implementar**

Em `group-notes.js`, adicionar:
```js
function pickType(type, allowedSet) {
  return allowedSet && allowedSet.has(type) ? type : 'livre';
}
function renderTypesBlock(types) {
  const base = [['acesso','Acesso'],['cnpj','CNPJ'],['conta','Conta'],['reuniao','Reunião'],['livre','Livre']];
  const all = [...base, ...((types || []).map((t) => [t.key, t.label]))];
  const lines = all.map(([k, l]) => `- ${k} — ${l}`).join('\n');
  return `Tipos de ficha disponíveis (use o mais adequado; NÃO invente tipo novo):\n${lines}`;
}
async function allowedTypeSet(supabase, groupId) {
  let custom = [];
  try {
    const { data } = await supabase.from('group_note_types').select('key').eq('group_id', groupId);
    custom = (data || []).map((r) => r.key).filter(Boolean);
  } catch (_) { /* sem tipos custom */ }
  return new Set([...NOTE_TYPES, ...custom]);
}
```
Em `createGroupNote`, trocar a linha do type:
```js
  const allowed = await allowedTypeSet(supabase, groupId);
  // ... no objeto row:
  type: pickType(note.type, allowed),
```
(remover o `NOTE_TYPES.includes(note.type) ? note.type : 'livre'` antigo.)
Em `groupNotesContext`, carregar tipos e injetar o bloco no topo do retorno:
```js
  const { data: typeRows } = await supabase.from('group_note_types').select('key,label').eq('group_id', groupId);
  // ... montar `out`, e antes do return final:
  out = `${renderTypesBlock(typeRows || [])}\n\n${out}`;
```
Atualizar `module.exports` add `pickType, renderTypesBlock`.

- [ ] **Step 4: Rodar e ver passar** — `node --test src/services/group-notes.test.js` (antigos + 2 novos) → PASS; `node --check src/services/group-notes.js` → OK.

---

## Task 9: Deploy + e2e + registro

**Files:** nenhum novo.

- [ ] **Step 1: Bateria de testes** — `node --test src/services/group-notes.test.js src/services/format-note.test.js src/ai/claude.test.js` + `cd web && npx vitest run src/lib/groupNotes.test.ts` → tudo PASS.

- [ ] **Step 2: Build PWA** — `cd web && npx tsc --noEmit && npx vite build` → PASS.

- [ ] **Step 3: Deploy backend** — `scp D:/la-organizer/_remote/src/services/group-notes.js tom:/opt/LA-Organizer/src/services/group-notes.js && ssh tom "pm2 restart tom && sleep 2 && pm2 logs tom --lines 8 --nostream"` → "TOM pronto" sem erro.

- [ ] **Step 4: e2e preview (com tipo descartável)** — localhost:4173, grupo Financeiro → Anotações:
  1. Conferir que o select de Tipo mostra as 3 sementes (Fornecedor/Cartão/Conta a pagar) + as 5 base + "➕ Novo tipo…".
  2. Criar tipo descartável (ex.: "Teste QA") com 2 campos → vira selecionável; criar ficha desse tipo → cor/ícone certos no card e detalhe → reload persiste. **Apagar a ficha e o tipo de teste depois** (preview = dado real).
  3. Selecionar "Fornecedor" numa nova ficha → campos do modelo pré-semeados.

- [ ] **Step 5: Dry-run TOM** — via `ssh tom`, conferir que `groupNotesContext({supabase,groupId:'d95f63af-...'})` inclui o bloco "Tipos de ficha disponíveis" com fornecedor/cartao/conta_pagar.

- [ ] **Step 6: Registro** — `tom_known_issues` (ou atualizar `GROUPNOTES-BODY-HTML`) anotando os tipos custom; atualizar memória `project_groupchat_anotacoes_grupo.md` com a seção "Fatia C entregue" (tabela `group_note_types`, índice, "+ Novo tipo", TOM lista tipos, sementes Financeiro).

- [ ] **Step 7: Fim do turno** — auto-deploy do PWA (não fazer push manual).

---

## Self-Review (feito)
- **Cobertura:** tabela+RLS+seed (T1) ✓ · índice/resolvers/IO/slug (T2) ✓ · hook (T3) ✓ · form criar tipo (T4) ✓ · select "+ Novo tipo" + template no changeType (T5) ✓ · card/detalhe/filtro via índice (T6) ✓ · página propaga índice (T7) ✓ · TOM lista tipos + valida key (T8) ✓ · deploy/e2e/registro (T9) ✓. 4 decisões cobertas (por grupo, qualquer membro, criador define campos, TOM escolhe).
- **Placeholders:** nenhum — código completo por passo; SQL e comandos com saída esperada.
- **Consistência:** `TypeIndex`/`buildTypeIndex`/`resolveColor(n,idx)`/`resolveIcon(n,idx)`/`typeLabel`/`templateForType`/`slugifyType` idênticos entre T2 e consumidores (T5–T7); `GroupNoteType` igual em lib/hook/form; `pickType`/`renderTypesBlock` entre T8 e testes; `group_notes.type` widened p/ string (T2) usado como string em T5–T7.
- **Riscos:** `typesWithCount` mudou de assinatura (`NoteType`→`string`) e ordem — preserva ordem base p/ não quebrar teste antigo; `NotesTypeFilter` precisa ler o arquivo atual antes de editar (props reais). `<select>` nativo no NoteTypeForm (kind) — trocar p/ CustomSelect se DS exigir.
