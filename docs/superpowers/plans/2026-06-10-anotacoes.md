# Módulo Anotações — Plano de Implementação

> **STATUS (10/06 ~12h BRT): T1–T10 ENTREGUES.** Migration + RLS ✓ (3 policies) · parser 7/7 ✓ ·
> service 5/5 ✓ · engine NOTE_ACTION ✓ · skill+gatilho+bloco 📒 no prompt ✓ · ata da Rose migrada
> (note 5a133e3b) ✓ · backend deployado (pm2 online) ✓ · PWA lista/detalhe/compartilhar/⚡vira-tarefas ✓
> (tsc+build ok; validado no preview 375px e 1440px; e2e real: task criada com link e descrição
> "📒 Da anotação", depois limpa; RLS provado — Alf não vê a nota da Rose). PENDENTE: T7.2 (Alf ditar
> anotação real pro TOM no WhatsApp) e T11.3 (avisar a Rose). Ajuste extra: FAB só no mobile;
> desktop usa botão "+ Nova anotação" no header.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Caderninho pessoal (ditado pro TOM ou criado no PWA) com compartilhamento e modo "⚡ Virar tarefas" em lote — spec aprovada em `docs/superpowers/specs/2026-06-10-anotacoes-design.md`.

**Architecture:** Tabela `notes` (+`note_task_links`) com RLS `current_collab_id()`; marker `<<NOTE_ACTION>>` no engine (espelho do CHECKLIST_ACTION, engine.js:8544); skill gatilhada por regex (system.js:~1068); bloco "📒 Anotações recentes" no prompt; PWA rota `/anotacoes` com dispatcher Mobile/Desktop, autosave e BottomSheet de lote.

**Tech Stack:** Supabase (Postgres+RLS), Node CJS (engine), React+TS+Tailwind (PWA), node --test.

**Regras do projeto que VALEM AQUI:** `collaborator_id` SEMPRE do remetente, nunca do marker · `current_collab_id()` nunca `auth.uid()` · fala=persistência (sem "Anotado!" com insert falho) · tokens DS `bg-tom`+`text-black` · dispatcher mobile/desktop obrigatório · deploy: scp + `pm2 restart tom` (pré-aprovado) · consultar `tom_known_issues` em qualquer bug.

---

### Task 1: Migration — notes + note_task_links + RLS

**Files:** migration via MCP `apply_migration` (name: `notes_module`).

- [ ] **1.1** Aplicar:

```sql
create table notes (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id),
  title text not null default '',
  body text not null default '',
  pinned boolean not null default false,
  archived boolean not null default false,
  source text not null default 'pwa' check (source in ('tom','pwa')),
  shared_with uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index notes_owner_idx on notes (collaborator_id, archived, pinned desc, updated_at desc);
create index notes_shared_idx on notes using gin (shared_with);

create table note_task_links (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references notes(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  line_no int not null,
  created_at timestamptz not null default now(),
  unique (note_id, line_no, task_id)
);

alter table notes enable row level security;
alter table note_task_links enable row level security;

create policy notes_owner_all on notes for all to authenticated
  using (collaborator_id = current_collab_id())
  with check (collaborator_id = current_collab_id());
create policy notes_shared_read on notes for select to authenticated
  using (current_collab_id() = any(shared_with));

create policy ntl_owner_all on note_task_links for all to authenticated
  using (exists (select 1 from notes n where n.id = note_id and n.collaborator_id = current_collab_id()))
  with check (exists (select 1 from notes n where n.id = note_id and n.collaborator_id = current_collab_id()));
```

- [ ] **1.2** Verificar: `select polname from pg_policies where tablename in ('notes','note_task_links');` → 3 policies. Esperado: `notes_owner_all, notes_shared_read, ntl_owner_all`.

### Task 2: Parser puro do marker (TDD)

**Files:** Create `src/services/note-marker.js` + `src/services/note-marker.test.js`.

- [ ] **2.1** Teste primeiro (`node --test src/services/note-marker.test.js` → FAIL "Cannot find module"):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseNoteActionMarker } = require('./note-marker');

test('create válido', () => {
  const r = parseNoteActionMarker('Anotado!\n<<NOTE_ACTION>>{"action":"create","title":"Reunião","body":"• item 1"}<<END>>');
  assert.equal(r.action.action, 'create');
  assert.equal(r.cleanText, 'Anotado!');
  assert.equal(r.malformed, false);
});
test('share_with deve ser array de strings', () => {
  const r = parseNoteActionMarker('<<NOTE_ACTION>>{"action":"create","title":"x","body":"y","share_with":"Ana"}<<END>>');
  assert.equal(r.malformed, true);
});
test('append exige note e body', () => {
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"append","body":"z"}<<END>>').malformed, true);
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"append","note":"latest","body":"z"}<<END>>').malformed, false);
});
test('action desconhecida = malformed; sem marker = null', () => {
  assert.equal(parseNoteActionMarker('<<NOTE_ACTION>>{"action":"delete"}<<END>>').malformed, true);
  assert.equal(parseNoteActionMarker('oi sem marker'), null);
});
test('create sem title usa primeira linha do body', () => {
  const r = parseNoteActionMarker('<<NOTE_ACTION>>{"action":"create","body":"Plano do caixa\\nlinha 2"}<<END>>');
  assert.equal(r.action.title, 'Plano do caixa');
});
```

- [ ] **2.2** Implementar `note-marker.js` (puro, zero deps):

```js
// src/services/note-marker.js — parser puro do <<NOTE_ACTION>> (espelha parseChecklistActionMarker).
// Validação aqui; persistência em notes.js. share_with carrega NOMES (engine resolve→ids).
'use strict';
const RE = /<<NOTE_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;

function parseNoteActionMarker(text) {
  if (!text) return null;
  const m = text.match(RE);
  if (!m) return null;
  const cleanText = text.replace(RE, '').trim();
  let p;
  try { p = JSON.parse(m[1].trim()); } catch { return { malformed: true, cleanText }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { malformed: true, cleanText };
  const action = String(p.action || '');
  if (!['create', 'append', 'share'].includes(action)) return { malformed: true, cleanText };
  if (p.share_with !== undefined && (!Array.isArray(p.share_with) || !p.share_with.every(s => typeof s === 'string'))) {
    return { malformed: true, cleanText };
  }
  if (action === 'create') {
    const body = typeof p.body === 'string' ? p.body.trim() : '';
    if (!body) return { malformed: true, cleanText };
    const title = (typeof p.title === 'string' && p.title.trim()) || body.split('\n')[0].slice(0, 120);
    return { malformed: false, cleanText, action: { action, title, body, share_with: p.share_with || [] } };
  }
  if (action === 'append') {
    if (typeof p.body !== 'string' || !p.body.trim() || !p.note) return { malformed: true, cleanText };
    return { malformed: false, cleanText, action: { action, note: String(p.note), body: p.body.trim() } };
  }
  // share
  if (!p.note || !Array.isArray(p.share_with) || p.share_with.length === 0) return { malformed: true, cleanText };
  return { malformed: false, cleanText, action: { action, note: String(p.note), share_with: p.share_with } };
}
module.exports = { parseNoteActionMarker };
```

- [ ] **2.3** `node --test src/services/note-marker.test.js` → 5 pass.

### Task 3: Service de persistência + resolução de nomes (TDD)

**Files:** Create `src/services/notes.js` + `src/services/notes.test.js` (supabase INJETADO — local pode não ter supabase/client, lição project_local_vps_desync).

- [ ] **3.1** Testes de `resolveShareNames` com mock (FAIL primeiro):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { resolveShareNames } = require('./notes');

const roster = [
  { id: 'id-ana', full_name: 'Ana Paula', preferred_name: null, is_active: true },
  { id: 'id-kri', full_name: 'Krissya', preferred_name: null, is_active: true },
  { id: 'id-anne', full_name: 'Anne', preferred_name: null, is_active: true },
];
const fakeSupabase = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: roster }) }) }) };

test('match único por prefixo case/acento-insensível', async () => {
  const r = await resolveShareNames(fakeSupabase, ['krissya']);
  assert.deepEqual(r.ids, ['id-kri']);
  assert.deepEqual(r.unresolved, []);
});
test('ambíguo (An→Ana/Anne) vai pra unresolved', async () => {
  const r = await resolveShareNames(fakeSupabase, ['An']);
  assert.deepEqual(r.ids, []);
  assert.equal(r.unresolved[0], 'An');
});
test('não encontrado vai pra unresolved; exato vence prefixo', async () => {
  const r = await resolveShareNames(fakeSupabase, ['Zé', 'Anne']);
  assert.deepEqual(r.ids, ['id-anne']);
  assert.deepEqual(r.unresolved, ['Zé']);
});
```

- [ ] **3.2** Implementar `notes.js`:

```js
// src/services/notes.js — CRUD de anotações. supabase SEMPRE injetado.
// collaborator_id vem do REMETENTE (engine), nunca do marker.
'use strict';
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

async function resolveShareNames(supabase, names) {
  const { data } = await supabase.from('collaborators')
    .select('id, full_name, preferred_name, is_active').eq('is_active', true);
  const roster = data || [];
  const ids = []; const unresolved = [];
  for (const raw of names || []) {
    const q = norm(raw);
    if (!q) continue;
    const exact = roster.filter(c => norm(c.preferred_name) === q || norm(c.full_name) === q
      || norm(c.full_name).split(' ')[0] === q);
    const pool = exact.length ? exact : roster.filter(c => norm(c.full_name).startsWith(q) || norm(c.preferred_name || '').startsWith(q));
    if (pool.length === 1) ids.push(pool[0].id);
    else unresolved.push(raw);
  }
  return { ids: [...new Set(ids)], unresolved };
}

async function createNote(supabase, collaboratorId, { title, body, source = 'tom', sharedWith = [] }) {
  const { data, error } = await supabase.from('notes')
    .insert({ collaborator_id: collaboratorId, title, body, source, shared_with: sharedWith })
    .select('id, title').single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, note: data };
}

async function findNoteRef(supabase, collaboratorId, ref) {
  let q = supabase.from('notes').select('id, title, body, shared_with')
    .eq('collaborator_id', collaboratorId).eq('archived', false);
  if (ref && ref !== 'latest') {
    // id de 8 chars: uuid não aceita LIKE — busca recentes e filtra em JS (lição do projeto)
    const { data } = await q.order('updated_at', { ascending: false }).limit(25);
    return (data || []).find(n => String(n.id).startsWith(ref)) || null;
  }
  const { data } = await q.order('updated_at', { ascending: false }).limit(1);
  return (data || [])[0] || null;
}

async function appendToNote(supabase, collaboratorId, ref, body) {
  const note = await findNoteRef(supabase, collaboratorId, ref);
  if (!note) return { ok: false, error: 'note_not_found' };
  const { error } = await supabase.from('notes')
    .update({ body: note.body + '\n' + body, updated_at: new Date().toISOString() }).eq('id', note.id);
  return error ? { ok: false, error: error.message } : { ok: true, note };
}

async function shareNote(supabase, collaboratorId, ref, addIds) {
  const note = await findNoteRef(supabase, collaboratorId, ref);
  if (!note) return { ok: false, error: 'note_not_found' };
  const merged = [...new Set([...(note.shared_with || []), ...addIds])].filter(id => id !== collaboratorId);
  const { error } = await supabase.from('notes')
    .update({ shared_with: merged, updated_at: new Date().toISOString() }).eq('id', note.id);
  return error ? { ok: false, error: error.message } : { ok: true, note, count: merged.length };
}

async function listRecentNotes(supabase, collaboratorId, n = 5) {
  const { data } = await supabase.from('notes')
    .select('id, title, body, updated_at, shared_with')
    .eq('collaborator_id', collaboratorId).eq('archived', false)
    .order('updated_at', { ascending: false }).limit(n);
  return data || [];
}

module.exports = { resolveShareNames, createNote, appendToNote, shareNote, listRecentNotes, findNoteRef };
```

- [ ] **3.3** `node --test src/services/notes.test.js` → 3 pass. `node --check` nos 2 arquivos.

### Task 4: Engine — bloco NOTE_ACTION

**Files:** Modify `src/engine.js` (espelhar o bloco CHECKLIST_ACTION de ~8544).

- [ ] **4.1** Requires no topo (junto dos services): `const noteMarker = require('./services/note-marker');` e `const notesService = require('./services/notes');`
- [ ] **4.2** Inserir bloco logo APÓS o bloco CHECKLIST_ACTION (~8560):

```js
  // 2.7x) NOTE_ACTION — anotações do usuário (spec 2026-06-10). collaborator_id = REMETENTE.
  {
    const parsedNote = noteMarker.parseNoteActionMarker(reply);
    if (parsedNote && parsedNote.malformed) {
      console.warn('[Note] WARN: malformed marker, dropping block');
      await logMarker(collab.id, 'NOTE_ACTION', 'rejected', 'schema_invalid', reply);
      const baseN = (parsedNote.cleanText || '').trim();
      reply = (baseN ? baseN + '\n\n' : '') + '_⚠️ não consegui salvar a anotação — me manda de novo?_';
    } else if (parsedNote) {
      const a = parsedNote.action;
      let res; let shareNotice = '';
      if (a.action === 'create' || a.action === 'share') {
        const { ids, unresolved } = await notesService.resolveShareNames(supabase, a.share_with || []);
        if (unresolved.length) shareNotice = `\n\n_⚠️ não achei "${unresolved.join('", "')}" pra compartilhar — confere o nome?_`;
        if (a.action === 'create') res = await notesService.createNote(supabase, collab.id, { title: a.title, body: a.body, source: 'tom', sharedWith: ids });
        else res = await notesService.shareNote(supabase, collab.id, a.note, ids);
      } else {
        res = await notesService.appendToNote(supabase, collab.id, a.note, a.body);
      }
      await logMarker(collab.id, 'NOTE_ACTION', res.ok ? 'executed' : 'rejected', `${a.action}:${res.ok ? 'ok' : res.error}`, null);
      let baseN = parsedNote.cleanText || '';
      if (!res.ok) baseN = (baseN ? baseN + '\n\n' : '') + (res.error === 'note_not_found'
        ? '_não achei essa anotação. Diz o título que eu procuro._'
        : '_⚠️ não consegui salvar a anotação agora — tenta de novo?_');
      reply = (baseN || reply) + shareNotice;
    }
  }
```

- [ ] **4.3** `node --check src/engine.js` → OK.

### Task 5: Skill + gatilho + contexto no prompt

**Files:** Create `skills/anotacoes.md`; Modify `src/prompts/system.js` (gatilho ~1068 após preferencias-voz; bloco de contexto no buildContext).

- [ ] **5.1** `skills/anotacoes.md`:

```md
---
name: anotacoes
description: Criar/anexar/compartilhar ANOTAÇÕES do usuário (caderninho pessoal, visível no app). Anotação ≠ tarefa ≠ memória.
---
# Anotações

Gatilhos: "cria uma anotação", "anota aí", "faz uma anotação", "adiciona na anotação", "compartilha a anotação com X".
NÃO é anotação: "me lembra de X" (tarefa/lembrete) · feedback sobre você (memória) · "anota a venda" (lojinha).

## Criar
Confirme leve mostrando título + 1ª linha; depois do ok (ou se a pessoa já mandou o texto completo de uma vez, direto):
<<NOTE_ACTION>>
{"action":"create","title":"<título curto>","body":"<texto VERBATIM da pessoa, preservando linhas>","share_with":["<Nome>"]}
<<END>>
- body = texto da pessoa SEM reescrever (pode corrigir transcrição óbvia de áudio).
- share_with só se a pessoa pediu; use NOMES (o sistema valida — nunca invente).
- Resposta: "✅ Anotado! Tá em *Anotações* no app." (curta; sem jargão).

## Anexar — "adiciona na anotação ..."
<<NOTE_ACTION>>{"action":"append","note":"latest","body":"<novas linhas>"}<<END>>
(use "latest" salvo se a pessoa citar outra anotação pelo título — aí pergunte/use o id do bloco 📒).

## Compartilhar
<<NOTE_ACTION>>{"action":"share","note":"latest","share_with":["Ana"]}<<END>>

## Veto
- NUNCA diga "anotado/salvei" sem emitir o marker (fala = persistência).
- NUNCA uuid inventado; share_with é NOME.
- Pediu pra LER: use o bloco "📒 Anotações recentes" do contexto; se não estiver lá, diga que abre no app em Mais → Anotações.
```

- [ ] **5.2** Gatilho em `system.js` (logo após o return de preferencias-voz, ~1069):

```js
  // Trigger: skill de anotações (caderninho) — "anota aí", "cria uma anotação", etc.
  if (/\banota(?:[çc][ãa]o|[çc][õo]es)?\b|\banota\s+(?:a[ií]|isso|pra\s+mim)|\bfa(?:z|ça)\s+uma\s+anota|adiciona\s+na\s+anota|compartilha\s+a\s+anota/i.test(lastUserMessage || '')) {
    return { name: 'anotacoes', body: loadSkill('anotacoes') };
  }
```

- [ ] **5.3** Bloco "📒 Anotações recentes" no buildContext: carregar via `notesService.listRecentNotes(supabase, id, 5)` no Promise.all dos dados (mesmo padrão dos demais) e renderizar após os checklists pessoais:

```js
  if (recentNotes && recentNotes.length) {
    lines.push('', '## 📒 Anotações recentes (Mais → Anotações no app)');
    recentNotes.forEach((n, i) => {
      const age = formatRelativeDate ? '' : '';
      const first = String(n.body || '').split('\n').find(l => l.trim()) || '';
      lines.push(`• [id=${String(n.id).slice(0, 8)}] *${n.title}* — ${first.slice(0, 80)}`);
      if (i === 0) lines.push(`  ↳ conteúdo: ${String(n.body).slice(0, 600)}`);
    });
    lines.push('_Pra anexar/compartilhar use <<NOTE_ACTION>> (skill anotacoes). Pra ler, cite o conteúdo acima._');
  }
```

(passar `recentNotes` pela assinatura do buildContext igual aos outros blocos; se a chamada ficar pesada, cachear não é necessário — limit 5.)
- [ ] **5.4** `node --check src/prompts/system.js` → OK.

### Task 6: Migrar a ata da Rose

- [ ] **6.1** SQL (MCP execute_sql):

```sql
insert into notes (collaborator_id, title, body, source, created_at)
select cm.collaborator_id, 'Reunião com ADMS CG, Recreio e Barra', cm.content, 'tom', cm.created_at
from collaborator_memory cm where cm.id = '0080ea63-562d-4301-8805-a3511fd86ef6'
returning id, title;
```

- [ ] **6.2** Conferir `select count(*) from notes;` → 1. (Memória original fica intacta.)

### Task 7: Deploy backend + e2e TOM

- [ ] **7.1** `node --test src/services/*.test.js` (tudo verde) → scp `src/engine.js`, `src/prompts/system.js`, `src/services/note-marker.js`, `src/services/notes.js`, `skills/anotacoes.md` pra `tom:/opt/LA-Organizer/...` → `ssh tom "node --check ..."` em cada → `pm2 restart tom`.
- [ ] **7.2** E2E real: Alf manda no WhatsApp "TOM, cria uma anotação: teste do módulo — linha um / linha dois". Conferir: marker_logs NOTE_ACTION executed + row em notes + resposta sem jargão. Depois "adiciona na anotação: linha três" → body com 3 linhas.

### Task 8: PWA — dados + lista

**Files:** Create `web/src/hooks/useNotes.ts`, `web/src/screens/anotacoes/{Anotacoes.tsx,AnotacoesMobile.tsx,AnotacoesDesktop.tsx}`; Modify `web/src/App.tsx` (rota), tela "Mais" (entrada 📒 Anotações), `web/src/components/SidebarV2.tsx` (entrada desktop).

- [ ] **8.1** `useNotes.ts` — useQuery listando: minhas (`collaborator_id=eq.${meuId}`, archived=false) + compartilhadas comigo (`shared_with.cs.{${meuId}}`), merge ordenado por pinned desc, updated_at desc; mutations create/update/archive/delete/share (update shared_with). RLS já protege; client filtra por capricho.
- [ ] **8.2** Dispatcher padrão (App.tsx:82-92): `Anotacoes` → mobile/desktop por `useBreakpoint()`. Rota `<Route path="anotacoes" element={<Anotacoes />} />` + `<Route path="anotacoes/:id" .../>`.
- [ ] **8.3** Lista conforme mockup aprovado: busca client-side (title+body), card com título, preview 2 linhas, badges `🔒 privada` / `👥 compartilhada (N)` / `📌`, rodapé "via TOM 💬 | criada no app" + idade; compartilhada-comigo com "de {nome}" (lookup roster). `<Fab label="+" />` → cria nota vazia e abre o editor. Tokens DS (`bg-bg-surface`, `border-border`, `text-fg`, `bg-tom text-black`).
- [ ] **8.4** `npx tsc --noEmit` + `npx vite build` → OK. Testar em 375px e 1440px no preview (preview_eval + screenshot) — as 38 rotas existentes intactas.

### Task 9: PWA — detalhe/editor + compartilhar

- [ ] **9.1** `NotaDetalhe` (mobile+desktop no mesmo arquivo da pasta): input título + textarea corpo com **autosave debounce 800ms** (padrão Configurações — sem botão Salvar), indicador "salvo ✓". Read-only quando não sou dono (compartilhada).
- [ ] **9.2** Ações no topo: 📌 fixar (toggle), 👥 compartilhar (BottomSheet com chips de pessoas — mesmo padrão de seleção da Governança/AssigneePicker; mostra atuais, adiciona/remove), 🗄️ arquivar, 🗑️ excluir (confirm).
- [ ] **9.3** tsc + build + preview nos 2 breakpoints.

### Task 10: PWA — ⚡ Virar tarefas

**Files:** Create `web/src/lib/noteLines.ts`, `web/src/screens/anotacoes/VirarTarefasSheet.tsx`.

- [ ] **10.1** `noteLines.ts` (puro):

```ts
export interface NoteLine { lineNo: number; text: string; actionable: boolean }
export function splitNoteLines(body: string): NoteLine[] {
  return String(body || '').split('\n').map((raw, i) => {
    const t = raw.trim();
    const isHeader = /:\s*$/.test(t);            // "Alinhamento:" não vira tarefa
    const text = t.replace(/^[•\-·*]\s*|^\d+[.)]\s*/, '').trim();
    return { lineNo: i, text, actionable: !!text && !isHeader };
  });
}
```

- [ ] **10.2** Modo seleção no detalhe: botão `⚡ Virar tarefas` (bg-tom text-black) → linhas actionable viram checkboxes (pré-deselecionadas as com link existente — badge "✓ criada" via query `note_task_links`); barra inferior "Criar N tarefas →".
- [ ] **10.3** `VirarTarefasSheet` (BottomSheet): Field "Pra quem" (seletor de responsável, padrão AssigneePicker/QuickCreateSheet, default eu) + Field "Pra quando" (DateInput + atalhos hoje/amanhã/sexta, default sem prazo) aplicados ao LOTE; lista das linhas selecionadas com título editável e expandir pra override individual (responsável/prazo). Botão "Criar".
- [ ] **10.4** Criação: mesmo insert do QuickCreateSheet (`tasks`: title, assigned_to, created_by=eu, source, status='pending', context='work', due_date) — descrição recebe `📒 Da anotação: "${note.title}"`; em seguida insert em `note_task_links` (note_id, task_id, line_no). Permissões/notificações de delegação = as vigentes (nada novo).
- [ ] **10.5** tsc + build + preview: fluxo completo na ata da Rose (selecionar 2 linhas → lote pra "eu" sexta → criar → badges ✓ + tarefas na agenda). Screenshot final pro Alf.

### Task 11: Encerramento

- [ ] **11.1** Suítes completas backend (`node --test src/...test.js` todas) + tsc + build → tudo verde.
- [ ] **11.2** Validação visual final 375/1440 (preview_eval limpando SW cache) ANTES de chamar o Alf.
- [ ] **11.3** Avisar a Rose via TOM (com OK do Alf no texto): a ata dela está no app em Mais → Anotações, dá pra ditar "anota aí…" e virar tarefas por lá.
- [ ] **11.4** Atualizar `docs/roadmap` se existir entrada; Stop hook commita tudo.

## Self-review do plano
- Cobertura da spec: §1→T1, §2→T2-T7, §3→T8-T9, vira-tarefa→T10, migração→T6, validação→T11. ✓
- Sem placeholders/TBD; código real nos pontos novos; padrões existentes citados com arquivo:linha. ✓
- Tipos consistentes: parseNoteActionMarker→{malformed,cleanText,action}; notes.js retorna {ok,...}. ✓
