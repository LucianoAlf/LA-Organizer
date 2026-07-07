# Modelos de tarefa pessoais ("Meus modelos") — Design

**Data:** 2026-07-07
**Demanda:** Jonathan (ADM), via Alf. Ex.: recebe ligação de lead → escolhe o modelo "Novo Lead" → formulário já vem pronto (título, descrição, delegado do comercial, checklist) → só ajusta e cria.
**Aprovação de design:** Alf, 2026-07-07 ("Tá sim!").

## Objetivo

Permitir que cada usuário salve o formulário do "Novo" (QuickCreateSheet) como um modelo nomeado, reutilizável nas 4 abas — **Tarefa, Compromisso, Delegar e Grupo** — com CRUD completo. Modelos são **pessoais**: só o criador vê e usa (diferente dos modelos de checklist, que são do time).

Como o QuickCreateSheet é o mesmo componente na Agenda e nos Grupos de trabalho (mobile e desktop), os dois ambientes são cobertos por uma única implementação.

## Decisões de escopo (fechadas com o Alf)

1. **O modelo salva tudo, menos a data.** Título, descrição, tipo (Trabalho/Pessoal), delegado padrão + em cópia, checklist, prioridade/quadrante, lembretes e hora. A data fica sempre a de hoje — quem usa escolhe na hora.
2. **Repetição (recurrenceRule) NÃO entra no modelo.** Recorrência + template é armadilha de flood (lição GROUP-POOL-DAILY-RECUR-FLOOD). Quem quiser repetição configura manualmente após aplicar o modelo.
3. **Privado por criador.** RLS em todas as operações: `created_by = current_collab_id()`. Nem coordenação/direção vê modelo alheio.
4. **Fora do escopo (YAGNI):** compartilhar modelos entre usuários; modelos de tarefa via TOM/WhatsApp (fase 2 se pedirem — privacidade por usuário no prompt exige cuidado extra); seeds pré-prontos (modelo pessoal não tem seed universal).
5. **Convivência com modelos de checklist:** os dois coexistem. O modelo de tarefa pode conter um checklist embutido; o picker de checklist do time continua onde está.

## Dados

### Tabela `task_templates` (migration nova)

```sql
create table task_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  kind text not null check (kind in ('task','event','delegated','group')),
  payload jsonb not null default '{}'::jsonb,
  created_by uuid not null references collaborators(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Nome único POR DONO (cada um tem seu namespace)
create unique index task_templates_owner_name_uq
  on task_templates (created_by, lower(btrim(name)));
```

RLS: habilitada; SELECT / INSERT / UPDATE / DELETE, todas com `created_by = current_collab_id()` (INSERT via with check).

### Payload por `kind` (snapshot jsonb do formulário)

Snapshot livre em jsonb: campo novo no formulário amanhã não pede migration. Campos ausentes no payload = default do formulário. Chaves por aba:

- **`task`** — `{ title, description, ctx: 'work'|'personal', group_mode: boolean, group_id: string|null, time: 'HH:MM'|null, reminders: string[], quadrant: number|null, checklist: string[] }`
- **`delegated`** — igual a `task` + `{ delegate_to: uuid, cc_ids: uuid[] }` (sem `group_mode`/`group_id`)
- **`event`** — `{ title, description, category_id: string|null, start_time: 'HH:MM', end_time: 'HH:MM', modality, location_text, meeting_url, quadrant: number|null, reminders: string[], participant_ids: uuid[] }` (só HH:MM — a data vem do dia corrente)
- **`group`** — `{ title, description, group_id: string|null, monthly: boolean, due_day: string, children: Array<{ title, day, time, reminders: number[] }> }` (dias/horas das filhas já são relativos por natureza)

**Não salvos em nenhum kind:** data (`due`, datas de `startAt`/`endAt`), `recurrenceRule`.

### Aplicação do payload (referências que envelheceram)

Ao aplicar um modelo, ids são validados contra os dados atuais:
- `delegate_to` / `cc_ids` / `participant_ids` que não existem mais na lista de colaboradores ativos → **removidos, com toast de aviso** ("Fulano saiu do time — escolhe outro responsável").
- `category_id` inexistente → campo volta a vazio, sem erro.
- `group_id` inexistente/arquivado → `group_mode` desliga, toast de aviso.

Aplicar um modelo **nunca cria nada sozinho** — só preenche o formulário; o usuário revisa e clica "Criar" (guardrail contra criação acidental em lote, mesmo espírito do guardrail de recorrência no pool de grupo).

## UI

Mesmo padrão visual/DS do picker de checklist recém-aprovado (CustomSelect, AdaptiveSheet, Button, ConfirmDialog, tokens; 375px + 1440px).

1. **Picker "Meus modelos…"** — CustomSelect no topo do formulário, logo abaixo das 4 abas, visível em todas as abas. Lista **apenas os modelos da aba ativa** (`kind` = aba). Selecionar preenche o formulário (data permanece hoje). Última opção: "⚙️ Gerenciar meus modelos…" (sentinel, abre o sheet de CRUD). Se o usuário não tem nenhum modelo do kind, o select mostra "Nenhum modelo seu ainda" como estado vazio + a opção de gerenciar.
2. **"Salvar como modelo"** — link no rodapé do formulário (acima do botão Criar). Clicou → input inline de nome (Enter salva, Escape cancela), snapshot do estado atual vira payload. Nome duplicado (23505) → toast "Já existe um modelo seu com esse nome."
3. **Sheet "Meus modelos" (CRUD)** — lista os modelos do usuário (todas as abas, com badge do kind), permite: renomear, **"Atualizar com o formulário atual"** (sobrescreve o payload com o snapshot corrente — só habilitado quando o kind do modelo = aba ativa), excluir (ConfirmDialog: "Tarefas já criadas não mudam. Não dá pra desfazer."). Sem editor campo-a-campo do payload: para editar o conteúdo, o fluxo é aplicar → ajustar no formulário → "Atualizar com o formulário atual". (Decisão anti-trambolho: evita duplicar o formulário inteiro dentro do sheet de gestão.)

## Arquivos

- **Criar** `_remote/supabase/migrations/20260707_task_templates.sql` — DDL + RLS acima (aplicar via MCP).
- **Criar** `_remote/web/src/lib/taskTemplates.ts` (+ `taskTemplates.test.ts`, TDD) — tipos (`TaskTemplate`, `TemplateKind`, payloads); `normalizeTemplateName` (reuso do contrato 2–80); funções puras `payloadFromSnapshot(kind, snapshot)` e `formPatchFromPayload(kind, payload, { collaborators, categories, groups })` → `{ patch, warnings[] }`; I/O Supabase (`listMyTemplates`, `createTemplate`, `updateTemplate`, `deleteTemplate`); `isDupName` (23505).
- **Criar** `_remote/web/src/components/TaskTemplatePicker.tsx` — CustomSelect + link "salvar como modelo" + montagem do sheet de gestão. Props: `kind`, `getSnapshot(): payload`, `onApply(patch, warnings)`. react-query key `['task-templates']`.
- **Criar** `_remote/web/src/components/TaskTemplatesSheet.tsx` — CRUD (lista com badge de kind, renomear, atualizar-com-formulário, excluir).
- **Modificar** `_remote/web/src/components/QuickCreateSheet.tsx` — renderizar o picker abaixo das abas; `getSnapshot()` lendo o estado da aba ativa; `applyPatch()` setando os estados correspondentes.

Nenhuma mudança em engine.js, system.js ou em qualquer coisa do TOM. Zero impacto nas 38 rotas.

## Erros

- Nome inválido (<2 ou >80 após trim) → toast "Nome precisa ter de 2 a 80 letras."
- Snapshot vazio (sem título e sem nenhum campo relevante) → toast "Preenche o formulário antes de salvar como modelo."
- Duplicado (23505 no índice owner+nome) → toast de nome duplicado.
- Falha de rede em qualquer operação → toast genérico; formulário intocado.

## Testes

- **Vitest (lib pura):** payloadFromSnapshot por kind (inclui NÃO capturar data/recorrência); formPatchFromPayload com payload íntegro; com colaborador removido (warning + campo limpo); com categoria removida; com payload de versão antiga (campo faltante → default); normalizeTemplateName; isDupName.
- **E2E preview (contra o BANCO, teste verde ≠ fix):** criar modelo na aba Delegar com delegado+checklist → recarregar → aplicar → criar → conferir a linha em `tasks` (assigned, checklist filhas) e a linha em `task_templates`; RLS: logado como outro usuário, o modelo não aparece.
- **Visual:** 375px e 1440px, aba Tarefa e Delegar.
