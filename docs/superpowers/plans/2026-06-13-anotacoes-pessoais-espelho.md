# Espelho Anotações Grupo → Pessoal — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Steps com checkbox.

**Goal:** Paridade do `/anotacoes` pessoal com o módulo de grupo (fichas tipadas + editor rico + IA + cor/ícone + reorder + tipos custom + senhas), preservando virar-tarefas/compartilhar/arquivar.

**Architecture:** Estende `notes`; reusa cripto genérica do grupo; reusa componentes agnósticos e parametriza os tipados (default = grupo, zero regressão); TOM recupera senha no 1:1.

**Tech Stack:** Supabase (migration), React+TS+TipTap+dnd-kit (PWA), Node CJS (engine 1:1).

**Código/SQL exato:** ver spec [§5–§7](../specs/2026-06-13-anotacoes-pessoais-espelho.md). O plano referencia a spec pras strings longas (execução inline pelo autor).

---

### Task 1: Migration — notes +cols, note_types, cripto, reveal RPC

**Files:** migration `anotacoes_pessoais_espelho` (apply_migration MCP)

- [ ] **Step 1:** Aplicar o SQL da spec §5.1–§5.4 (ALTER notes; CREATE note_types + RLS dono/service; CREATE TRIGGER notes_encrypt_secrets EXECUTE gn_encrypt_secret_fields; CREATE reveal_personal_note_secret + GRANT).
- [ ] **Step 2 — Validar RLS de `notes`:** confirmar que a policy de `notes` usa `current_collab_id()` (NÃO `auth.uid()`) — [[reference_collab_id_vs_auth_uid]]. Se divergir, alinhar o reveal/CRUD.
- [ ] **Step 3 — Validar cripto via SQL:** INSERT nota de teste do Alf com `fields=[{label,value,secret:true}]` → SELECT mostra `enc:v1:`; `reveal_personal_note_secret(id,0)` como dono → texto claro; simular não-dono → `forbidden`. Apagar a nota de teste.

### Task 2: lib/personalNotes + useNotes estendido + useNoteTypes (TDD)

**Files:** Create `web/src/lib/personalNotes.ts`; Modify `web/src/hooks/useNotes.ts`; Test `web/src/lib/personalNotes.test.ts`

- [ ] **Step 1:** `personalNotes.ts` — re-exporta resolvers/índice de `groupNotes.ts` (buildTypeIndex/resolveColor/Icon/typeLabel/templateForType/bodyToHtml/isEncrypted/notesWithSecrets/typesWithCount/renumber); IO: `loadNoteTypes/upsertNoteType/deleteNoteType` (tabela `note_types`, por dono), `revealPersonalNoteSecret(noteId,index)` = `supabase.rpc('reveal_personal_note_secret',{p_note_id,p_field_index})`.
- [ ] **Step 2 — Teste (vitest):** `personalNotes` re-exporta os puros (smoke) + (se houver pura nova) cobre. Rodar `npx vitest run personalNotes` → vermelho→verde.
- [ ] **Step 3:** `useNotes.ts` — `Note` += `type/fields/color/icon/sort_order/tags`; `createNote` aceita patch inicial (default type 'livre', fields template); `updateNote` aceita os campos novos; `reorder` (renumber + update otimista); `useNoteTypes()` (React Query por dono). `list` ordena `pinned, sort_order, updated_at`.
- [ ] **Step 4:** `npx tsc --noEmit`.

### Task 3: Parametrizar componentes do grupo (aditivo, default = grupo)

**Files:** Modify `web/src/screens/grupos/notes/FieldRow.tsx`, `NoteEditor.tsx`, `NoteTypeForm.tsx`

- [ ] **Step 1:** `FieldRow` += prop `onReveal?: (noteId, index) => Promise<string>`; usa `onReveal ?? revealNoteSecret`. (Ler o arquivo antes — confirmar a chamada atual.)
- [ ] **Step 2:** `NoteTypeForm` += prop opcional pra a mutation de salvar tipo (default = `useGroupNoteTypes`); `NoteEditor` += prop pra abrir o form pessoal (default = grupo).
- [ ] **Step 3:** `npx tsc --noEmit` (grupo continua compilando, sem mudança de comportamento).

### Task 4: UI two-pane pessoal

**Files:** Rewrite `web/src/screens/anotacoes/Anotacoes.tsx`, `web/src/screens/anotacoes/NotaDetalhe.tsx`

- [ ] **Step 1:** `Anotacoes.tsx` two-pane espelhando `GrupoAnotacoes` (header busca + Nova ficha; `NotesSummary`; `NotesTypeFilter` + 🔑; lista `NoteCard` com reorder dnd-kit só na visão "Todas"; detalhe). Usa `useNotes` + `useNoteTypes` + `buildTypeIndex`.
- [ ] **Step 2:** `NotaDetalhe` pessoal: leitura (campos via `FieldRow` + `onReveal={revealPersonalNoteSecret}`, corpo `bodyToHtml`) + edição (`NoteEditor` reusado com form pessoal) + barra de ações pessoal (fixar/virar-tarefas/compartilhar/arquivar/excluir/"de fulano leitura").
- [ ] **Step 3:** `npx tsc --noEmit` + `npx vite build`.

### Task 5: "Virar tarefas" com corpo HTML

**Files:** Modify `web/src/screens/anotacoes/NotaDetalhe.tsx` (e/ou `lib/noteLines`)

- [ ] **Step 1:** `splitNoteLines(htmlToPlain(body))` antes de detectar linhas acionáveis; resto (`VirarTarefasSheet`, `note_task_links`) inalterado.
- [ ] **Step 2:** `npx tsc --noEmit` + `npx vite build`.

### Task 6: TOM 1:1 — recupera senha pessoal (TDD)

**Files:** Modify `src/services/notes.js`, `src/engine.js`, `src/prompts/system.js`; Test `src/services/notes.test.js` (ou novo)

- [ ] **Step 1:** `notes.js` `credentialLookupContext({supabase,collaboratorId,text})` — espelha group-notes (intenção + score nas notas do dono + `gn_decrypt`). TDD: teste de score/intenção (node --test).
- [ ] **Step 2:** `engine.js` chama antes do prompt e passa `credentialBlock`; `system.js buildContext` injeta o bloco no prompt 1:1 (id do remetente, nunca do LLM).
- [ ] **Step 3:** `node --check` + `node --test`.

### Task 7: Deploy + e2e + regressão grupo

- [ ] **Step 1 — Deploy:** PWA auto-deploy (fim do turno); backend SCP (`notes.js`, `engine.js`, `system.js`) + `pm2 restart tom`.
- [ ] **Step 2 — e2e pessoal (ficha descartável; preview muta REAL):** criar ficha pessoal com senha → olho revela (dono) → 🔑 filtro → IA Organizar (Descartar) → virar tarefas → apagar ficha. Dry-run VPS: TOM 1:1 "qual minha senha da X?".
- [ ] **Step 3 — Regressão grupo:** revalidar grupo da Rose (FieldRow reveal + editor) pós-parametrização — preview read-only.

### Task 8: Registro

- [ ] **Step 1:** INSERT `tom_known_issues` `PERSONALNOTES-MIRROR` (spec §12).
- [ ] **Step 2:** Atualizar memória (`project_groupchat_anotacoes_grupo.md` ou nova `project_anotacoes_pessoais.md`) + MEMORY.md.
