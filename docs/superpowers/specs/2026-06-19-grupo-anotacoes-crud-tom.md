# Spec — Parte 1 do Grupo-CRUD: Anotações com CRUD total pelo TOM no chat de grupo

**Data:** 2026-06-19
**Autor:** Claude + Alf
**Épico:** Grupo-CRUD (trazer o pacote CRUD do 1:1 pro chat de grupo) — Parte 1 de 4. Ver `memory/project_grupo_crud_roadmap.md`.

## Objetivo

Dar ao TOM, dentro do chat de grupo de trabalho (app + WhatsApp espelhado), **CRUD completo + papel de consultor** sobre as fichas do grupo (`group_notes`): **ler qualquer ficha sob demanda**, **editar**, **apagar (com confirmação + lixeira)** e **auditar/listar**. Hoje ele só faz `create` e `append`, só "enxerga" o conteúdo de fichas **fixadas**, e responde "não consigo te mostrar" pra ficha não-fixada (bug real, caso Rose/Dívida Ativa 17/06).

## Decisões aprovadas pelo Alf (19/06)

1. **Senha em leitura/listagem:** mascarar por padrão (`••••`); revelar **só** no pedido explícito de senha (o `credentialLookupContext` que já existe). Vale no app e no WhatsApp espelhado.
2. **Apagar:** sempre **confirmar antes** (mostrando qual ficha) **+ lixeira** (soft-delete reversível). Restaurável por um tempo; faxina automática depois.
3. **Editar:** **direto** (sem confirmar), mas o TOM **ecoa o que mudou** — um match errado fica visível na hora e dá pra corrigir.
4. **Escopo de permissão:** qualquer membro do grupo lê/edita/apaga (consistente com o `create`/`append` de hoje, que já é aberto). Apagar sempre confirma e é reversível, então fica seguro.

## Arquitetura: separar LEITURA de ESCRITA

- **Leitura = injeção determinística no contexto** (mesmo padrão provado do `credentialLookupContext`). Quando a mensagem cita uma ficha, o motor acha e **injeta o conteúdo dela no prompt** — o TOM só repassa. Elimina a confabulação "não consigo": o conteúdo já está no contexto.
- **Escrita (editar/apagar/restaurar) = ações novas no marker `<<GROUP_NOTE>>`** que ele já emite. Apagar passa por um **gate de confirmação determinístico** (não depende do LLM threading "sim/não").

## Modelo de dados (migration)

### `group_notes` — soft-delete
- Adicionar coluna `deleted_at timestamptz NULL` (default null).
- Índice parcial opcional para listas: `WHERE deleted_at IS NULL`.
- **Toda** leitura passa a filtrar `deleted_at IS NULL` (app + backend + relatório + credential lookup).

### `group_chat_pending_confirms` — confirmação determinística (tabela nova)
Genérica (reutilizável p/ futuras ações destrutivas no grupo). Colunas:
- `id uuid pk default gen_random_uuid()`
- `group_id uuid not null` (FK work_groups)
- `sender_collab_id uuid not null` (quem pediu — a confirmação tem que vir DA MESMA pessoa)
- `op text not null` (v1: `'delete_note'`)
- `target_id uuid` (id da ficha alvo)
- `summary text` (rótulo amigável pro echo: título da ficha)
- `created_at timestamptz default now()`
- `expires_at timestamptz not null` (≈ now() + 10 min)
- RLS: serviço escreve via service_role; leitura member-checked (não é sensível, mas mantém padrão).
- Unicidade leve: no máximo 1 pendência ativa por (`group_id`, `sender_collab_id`, `op`) — upsert/replace.

## Capacidades (comportamento detalhado)

### A. Ler qualquer ficha sob demanda — `noteFetchContext` (injeção, sem marker)
Nova função em `group-notes.js`, irmã de `credentialLookupContext`:
- Dispara quando a mensagem parece pedir uma ficha (verbo de recuperação: manda/mostra/envia/qual/cadê/abre/passa + termo "ficha|anotação|nota|passo a passo|procedimento|guia"), **OU** quando o texto casa fortemente com o título/tags de uma ficha (reusa `credTokenize`/`scoreNoteMatch`).
- Pega o(s) top match(es) (1–2), filtra `deleted_at IS NULL`, e injeta um bloco `## Ficha(s) que casam com o pedido` com o conteúdo via `renderNoteContent` **com secrets MASCARADOS** (`••••` em vez do valor — diferente do credential, que revela).
- Se 2+ casam com score parecido → injeta as duas (TOM desambígua: "achei a ficha X e a Y, qual?").
- Cap de tamanho pra não estourar o prompt (top-2, corpo truncado se gigante).
- Wired no `loadContext` do `group-chat-engine.js`, ao lado da chamada de `credentialLookupContext`.

### B. Editar — `<<GROUP_NOTE>>{action:"update"}`
- Novo `updateGroupNote({ supabase, groupId, updatedBy, title, patch })` em `group-notes.js`.
- Resolve a ficha por `ilike(title)` (filtrando `deleted_at IS NULL`); se não achar → `{ updated:false, reason:'not_found' }`.
- `patch` aceita: `new_title`, `type`, `tags`, `body`, e **mutação de campos**: `set_fields` (substitui todos) ou `upsert_field` ({label, value, kind, secret}) / `remove_field` (por label). Sanitiza via `sanitizeFields`. Seta `updated_by`/`updated_at`.
- **Secret:** ao editar campos, NUNCA reescrever um secret já cifrado (`enc:v1:`) sem novo valor (lição PERSONALNOTES/NoteEditor). Se o LLM mandar `••••` ou vazio num campo secret existente, preserva o cifrado.
- Handler push action `{kind:'note', status:'ok', label:title, detail:'✏️ atualizada: <resumo do que mudou>'}` → o TOM ecoa.

### C. Apagar (confirm + lixeira) — `<<GROUP_NOTE>>{action:"delete"}` + gate determinístico
1. **Pedido:** LLM emite `{action:"delete", title:"X"}`. O handler **não apaga**: resolve a ficha (ilike, não-deletada), grava/atualiza uma pendência em `group_chat_pending_confirms` (group+sender+op='delete_note'+target_id+summary, expires +10min), e push action `{kind:'note', status:'pending', label:title, detail:'❓ confirmar exclusão'}`. O TOM pergunta "apagar a ficha **X**? confirma?".
   - Se não resolveu a ficha → `{status:'fail', detail:'não achei essa ficha'}` (sem pendência).
2. **Confirmação (pré-passo determinístico no `processGroupChatMessage`, ANTES do LLM):** se existe pendência ativa (não expirada) para (group, sender) **e** a mensagem é afirmativa (`/\b(sim|confirmo?|confirma|pode|isso|apaga|apagar|manda ver|exclui)\b/i` e curta), executa o **soft-delete** (`deleted_at=now()`), limpa a pendência, e responde determinístico "apaguei a ficha X — tá na lixeira, é só pedir 'restaura a ficha X' que eu trago de volta". Não chama o LLM pra essa confirmação (evita ambiguidade).
   - Se a mensagem é negativa (`/\b(não|nao|cancela|deixa|esquece)\b/i`) → limpa a pendência e responde "ok, não apaguei".
   - Se é outra coisa → ignora a pendência (deixa expirar), segue o fluxo normal do LLM.
   - **Engajamento:** como o TOM acabou de perguntar "confirma?", a sessão está engajada (`tom_chat_engaged_at`), então um "sim" seco já chega ao `processGroupChatMessage`. O pré-passo de confirmação roda ANTES da lógica de engajamento/silêncio e ANTES do LLM, garantindo que a confirmação seja capturada mesmo sem "tom" na mensagem.
3. **Restaurar:** `<<GROUP_NOTE>>{action:"restore", title:"X"}` → `restoreGroupNote` seta `deleted_at=null`. (Resolve inclusive entre as deletadas recentes.)
4. **Faxina:** cron diário no `dispatcher.js` (ou ritual existente) faz hard-delete de `group_notes` com `deleted_at < now() - interval '30 days'`.

### D. Auditar / listar — implementar o stub do relatório
- `group-report-builder.js`: implementar `queryGroupNotes(supabase, groupId)` → lista `group_notes` não-deletadas do grupo com `title, type, updated_at, updated_by` (nome via join `collaborators`). Corrigir o comentário desatualizado.
- "quais fichas o grupo tem" já é coberto pelo índice no prompt; "quem mexeu na ficha X / quando" → o `noteFetchContext`/render inclui `updated_by`+`updated_at` quando o pedido é de auditoria.
- (Opcional, se barato) expor um scope `anotacoes` no `<<GROUP_REPORT>>` que renderiza a lista de fichas.

## Prompt (`group-chat-prompt.js`)
- Documentar as ações novas do `<<GROUP_NOTE>>`: `update`, `delete`, `restore` (com exemplos), além de `create`/`append`.
- Regra **anti-"não consigo"**: "O conteúdo das fichas relevantes JÁ vem no seu contexto (bloco 'Ficha(s) que casam'). NUNCA diga que não consegue mostrar uma ficha — se o conteúdo está no contexto, repasse; se não veio, diga que vai puxar / peça o nome exato. Senha aparece mascarada: pra revelar, a pessoa pede 'a senha de X'."
- Regra de apagar: "Pra apagar, emita `{action:delete}` e PERGUNTE a confirmação; só o sistema apaga, e vai pra lixeira (reversível)."

## Handler (`group-chat-engine.js`)
- Bloco `<<GROUP_NOTE>>`: aceitar `action ∈ {create, append, update, delete, restore}` (hoje só create/append → resto cai em "marker malformado").
- Adicionar o **pré-passo de confirmação** no topo do `processGroupChatMessage` (antes de montar/rodar o LLM): checa `group_chat_pending_confirms`.
- `loadContext`: chamar `noteFetchContext` junto do `credentialLookupContext`.

## App (`web/src/lib/groupNotes.ts`) — mínimo p/ lixeira não quebrar a tela
- `loadGroupNotes`: adicionar `.is('deleted_at', null)`.
- `deleteGroupNote`: trocar hard-delete por soft (`.update({ deleted_at: new Date().toISOString() })`) — transparente pra UI (a ficha some da lista igual).
- **Fora de escopo da Parte 1 (fast-follow):** tela de "Lixeira" no app com botão restaurar. Na Parte 1, restaurar é via TOM ("restaura a ficha X"). Anotar como pendência.

## Testes (TDD — funções puras primeiro)
Backend (`group-notes.test.js`, mock de supabase já existe no padrão dos outros testes):
- `noteFetchContext`: casa por título/tags; mascara secret; respeita `deleted_at`; top-2 em empate; vazio quando não casa.
- `updateGroupNote`: muda título/tags/body; upsert/remove field; **preserva secret cifrado** quando vem `••••`/vazio; not_found.
- `softDeleteGroupNote`/`restoreGroupNote`: seta/limpa `deleted_at`; resolve só não-deletadas (delete) e só deletadas (restore).
- Gate de confirmação (função pura de decisão: dado pendência + texto → `execute|cancel|ignore`).
- `queryGroupNotes` do relatório: retorna fichas não-deletadas com metadados.
Regressão: a suíte de `group-chat-tasks`/`group-chat-engine` continua verde (zero toque no caminho de recorrência).

## Não-objetivos (Parte 1)
- Tarefas, arquivos, finanças (Partes 2–4).
- Reordenar via chat (é gesto visual; fica na tela).
- Tela de Lixeira no app (fast-follow).
- Mexer no motor de recorrência (intocado).

## Deploy & registro
- Migration via MCP Supabase; backend via `scp tom:` + `pm2 restart`; app via auto-deploy.
- Validar no preview (localhost:4173) + dry-run no grupo Financeiro (ficha descartável, não mexer em dado real sem necessidade).
- Registrar known issue (`tom_known_issues`) no fim: `GROUPCHAT-NOTES-CRUD` (causa: só create/append + leitura só de fixada → "não consigo"; fix: CRUD + injeção determinística de leitura + lixeira).
