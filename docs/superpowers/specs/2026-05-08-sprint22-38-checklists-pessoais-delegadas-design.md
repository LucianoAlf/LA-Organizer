# Sprint 22.38 — Checklists Pessoais + Delegadas (tabs em /checklists)

**Data:** 2026-05-08
**Status:** approved (pending user re-review of written spec)
**Estimativa:** ~6h

## 1. Objetivo

Transformar `/checklists` numa central com 3 visualizações via tabs:

- **Trabalho** (default): checklists operacionais que o TOM disparou hoje (comportamento atual, sem mudança).
- **Pessoal**: listas que o usuário cria (mercado, viagem, remédios, geral). TOM lê.
- **Delegadas**: leitura de tasks onde `assigned_by = self != assigned_to` (sem schema novo — reuso de `tasks`).

## 2. Não-objetivos

- Não substitui `/agenda` (delegadas aqui é dashboard de leitura, não edição).
- Não move templates operacionais — `/mais/checklists-templates` continua exatamente igual.
- Não introduz colaboração em listas pessoais (single-owner via RLS).
- Não dispara notificações WhatsApp pra checklists pessoais (TOM **lê**, não cobra).
- Não cria fluxo de "cobrar delegada" nessa sprint (futuro).

## 3. Arquitetura

### 3.1 Tabs em `/checklists`

URL: `/checklists?tab=trabalho|pessoal|delegadas` (default `trabalho`).

Reusa o componente existente `Tabs.tsx`. Tab atual fica destacada, troca persiste em querystring (não em localStorage — refresh + share-link funcionam).

### 3.2 Schema novo (1 migration)

```sql
CREATE TABLE personal_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_collab_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  list_type text NOT NULL DEFAULT 'general'
    CHECK (list_type IN ('shopping','travel','meds','general')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES personal_checklists(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  is_done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX personal_checklists_owner_active_idx
  ON personal_checklists (owner_collab_id, is_active);
CREATE INDEX personal_checklist_items_list_sort_idx
  ON personal_checklist_items (list_id, sort_order);

ALTER TABLE personal_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_checklists_owner ON personal_checklists
  FOR ALL TO authenticated
  USING (owner_collab_id = current_collab_id())
  WITH CHECK (owner_collab_id = current_collab_id());

CREATE POLICY personal_checklist_items_owner ON personal_checklist_items
  FOR ALL TO authenticated
  USING (list_id IN (SELECT id FROM personal_checklists WHERE owner_collab_id = current_collab_id()))
  WITH CHECK (list_id IN (SELECT id FROM personal_checklists WHERE owner_collab_id = current_collab_id()));
```

**Notas:**
- `list_type` enum check pequeno; ícone vem do front (mapping emoji).
- `is_active=false` = arquivada (não deleta — TOM pode citar histórico).
- Sem `updated_by` (single-owner, sempre o próprio).

### 3.3 Tab "Pessoal" — componentes

**Tela:** `web/src/screens/Checklists.tsx` ganha switch por tab. Pessoal renderiza:

```
┌── Listas pessoais ───────────────┐
│  + criar lista (botão pill)      │
│                                   │
│  PersonalChecklistCard (mercado) │
│  PersonalChecklistCard (viagem)  │
│  ...                              │
│                                   │
│  + FAB rosa (alternativa mobile) │
└───────────────────────────────────┘
```

**Componentes novos:**

- `web/src/components/PersonalChecklistCard.tsx`
  - Header: ícone (emoji por list_type) + nome + barra `bg-tom` + ⋮ menu + chevron colapsar.
  - Body: `<DndContext>` + `<SortableContext>` com `ChecklistItemRow` reutilizado.
  - Inline: `ChecklistAddItemForm` reutilizado.
  - Auto-colapsa quando 100% (mesmo padrão do ChecklistCard).
  - ⋮ menu card: Renomear, Mudar tipo, Arquivar.

- `web/src/components/PersonalChecklistSheet.tsx`
  - BottomSheet de criar/editar (nome + tipo + items iniciais).
  - Reusa `BottomSheet`.

**list_type → ícone:**
- `shopping` → 🛒
- `travel` → ✈️
- `meds` → 💊
- `general` → 📋

**ChecklistItemRow já tem:** drag, checkbox, ⋮ menu (Adicionar nota / Apagar item). Não precisa "Criar tarefa" pra pessoal — passar `onCreateTask={undefined}`.

### 3.4 Tab "Delegadas" — componente

**Componente novo:** `web/src/components/DelegatedTaskRow.tsx`

**Query:** `tasks` onde `created_by = self.id AND assigned_to != self.id AND status NOT IN ('done','cancelled')`.

**Layout (1 linha por task):**
```
┌─────────────────────────────────┐
│ 👤 Quintela                  ⋮  │
│ "Reunião com pais 5º ano"       │
│ 📅 hoje · 🟡 em andamento       │
└─────────────────────────────────┘
```

**Sub-tabs internas:** Ativas (default) / Concluídas (últimas 30d).

**Sem ações de edição.** Click vai pra projeto/agenda (Link react-router).

**Ordering:** atrasadas primeiro (due_date < hoje), depois por due_date asc.

**Status emoji:**
- `pending` → 🟡
- `in_progress` → 🟢
- `awaiting_confirmation` → 🟣
- `overdue` (computed) → 🔴

### 3.5 TOM integration

**Backend (`src/prompts/system.js`):**
- Estende `fetchCollaboratorContext` com `personalChecklistsRes`:
  ```js
  supabase.from('personal_checklists')
    .select('id, name, list_type, personal_checklist_items(description, is_done, sort_order)')
    .eq('owner_collab_id', collaborator.id)
    .eq('is_active', true)
    .limit(20)
  ```
- `buildContext` aceita novo param `personalChecklists`.
- **Bloco gated:** só injeta se houver pelo menos 1 lista com items pendentes (else: ruído).
- Formato:
  ```
  **Listas pessoais (3 ativas):**
  - 🛒 Mercado: 5 pendentes (tomate, ovo, leite +2)
  - ✈️ Viagem RJ: 8 pendentes (passaporte, kindle...)
  ```

**Skill nova:** `skills/listas-pessoais.md` — descreve como criar/marcar listas via TOM.

**Action token novo:** `<<PERSONAL_LIST_ACTION>>` com `action: create | add_item | toggle_item | rename | archive`.

**Engine handler:** `src/engine.js` ganha branch pra `<<PERSONAL_LIST_ACTION>>` que escreve nas tabelas via service-role client.

> **Nota:** Já existe skill `lista-mental.md` — checar se é o mesmo conceito ou ortogonal. Se for, **renomear/refatorar** durante a sprint pra evitar duplicação. Se for ortogonal (memória mental vs lista executável), manter os dois e cross-link nas duas skills.

## 4. Visibilidade por role

- **Tab Trabalho:** todo mundo (igual hoje).
- **Tab Pessoal:** todo mundo.
- **Tab Delegadas:** todo mundo (mas vazio pra quem nunca delegou — empty state explica).

## 5. Empty states

- **Pessoal vazio:** "Crie sua primeira lista pessoal — mercado, viagem, remédios… O TOM vai te ajudar a lembrar." + botão "+ Criar lista".
- **Delegadas vazio:** "Você ainda não delegou nada. Quando você atribuir uma tarefa pra outra pessoa, ela aparece aqui."

## 6. Frontend — arquivos

### Novos
- `web/src/components/PersonalChecklistCard.tsx`
- `web/src/components/PersonalChecklistSheet.tsx`
- `web/src/components/DelegatedTaskRow.tsx`
- `web/src/lib/personalChecklists.ts` (helpers de fetch + types)

### Modificados
- `web/src/screens/Checklists.tsx` — tabs, switch por tab.
- `web/src/types.ts` — `PersonalChecklist`, `PersonalChecklistItem`, `PersonalListType`.
- `web/src/components/ChecklistItemRow.tsx` — **possivelmente** generalizar tipo (hoje espera completion-related fields). Se já é prop-driven o suficiente, sem mudança.

## 7. Backend — arquivos

### Modificados
- `src/prompts/system.js` — fetchCollaboratorContext + buildContext (param + bloco).
- `src/engine.js` — handler `<<PERSONAL_LIST_ACTION>>`.
- `src/internal-api.js` — endpoints `POST/PUT/DELETE /internal/personal-list/*` (ou via supabase direto + RLS).

### Novos
- `skills/listas-pessoais.md` (skill TOM)
- `migrations/2026-05-08-sprint22-38-personal-checklists.sql`

**Decisão:** TOM grava via supabase service-role direto no engine handler (igual `<<HABIT_ACTION>>`). **Sem** rota internal-api nova — RLS é trivial (service-role bypassa, e PWA usa user-jwt direto).

## 8. UX — detalhes

### Tabs
- 3 botões pill no topo, full-width split. Ativa: `bg-brand text-white`. Inativa: `bg-bg-surface border text-fg-muted`.
- Counter badge opcional (ex: "Pessoal · 2") — mostra só se >0.

### Criar lista pessoal (BottomSheet)
- Campos: Nome (input, max 80) · Tipo (radio chips: 🛒/✈️/💊/📋) · Items iniciais (lista editável com `ChecklistItemEditRow` ou input simples).
- Botão "Salvar lista".

### Mudar tipo
- Submenu inline com 4 chips emoji.

### Arquivar
- Confirma "Arquivar lista? Some da visualização — recuperação via admin".
- **YAGNI:** sem tela de arquivadas nessa sprint. Arquivada some. Recover via SQL/admin.

### Delegadas
- Sub-tabs Ativas/Concluídas (filtro local).
- Click no card vai pra:
  - Se `project_id` → `/projetos/:project_id`
  - Senão → `/agenda?focus=:task_id` (já existe? se não, fallback `/agenda`)

## 9. Testes manuais

1. **Criar lista pessoal "Mercado" com 3 items.** Marcar 2. Refresh. Items persistem.
2. **Reordenar items via drag.** Sort persiste.
3. **Marcar todos.** Card auto-colapsa.
4. **Arquivar lista.** Some da tab Pessoal.
5. **Trocar tab Trabalho ↔ Pessoal ↔ Delegadas.** URL muda. Refresh mantém tab.
6. **Tab Delegadas:** apenas tasks que VOCÊ criou pra outros. Status emoji correto.
7. **TOM context:** mensagem "tô fazendo compras hoje" — TOM cita lista mercado.
8. **TOM action:** "Tom, marca tomate como comprado" — supabase atualiza, PWA realtime invalida.
9. **RLS:** outro collaborator no banco não consegue ler listas alheias (via SQL injection test).

## 10. Métricas de sucesso

- 0 erros 4xx/5xx em `/internal/personal-list/*` durante 7 dias.
- ≥3 listas pessoais ativas após 1 semana de uso real.
- TOM cita lista pessoal pelo menos 1x/semana em conversa relevante.

## 11. Rollback

- Drop tables `personal_checklist_items`, `personal_checklists` (RLS + dados some).
- Reverter commit do PWA → tabs somem, lista trabalho volta ao default.
- Engine handler `<<PERSONAL_LIST_ACTION>>` volta a ser ignorado (TOM emite, ninguém grava).

## 12. Riscos

- **`ChecklistItemRow` precisa generalizar:** hoje recebe IDs com prefixo `tpl:`/`adhoc:`. Pessoal precisa só do uid simples. Mitigação: passar `id` opaco e tratar branding fora.
- **Engine action coupling:** `<<PERSONAL_LIST_ACTION>>` adiciona um novo branch — atenção pra não quebrar fluxo existente.
- **Skill `lista-mental.md` existente:** pode causar confusão. Resolver explicitamente na task 0 da sprint (ler skill atual, decidir merge/separation).

## 13. Decisões adiadas (out of scope)

- Tela de arquivadas pra restaurar.
- Lembretes WhatsApp pra listas pessoais (ex: "lista de mercado tem 5 items, vai sair pro mercado hoje?").
- Compartilhar lista com outro colaborador.
- Lista colaborativa (família).
- "Cobrar delegada" via TOM (Zap pro destinatário).
