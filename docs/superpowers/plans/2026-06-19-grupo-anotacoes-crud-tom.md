# Parte 1 do Grupo-CRUD — Anotações CRUD pelo TOM: Plano de Implementação

> **For agentic workers:** Use superpowers:executing-plans / subagent-driven-development. Steps use `- [ ]`.

**Goal:** TOM no chat de grupo lê qualquer ficha sob demanda, edita, apaga (confirmação + lixeira) e audita/lista as `group_notes`.

**Architecture:** Leitura = injeção determinística no contexto (irmã do `credentialLookupContext`, mas mascarando senha). Escrita (update/delete/restore) = ações novas no marker `<<GROUP_NOTE>>`. Apagar passa por gate de confirmação determinístico (tabela `group_chat_pending_confirms` + pré-passo). Soft-delete (`deleted_at`) + faxina cron. Zero toque no motor de recorrência.

**Tech Stack:** Node CJS (`src/services/*.js`), Supabase (MCP p/ migration), Vitest/node:test, React/TS (PWA `web/src/lib`). Deploy backend = `scp tom:` + `pm2 restart`; app = auto-deploy.

**Spec:** `docs/superpowers/specs/2026-06-19-grupo-anotacoes-crud-tom.md`

---

## File Structure
- `migrations/` (ou MCP `apply_migration`) — `deleted_at` em `group_notes` + tabela `group_chat_pending_confirms`.
- `src/services/group-notes.js` — novas funções puras: `noteFetchContext`, `updateGroupNote`, `softDeleteGroupNote`, `restoreGroupNote`, `decideConfirm`, `resolveNoteByTitle`; filtro `deleted_at` nas leituras existentes.
- `src/services/group-notes.test.js` — testes TDD das funções acima.
- `src/services/group-report-builder.js` — `queryGroupNotes` real.
- `src/services/group-chat-engine.js` — handler aceita update/delete/restore; pré-passo de confirmação; wire do `noteFetchContext`.
- `src/services/group-chat-prompt.js` — documenta ações novas + regra anti-"não consigo".
- `src/rituals/dispatcher.js` — faxina diária da lixeira.
- `web/src/lib/groupNotes.ts` — filtro `deleted_at` na lista + soft-delete.

---

## Task 1: Migration (soft-delete + tabela de confirmação)

**Files:** Supabase (MCP `apply_migration`, project `cesnbnrynvxvgdhfmaua`).

- [ ] **Step 1: Aplicar migration**

```sql
-- soft-delete nas fichas do grupo
alter table public.group_notes add column if not exists deleted_at timestamptz;
create index if not exists group_notes_active_idx on public.group_notes (group_id) where deleted_at is null;

-- confirmação determinística de ações destrutivas no grupo
create table if not exists public.group_chat_pending_confirms (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.work_groups(id) on delete cascade,
  sender_collab_id uuid not null,
  op text not null,
  target_id uuid,
  summary text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create unique index if not exists gcpc_one_active_idx
  on public.group_chat_pending_confirms (group_id, sender_collab_id, op);
alter table public.group_chat_pending_confirms enable row level security;
-- service_role faz tudo; membros podem ler a própria pendência (não sensível)
create policy gcpc_service_all on public.group_chat_pending_confirms for all to service_role using (true) with check (true);
```

- [ ] **Step 2: Verificar**

Run (MCP `execute_sql`): `select column_name from information_schema.columns where table_name='group_notes' and column_name='deleted_at';` → 1 linha. E `select to_regclass('public.group_chat_pending_confirms');` → não-nulo.

---

## Task 2: Pure helpers de leitura/escrita em `group-notes.js` (TDD)

**Files:** Modify `src/services/group-notes.js`; Test `src/services/group-notes.test.js`.

- [ ] **Step 1: Escrever testes que falham** (append em `group-notes.test.js`, seguindo o mock de supabase já usado no arquivo)

```js
// resolveNoteByTitle: acha não-deletada por ilike; ignora deletada
// updateGroupNote: muda title/tags/body; upsert_field; remove_field; PRESERVA secret cifrado quando value vazio/••••; not_found
// softDeleteGroupNote/restoreGroupNote: seta/limpa deleted_at
// noteFetchContext: injeta conteúdo do top match com secret MASCARADO; vazio quando não casa; respeita deleted_at; top-2 em empate
// decideConfirm: (pending, text) → 'execute' | 'cancel' | 'ignore'
```

Casos mínimos (nomes de teste):
- `noteFetchContext mascara secret e injeta conteúdo da ficha pedida`
- `noteFetchContext retorna '' quando nada casa`
- `noteFetchContext ignora ficha deletada`
- `updateGroupNote preserva secret cifrado quando vem valor vazio`
- `updateGroupNote upsert_field adiciona/atualiza campo por label`
- `softDeleteGroupNote seta deleted_at; restore limpa`
- `decideConfirm: 'sim' → execute; 'não' → cancel; 'que horas são' → ignore`

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote && node --test src/services/group-notes.test.js` → FAIL (funções indefinidas).

- [ ] **Step 3: Implementar as funções puras**

```js
// ── helpers de máscara/decisão (puros) ──
function maskSecretFields(n) {
  const fields = (n.fields || []).map((f) => ({
    label: f.label,
    value: f.secret ? '••••' : f.value,
    secret: !!f.secret,
  }));
  return { ...n, fields };
}
const AFFIRM_RE = /\b(sim|confirmo|confirma|pode|isso|apaga|apagar|exclui|excluir|manda ver|ok|isso a[ií])\b/i;
const NEGATE_RE = /\b(n[aã]o|cancela|deixa|esquece|para|pera|espera)\b/i;
// dado uma pendência ativa + texto curto, decide o que fazer
function decideConfirm(pending, text) {
  if (!pending) return 'ignore';
  const t = String(text || '').trim();
  if (NEGATE_RE.test(t)) return 'cancel';
  if (AFFIRM_RE.test(t) && t.length <= 40) return 'execute';
  return 'ignore';
}

// ── I/O (supabase injetado; sempre filtra deleted_at) ──
async function resolveNoteByTitle({ supabase, groupId, title, includeDeleted = false }) {
  let q = supabase.from('group_notes')
    .select('id, title, type, tags, fields, body, pinned, deleted_at, updated_by, updated_at')
    .eq('group_id', groupId).ilike('title', String(title || '').trim());
  const { data } = await q.limit(5);
  const rows = (data || []).filter((r) => includeDeleted ? r.deleted_at : !r.deleted_at);
  return rows[0] || null;
}

async function updateGroupNote({ supabase, groupId, updatedBy, title, patch }) {
  const hit = await resolveNoteByTitle({ supabase, groupId, title });
  if (!hit) return { updated: false, reason: 'not_found' };
  const upd = { updated_by: updatedBy, updated_at: new Date().toISOString() };
  if (patch.new_title) upd.title = String(patch.new_title).trim().slice(0, 200);
  if (patch.type) upd.type = patch.type;
  if (Array.isArray(patch.tags)) upd.tags = patch.tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof patch.body === 'string') upd.body = patch.body;
  // mutação de campos preservando secret cifrado
  let fields = Array.isArray(hit.fields) ? hit.fields.map((f) => ({ ...f })) : [];
  const keepCipher = (oldF, newF) => {
    // se o campo é secret e o novo valor é vazio/máscara, preserva o cifrado antigo
    const blank = newF.value == null || newF.value === '' || /^[•*]+$/.test(String(newF.value));
    if (oldF && oldF.secret && blank) return { ...newF, value: oldF.value, secret: true };
    return newF;
  };
  if (Array.isArray(patch.set_fields)) {
    fields = sanitizeFields(patch.set_fields).map((nf) => {
      const old = fields.find((f) => f.label === nf.label);
      return keepCipher(old, nf);
    });
  }
  if (patch.upsert_field && patch.upsert_field.label) {
    const nf = sanitizeFields([patch.upsert_field])[0];
    const i = fields.findIndex((f) => f.label === nf.label);
    const merged = keepCipher(i >= 0 ? fields[i] : null, nf);
    if (i >= 0) fields[i] = merged; else fields.push(merged);
  }
  if (patch.remove_field) fields = fields.filter((f) => f.label !== patch.remove_field);
  if (patch.set_fields || patch.upsert_field || patch.remove_field) upd.fields = fields;
  await supabase.from('group_notes').update(upd).eq('id', hit.id);
  return { updated: true, id: hit.id, title: upd.title || hit.title };
}

async function softDeleteGroupNote({ supabase, groupId, title }) {
  const hit = await resolveNoteByTitle({ supabase, groupId, title });
  if (!hit) return { deleted: false, reason: 'not_found' };
  await supabase.from('group_notes').update({ deleted_at: new Date().toISOString() }).eq('id', hit.id);
  return { deleted: true, id: hit.id, title: hit.title };
}
async function softDeleteGroupNoteById({ supabase, noteId }) {
  await supabase.from('group_notes').update({ deleted_at: new Date().toISOString() }).eq('id', noteId);
  return { deleted: true, id: noteId };
}
async function restoreGroupNote({ supabase, groupId, title }) {
  const hit = await resolveNoteByTitle({ supabase, groupId, title, includeDeleted: true });
  if (!hit) return { restored: false, reason: 'not_found' };
  await supabase.from('group_notes').update({ deleted_at: null }).eq('id', hit.id);
  return { restored: true, id: hit.id, title: hit.title };
}

// ── leitura sob demanda: injeta conteúdo da(s) ficha(s) que casam, secret MASCARADO ──
const NOTE_REQUEST_RE = /\b(manda|mandar|mostra|mostrar|envia|enviar|passa|passar|qual|cad[êe]|abre|abrir|ver|me d[áa])\b/i;
const NOTE_NOUN_RE = /\b(ficha|anota[çc][aã]o|nota|passo a passo|procedimento|guia|tutorial)\b/i;
async function noteFetchContext({ supabase, groupId, text }) {
  const looksRequest = NOTE_REQUEST_RE.test(text || '') || NOTE_NOUN_RE.test(text || '');
  const tokens = credTokenize(text);
  if (!tokens.length) return '';
  const { data } = await supabase.from('group_notes')
    .select('title, type, tags, fields, body, deleted_at, updated_by, updated_at')
    .eq('group_id', groupId);
  const active = (data || []).filter((n) => !n.deleted_at);
  const scored = active.map((n) => ({ n, score: scoreNoteMatch(n, tokens) }))
    .filter((x) => x.score >= (looksRequest ? 1 : 2)) // sem verbo de pedido, exige match mais forte
    .sort((a, b) => b.score - a.score).slice(0, 2);
  if (!scored.length) return '';
  const blocks = scored.map(({ n }) => `### ${n.title} (${n.type || 'livre'})\n${renderNoteContent(maskSecretFields(n))}`).join('\n\n');
  return `## Ficha(s) do grupo que casam com o pedido\n(senha vem mascarada — pra revelar, a pessoa pede "a senha de X")\n${blocks}`;
}
```

- [ ] **Step 4: Atualizar leituras existentes p/ filtrar `deleted_at`**

Em `groupNotesContext` (L89-91): `.eq('group_id', groupId)` → adicionar `.is('deleted_at', null)`. Em `credentialLookupContext` (L124): idem. Em `appendGroupNote` (L59-60): a resolução por ilike deve filtrar `deleted_at is null` (não anexar em ficha deletada).

- [ ] **Step 5: Exportar e rodar testes**

Adicionar ao `module.exports`: `noteFetchContext, updateGroupNote, softDeleteGroupNote, softDeleteGroupNoteById, restoreGroupNote, resolveNoteByTitle, decideConfirm, maskSecretFields`.
Run: `cd /d/la-organizer/_remote && node --test src/services/group-notes.test.js` → PASS.

- [ ] **Step 6: `node --check`**

Run: `cd /d/la-organizer/_remote && node --check src/services/group-notes.js`.

---

## Task 3: Relatório de anotações (audit/list) em `group-report-builder.js`

**Files:** Modify `src/services/group-report-builder.js`; Test `src/services/group-report-builder.test.js` (se existir; senão teste mínimo inline).

- [ ] **Step 1: Implementar `queryGroupNotes`** (substitui o stub L171)

```js
// Fichas do grupo (não-deletadas) com quem mexeu por último — pra auditoria/listagem.
async function queryGroupNotes(supabase, groupId) {
  const { data } = await supabase.from('group_notes')
    .select('title, type, updated_at, updater:collaborators!group_notes_updated_by_fkey(preferred_name, full_name)')
    .eq('group_id', groupId).is('deleted_at', null)
    .order('updated_at', { ascending: false });
  return (data || []).map((n) => ({
    title: n.title, type: n.type, updated_at: n.updated_at,
    quem: n.updater?.preferred_name || n.updater?.full_name || null,
  }));
}
```
(Confirmar o nome da FK `group_notes_updated_by_fkey` via `\d group_notes` antes; ajustar se diferente.)

- [ ] **Step 2: `node --check`** → `node --check src/services/group-report-builder.js`.

---

## Task 4: Handler + pré-passo de confirmação em `group-chat-engine.js`

**Files:** Modify `src/services/group-chat-engine.js`.

- [ ] **Step 1: Aceitar novas actions no `<<GROUP_NOTE>>`** (L184)

Trocar a guarda `p.action !== 'create' && p.action !== 'append'` por um conjunto `['create','append','update','delete','restore']`. Ramos:
- `update` → `groupNotes.updateGroupNote(...)`; action `{kind:'note', status: r.updated?'ok':'fail', label:p.title, detail: r.updated ? '✏️ atualizada' : 'não achei essa ficha'}`.
- `delete` → resolve a ficha (`resolveNoteByTitle`); se achou, **grava pendência** em `group_chat_pending_confirms` (upsert por group+sender+op) com `target_id`, `summary=title`, `expires_at=now()+10min`; action `{kind:'note', status:'pending', label:p.title, detail:'❓ confirma a exclusão?'}`. Se não achou → fail 'não achei essa ficha'.
- `restore` → `groupNotes.restoreGroupNote(...)`; action ok/fail.

- [ ] **Step 2: Pré-passo de confirmação no topo do `processGroupChatMessage`** (antes de montar contexto/LLM)

```js
// ── PRÉ-PASSO: confirmação de ação destrutiva pendente (determinístico) ──
// Roda antes do LLM: um "sim" seco do mesmo remetente confirma a exclusão pendente.
const { data: pend } = await supabase.from('group_chat_pending_confirms')
  .select('*').eq('group_id', groupId).eq('sender_collab_id', senderCollabId)
  .eq('op', 'delete_note').gt('expires_at', new Date().toISOString()).maybeSingle();
if (pend) {
  const verdict = groupNotes.decideConfirm(pend, text);
  if (verdict === 'execute') {
    await groupNotes.softDeleteGroupNoteById({ supabase, noteId: pend.target_id });
    await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
    return await postTomText({ supabase, groupId, text:
      `Apaguei a ficha *${pend.summary}* — tá na lixeira. É só pedir "restaura a ficha ${pend.summary}" que eu trago de volta. 🗑️` });
  }
  if (verdict === 'cancel') {
    await supabase.from('group_chat_pending_confirms').delete().eq('id', pend.id);
    return await postTomText({ supabase, groupId, text: `Ok, não apaguei a ficha *${pend.summary}*. 👍` });
  }
  // 'ignore' → segue o fluxo normal (a pendência expira sozinha)
}
```
(`postTomText` = helper que insere `group_chat_messages` role=tom kind=text + deixa o bridge-out espelhar — reusar o caminho de insert já existente no arquivo; se não houver helper, inline o insert como nos outros pontos.)

- [ ] **Step 3: Wire do `noteFetchContext` no `loadContext`**

Onde hoje monta o bloco de credencial (`credentialLookupContext`), chamar também `noteFetchContext({ supabase, groupId, text })` e concatenar no system prompt (os dois podem coexistir: credencial revela senha sob pedido explícito; fetch geral mascara).

- [ ] **Step 4: `node --check`** → `node --check src/services/group-chat-engine.js`.

---

## Task 5: Prompt em `group-chat-prompt.js`

**Files:** Modify `src/services/group-chat-prompt.js` (seção "Anotação do grupo", ~L85-98).

- [ ] **Step 1: Documentar ações novas + regras**

Acrescentar:
- `<<GROUP_NOTE>>{"action":"update","title":"<título exato>","new_title?,"type?","tags?","body?","upsert_field?":{...},"remove_field?":"<label>"}<<END>>`
- `<<GROUP_NOTE>>{"action":"delete","title":"<título>"}<<END>>` — "PERGUNTE a confirmação; só o sistema apaga e vai pra lixeira (reversível)".
- `<<GROUP_NOTE>>{"action":"restore","title":"<título>"}<<END>>`
- Regra anti-"não consigo": "O conteúdo das fichas relevantes ao pedido JÁ aparece no seu contexto (bloco 'Ficha(s) do grupo que casam'). NUNCA diga que não consegue mostrar uma ficha que existe — repasse o que está no contexto. Senha vem mascarada; pra revelar, a pessoa pede 'a senha de X'. Só diga que não tem se realmente não houver ficha no índice."

- [ ] **Step 2: `node --check`**

---

## Task 6: App — lixeira não quebra a tela (`web/src/lib/groupNotes.ts`)

**Files:** Modify `web/src/lib/groupNotes.ts`.

- [ ] **Step 1: Filtrar deletadas na lista** (L172-175, `loadGroupNotes`)

Adicionar `.is('deleted_at', null)` antes dos `.order(...)`.

- [ ] **Step 2: Soft-delete** (L202-205, `deleteGroupNote`)

```ts
export async function deleteGroupNote(id: string): Promise<void> {
  const { error } = await supabase.from('group_notes')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
}
```

- [ ] **Step 3: tsc**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit`.

---

## Task 7: Faxina diária da lixeira (`dispatcher.js`)

**Files:** Modify `src/rituals/dispatcher.js`.

- [ ] **Step 1: Adicionar purga no tick diário existente** (junto de outros jobs diários)

```js
// Faxina: hard-delete de fichas na lixeira há mais de 30 dias.
try {
  const cutoff = new Date(Date.now() - 30 * 864e5).toISOString();
  await supabase.from('group_notes').delete().lt('deleted_at', cutoff).not('deleted_at', 'is', null);
} catch (e) { console.error('[Faxina] group_notes lixeira:', e.message); }
```
(Encaixar no job que já roda 1×/dia; NÃO criar cron novo se já existe um diário.)

- [ ] **Step 2: `node --check`**

---

## Task 8: Deploy + E2E + registro

- [ ] **Step 1: Deploy backend**

`scp` dos arquivos backend tocados (`group-notes.js`, `group-report-builder.js`, `group-chat-engine.js`, `group-chat-prompt.js`, `dispatcher.js`) `tom:/opt/LA-Organizer/src/...` + `ssh tom "pm2 restart tom"`. App via auto-deploy.

- [ ] **Step 2: E2E no grupo Financeiro (dry, ficha descartável)**

Criar ficha descartável "Ficha Teste CRUD"; via dry-run/preview: ler ("me manda a ficha teste crud") → vê conteúdo; editar → eco; apagar → pergunta confirma → "sim" → some + lixeira; "restaura a ficha teste crud" → volta. Conferir no banco (`deleted_at`). Conferir que senha de uma ficha `acesso` aparece mascarada na leitura geral mas revela no "a senha de X".

- [ ] **Step 3: Regressão**

`cd /d/la-organizer/_remote && node --test src/services/group-notes.test.js src/services/group-chat-tasks.test.js` → verde. Confirmar que `groupNotesContext`/credential seguem funcionando.

- [ ] **Step 4: Registrar known issue**

INSERT em `tom_known_issues` código `GROUPCHAT-NOTES-CRUD` (área `marker`/`coordination`): causa = só create/append + leitura só de fixada → "não consigo te mostrar"; fix = CRUD completo + injeção determinística de leitura (mascarando senha) + apagar com confirmação+lixeira. Atualizar `memory/project_groupchat_anotacoes_grupo.md` + marcar task #223.
