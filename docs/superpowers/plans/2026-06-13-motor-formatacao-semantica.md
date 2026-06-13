# Motor de Formatação Semântica do TOM (Anotações) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline escolhida pelo Alf). Steps usam checkbox (`- [ ]`).

**Goal:** Tornar o "Formatar com o TOM" das anotações semântico por padrão — separa cada item, agrupa por categoria, preserva 100% dos dados — herdado por todas as ações, + instrução livre + toggle de emojis. Sonnet/OAuth intocado.

**Architecture:** Motor puro `format-note.js` (prompts + validate + systemPromptFor) chamado pelo endpoint `/internal/format-note` via `claude.chatRaw` (CLI OAuth). PWA `RichEditor` manda `{action, html, instruction, emoji}`.

**Tech Stack:** Node CJS (motor + endpoint), node:test; React+TS+TipTap (PWA); deploy SCP+pm2 (backend) e auto-deploy hook (PWA).

**Código exato dos prompts/funções:** ver spec [§6–§9](../specs/2026-06-13-motor-formatacao-semantica.md). O plano referencia a spec pras strings longas (execução inline pelo próprio autor).

---

### Task 1: Motor — núcleo semântico + few-shot + validate/systemPromptFor (TDD)

**Files:**
- Modify: `src/services/format-note.js`
- Test: `src/services/format-note.test.js`

- [ ] **Step 1 — Testes que falham.** Adicionar ao test: (a) `validateFormatRequest` aceita `instruction` string (trimada) e devolve; `invalid_instruction` p/ não-string; trunca >280; `emoji` default `true`; `emoji:false` respeitado. (b) `systemPromptFor`: núcleo (`'CADA item é um <li>'`) presente nas 4 ações; few-shot (`'ENTRADA:'`) presente; `fix` contém `'CORRIGIR ortografia'`; com `instruction` aparece `'INSTRUÇÃO DO USUÁRIO'`, sem ela não; `emoji:true` contém `'1 emoji'`, `emoji:false` contém `'NÃO use emojis'`.
- [ ] **Step 2 — Rodar:** `cd _remote && node --test src/services/format-note.test.js` → FALHA (campos/strings novos não existem).
- [ ] **Step 3 — Implementar** conforme spec §6.1–§6.5: trocar `SYSTEM_PROMPTS`/`COMMON` por `SEMANTIC_CORE` (regras + few-shot), `ACTION_VERBS`, `EMOJI_ON`/`EMOJI_OFF`, `COMMON` (com `<p>`); `MAX_INSTRUCTION=280`; estender `validateFormatRequest` (instruction+emoji) e `systemPromptFor(action, opts)`; exportar `MAX_INSTRUCTION`.
- [ ] **Step 4 — Rodar:** `node --test src/services/format-note.test.js` → PASSA. `node --check src/services/format-note.js`.

### Task 2: Endpoint passa instruction+emoji

**Files:** Modify `src/internal-api.js` (rota `/internal/format-note`, ~linha 1108)

- [ ] **Step 1:** `claude.chatRaw(systemPromptFor(v.action, { instruction: v.instruction, emoji: v.emoji }), v.html)`; ajustar `logFmt('executed', ...)` p/ incluir `instr=${v.instruction?'y':'n'} emoji=${v.emoji?'y':'n'}`.
- [ ] **Step 2:** `node --check src/internal-api.js`.

### Task 3: Client aceita opts

**Files:** Modify `web/src/lib/formatNote.ts`

- [ ] **Step 1:** assinatura `formatNote(action, html, opts?: { instruction?: string; emoji?: boolean })`; incluir `instruction`/`emoji` no body JSON.
- [ ] **Step 2:** `cd _remote/web && npx tsc --noEmit`.

### Task 4: UI — menu + instrução + toggle emoji

**Files:** Modify `web/src/screens/grupos/notes/RichEditor.tsx`

- [ ] **Step 1:** Estado `instrOpen`, `instrText`, `useEmoji` (init de `localStorage['tom_notes_emoji']`, default `true`); `runIa(action, instruction?)` passa `{ instruction, emoji: useEmoji }`.
- [ ] **Step 2:** Menu: "✨ Organizar (recomendado)" no topo; Resumir/Corrigir/Deixar mais claro; divisória; "Formatar do meu jeito…" abre `<textarea>` + Aplicar (`runIa('format', instrText)`); rodapé toggle "Usar emojis" (persiste no localStorage).
- [ ] **Step 3:** `npx tsc --noEmit` + `npx vite build`.

### Task 5: Deploy backend + validação e2e

- [ ] **Step 1 — Deploy backend:** `scp` de `src/services/format-note.js` e `src/internal-api.js` p/ `tom:/opt/LA-Organizer/...`; `ssh tom "pm2 restart tom"`.
- [ ] **Step 2 — e2e (ficha descartável; preview muta dado REAL):** no preview/PWA, ficha de teste com descarga mental de contas → "Organizar" → conferir cada conta = `<li>` separado, agrupado por seção; testar "Do meu jeito" c/ instrução; emoji on/off; **Descartar** ou apagar a ficha de teste.

### Task 6: Registro

- [ ] **Step 1:** INSERT `tom_known_issues` `GROUPNOTES-FORMAT-SEMANTIC` (spec §12).
- [ ] **Step 2:** Atualizar memória `project_groupchat_anotacoes_grupo.md` com a seção "Fatia D — formatação semântica".
