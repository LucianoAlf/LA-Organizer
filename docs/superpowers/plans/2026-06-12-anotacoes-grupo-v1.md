# Anotações do Grupo (Base de Conhecimento) — v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar a cada grupo de trabalho uma **base de conhecimento compartilhada** — anotações do grupo (markdown) organizadas por categoria + tags, num ambiente dois-painéis, com o TOM criando/consultando pelo chat.

**Architecture:** Tabela nova `group_notes` (RLS de membro). PWA: um `GroupNotesEnv` (rail · lista · documento) aberto por um botão 📒 no `GrupoWorkspace` (mesmo padrão de estado do `GroupChatDrawer`). Backend: marker `<<GROUP_NOTE>>` no `group-chat-engine.js` → `src/services/group-notes.js`; o prompt do grupo ganha o índice + body das fixadas. Migração move a nota "do grupo" (hack `shared_with`) da Rose pra `group_notes`.

**Tech Stack:** Supabase Postgres (`cesnbnrynvxvgdhfmaua`), React+TS+Tailwind (`web/`), Node CJS (`src/`), `marked`+`dompurify` (já no app), vitest + `node --test`.

---

## Convenções (ler antes)
- **Backend deploy:** `scp <arquivo> tom:/opt/LA-Organizer/<path>` + `ssh tom "pm2 restart tom"`. Sintaxe: `node --check`.
- **`supabase/client` só existe na VPS** → em módulo backend que precise dele no nível de módulo, fazer require LAZY dentro da função (padrão já usado em `src/services/task-groups.js`). Funções do motor recebem `supabase` injetado → carregam local p/ teste.
- **PWA:** só editar em `web/`; Stop hook commita/pusha (Vercel). Validar `npx tsc --noEmit && npx vite build`.
- **DS obrigatório:** `CustomSelect({value, options:[{value,label}], onChange:(v:string)=>void, size})`, tokens `bg-bg-surface/bg-bg-elevated/text-fg/text-fg-muted/text-tom/border-border`, cor **`tom`** (verde), nunca `brand`. Guardrail mobile(375)/desktop(1440).
- **Markdown:** reusar o pipeline de `web/src/screens/grupos/chat/MessageBubble.tsx` (marked → DOMPurify.sanitize).
- **RLS membro (verbatim do `group_chat_messages`):** `group_id IN (SELECT group_id FROM work_group_members WHERE collaborator_id = current_collab_id())`.

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| migration `group_notes` | tabela + RLS + índices | Criar (MCP) |
| `src/services/group-notes.js` | `createGroupNote`/`appendGroupNote` + `groupNotesContext` | Criar |
| `src/services/group-notes.test.js` | testes backend | Criar |
| `src/services/group-chat-engine.js` | parse `<<GROUP_NOTE>>` + injeta contexto | Modificar |
| `src/services/group-chat-prompt.js` | bloco do marker + heurística | Modificar |
| `web/src/lib/groupNotes.ts` | puras (filter/categorias/tags/excerpt) + I/O | Criar |
| `web/src/lib/groupNotes.test.ts` | testes das puras | Criar |
| `web/src/hooks/useGroupNotes.ts` | React Query (lista + mutations) | Criar |
| `web/src/screens/grupos/notes/GroupNotesEnv.tsx` | shell rail·lista·doc | Criar |
| `web/src/screens/grupos/notes/NotesRail.tsx` | categorias+tags | Criar |
| `web/src/screens/grupos/notes/NotesList.tsx` | busca + itens | Criar |
| `web/src/screens/grupos/notes/NoteDoc.tsx` | documento + edição | Criar |
| `web/src/screens/grupos/GrupoWorkspace.tsx` | botão 📒 + estado | Modificar |
| `scripts/migrate-shared-notes-to-group.js` | migração 1-off | Criar |

---

## Task 1: Migration `group_notes`

**Files:** Create (MCP `apply_migration`, project `cesnbnrynvxvgdhfmaua`, name `group_notes`).

- [ ] **Step 1: Aplicar**
```sql
create table if not exists public.group_notes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  category text not null default 'Geral',
  tags text[] not null default '{}',
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  created_by uuid references public.collaborators(id),
  updated_by uuid references public.collaborators(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists group_notes_group_idx on public.group_notes(group_id);
create index if not exists group_notes_group_cat_idx on public.group_notes(group_id, category);

alter table public.group_notes enable row level security;
create policy gn_member_select on public.group_notes for select using (
  group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gn_member_insert on public.group_notes for insert with check (
  group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gn_member_update on public.group_notes for update using (
  group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()))
  with check (group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gn_member_delete on public.group_notes for delete using (
  group_id in (select group_id from public.work_group_members where collaborator_id = current_collab_id()));
create policy gn_service_all on public.group_notes for all using (auth.role()='service_role') with check (auth.role()='service_role');
```

- [ ] **Step 2: Verificar**
Via MCP `execute_sql`:
```sql
select rowsecurity from pg_tables where tablename='group_notes';                       -- true
select count(*) from pg_policies where tablename='group_notes';                          -- 5
```
Expected: `true` e `5`.

---

## Task 2: Backend `group-notes.js`

**Files:** Create `src/services/group-notes.js`, `src/services/group-notes.test.js`.

- [ ] **Step 1: Teste que falha**

`src/services/group-notes.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { createGroupNote, appendGroupNote, groupNotesContext } = require('./group-notes');

function fakeDb({ notes = [] } = {}) {
  const ev = [];
  function b() {
    const st = { filters: {}, op: 'select' };
    function resolve() {
      let rows = notes.filter((n) => (!st.filters.group_id || n.group_id === st.filters.group_id)
        && (!st.filters.ilike_title || n.title.toLowerCase() === st.filters.ilike_title));
      if (st.op === 'insert') { const row = { id: `n${notes.length + 1}`, ...st.row }; notes.push(row); ev.push(['insert', row]); return Promise.resolve({ data: { id: row.id }, error: null }); }
      if (st.op === 'update') { rows.forEach((r) => { Object.assign(r, st.patch); ev.push(['update', r.id, st.patch]); }); return Promise.resolve({ data: rows, error: null }); }
      return Promise.resolve({ data: rows, error: null });
    }
    const q = {
      select() { return q; }, eq(c, v) { st.filters[c] = v; return q; }, neq() { return q; },
      order() { return q; }, ilike(c, v) { st.filters['ilike_' + c] = String(v).toLowerCase(); return q; }, limit() { return q; },
      insert(row) { st.op = 'insert'; st.row = row; return q; }, update(p) { st.op = 'update'; st.patch = p; return q; },
      single() { return resolve().then((r) => ({ data: r.data, error: null })); },
      maybeSingle() { return resolve().then((r) => ({ data: (r.data || [])[0] || null, error: null })); },
      then(res, rej) { return resolve().then(res, rej); },
    };
    return q;
  }
  return { sb: { from: () => b() }, ev, notes };
}

test('createGroupNote insere com category/tags/created_by', async () => {
  const { sb, ev } = fakeDb();
  await createGroupNote({ supabase: sb, groupId: 'g1', createdBy: 'u1', note: { title: 'Acesso Zoho', category: 'Acessos', tags: ['Zoho'], body: 'login: x' } });
  const ins = ev.find((e) => e[0] === 'insert')[1];
  assert.strictEqual(ins.group_id, 'g1'); assert.strictEqual(ins.category, 'Acessos');
  assert.deepStrictEqual(ins.tags, ['Zoho']); assert.strictEqual(ins.created_by, 'u1');
});

test('appendGroupNote concatena no body por título', async () => {
  const notes = [{ id: 'n1', group_id: 'g1', title: 'Contas', body: 'linha 1' }];
  const { sb, ev } = fakeDb({ notes });
  await appendGroupNote({ supabase: sb, groupId: 'g1', updatedBy: 'u1', title: 'Contas', body: 'linha 2' });
  const up = ev.find((e) => e[0] === 'update');
  assert.ok(up[2].body.includes('linha 1') && up[2].body.includes('linha 2'));
});

test('groupNotesContext: índice de todas + body só das pinned', async () => {
  const notes = [
    { id: 'n1', group_id: 'g1', title: 'CNPJs', category: 'Fiscal', tags: ['fiscal'], body: 'X', pinned: true },
    { id: 'n2', group_id: 'g1', title: 'Reunião', category: 'Reuniões', tags: [], body: 'Y', pinned: false },
  ];
  const { sb } = fakeDb({ notes });
  const ctx = await groupNotesContext({ supabase: sb, groupId: 'g1' });
  assert.ok(ctx.includes('CNPJs') && ctx.includes('Reunião'));     // índice tem as duas
  assert.ok(ctx.includes('X'));                                     // body da pinned
  assert.ok(!ctx.includes('Y'));                                    // body da não-pinned fica fora
});
```

- [ ] **Step 2: Rodar e ver falhar**
Run: `cd D:/la-organizer/_remote && node --test src/services/group-notes.test.js`
Expected: FAIL — `Cannot find module './group-notes'`.

- [ ] **Step 3: Implementar**

`src/services/group-notes.js`:
```js
// src/services/group-notes.js
// Base de conhecimento do grupo (group_notes). createGroupNote/appendGroupNote usados
// pelo TOM (chat de grupo) via service_role; groupNotesContext monta o bloco que vai no
// prompt (índice de todas + body das fixadas). supabase injetado (testável sem DB).
'use strict';

async function createGroupNote({ supabase, groupId, createdBy, note }) {
  const row = {
    group_id: groupId, created_by: createdBy, updated_by: createdBy,
    title: String(note.title || '').trim().slice(0, 200),
    category: (note.category && String(note.category).trim()) || 'Geral',
    tags: Array.isArray(note.tags) ? note.tags.map((t) => String(t).trim()).filter(Boolean) : [],
    body: String(note.body || ''),
  };
  const { data, error } = await supabase.from('group_notes').insert(row).select('id').single();
  if (error) throw new Error('insert group_note: ' + error.message);
  return { id: data.id };
}

async function appendGroupNote({ supabase, groupId, updatedBy, title, body }) {
  const { data: hit } = await supabase.from('group_notes')
    .select('id, body').eq('group_id', groupId).ilike('title', String(title || '').trim()).limit(1).maybeSingle();
  if (!hit) return { appended: false, reason: 'not_found' };
  const newBody = `${hit.body || ''}\n\n${String(body || '')}`.trim();
  await supabase.from('group_notes').update({ body: newBody, updated_by: updatedBy, updated_at: new Date().toISOString() }).eq('id', hit.id);
  return { appended: true, id: hit.id };
}

// Bloco pro prompt do grupo: índice (título · categoria · tags) de TODAS + body das fixadas.
async function groupNotesContext({ supabase, groupId }) {
  const { data } = await supabase.from('group_notes')
    .select('title, category, tags, body, pinned').eq('group_id', groupId).order('pinned', { ascending: false });
  const notes = data || [];
  if (!notes.length) return '';
  const idx = notes.map((n) => `- ${n.title} (${n.category})${(n.tags || []).length ? ' · ' + n.tags.map((t) => '#' + t).join(' ') : ''}`).join('\n');
  const pinned = notes.filter((n) => n.pinned).map((n) => `### ${n.title}\n${n.body}`).join('\n\n');
  let out = `## Anotações do grupo (base de conhecimento)\n${idx}`;
  if (pinned) out += `\n\n### Fixadas (conteúdo):\n${pinned}`;
  return out;
}

module.exports = { createGroupNote, appendGroupNote, groupNotesContext };
```

- [ ] **Step 4: Rodar e ver passar**
Run: `cd D:/la-organizer/_remote && node --test src/services/group-notes.test.js`
Expected: PASS (3 testes).

---

## Task 3: Engine — parse `<<GROUP_NOTE>>` + injeta contexto + prompt

**Files:** Modify `src/services/group-chat-engine.js`, `src/services/group-chat-prompt.js`.

- [ ] **Step 1: require + parse do marker no engine**

Em `group-chat-engine.js`, no topo (junto dos outros require):
```js
const groupNotes = require('./group-notes');
```
Logo após o bloco `<<TASK_GROUP>>` (mesmo estilo), adicionar:
```js
  // ─── ANOTAÇÃO DO GRUPO (base de conhecimento) ─────────────────────────────
  const gnMatch = reply.match(/<<GROUP_NOTE>>([\s\S]*?)<<END>>/i);
  if (gnMatch) {
    stripBlock(/<<GROUP_NOTE>>[\s\S]*?<<END>>/i);
    let p = null; try { p = JSON.parse(gnMatch[1].trim()); } catch (_) { p = null; }
    if (!p || (p.action !== 'create' && p.action !== 'append')) {
      actions.push({ kind: 'note', status: 'fail', label: 'Anotação', detail: 'marker malformado' });
    } else {
      try {
        if (p.action === 'create') {
          await groupNotes.createGroupNote({ supabase, groupId, createdBy: senderCollabId, note: { title: p.title, category: p.category, tags: p.tags, body: p.body } });
          actions.push({ kind: 'note', status: 'ok', label: p.title, detail: '📒 anotação do grupo' });
        } else {
          const r = await groupNotes.appendGroupNote({ supabase, groupId, updatedBy: senderCollabId, title: p.title, body: p.body });
          actions.push({ kind: 'note', status: r.appended ? 'ok' : 'fail', label: p.title, detail: r.appended ? '📒 atualizada' : 'não achei essa anotação' });
        }
      } catch (e) { console.error('[GroupChat] GROUP_NOTE:', e.message); actions.push({ kind: 'note', status: 'fail', label: p.title || 'Anotação', detail: 'não consegui salvar' }); }
    }
  }
```

- [ ] **Step 2: injetar o contexto das anotações no prompt**

Em `group-chat-engine.js`, achar onde `buildGroupChatPrompt(...)` é chamado (e onde `loadContext`/`ctx` monta os campos). Adicionar, antes de montar o prompt:
```js
  let notesCtx = '';
  try { notesCtx = await groupNotes.groupNotesContext({ supabase, groupId }); } catch (_) { notesCtx = ''; }
```
e passar `notesCtx` para `buildGroupChatPrompt({ ..., notesContext: notesCtx })`.

> Achar a chamada real (grep `buildGroupChatPrompt(` no engine) e acrescentar a chave `notesContext` ao objeto existente, sem remover as outras.

- [ ] **Step 3: prompt aceita `notesContext` + documenta o marker**

Em `group-chat-prompt.js`, `buildGroupChatPrompt({...})`:
- adicionar `notesContext` à desestruturação dos parâmetros;
- renderizar o bloco (se houver) logo após "## Memória de longo prazo deste grupo":
```js
${notesContext ? `\n${notesContext}\n` : ''}
```
- na seção "## Markers disponíveis", antes de "### Tarefa do grupo", inserir:
```js
`
### Anotação do grupo (base de conhecimento compartilhada)
Quando pedirem pra GUARDAR/REGISTRAR algo do grupo (acesso, senha, CNPJ, contas, resumo de reunião — coisa que o time precisa consultar depois), crie uma anotação DO GRUPO (visível a todos os membros):
<<GROUP_NOTE>>{"action":"create","title":"<título>","category":"<Acessos|CNPJs|Contas|Reuniões|…>","tags":["<tag>"],"body":"<conteúdo em markdown>"}<<END>>
Pra acrescentar a uma anotação que já existe: <<GROUP_NOTE>>{"action":"append","title":"<título exato>","body":"<texto novo>"}<<END>>.
- Anotação PESSOAL (privada da pessoa) continua sendo <<NOTE_ACTION>> no privado — NUNCA use shared_with pra simular anotação de grupo.
- As anotações do grupo aparecem no seu contexto acima ("Anotações do grupo"): use pra responder ("tá na anotação X", e se estiver fixada, dê o valor). NUNCA diga "anotei pro grupo" sem emitir <<GROUP_NOTE>>.
`
```

- [ ] **Step 4: Sintaxe + presença**
Run: `cd D:/la-organizer/_remote && node --check src/services/group-chat-engine.js && node --check src/services/group-chat-prompt.js`
Expected: exit 0.
Run: `node -e "const {buildGroupChatPrompt}=require('./src/services/group-chat-prompt'); const p=buildGroupChatPrompt({soulText:'',groupName:'X',members:[],pool:[],history:[],senderName:'Y',notesContext:'## Anotações do grupo\n- CNPJs (Fiscal)'}); console.log(p.includes('GROUP_NOTE') && p.includes('CNPJs (Fiscal)') ? 'OK' : 'FALTA');"`
Expected: `OK`.

- [ ] **Step 5: Deploy backend**
```bash
scp D:/la-organizer/_remote/src/services/group-notes.js D:/la-organizer/_remote/src/services/group-chat-engine.js D:/la-organizer/_remote/src/services/group-chat-prompt.js tom:/opt/LA-Organizer/src/services/
ssh tom "cd /opt/LA-Organizer && node -e \"require('./src/services/group-chat-engine'); console.log('OK')\" && pm2 restart tom >/dev/null 2>&1 && echo RESTARTED"
```
Expected: `OK` + `RESTARTED`.

---

## Task 4: PWA — `groupNotes.ts` (puras + I/O)

**Files:** Create `web/src/lib/groupNotes.ts`, `web/src/lib/groupNotes.test.ts`.

- [ ] **Step 1: Teste que falha**

`web/src/lib/groupNotes.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { filterNotes, categoriesWithCount, allTags, noteExcerpt, type GroupNote } from './groupNotes';

const N = (o: Partial<GroupNote>): GroupNote => ({ id: 'x', group_id: 'g', category: 'Geral', tags: [], title: '', body: '', pinned: false, created_by: null, updated_by: null, created_at: '', updated_at: '', ...o });

describe('groupNotes puras', () => {
  const notes = [
    N({ id: '1', title: 'Acesso Zoho', category: 'Acessos', tags: ['Zoho'], body: 'login x' }),
    N({ id: '2', title: 'CNPJs', category: 'Fiscal', tags: ['fiscal'], body: 'numeros' }),
    N({ id: '3', title: 'Light Recreio', category: 'Acessos', tags: ['Recreio', 'Light'], body: 'senha y' }),
  ];
  it('filterNotes por categoria', () => {
    expect(filterNotes(notes, { category: 'Acessos' }).map((n) => n.id)).toEqual(['1', '3']);
  });
  it('filterNotes por tag', () => {
    expect(filterNotes(notes, { tag: 'Recreio' }).map((n) => n.id)).toEqual(['3']);
  });
  it('filterNotes por busca (título + body, case-insensitive)', () => {
    expect(filterNotes(notes, { query: 'zoho' }).map((n) => n.id)).toEqual(['1']);
    expect(filterNotes(notes, { query: 'senha' }).map((n) => n.id)).toEqual(['3']);
  });
  it('categoriesWithCount', () => {
    expect(categoriesWithCount(notes)).toEqual([{ category: 'Acessos', count: 2 }, { category: 'Fiscal', count: 1 }]);
  });
  it('allTags únicas ordenadas', () => {
    expect(allTags(notes)).toEqual(['Light', 'Recreio', 'Zoho', 'fiscal']);
  });
  it('noteExcerpt corta markdown', () => {
    expect(noteExcerpt('# Título\nlinha de corpo aqui').length).toBeLessThanOrEqual(120);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**
Run: `cd D:/la-organizer/_remote/web && npx vitest run src/lib/groupNotes.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

`web/src/lib/groupNotes.ts`:
```ts
import { supabase } from './supabase';

export interface GroupNote {
  id: string; group_id: string; category: string; tags: string[];
  title: string; body: string; pinned: boolean;
  created_by: string | null; updated_by: string | null; created_at: string; updated_at: string;
}

export function filterNotes(notes: GroupNote[], f: { category?: string; tag?: string; query?: string }): GroupNote[] {
  const q = (f.query || '').trim().toLowerCase();
  return notes.filter((n) => {
    if (f.category && n.category !== f.category) return false;
    if (f.tag && !n.tags.includes(f.tag)) return false;
    if (q && !(`${n.title}\n${n.body}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

export function categoriesWithCount(notes: GroupNote[]): Array<{ category: string; count: number }> {
  const m = new Map<string, number>();
  for (const n of notes) m.set(n.category, (m.get(n.category) || 0) + 1);
  return [...m.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => a.category.localeCompare(b.category));
}

export function allTags(notes: GroupNote[]): string[] {
  return [...new Set(notes.flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b));
}

export function noteExcerpt(body: string, max = 120): string {
  const plain = (body || '').replace(/[#*`>_\-]/g, '').replace(/\s+/g, ' ').trim();
  return plain.length > max ? plain.slice(0, max - 1) + '…' : plain;
}

// ── I/O ──
export async function loadGroupNotes(groupId: string): Promise<GroupNote[]> {
  const { data, error } = await supabase.from('group_notes')
    .select('*').eq('group_id', groupId).order('pinned', { ascending: false }).order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as GroupNote[];
}
export async function upsertGroupNote(groupId: string, updatedBy: string, note: Partial<GroupNote> & { id?: string }): Promise<string> {
  const payload: Record<string, unknown> = {
    group_id: groupId, title: (note.title || '').trim() || 'Sem título',
    category: (note.category || 'Geral').trim(), tags: note.tags || [], body: note.body || '',
    pinned: note.pinned ?? false, updated_by: updatedBy, updated_at: new Date().toISOString(),
  };
  if (note.id) payload.id = note.id; else payload.created_by = updatedBy;
  const { data, error } = await supabase.from('group_notes').upsert(payload).select('id').single();
  if (error) throw error;
  return (data as { id: string }).id;
}
export async function deleteGroupNote(id: string): Promise<void> {
  const { error } = await supabase.from('group_notes').delete().eq('id', id);
  if (error) throw error;
}
export async function togglePin(id: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from('group_notes').update({ pinned }).eq('id', id);
  if (error) throw error;
}
```
> Confirmar que o client do PWA é `./supabase` (export `supabase`) — confirmado nesta sessão (igual `groupNotifications.ts`).

- [ ] **Step 4: Rodar e ver passar**
Run: `cd D:/la-organizer/_remote/web && npx vitest run src/lib/groupNotes.test.ts`
Expected: PASS (6 testes).

---

## Task 5: PWA — hook + componentes do ambiente

**Files:** Create `web/src/hooks/useGroupNotes.ts` + `web/src/screens/grupos/notes/{GroupNotesEnv,NotesRail,NotesList,NoteDoc}.tsx`.

- [ ] **Step 1: Hook `useGroupNotes`**

`web/src/hooks/useGroupNotes.ts`:
```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { loadGroupNotes, upsertGroupNote, deleteGroupNote, togglePin, type GroupNote } from '../lib/groupNotes';
import { useAuth } from '../contexts/AuthContext';

export function useGroupNotes(groupId: string) {
  const qc = useQueryClient();
  const { meuId } = useAuth() as { meuId: string };
  const key = ['group-notes', groupId];
  const list = useQuery({ queryKey: key, queryFn: () => loadGroupNotes(groupId), enabled: !!groupId });
  const inval = () => qc.invalidateQueries({ queryKey: key });
  const save = useMutation({ mutationFn: (n: Partial<GroupNote> & { id?: string }) => upsertGroupNote(groupId, meuId, n), onSuccess: inval });
  const remove = useMutation({ mutationFn: (id: string) => deleteGroupNote(id), onSuccess: inval });
  const pin = useMutation({ mutationFn: (v: { id: string; pinned: boolean }) => togglePin(v.id, v.pinned), onSuccess: inval });
  return { notes: list.data ?? [], loading: list.isLoading, save, remove, pin };
}
```
> Confirmar a fonte real do `meuId` (no `useWorkGroups` ele vem como `meuId`; se o `useAuth` expõe outro nome, ajustar — usar o mesmo que o `GroupConfigPanel` usa).

- [ ] **Step 2: `NotesRail.tsx`**
```tsx
import { categoriesWithCount, allTags, type GroupNote } from '../../../lib/groupNotes';

interface Props { notes: GroupNote[]; category: string | null; tag: string | null;
  onCategory: (c: string | null) => void; onTag: (t: string | null) => void; }

export function NotesRail({ notes, category, tag, onCategory, onTag }: Props) {
  const cats = categoriesWithCount(notes);
  const tags = allTags(notes);
  const item = (active: boolean) => `w-full text-left px-sm py-xs rounded-sm text-body-sm flex justify-between items-center ${active ? 'bg-tom/10 text-tom font-medium' : 'text-fg-muted hover:bg-bg-elevated'}`;
  return (
    <div className="w-40 shrink-0 border-r border-border p-sm space-y-xs overflow-y-auto">
      <p className="text-caption uppercase tracking-wide text-fg-muted px-sm pt-xs">Categorias</p>
      <button className={item(!category)} onClick={() => onCategory(null)}><span>Todas</span><span>{notes.length}</span></button>
      {cats.map((c) => (
        <button key={c.category} className={item(category === c.category)} onClick={() => onCategory(c.category)}>
          <span className="truncate">{c.category}</span><span>{c.count}</span></button>
      ))}
      {tags.length > 0 && <p className="text-caption uppercase tracking-wide text-fg-muted px-sm pt-sm">Tags</p>}
      <div className="flex flex-wrap gap-xs px-sm">
        {tags.map((t) => (
          <button key={t} onClick={() => onTag(tag === t ? null : t)}
            className={`text-caption px-sm py-[2px] rounded-full border ${tag === t ? 'bg-tom/15 text-tom border-tom' : 'border-border text-fg-muted'}`}>#{t}</button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: `NotesList.tsx`**
```tsx
import { useState } from 'react';
import { noteExcerpt, type GroupNote } from '../../../lib/groupNotes';

interface Props { notes: GroupNote[]; selectedId: string | null; query: string;
  onQuery: (q: string) => void; onSelect: (n: GroupNote) => void; onNew: () => void; }

export function NotesList({ notes, selectedId, query, onQuery, onSelect, onNew }: Props) {
  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col">
      <div className="p-sm border-b border-border flex gap-xs">
        <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="🔍 Buscar…"
          className="flex-1 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
        <button onClick={onNew} className="bg-tom text-black rounded-md px-2 text-body-sm font-semibold" aria-label="Nova anotação">+</button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 && <p className="text-body-sm text-fg-muted p-sm">Nenhuma anotação.</p>}
        {notes.map((n) => (
          <button key={n.id} onClick={() => onSelect(n)}
            className={`w-full text-left px-sm py-2 border-b border-border ${selectedId === n.id ? 'bg-bg-elevated' : 'hover:bg-bg-elevated/50'}`}>
            <div className="text-body-sm font-medium text-fg flex items-center gap-xs">{n.pinned && <span>📌</span>}{n.title || 'Sem título'}</div>
            <div className="text-caption text-fg-muted truncate">{noteExcerpt(n.body, 60) || n.category}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: `NoteDoc.tsx`** (render markdown + modo edição)
```tsx
import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { CustomSelect } from '../../../components/CustomSelect';
import type { GroupNote } from '../../../lib/groupNotes';

interface Props { note: GroupNote | null; allCategories: string[]; canEdit: boolean;
  onSave: (patch: Partial<GroupNote> & { id?: string }) => void; onDelete: (id: string) => void; onPin: (id: string, pinned: boolean) => void; onBack?: () => void; }

export function NoteDoc({ note, allCategories, onSave, onDelete, onPin, onBack }: Props) {
  const [edit, setEdit] = useState(!note?.id);
  const [draft, setDraft] = useState<Partial<GroupNote>>(note ?? { title: '', category: 'Geral', tags: [], body: '' });
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setDraft(note ?? { title: '', category: 'Geral', tags: [], body: '' }); setEdit(!note?.id); }, [note?.id]);

  function patch(p: Partial<GroupNote>) {
    setDraft((d) => { const next = { ...d, ...p }; clearTimeout(timer.current); timer.current = setTimeout(() => onSave({ ...next, id: note?.id }), 600); return next; });
  }
  if (!note && !edit) return <div className="flex-1 flex items-center justify-center text-fg-muted text-body-sm">Selecione uma anotação</div>;

  const catOpts = [...new Set([...allCategories, 'Acessos', 'CNPJs', 'Contas', 'Reuniões', 'Geral'])].map((c) => ({ value: c, label: c }));
  const html = DOMPurify.sanitize(marked.parse(draft.body || '', { async: false }) as string);

  return (
    <div className="flex-1 p-md overflow-y-auto">
      <div className="flex items-center gap-sm mb-sm">
        {onBack && <button className="text-fg-muted md:hidden" onClick={onBack}>←</button>}
        <div className="flex-1" />
        {note?.id && <button className="text-body-sm text-fg-muted" onClick={() => onPin(note.id, !note.pinned)}>{note.pinned ? '📌 Fixada' : '📌 Fixar'}</button>}
        <button className="text-body-sm text-tom font-medium" onClick={() => setEdit((v) => !v)}>{edit ? 'Pronto' : 'Editar'}</button>
        {note?.id && <button className="text-body-sm text-danger" onClick={() => onDelete(note.id)}>Excluir</button>}
      </div>
      {edit ? (
        <div className="space-y-sm">
          <input value={draft.title || ''} onChange={(e) => patch({ title: e.target.value })} placeholder="Título"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-body-lg font-semibold text-fg focus:outline-none focus:border-tom" />
          <div className="flex gap-sm items-center">
            <CustomSelect value={draft.category || 'Geral'} options={catOpts} onChange={(v) => patch({ category: v })} size="sm" />
            <input value={(draft.tags || []).join(', ')} onChange={(e) => patch({ tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })}
              placeholder="tags: Recreio, Zoho" className="flex-1 bg-bg-surface border border-border rounded-md p-1.5 text-body-sm text-fg focus:outline-none focus:border-tom" />
          </div>
          <textarea value={draft.body || ''} onChange={(e) => patch({ body: e.target.value })} rows={14} placeholder="Conteúdo (markdown)…"
            className="w-full bg-bg-surface border border-border rounded-md p-2 text-body-sm text-fg font-mono focus:outline-none focus:border-tom" />
        </div>
      ) : (
        <>
          <h2 className="text-h3 text-fg">{draft.title}</h2>
          <p className="text-caption text-fg-muted mb-sm">👥 do grupo{(draft.tags || []).length ? ' · ' + (draft.tags || []).map((t) => '#' + t).join(' ') : ''}</p>
          <div className="prose-tom text-body-sm text-fg" dangerouslySetInnerHTML={{ __html: html }} />
        </>
      )}
    </div>
  );
}
```
> Espelhar o sanitize/marked exatamente como `chat/MessageBubble.tsx` faz (mesma config). `prose-tom` = classe de tipografia se existir; senão, estilos inline básicos.

- [ ] **Step 5: `GroupNotesEnv.tsx`** (shell + estado mobile)
```tsx
import { useMemo, useState } from 'react';
import { useGroupNotes } from '../../../hooks/useGroupNotes';
import { filterNotes, categoriesWithCount, type GroupNote } from '../../../lib/groupNotes';
import { NotesRail } from './NotesRail';
import { NotesList } from './NotesList';
import { NoteDoc } from './NoteDoc';

export function GroupNotesEnv({ groupId }: { groupId: string }) {
  const { notes, save, remove, pin } = useGroupNotes(groupId);
  const [category, setCategory] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GroupNote | null>(null);
  const [mobilePane, setMobilePane] = useState<'list' | 'doc'>('list');

  const filtered = useMemo(() => filterNotes(notes, { category: category || undefined, tag: tag || undefined, query }), [notes, category, tag, query]);
  const allCats = categoriesWithCount(notes).map((c) => c.category);
  const current = selected ? notes.find((n) => n.id === selected.id) ?? selected : null;

  function openNew() { setSelected({ id: '', group_id: groupId, category: 'Geral', tags: [], title: '', body: '', pinned: false, created_by: null, updated_by: null, created_at: '', updated_at: '' }); setMobilePane('doc'); }
  function onSelect(n: GroupNote) { setSelected(n); setMobilePane('doc'); }

  return (
    <div className="flex h-full min-h-0">
      <div className="hidden md:flex"><NotesRail notes={notes} category={category} tag={tag} onCategory={setCategory} onTag={setTag} /></div>
      <div className={`${mobilePane === 'doc' ? 'hidden md:flex' : 'flex'} flex-col`}><NotesList notes={filtered} selectedId={current?.id || null} query={query} onQuery={setQuery} onSelect={onSelect} onNew={openNew} /></div>
      <div className={`${mobilePane === 'list' ? 'hidden md:flex' : 'flex'} flex-1`}>
        <NoteDoc note={current} allCategories={allCats} canEdit
          onSave={(p) => save.mutate(p, { onSuccess: () => { /* lista revalida */ } })}
          onDelete={(id) => { remove.mutate(id); setSelected(null); setMobilePane('list'); }}
          onPin={(id, p) => pin.mutate({ id, pinned: p })}
          onBack={() => { setSelected(null); setMobilePane('list'); }} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: tsc**
Run: `cd D:/la-organizer/_remote/web && npx tsc --noEmit 2>&1 | tail -20`
Expected: sem erros (corrigir imports/props até limpar).

---

## Task 6: Integrar no `GrupoWorkspace`

**Files:** Modify `web/src/screens/grupos/GrupoWorkspace.tsx`.

- [ ] **Step 1: estado + botão + render**

Espelhar o padrão do chat (`chatOpen`). Adicionar:
```tsx
import { GroupNotesEnv } from './notes/GroupNotesEnv';
// ...dentro do componente:
const [notesOpen, setNotesOpen] = useState(false);
```
Botão no cabeçalho (junto de Chat/Pacote/Nova tarefa) — seguir o mesmo `<Button>`/estilo dos vizinhos:
```tsx
<Button variant={notesOpen ? 'primary' : 'secondary'} size="sm" onClick={() => setNotesOpen(v => !v)}>📒 Anotações</Button>
```
Render do ambiente como **drawer/painel** (espelhar como o `GroupChatDrawer` é montado — overlay no mobile, painel lateral/empurra no desktop). Mínimo viável reusando o mesmo container do chat:
```tsx
{notesOpen && groupId && (
  <div className="fixed inset-0 z-40 bg-bg-app md:absolute md:inset-y-0 md:right-0 md:left-auto md:w-[640px] md:border-l md:border-border flex flex-col">
    <div className="flex items-center gap-sm p-sm border-b border-border">
      <span className="font-semibold text-fg">📒 Anotações · {group?.name}</span>
      <div className="flex-1" />
      <button onClick={() => setNotesOpen(false)} className="text-fg-muted">✕</button>
    </div>
    <div className="flex-1 min-h-0"><GroupNotesEnv groupId={groupId} /></div>
  </div>
)}
```
> Ajustar ao layout real do workspace (ver como `chatOpen`/`GroupChatDrawer` empurra o conteúdo com `md:pr-…` — replicar se quiser o mesmo "push", ou usar overlay simples). Não quebrar o guardrail mobile/desktop.

- [ ] **Step 2: tsc + build**
Run: `cd D:/la-organizer/_remote/web && npx tsc --noEmit && npx vite build 2>&1 | tail -4`
Expected: tsc limpo, build conclui.

- [ ] **Step 3: validar no preview (localhost:4173)**
Recarregar (limpar SW), abrir o grupo Financeiro → clicar 📒 Anotações → criar uma anotação (título "Teste KB", categoria Acessos, tags, body markdown) → confirmar que aparece na lista + render markdown no doc + filtro por categoria/tag funciona. Usar `mcp__Claude_Preview__preview_eval` + screenshot (ver [[feedback_preview_validation]]). Depois apagar a "Teste KB".

---

## Task 7: Migração da nota da Rose

**Files:** Create `scripts/migrate-shared-notes-to-group.js`.

- [ ] **Step 1: Script**
```js
// VPS: node --env-file=.env scripts/migrate-shared-notes-to-group.js [--dry]
// Migra a(s) nota(s) que o TOM marcou como "do grupo" (hack shared_with) no Financeiro
// pra group_notes. Idempotente (pula se já existe título igual no grupo). Não deleta:
// arquiva a nota pessoal original (archived=true).
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const supabase = require('../src/supabase/client');
const { createGroupNote } = require('../src/services/group-notes');

const GID = 'd95f63af-5032-4120-89f2-ca4c49684cbc';
const DRY = process.argv.includes('--dry');
// Títulos a migrar (notas pessoais compartilhadas que são, na prática, do grupo):
const TITLES = ['Contas a Pagar 15/06/2026'];

(async () => {
  for (const title of TITLES) {
    const { data: notes } = await supabase.from('notes')
      .select('id, title, body, collaborator_id, shared_with, archived')
      .ilike('title', title).limit(1);
    const n = (notes || [])[0];
    if (!n) { console.log('skip (não achei):', title); continue; }
    const { data: exists } = await supabase.from('group_notes').select('id').eq('group_id', GID).ilike('title', title).limit(1);
    if (exists && exists.length) { console.log('skip (já migrada):', title); continue; }
    if (DRY) { console.log('[dry] migraria:', title, '→ categoria Contas'); continue; }
    await createGroupNote({ supabase, groupId: GID, createdBy: n.collaborator_id, note: { title: n.title, category: 'Contas', tags: [], body: n.body || '' } });
    await supabase.from('notes').update({ archived: true }).eq('id', n.id);
    console.log('migrada + arquivada:', title);
  }
  console.log('DONE', DRY ? '(dry)' : '');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 2: dry-run + run**
```bash
scp D:/la-organizer/_remote/scripts/migrate-shared-notes-to-group.js tom:/opt/LA-Organizer/scripts/migrate-shared-notes-to-group.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/migrate-shared-notes-to-group.js --dry"
ssh tom "cd /opt/LA-Organizer && node --env-file=.env scripts/migrate-shared-notes-to-group.js"
```
Expected: dry mostra "migraria: Contas a Pagar…"; run mostra "migrada + arquivada".

- [ ] **Step 3: validar no banco**
```sql
select title, category, left(body,40) as preview from group_notes where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc';
```
Expected: a anotação "Contas a Pagar 15/06/2026" presente na categoria "Contas".

---

## Task 8: e2e + registro

- [ ] **Step 1: e2e pelo chat (TOM)**
No grupo Financeiro (app/WhatsApp): *"Tom, guarda pro grupo o acesso do Zoho: login financeiro@lamusicschool.com.br, senha 230712la — categoria Acessos."*
Confirmar via `execute_sql`:
```sql
select title, category, tags from group_notes where group_id='d95f63af-5032-4120-89f2-ca4c49684cbc' and title ilike '%Zoho%';
```
Expected: 1 linha (category Acessos). Conferir que aparece no ambiente 📒 no app. Depois limpar a de teste.

- [ ] **Step 2: e2e de consulta (TOM lê)**
Fixar a anotação do Zoho (📌 no app), e perguntar no chat: *"Tom, qual a senha do Zoho?"* → o TOM deve responder com base no body da fixada (que entrou no prompt via `groupNotesContext`).

- [ ] **Step 3: known issue + memória**
INSERT em `tom_known_issues` código `GROUPCHAT-GROUP-NOTES-V1` (feature: base de conhecimento do grupo; antes só nota pessoal + hack shared_with). Escrever memória `project_groupchat_anotacoes_grupo.md` + linha no MEMORY.md.

---

## Self-Review

**1. Spec coverage:**
- §3 `group_notes` + RLS → Task 1 ✅
- §4 UI dois-painéis (env/rail/list/doc) + botão → Tasks 5, 6 ✅
- §4.3 lib puras + hook → Tasks 4, 5 ✅
- §5 TOM marker + contexto + prompt → Tasks 2, 3 ✅
- §6 migração → Task 7 ✅
- §7 testes (puras/marker/RLS/e2e) → Tasks 2, 4, 6, 8 ✅

**2. Placeholder scan:** Sem TBD. As notas `> Confirmar/Ajustar…` (meuId, sanitize do MessageBubble, push do drawer) são fidelidade ao código real, com como-resolver concreto.

**3. Type consistency:** `GroupNote` (campos) idêntico entre lib (Task 4), hook e componentes (Task 5). `filterNotes({category,tag,query})`, `categoriesWithCount→{category,count}`, `allTags→string[]` consistentes. Backend `createGroupNote({supabase,groupId,createdBy,note})` / `appendGroupNote({...,title,body})` / `groupNotesContext({supabase,groupId})` iguais entre service (Task 2), engine (Task 3) e migração (Task 7).
