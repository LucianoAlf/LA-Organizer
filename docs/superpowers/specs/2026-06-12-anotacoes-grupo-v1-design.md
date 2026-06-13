# Anotações do Grupo (Base de Conhecimento) — v1 — Design

**Data:** 2026-06-12
**Autor:** TOM dev (sessão com Alf) — disparado pelo caso Rose (grupo Financeiro)
**Status:** Aprovado (design) — pendente review da spec escrita
**Relacionado:** [[project_groupchat_pacote_tarefas]], [[project_groupchat_b1_relatorios]]

---

## 1. Objetivo e motivação

Hoje o grupo de trabalho não tem um lugar para **conhecimento compartilhado**. A Rose
(gerente, Financeiro) recorre à descrição do WhatsApp pra guardar CNPJs, acessos (Zoho,
Light), contas a pagar — e pediu ao TOM pra "anotar pro grupo". O TOM resolveu com um
**hack**: nota pessoal dela com `shared_with` = membros. Não há group-scope real, nem
organização, nem UI dedicada.

A v1 entrega uma **base de conhecimento do grupo**: anotações que pertencem ao grupo,
visíveis a todos os membros, organizadas por **categoria + tags**, com **busca e filtro**,
num ambiente **dois-painéis** (estilo Notion/Slack), e com o **TOM** criando/consultando
essas anotações pelo chat. É a fatia v1 de uma visão maior (v2 = editor de blocos rico).

## 2. Decisões (confirmadas no brainstorm)

1. **Corte:** v1 = base de conhecimento (markdown + categoria + tags + filtro + dois-painéis
   + TOM). **v2** (futuro) = editor de blocos Notion-style, tabelas, campos estruturados,
   templates por tipo de grupo, histórico, permissões finas.
2. **Organização:** 1 **categoria** principal por anotação (texto livre — o grupo cria as
   suas: Acessos, CNPJs, Contas, Reuniões…) + **tags livres** (`text[]`).
3. **Permissão:** **qualquer membro** do grupo cria/edita (base colaborativa; RLS por membro).
4. **Layout:** **B — dois painéis** (rail categorias/tags · lista · documento). Mobile colapsa
   em lista→detalhe.
5. **Conteúdo:** `body` em **markdown** (renderizado com `marked`+`dompurify`, já no app).
6. **Tabela dedicada** `group_notes` (não estende a `notes` pessoal — evita poluir a tela
   individual e as queries pessoais).

## 3. Dados — `group_notes` (Supabase `cesnbnrynvxvgdhfmaua`)

| coluna | tipo | notas |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| group_id | uuid FK | → `work_groups(id)` ON DELETE CASCADE |
| category | text | texto livre (default `'Geral'`) |
| tags | text[] | default `'{}'` |
| title | text | obrigatório |
| body | text | markdown |
| pinned | boolean | default false |
| created_by | uuid | → collaborators(id) |
| updated_by | uuid | quem editou por último |
| created_at | timestamptz | default now() |
| updated_at | timestamptz | default now() |

**Índices:** `(group_id)`, `(group_id, category)`.
**RLS** (copia o padrão de [[reference_collab_id_vs_auth_uid]] / `group_chat_messages`):
- SELECT/INSERT/UPDATE/DELETE: `group_id IN (SELECT group_id FROM work_group_members WHERE collaborator_id = current_collab_id())`.
- service_role: ALL (`auth.role()='service_role'`) — caminho do TOM.

## 4. UI — ambiente de dois painéis

### 4.1 Entrada
Botão **📒 Anotações** no cabeçalho do `GrupoWorkspace.tsx` (junto de Chat / Pacote / Nova
tarefa). Abre o ambiente (drawer full-height no desktop / rota no mobile — seguir o padrão
do `GroupChatDrawer` que já existe).

### 4.2 Componentes (novos, em `web/src/screens/grupos/notes/`)
- `GroupNotesEnv.tsx` — shell de 3 colunas (rail · lista · documento). No mobile, estado
  navegacional: rail→lista→documento (volta com ←).
- `NotesRail.tsx` — categorias (com contagem) + tags; clique filtra. "Todas" no topo.
- `NotesList.tsx` — busca (título+body) no topo + lista de itens (título, trecho, "editado
  por X há…", 📌 se pinned).
- `NoteDoc.tsx` — documento aberto: título, badges (👥 do grupo · editado por · tags),
  body markdown renderizado; botão **Editar** → modo edição (título + categoria
  [CustomSelect com autocomplete das categorias existentes] + tags [input de chips] +
  textarea markdown). **Auto-save com debounce** (sem botão Salvar, padrão da casa).
  Botões **📌 fixar** e **🗑️ excluir** (qualquer membro).
- DS obrigatório (`CustomSelect`, `BottomSheet`/drawer, tokens, cor `tom`). Tema claro/escuro
  herda o app.

### 4.3 Dados/hook
- `web/src/lib/groupNotes.ts` — puras: `filterNotes(notes, {category, tag, query})`,
  `categoriesWithCount(notes)`, `allTags(notes)`, `noteExcerpt(body)`; I/O:
  `loadGroupNotes(groupId)`, `upsertGroupNote(note)`, `deleteGroupNote(id)`, `togglePin(id)`.
- `useGroupNotes(groupId)` (React Query) — lista + mutations.

## 5. TOM no chat do grupo

### 5.1 Marker novo `<<GROUP_NOTE>>`
Parseado em `group-chat-engine.js` (espelha `<<TASK_GROUP>>`/`<<GROUP_REPORT>>`):
```
<<GROUP_NOTE>>{"action":"create"|"append","title":"<título>","category":"<categoria>","tags":["…"],"body":"<markdown>"}<<END>>
```
- `create` → insere `group_notes` do grupo (via service_role). `append` → acha por título
  (ilike, no grupo) e concatena no `body` (separador `\n\n`). Render: "📒 Anotação do grupo
  criada/atualizada: <título>".
- Persistência via novo `src/services/group-notes.js` (`createGroupNote`/`appendGroupNote`,
  supabase injetado, testável).

### 5.2 Consciência (consulta)
`group-chat-prompt.js` passa a incluir, no contexto do grupo:
- **Índice** das anotações do grupo: `título · categoria · tags` (compacto, sem body).
- **Body das anotações fixadas (pinned)** — as importantes (CNPJs, acessos) que o time fixa.
Assim o TOM sabe o que existe e responde "tá na anotação *Acesso Zoho*" e, se fixada, dá o
valor. (Recuperação full-text de qualquer body sob demanda = v2.)

### 5.3 Prompt — heurística
"anota isso pro grupo / guarda o acesso / registra o CNPJ do grupo" → `<<GROUP_NOTE>>`.
Nota **pessoal** continua `<<NOTE_ACTION>>` no privado. O TOM NUNCA mais usa o hack de
`shared_with` pra simular nota de grupo.

## 6. Migração de dados

Script `scripts/migrate-shared-notes-to-group.js` (one-off, com `--dry`): a(s) nota(s) que
o TOM marcou como "do grupo" via `shared_with` no Financeiro (ex.: "Contas a Pagar
15/06/2026" da Rose) → cria `group_notes` equivalente (categoria "Contas", `created_by` =
dono original) e marca a nota pessoal como `archived` (não apaga — reversível). Idempotente.

## 7. Testes

- **Puras PWA** (vitest): `filterNotes` (categoria/tag/busca), `categoriesWithCount`,
  `allTags`, `noteExcerpt`.
- **Marker** (`node --test`): parse `<<GROUP_NOTE>>` válido/malformado; `group-notes.js`
  create/append (supabase fake).
- **RLS:** membro lê/edita; não-membro não vê.
- **e2e VPS** (Financeiro `d95f63af-…`): criar anotação pela UI (categoria+tags) + pelo chat
  ("Tom, guarda o acesso do Zoho pro grupo") → aparece no ambiente; validar no preview.

## 8. Fora de escopo (v1 → vai pro v2/v3)

- Editor de **blocos** (headings/listas/tabelas arrastáveis) — v1 é markdown textarea.
- Campos estruturados por unidade/conta; **templates** por tipo de grupo.
- **Histórico/versão**, anexos, permissões finas (quem-edita vs quem-lê).
- Recuperação semântica (RAG) de qualquer body pelo TOM — v1 só índice + pinned.

## 9. Riscos

- **Escopo da UI dois-painéis** é a parte mais cara — mitiga: reusar o padrão do
  `GroupChatDrawer` (drawer) + DS; mobile = navegação lista→detalhe (sem two-pane).
- **TOM confabular** que "anotou" sem marker — a regra anti-confabulação já existe; reforçar
  no prompt ("nunca diga 'anotei pro grupo' sem emitir `<<GROUP_NOTE>>`").
- **Markdown injection** — `dompurify` já sanitiza (mesmo pipeline do chat).
