# Anotações do Grupo — Fatia B: Editor Rico (TipTap) + IA "Formatar com o TOM"

**Data:** 2026-06-13
**Módulo:** Base de conhecimento do grupo (`group_notes` / fichas tipadas v2)
**Pré-requisito:** Fatia A entregue (reorder DnD + cor/ícone por ficha)

---

## Goal

Substituir o `<textarea>` de markdown cru do corpo da ficha por um **editor visual (TipTap)** e adicionar um botão **"✨ Formatar com o TOM"** que organiza/resume/corrige/ajusta o texto via IA — usando a **mesma assinatura OAuth do TOM** (CLI `claude -p`), **sem nenhuma API key**.

## Decisões aprovadas (brainstorming)

| Tema | Decisão |
|---|---|
| Editor | TipTap WYSIWYG (negrito, itálico, título, lista, cor, link) |
| Ações da IA | 4: **auto-formatar**, **resumir**, **corrigir** (ortografia/gramática), **ajustar tom** |
| Aplicação da IA | **Preview antes/depois** → Aplicar ou Descartar (estilo Samsung Note Assist) |
| Escopo | Editor rico **+** IA juntos nesta fatia |
| Camada de IA | **Endpoint interno na VPS** (`/internal/format-note`) reusando o **CLI `claude -p` (OAuth)** — **NÃO** edge function, **NÃO** API key |

## Arquitetura geral

```
PWA (RichEditor) ── clica ✨ Formatar ──▶ tomEngine.formatNote(action, html)
   │                                          │ fetch POST /internal/format-note
   │                                          │ (proxy Vercel → VPS, header x-internal-secret)
   │                                          ▼
   │                              internal-api.js  POST /internal/format-note
   │                                          │ valida (action + tamanho)
   │                                          │ monta system prompt por ação
   │                                          ▼
   │                              claude.chatRaw(systemPrompt, userText)  ← CLI OAuth, SEM fallback OpenAI
   │                                          │
   ◀────────── { ok, html } ◀────────────────┘
   │
   ▼
FormatPreview (antes/depois) ── Aplicar ──▶ editor recebe HTML ──▶ autosave (body = HTML)
```

**Sem migração de banco.** `group_notes.body` já é `text`; passa a guardar **HTML** (antes guardava markdown). Compatibilidade retroativa é resolvida no render (ver `bodyToHtml`), não no schema.

---

## Formato de armazenamento — HTML canônico, migration-free

`body` passa a guardar **HTML**. Três fontes alimentam essa coluna e todas precisam renderizar certo:

1. **Editor TipTap (novo)** → emite HTML.
2. **Notas legadas** (ex.: "Contas a Pagar" da Rose) → markdown/texto.
3. **TOM via `<<GROUP_NOTE>>`** → texto puro (engine inalterado).

Helper único resolve as três:

```ts
// lib/groupNotes.ts
// Decide se o body já é HTML; senão trata como markdown (legado + TOM). Retorna HTML
// NÃO sanitizado — o caller aplica DOMPurify (NoteDetail já faz; RichEditor deve fazer).
export function bodyToHtml(body: string): string {
  const s = body || '';
  if (!s.trim()) return '';
  const looksHtml = /<[a-z][\s\S]*>/i.test(s);
  return looksHtml ? s : (marked.parse(s, { async: false, breaks: true }) as string);
}
```

Usado em:
- **NoteDetail.tsx** → `DOMPurify.sanitize(bodyToHtml(note.body))` (substitui o `marked.parse` direto da linha 26).
- **RichEditor.tsx** → inicializa o conteúdo com `DOMPurify.sanitize(bodyToHtml(note.body))`.

---

## PWA — componentes

### 1. Dependências

Instalar no `web/`:
```
@tiptap/react @tiptap/starter-kit @tiptap/extension-text-style @tiptap/extension-color @tiptap/extension-link
```
(`marked`, `dompurify`, `@dnd-kit/*` já instalados.)

### 2. `web/src/screens/grupos/notes/RichEditor.tsx` (NOVO)

Editor TipTap com barra de ferramentas + botão IA. Substitui o `<textarea>`.

- **Props:** `{ valueHtml: string; onChange: (html: string) => void }` (o NoteEditor liga `onChange` ao `patch({ body })` existente).
- **Extensões:** `StarterKit` (parágrafo, negrito, itálico, headings, listas, etc.) + `TextStyle` + `Color` + `Link`.
- **Inicialização:** `content: DOMPurify.sanitize(bodyToHtml(valueHtml))`.
- **onUpdate:** `onChange(editor.getHTML())` — debounce fica a cargo do `commit()` do NoteEditor (não duplicar).
- **Barra (DS, ícones lucide):** Negrito (`Bold`), Itálico (`Italic`), Título (`Heading2` → toggle `<h2>`), Lista (`List`), Cor (botão que abre as `NOTE_COLORS` reaproveitadas → `editor.chain().setColor(c)`), Link (`Link2` → prompt de URL). Botão ativo usa `text-tom`.
- **Botão IA:** `✨ Formatar com o TOM` (lucide `Sparkles`) abre um menu com as 4 ações. Ao escolher, chama o fluxo de IA (abaixo) com `editor.getHTML()`.
- **Container:** `border border-border rounded-md`, área editável com `prose`-like via classes Tailwind já usadas no NoteDetail (`[&_h2]:... [&_ul]:list-disc [&_a]:text-tom [&_strong]:text-fg`), `min-h-[160px] p-3 focus:outline-none`.
- **Guardrail:** `editor` destruído no unmount (`useEditor` cuida); respeitar o remount por `editorKey` que já existe no NoteEditor (sem regressão da "Nova ficha").

### 3. `web/src/screens/grupos/notes/FormatPreview.tsx` (NOVO)

Painel/modal de **antes/depois** (estilo Note Assist).

- **Props:** `{ beforeHtml: string; afterHtml: string; loading: boolean; error?: string; onApply: () => void; onDiscard: () => void }`.
- **Layout:** título "✨ Formatar com o TOM", duas colunas (desktop) / empilhado (mobile): **Antes** (render sanitizado do `beforeHtml`, esmaecido) e **Depois** (render do `afterHtml`). Rodapé: `Button variant="primary"` **Aplicar** + `Button variant="secondary"` **Descartar**.
- **Loading:** spinner + "O TOM tá organizando…". **Erro:** mensagem + só botão Fechar.
- Render dos dois lados usa `DOMPurify.sanitize(...)` (nunca `dangerouslySetInnerHTML` sem sanitizar).

### 4. `web/src/lib/formatNote.ts` (NOVO) — ou função em `tomEngine.ts`

Cliente do endpoint. Segue o padrão dos outros `/internal/*` (mesmo `TOM_BASE` + `x-internal-secret`):

```ts
export type FormatAction = 'format' | 'summarize' | 'fix' | 'tone';
export async function formatNote(action: FormatAction, html: string):
  Promise<{ ok: true; html: string } | { ok: false; reason: string }> {
  if (!INTERNAL_SECRET) return { ok: false, reason: 'no_secret' };
  try {
    const r = await fetch(`${TOM_BASE}/internal/format-note`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ action, html }),
    });
    if (!r.ok) return { ok: false, reason: `http_${r.status}` };
    const data = await r.json();
    return data?.ok ? { ok: true, html: String(data.html || '') } : { ok: false, reason: data?.error || 'unknown' };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
```

Decisão: criar como **novo arquivo `lib/formatNote.ts`** (reexporta `TOM_BASE`/`INTERNAL_SECRET` de `tomEngine` ou duplica as 2 linhas de env) para não inchar `tomEngine.ts`. Plano define o detalhe de import.

### 5. `web/src/screens/grupos/notes/NoteEditor.tsx` (MODIFICAR)

- Trocar o bloco do `<textarea>` (linhas 109-111) por:
  ```tsx
  <div className="text-label uppercase tracking-wide text-fg-muted mb-xs">Anotações livres</div>
  <RichEditor valueHtml={draft.body || ''} onChange={(html) => patch({ body: html })} />
  ```
  (remove o rótulo "(markdown)" e a fonte `font-mono`.)
- O fluxo de IA (chamar `formatNote`, abrir `FormatPreview`, aplicar resultado no editor) mora aqui ou no RichEditor; **escolha:** mora no **RichEditor** (ele detém a instância do editor e sabe aplicar `editor.commands.setContent(html)`). O NoteEditor só passa `valueHtml`/`onChange`.
- Sem mudança no `commit()`/autosave — `setContent` no Aplicar dispara `onUpdate` → `onChange` → `patch({ body })`.

### 6. `web/src/screens/grupos/notes/NoteDetail.tsx` (MODIFICAR)

- Linha 26: `const bodyHtml = note.body ? DOMPurify.sanitize(bodyToHtml(note.body)) : '';` (import `bodyToHtml` de `lib/groupNotes`).
- Resto inalterado (a data interna "criado em" da Fatia A permanece).

---

## Backend (TOM engine) — assinatura OAuth, zero API key

### 1. `src/ai/claude.js` (MODIFICAR) — expor saída crua sem o sanitizer de WhatsApp

O `chat()` atual aplica um **sanitizer agressivo** (corta cercas ```` ``` ````, linhas em inglês, `<details>`, tags de tool) pensado para mensagens de WhatsApp. Esse sanitizer **mutilaria HTML/legítimo** de formatação (ex.: nota que contém um bloco de código). Solução: separar "spawn+parse" da "sanitização".

- Refatorar para um helper interno `runClaudeCli(systemPrompt, userPrompt)` que faz spawn + parse (passa pela `_claudeQueue` p/ não corromper `.claude.json`) e retorna `{ rawResult, meta }`.
- `chat()` = `runClaudeCli(...)` **+ sanitizer existente** → comportamento atual **inalterado** (cobertura: `claude.test.js` deve continuar verde).
- **Novo `chatRaw(systemPrompt, userPrompt)`** = `runClaudeCli(...)` retornando `rawResult` com **limpeza leve apenas** (tirar cercas ```` ```html ... ``` ````/```` ``` ````/ prosa fora de tag; trim). **Sem** fallback OpenAI (é o CLI OAuth direto).
- Exportar `chatRaw`.

### 2. `src/internal-api.js` (MODIFICAR) — `POST /internal/format-note`

Segue o padrão dos outros endpoints (CORS de `/internal/*` já configurado; `requireInternalSecret`).

- **Auth:** `requireInternalSecret` (mesmo `INTERNAL_API_SECRET`).
- **Body:** `{ action: 'format'|'summarize'|'fix'|'tone', html: string }`.
- **Validação (função pura testável `validateFormatRequest(body)`):**
  - `action` ∈ whitelist, senão `400 invalid_action`.
  - `html` string não-vazia, **≤ 20000 chars**, senão `400 invalid_html` / `400 too_long`. (cap = guardrail básico de abuso/latência.)
- **System prompt por ação** (todos terminam com "Responda APENAS o HTML do corpo — sem ```, sem texto antes/depois, sem comentário. NÃO invente informação que não esteja no original."):
  - `format`: "Organize esta anotação bagunçada em HTML limpo: títulos `<h2>`, listas `<ul><li>`, negrito `<strong>` onde fizer sentido. Preserve TODOS os dados. Não remova informação."
  - `summarize`: "Resuma o conteúdo: um parágrafo curto + bullets dos pontos principais, em HTML. Não invente."
  - `fix`: "Corrija ortografia e gramática em português, **preservando** o sentido e a estrutura HTML existente."
  - `tone`: "Reescreva num tom mais claro, objetivo e profissional, mantendo todas as informações, em HTML."
- **Chamada:** `const r = await claude.chatRaw(systemPrompt, htmlText)` com **race de 30s** (igual padrão do checkpoint, que usa 10s). `htmlText` = o `html` recebido (o modelo lê as tags).
- **Resposta:** `200 { ok: true, html: <string> }`. Falha do CLI → `502 { ok: false, error: 'tom_unavailable' }` (sem cair em API paga). Validação → `400 { ok:false, error }`.
- **Log:** `marker_logs` opcional `marker_type='NOTE_FORMATTED'` (result executed/rejected) p/ telemetria — best-effort, não bloqueia.

### 3. `src/services/group-notes.js` (MODIFICAR) — `htmlToPlain` no prompt

`renderNoteContent(n)` (linha ~48) injeta `n.body` cru no prompt das fichas **fixadas**. Com `body` em HTML, o prompt receberia tags. Adicionar:

```js
function htmlToPlain(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
```

Em `renderNoteContent`: `if (n.body) lines.push(htmlToPlain(n.body));` (linha 53). Marker `<<GROUP_NOTE>>` e engine **inalterados** (TOM continua escrevendo texto puro; `bodyToHtml` no PWA renderiza).

---

## Segurança (postura honesta antes de produção)

- **`x-internal-secret` está no bundle do PWA** (exposto). Um endpoint de IA é alvo de abuso (proxy LLM grátis → queima a assinatura do TOM). É a **mesma postura dos endpoints atuais** — aceitável em dev (single-user), **inaceitável em prod**.
  - **Antes de prod:** migrar `/internal/*` (ou ao menos `format-note`) para **JWT do Supabase** + **rate-limit** por colaborador. Entra na lista junto com **rotação de chaves** (`CLAUDE_CODE_OAUTH_TOKEN`, service_role, etc.).
- **Cap de 20000 chars** + race de 30s = guardrail mínimo agora.
- **OAuth-only:** `chatRaw` não tem fallback OpenAI — se a assinatura falhar, erro honesto, nunca uma key paga.
- **XSS:** todo HTML (do editor, do legado, do TOM, da IA) é **DOMPurify-sanitizado** antes de render. `body` no banco pode conter HTML não confiável → nunca renderizar sem purificar.

## Testes

- **PWA (vitest, `lib/groupNotes.test.ts` estendido):** `bodyToHtml` — (a) HTML passa direto, (b) markdown vira HTML, (c) vazio → `''`.
- **Backend (`node --test`):** `htmlToPlain` (tags viram texto, `<br>`/`</p>` viram quebra, entidades decodificadas, espaços colapsados); `validateFormatRequest` (whitelist de action, vazio, > 20000).
- **E2E preview (localhost:4173):**
  1. Abrir ficha → corpo no RichEditor; negrito/lista/cor funcionam; salva (autosave) e persiste após reload.
  2. Digitar texto bagunçado → ✨ Formatar → **auto-formatar** → preview antes/depois → Aplicar → corpo vira HTML formatado e renderiza no NoteDetail; reload persiste.
  3. Ficha legada (markdown) abre certa no editor (via `bodyToHtml`).
  4. Fixar ficha → conferir que `renderNoteContent` injeta **texto limpo** (sem tags) no prompt (dry-run/inspeção).
- **Validação backend:** `node --check` nos arquivos; deploy via SCP + `pm2 restart tom`; smoke test do endpoint com `curl` (action válida/ inválida).

## Fora de escopo (Fatia B)

- Unificar visual com `/anotacoes` pessoal (tabela `notes`) — **fatia futura** (o RichEditor já fica reaproveitável).
- Sub-opções de tom (formal vs informal como toggle) — `tone` entrega "claro/profissional" por enquanto.
- Edição colaborativa em tempo real, histórico/versões.
- Migrar JWT/rate-limit (é tarefa de hardening pré-prod, listada em Segurança).

## Riscos

| Risco | Mitigação |
|---|---|
| Sanitizer de WhatsApp mutila HTML da IA | `chatRaw` sem o sanitizer; `chat()` intacto p/ WhatsApp |
| Formatação concorre com respostas do TOM (mutex do CLI serializa tudo) | Uso manual/pontual; race 30s; aceito p/ agora |
| Bundle TipTap aumenta o PWA | StarterKit + 3 extensões enxutas; lazy-load do RichEditor se necessário (decisão no plano) |
| `body` em HTML quebra notas antigas | `bodyToHtml` detecta markdown legado e converte no render — migration-free |
| HTML malicioso no `body` | DOMPurify em todo render |

---

## Arquivos

**Novos:**
- `web/src/screens/grupos/notes/RichEditor.tsx`
- `web/src/screens/grupos/notes/FormatPreview.tsx`
- `web/src/lib/formatNote.ts`
- `src/internal-api.js` → rota `/internal/format-note` (no arquivo existente)

**Modificados:**
- `web/src/lib/groupNotes.ts` (`bodyToHtml`)
- `web/src/screens/grupos/notes/NoteEditor.tsx` (textarea → RichEditor)
- `web/src/screens/grupos/notes/NoteDetail.tsx` (`bodyToHtml` no render)
- `web/src/lib/groupNotes.test.ts` (testes `bodyToHtml`)
- `src/ai/claude.js` (`runClaudeCli` + `chatRaw`)
- `src/services/group-notes.js` (`htmlToPlain` em `renderNoteContent`)
- `web/package.json` (deps TipTap)
