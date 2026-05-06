# Spec: Sprint 15 — Camada Operacional Replicável (Piloto: Operações Técnicas)
**Data:** 2026-05-03
**Status:** Proposta — aguardando aprovação

---

## 1. Diagnóstico do estado atual

### 1.1 Banco de dados (relevante para Sprint 15)

O banco conta com 36 tabelas. As peças abaixo já existem e serão reaproveitadas diretamente:

**`tasks`** — backbone operacional. Colunas relevantes que já existem:
- `id`, `title`, `description`, `assigned_to`, `created_by`, `status` (pending / in_progress / done / cancelled / awaiting_confirmation)
- `priority` (critical / high / medium / low), `eisenhower_quadrant` (calculado por trigger)
- `due_date`, `scheduled_date`, `source` (manual / agent_briefing / agent_closing / checkpoint_decomposition / coordinator_assignment / system)
- `context` (work / personal), `action_type`, `notes`
- `school_event_id`, `event_sector` — prova de que `tasks` já absorveu relações com outras entidades sem criar tabelas novas
- `delegated_to`, `delegated_at`, `support_team` (uuid[])
- `remind_at`, `task_event_reminder_sent_at`

**`op_checklists` + `op_checklist_items` + `op_checklist_completions` + `op_checklist_item_completions` + `op_checklists_audit`** — pipeline de checklists operacionais já funcional, com dispatch via dispatcher, idempotência via `dispatched_at`, lógica de WhatsApp interativo. Funciona com `function_role`, `unit`, `shift`, `days_of_week`, `dispatch_time`.

**`event_team_map`** — mapa setor × unidade → responsável. Modelo exato para futura tabela `department_assignees` (fora do escopo Sprint 15, mas o padrão já existe).

**`notifications`** — fila de notificações assíncrona usada pelo engine.

**`announcements` + `announcement_jobs`** — modelo de aprovação em dois passos reutilizável como referência para `requires_approval` nos tipos de demanda.

**`task_comments`** — timeline de comentários nas tasks (equivale ao "histórico de execução" do wireframe do card operacional).

**`ritual_logs`** — idempotência de despacho. Reutilizado para guardar execução do ritual semanal operacional.

**RLS relevante:**
- `tasks`: colaborador lê/edita as próprias (work); coordinator/director vê todas work. Engine usa service role (bypassa RLS).
- `op_checklists`: SELECT aberto a todos; escrita restrita a coordinator/director.
- Helper `current_collab_role()` disponível para policies novas.
- Novas tabelas de Sprint 15 seguirão o mesmo padrão.

---

### 1.2 PWA (telas relevantes)

**Telas existentes reaproveitáveis:**

| Tela | Rota | Padrão reutilizável |
|---|---|---|
| `Checklists.tsx` | `/mais/checklists` | Lista de completions com status, filtros por data |
| `ChecklistsTemplates.tsx` | `/mais/checklists-templates` | CRUD de templates com roles guard |
| `DashboardTime.tsx` | `/time` | Fila de tarefas de outros colaboradores (coordinator view) |
| `Mais.tsx` | `/mais` | Hub de navegação — onde a nova entrada será adicionada |
| `Observabilidade.tsx` | `/mais/observabilidade` | Painel de logs — padrão para "visão geral operacional" |
| `EventoDetalhe.tsx` | `/mais/agenda/:id` | Card de detalhe com timeline de ações — padrão para `OperacaoDetalhe` |
| `ConfigurarEquipe.tsx` | `/mais/configurar-equipe` | Gestão de mapa setor × unidade — padrão para gestão de responsáveis por departamento |

**Padrões reaproveitáveis:**
- `ProtectedRoute` com `requireRoles` — usado em `ConfigurarEquipe` e `Comunicados` para restringir coordinator/director
- Cards com badge de criticidade (padrão Eisenhower em `Hoje.tsx`)
- Filtros de lista com query params (padrão `AgendaEscolar.tsx`)

---

### 1.3 TOM / Engine

**Markers existentes:**

| Marker | Função | Relevância Sprint 15 |
|---|---|---|
| `<<TASK_UPDATE>>` | Único marker para todas as operações de task (create, complete, reschedule, delegate, cancel) | Principal marker da nova skill |
| `<<WEEKLY_PLAN>>` | Cria weekly_plans + daily_plans + tasks | Potencialmente reutilizado no ritual semanal operacional |
| `<<CHECKLIST_UPDATE>>` | Registra completions de checklist | Gatilho indireto para geração de tasks |
| `<<ANNOUNCEMENT>>` | Cria comunicados segmentados | Referência para notificação de closure |
| `<<MEMORY_UPDATE>>` | Gestão de memória do colaborador | Irrelevante para Sprint 15 |

**`applyTaskActions`** (engine.js) — função que processa o array de actions do `<<TASK_UPDATE>>`. Suporta: `create`, `complete`, `reschedule`, `delegate`, `extension_request`, `approve`, `deny`. Para Sprint 15, o `create` precisa receber `department_id` e `request_type_id` como campos extras — o engine já passa o objeto inteiro pro Supabase via insert, então campos novos são absorvidos sem alteração estrutural da função.

**Skills relevantes:**
- `checklists-operacionais.md` — disparo e parsing de checklists via WhatsApp; fonte do padrão para "checklist com consequência"
- `priorizacao-inteligente.md` — ajuda TOM a classificar urgência real vs percebida (reutilizável na triagem de demanda operacional)
- `eventos-institucionais.md` — padrão de skill com múltiplos turnos, marcador próprio, e consulta ao `event_team_map`

---

### 1.4 Dispatcher

**Blocos atuais do `run()` (Sprint 14, 12 blocos):**

| Bloco | Frequência | Função |
|---|---|---|
| 1 | Por slot em `user_preferences` | Rituais individuais (briefing, closing, planning) |
| 2 | Weekdays 19:30 / Dom 18:00 | Coordinator reports |
| 3 | Dom 22:00 | Consolidação de memória |
| 4–6 | Todo tick | Reminders, task reminders, aderência |
| 7 | Todo tick | `dispatchChecklists` — padrão direto para Sprint 15 |
| 8–12 | Todo tick / slots fixos | Reports, aprovações, remindEventTasks, announcements |

**Padrão `dispatchChecklists`** é o modelo a seguir: janela de 5 min, idempotência por completions, dry-run, filtro por `unit`/`function_role`/`shift`. Sprint 15 criará `checkDepartmentOperational` seguindo exatamente esse padrão.

---

### 1.5 O que será reaproveitado

- `tasks` como backbone — nenhuma tabela nova de demandas
- `applyTaskActions` no engine — absorve campos novos sem refactor
- `<<TASK_UPDATE>>` — marker único, sem criar `<<OPERATIONAL_REQUEST>>`
- `op_checklists` + pipeline existente — gatilho para geração de tasks operacionais
- `dispatchChecklists` como template de código para novo bloco no dispatcher
- `ProtectedRoute` + roles guard para tela nova
- Padrão de card com timeline de `EventoDetalhe.tsx`
- Padrão de hub de links de `Mais.tsx`
- `event_team_map` como inspiração para `department_assignees` (futuro)
- RLS helpers (`current_collab_role`) para policies das novas tabelas
- `ritual_logs` para idempotência do ritual semanal operacional

---

## 2. Proposta arquitetural da Sprint 15

### 2.1 Modelagem nova

Apenas 2 novas tabelas, como decidido.

#### Tabela `departments`

```sql
CREATE TABLE departments (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text    NOT NULL UNIQUE,
  name        text    NOT NULL,
  description text,
  is_active   boolean NOT NULL DEFAULT true,
  -- unit_scope_enabled: se true, tasks deste dept requerem unit preenchida
  unit_scope_enabled boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX departments_slug_idx ON departments(slug);
CREATE INDEX departments_active_idx ON departments(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;

-- Todos leem (visibilidade de nomes/slugs é necessária para forms e TOM)
CREATE POLICY departments_select ON departments
  FOR SELECT TO authenticated USING (true);

-- Apenas director/coordinator criam e editam
CREATE POLICY departments_write ON departments
  FOR ALL TO authenticated
  WITH CHECK (current_collab_role() IN ('coordinator', 'director'));
```

#### Tabela `department_request_types`

```sql
CREATE TABLE department_request_types (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id    uuid    NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  slug             text    NOT NULL,
  label            text    NOT NULL,
  description      text,
  default_priority text    NOT NULL DEFAULT 'medium'
                           CHECK (default_priority IN ('critical','high','medium','low')),
  requires_approval boolean NOT NULL DEFAULT false,
  -- se true: checklist flagged gera task automaticamente (ver §2.7)
  generates_task   boolean NOT NULL DEFAULT true,
  is_active        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, slug)
);

CREATE INDEX dept_request_types_dept_idx ON department_request_types(department_id);
CREATE INDEX dept_request_types_active_idx ON department_request_types(is_active) WHERE is_active = true;

-- RLS
ALTER TABLE department_request_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY dept_request_types_select ON department_request_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY dept_request_types_write ON department_request_types
  FOR ALL TO authenticated
  WITH CHECK (current_collab_role() IN ('coordinator', 'director'));
```

---

### 2.2 Mudanças em `tasks`

Apenas 2 novas colunas. Justificativa abaixo.

```sql
ALTER TABLE tasks
  ADD COLUMN department_id    uuid REFERENCES departments(id) ON DELETE SET NULL,
  ADD COLUMN request_type_id  uuid REFERENCES department_request_types(id) ON DELETE SET NULL;

CREATE INDEX tasks_department_idx ON tasks(department_id) WHERE department_id IS NOT NULL;
CREATE INDEX tasks_request_type_idx ON tasks(request_type_id) WHERE request_type_id IS NOT NULL;
```

**Justificativas:**

| Coluna | Justificativa | Alternativa descartada |
|---|---|---|
| `department_id` | Permite filtrar a fila por departamento na PWA e no ritual semanal sem join extra. Chave de roteamento: toda task operacional pertence a um departamento. | Sem esta coluna, o filtro exigiria join em `request_type_id → department_request_types → departments`, adicionando complexidade a todas as queries de fila. |
| `request_type_id` | Carrega `default_priority`, `requires_approval` e `label` do tipo — TOM usa para classificar e o PWA usa para exibir o badge de tipo no card. | Usar `notes` ou `category` existente seria gambiarra sem semântica clara. |

**Colunas avaliadas e descartadas:**

- `criticality` (text) — **descartado**. A coluna `priority` já existe e tem CHECK com 4 níveis. O campo `default_priority` em `department_request_types` alimenta `priority` no create. Duplicar não agrega.
- `unit_scope` (text) — **descartado**. `unit` já existe implicitamente via `assigned_to → collaborators.unit`. Para filtros PWA, usamos `collaborators.unit` via join. O flag `unit_scope_enabled` em `departments` indica se a triagem de unidade é necessária (configuração, não dado da task).
- `reported_by` (uuid) — **descartado** para Sprint 15. O campo `created_by` já captura quem criou. Se a triagem vier de outra pessoa, `created_by` reflete o triador. Refinamento futuro se o produto exigir.

**RLS de tasks — sem alteração.** As novas colunas não mudam o modelo de acesso: coordinator/director já vê todas as tasks de trabalho. Tasks operacionais têm `context = 'work'`, então são visíveis para gestores sem mudança de policy.

---

### 2.3 Seed inicial

```sql
-- 1. Departamento piloto
INSERT INTO departments (slug, name, description, is_active, unit_scope_enabled)
VALUES (
  'operacoes-tecnicas',
  'Operações Técnicas',
  'Gestão de incidentes, reposição de estoque, obras e manutenção preventiva das unidades',
  true,
  true  -- demandas sempre associadas a uma unidade
);

-- 2. Tipos de demanda (5 tipos do PRD + compra/fornecedor da REF4)
-- Buscar o ID inserido acima
WITH dept AS (SELECT id FROM departments WHERE slug = 'operacoes-tecnicas')
INSERT INTO department_request_types
  (department_id, slug, label, description, default_priority, requires_approval, generates_task, sort_order)
VALUES
  ((SELECT id FROM dept), 'incidente-tecnico',      'Incidente técnico',        'Cabo ruim, equipamento quebrado, ar-condicionado falhando',          'high',     false, true,  1),
  ((SELECT id FROM dept), 'reposicao-estoque',      'Reposição / estoque',      'Falta corda, baqueta, microfone reserva, consumíveis',               'medium',   false, true,  2),
  ((SELECT id FROM dept), 'apoio-tecnico-montagem', 'Apoio técnico / montagem', 'Gravação, vídeo, evento, apoio de sala, montagem de equipamento',    'medium',   false, true,  3),
  ((SELECT id FROM dept), 'obra-infraestrutura',    'Obra / infraestrutura',    'Luz de emergência, reforma, ajuste estrutural, contratação externa',  'low',      true,  true,  4),
  ((SELECT id FROM dept), 'preventivo-auditoria',   'Preventivo / auditoria',   'Revisão de sala, checagem de itens críticos, ronda semanal',          'low',      false, true,  5),
  ((SELECT id FROM dept), 'compra-fornecedor',      'Compra / fornecedor',      'Item que depende de aprovação de compra ou contato com terceiro',     'medium',   true,  true,  6);
```

---

### 2.4 TOM skill nova

**Arquivo:** `skills/operacoes-tecnicas.md`

**Propósito:** Capturar demandas operacionais via WhatsApp, forçar estrutura mínima (unidade, tipo, urgência, impacto na aula), classificar com ajuda do TOM e emitir `<<TASK_UPDATE>>` com `department_id` e `request_type_id`. A skill não cria uma entidade nova — ela instrui o TOM a criar uma task com os campos corretos.

**Padrão seguido:** `eventos-institucionais.md` — skill com múltiplos turnos, consulta contextual ao banco, emissão de `<<TASK_UPDATE>>`.

**Gatilhos de ativação:**
- Mensagem do usuário contendo: "problema", "quebrou", "tá falhando", "falta", "preciso de", "incidente", "manutenção", "obra", "revisão", "montagem", "compra", "fornecedor"
- TOM identifica que o contexto é operacional (unidade, sala, equipamento)
- Coordinator/director abre o fluxo manualmente: "registrar demanda operacional"

**Fluxo da skill (3 turnos):**

```
Turno 1 — Captura
  TOM: "Entendi que há um problema operacional. Para registrar direitinho:
        1. Qual unidade? (Barra / Recreio / Campo Grande)
        2. Qual sala ou local?
        3. O que está acontecendo — descreve em uma frase."

Turno 2 — Triagem
  TOM classifica internamente o tipo (incidente / reposição / apoio / obra / preventivo / compra)
  TOM pergunta:
        "Isso está impactando aulas agora? (sim/não)
        Quem deve resolver? (Rafinha / Eduardo / outro)"

Turno 3 — Confirmação + emissão
  TOM confirma: "Vou registrar como [tipo] — prioridade [X].
                 [Se requires_approval=true]: Isso precisa de aprovação antes de executar.
                 Posso criar?"
  Usuário confirma → TOM emite <<TASK_UPDATE>>
```

**Marker emitido:**

Reuso de `<<TASK_UPDATE>>` com `action: "create"`. Campos extras `department_id` e `request_type_id` são passados no objeto da action — o `applyTaskActions` do engine os inclui no insert sem modificação estrutural da função.

```json
<<TASK_UPDATE>>
[{
  "action": "create",
  "title": "Cabo de guitarra ruim — Recreio Sala 2",
  "description": "Professor sinalizou: cabo ruim impactando aulas. Unidade: Recreio. Sala: 2.",
  "assigned_to": "<collab_id_rafinha>",
  "created_by": "<collab_id_solicitante>",
  "due_date": "2026-05-03",
  "priority": "high",
  "context": "work",
  "source": "agent_briefing",
  "department_id": "<uuid_operacoes_tecnicas>",
  "request_type_id": "<uuid_incidente_tecnico>",
  "notes": "Impacta aulas: sim. Urgência percebida: alta."
}]
<</TASK_UPDATE>>
```

**Exemplos input → output:**

| Input do usuário | Output do TOM |
|---|---|
| "o ar do recreio tá falhando" | Pergunta unidade + sala + impacto → cria task tipo incidente-tecnico, priority=high, assigned_to=Rafinha |
| "faltou corda de violão na barra" | Pergunta sala + quantidade → cria task tipo reposicao-estoque, priority=medium |
| "precisa de reforma na sala 1 de campo grande" | Pergunta escopo + urgência → cria task tipo obra-infraestrutura, priority=low, requires_approval=true → task entra com status=awaiting_confirmation |
| "revisão semanal de salas do recreio" | Confirma que é preventivo → cria task tipo preventivo-auditoria, priority=low |

**Integração com `priorizacao-inteligente.md`:** TOM aplica a lógica de urgência real vs urgência percebida antes de definir `priority` — evita que "urgente" informal vire critical sem critério.

---

### 2.5 PWA

**Nova rota:** `/mais/operacoes`
**Nova tela:** `web/src/screens/OperacoesFilaTecnica.tsx`
**Adição em `Mais.tsx`:** item `{ to: '/mais/operacoes', label: 'Operações Técnicas', hint: 'Fila de demandas operacionais', requireRoles: ['coordinator', 'director'] }`

**Padrão seguido:** `Checklists.tsx` para lista com filtros + `EventoDetalhe.tsx` para card de detalhe.

**Wireframe textual — tela `/mais/operacoes`:**

```
┌─────────────────────────────────────────────────────────────┐
│ ← Operações Técnicas                          [+ Nova]     │
├─────────────────────────────────────────────────────────────┤
│ [Unidade ▾]  [Tipo ▾]  [Status ▾]  [Responsável ▾]        │
├─────────────────────────────────────────────────────────────┤
│ 🔴 INCIDENTE   Recreio — Cabo guitarra ruim                 │
│    Sala 2 · Rafinha · Impacta aula · Em execução           │
│    [Ver detalhes →]                                         │
├─────────────────────────────────────────────────────────────┤
│ 🟠 OBRA        Campo Grande — Luz de emergência            │
│    Sala 1 · Aguardando aprovação                           │
│    [Ver detalhes →]                                         │
├─────────────────────────────────────────────────────────────┤
│ 🟡 REPOSIÇÃO   Barra — Falta cadeira sala 3                │
│    Triado · Eduardo                                         │
│    [Ver detalhes →]                                         │
├─────────────────────────────────────────────────────────────┤
│ 🟢 PREVENTIVO  Recreio — Revisão semanal salas             │
│    Pendente · Rafinha                                       │
│    [Ver detalhes →]                                         │
└─────────────────────────────────────────────────────────────┘
```

**Query Supabase (PWA, anon key):**

```ts
supabase
  .from('tasks')
  .select(`
    id, title, description, status, priority, due_date, notes,
    assigned_to:collaborators!tasks_assigned_to_fkey(id, full_name),
    department_id, request_type_id,
    request_type:department_request_types!tasks_request_type_id_fkey(id, label, slug),
    department:departments!tasks_department_id_fkey(id, slug, name)
  `)
  .eq('department_id', departmentId)
  .in('status', ['pending', 'in_progress', 'awaiting_confirmation'])
  .order('priority', { ascending: false })
  .order('due_date', { ascending: true })
```

**Tela de detalhe:** `/mais/operacoes/:taskId` — `OperacaoDetalhe.tsx`

Seguindo o padrão de `EventoDetalhe.tsx`: card com campos estruturados + seção de timeline via `task_comments` (registros cronológicos: criação, classificação, início de execução, closure).

**Tipos TypeScript a adicionar em `types.ts`:**

```ts
export interface Department {
  id: string;
  slug: string;
  name: string;
  is_active: boolean;
  unit_scope_enabled: boolean;
}

export interface DepartmentRequestType {
  id: string;
  department_id: string;
  slug: string;
  label: string;
  default_priority: TaskPriority;
  requires_approval: boolean;
  generates_task: boolean;
  is_active: boolean;
  sort_order: number;
}
```

---

### 2.6 Dispatcher / ritual semanal

**Novo bloco no `run()`: bloco 13 — `checkDepartmentOperational`**

**Quando dispara:** Segunda-feira 07:30 (horário BRT). Envia para o responsável do departamento (Rafinha) um resumo da fila da semana. Não é um ritual pessoal (não usa `user_preferences`) — é um despacho operacional fixo por departamento.

**Por que segunda 07:30 e não sexta 17h (decisão MVP, 2026-05-03):**
- **Timing de ação.** Briefing na segunda → resolve na segunda. Digest na sexta 17h → lê agora, age só segunda (perde 60h).
- **Coerência arquitetural.** Dispatcher já tem janela de briefing matinal pra usuários individuais; briefing departamental no mesmo horário reutiliza padrão existente.
- **Pareamento com `daily_plans`.** Segunda manhã conversa com ciclo de planejamento da semana já existente.
- **Sexta 17h como evolução.** Se uso real mostrar demanda de "fechamento da semana", adicionamos `weeklyOperationalClosing` em fatia futura sem refactor — não é incompatível, só não é MVP.

**Justificativa para bloco no dispatcher (vs. weekly_plans/events):** `weekly_plans` pertence ao planejamento pessoal do colaborador. `events` são calendário escolar. Um ritual operacional de departamento tem cadência própria (pode ser semanal, não acoplada ao planning pessoal do responsável). Seguir o padrão de `dispatchChecklists` — bloco no `run()` com janela de tempo, idempotência via `ritual_logs` — é mais coerente com a arquitetura atual.

**Lógica:**

```
checkDepartmentOperational(now, { dry = false }):
  Se não for segunda-feira BRT entre 07:25 e 07:35 → skip
  Se ritual_logs já tem (ritual_type='dept_operational_briefing',
    reference_date=today, department_slug='operacoes-tecnicas') → skip (idempotente)

  tasks_abertas = SELECT tasks WHERE
    department_id = <operacoes_tecnicas_id>
    AND status IN ('pending', 'in_progress', 'awaiting_confirmation')
    ORDER BY priority DESC, due_date ASC

  responsavel = SELECT collaborator FROM event_team_map
    WHERE sector = 'tecnica' AND unit = 'all'  -- ou: query a departments_assignees futuro

  Montar mensagem resumo:
    "🔧 *Operações Técnicas — Semana de [data]*
    Você tem [N] demandas abertas:
    🔴 [count] incidentes
    🟠 [count] obras/aprovações
    🟡 [count] reposições
    🟢 [count] preventivos
    Acesse o app para detalhar: [link PWA]"

  Se dry=true → log would_dispatch, não envia
  Envia WhatsApp para responsavel.phone
  INSERT ritual_logs (collaborator_id=responsavel.id,
    ritual_type='dept_operational_briefing',
    reference_date=today, status='sent', detail=JSON.stringify(tasks_abertas.map(t=>t.id)))
```

**Nota sobre `responsavel`:** Na Sprint 15 (piloto), o responsável de Operações Técnicas será buscado via `event_team_map` com `sector = 'tecnica'`. Em sprints futuras, quando `department_assignees` existir, a query muda sem alterar a lógica do bloco.

---

### 2.7 Checklist com consequência

**Modelo:** quando um item de checklist é marcado como não-concluído (ou flagged como problema), o sistema verifica se o tipo de checklist tem um `request_type` associado e, se `generates_task = true`, cria automaticamente uma task operacional.

**Implementação:** adição de coluna opcional em `op_checklist_items`:

```sql
ALTER TABLE op_checklist_items
  ADD COLUMN generates_request_type_id uuid
    REFERENCES department_request_types(id) ON DELETE SET NULL;
```

**Lógica no `dispatchChecklists` (ou em novo helper `checkChecklistConsequences`):**

```
Quando op_checklist_item_completions é registrado com done=false (item não feito):
  item = SELECT op_checklist_items WHERE id = item_id
  Se item.generates_request_type_id IS NOT NULL:
    rtype = SELECT department_request_types WHERE id = item.generates_request_type_id
    Se rtype.generates_task = true:
      Verifica se já existe task aberta com
        (request_type_id = rtype.id AND title LIKE '%<item.description>%'
         AND status NOT IN ('done','cancelled') AND created_at > NOW() - INTERVAL '24h')
      Se não existe → INSERT tasks:
        title = "[Auto] " + item.description + " — " + checklist.name
        department_id = rtype.department_id
        request_type_id = rtype.id
        assigned_to = responsavel_do_departamento
        source = 'system'
        priority = rtype.default_priority
        context = 'work'
        due_date = CURRENT_DATE
        notes = "Gerado automaticamente por checklist: " + completion.id
```

**Exemplo concreto:** Checklist "Abertura Escola — Recreio" tem item "Verificar cabos de instrumentos da sala 2". Se o colaborador marca como não-feito e o item tem `generates_request_type_id = <uuid_incidente_tecnico>`, uma task "Incidente técnico — Verificar cabos de instrumentos da sala 2" é criada automaticamente e atribuída ao Rafinha.

**Importante:** Sprint 15 implementa a lógica, mas a **associação de itens a `request_type_id` é configuração** (feita pelo coordinator via PWA ou migration de seed) — nenhum item existente é afetado. Zero regressão.

---

## 3. Decisões de trade-off

### 3.1 Por que `tasks` em vez de nova entidade `operational_requests`

**Vantagens de usar `tasks`:**
- Zero duplicação de infraestrutura: RLS, assignments, priorização, delegação, comentários, reminders, status machine — tudo já existe e funciona.
- TOM já sabe criar tasks via `<<TASK_UPDATE>>` — a skill nova não precisa ensinar um novo marker ao engine.
- O PWA já tem padrões de visualização de tasks por responsável, por status, por prioridade — reaproveitados diretamente.
- `source = 'system'` diferencia tasks geradas por checklist; `department_id` diferencia tasks operacionais. Filtragem simples.
- Manutenção única: qualquer melhoria no pipeline de tasks (novos status, notificações, delegação) beneficia automaticamente as demandas operacionais.

**Desvantagens honestas:**
- `tasks` não tem campo nativo para `reported_by` (diferente de `created_by`), `room/sala`, `evidence_url` (fotos). Por enquanto, `notes` absorve. Se o produto amadurecer, esses campos terão que ser adicionados a `tasks` ou uma entidade filha.
- O conceito de "aprovação de compra" (requires_approval) é simulado pelo status `awaiting_confirmation` — funciona, mas não é um workflow formal de aprovação com histórico de aprovador.
- Tasks têm `context = work | personal`. Demandas operacionais são sempre `work`. Não há problema, mas o modelo não expressa "operacional" como contexto de primeira classe.

### 3.2 Limites desse approach

O que só saberemos com uso real:
- Se a fila operacional vai crescer além de ~50 tasks abertas simultâneas por departamento (paginação e performance de query)
- Se `notes` é suficiente para capturar evidências (fotos) ou se precisamos de `evidence_attachments` (storage links)
- Se o fluxo de aprovação (`awaiting_confirmation`) é suficiente ou se um workflow com múltiplos aprovadores se torna necessário
- Se `task_comments` atende como timeline ou se o histórico operacional precisa de campos estruturados (timestamps de etapas, responsável por etapa)

**Sinais de que uma entidade própria faria sentido:**
- Mais de 3 campos específicos de operações sendo adicionados em `tasks` (sala, evidência, impacto_aula, etc.)
- Necessidade de workflow de aprovação com múltiplos papéis e histórico imutável
- Integração com sistemas externos (ERP, fornecedores) que precisem de endpoint próprio
- 3+ departamentos com tipos e campos radicalmente diferentes entre si

### 3.3 Replicabilidade

**Como generaliza para Marketing, RH, Pedagógico:**

O piloto não tem hardcode de "Rafinha" ou "Operações Técnicas" no código. Toda a lógica é parametrizada por `department_id` e `request_type_id`:

| Camada | Pilot-specific | Genérico |
|---|---|---|
| DB | Seed com `operacoes-tecnicas` e 6 tipos | `departments` e `department_request_types` aceitam qualquer slug/label |
| Engine/TOM | Skill `operacoes-tecnicas.md` ensina os 6 tipos ao TOM | Nova skill por departamento segue o mesmo template |
| PWA | Tela filtra por `department_id` passado por parâmetro | `/mais/operacoes/:deptSlug` no futuro — mesma tela, filtro dinâmico |
| Dispatcher | Bloco 13 busca `operacoes-tecnicas` por slug | Loop por `departments WHERE is_active = true` |
| Checklists | `generates_request_type_id` ligado a tipos de Operações Técnicas | Qualquer tipo de qualquer departamento pode ser associado |

Para ativar Marketing, por exemplo: INSERT em `departments` + INSERTs em `department_request_types` + nova skill `.md` + seed de assignees. Zero mudança em código de engine, PWA core, ou dispatcher.

---

## 4. Plano de implementação passo a passo

### Fatia 1 — Schema + Seed

**Objetivo:** tabelas `departments` e `department_request_types` criadas + seed do piloto + colunas `department_id` / `request_type_id` em `tasks`.

**Tasks:**

1. Migration `departments` — criar tabela com RLS
   - Arquivo: Supabase MCP `execute_sql` (project_id = `cesnbnrynvxvgdhfmaua`)
   - SQL: DDL de `departments` + indexes + policies

2. Migration `department_request_types` — criar tabela com RLS
   - Arquivo: Supabase MCP `execute_sql`
   - SQL: DDL de `department_request_types` + indexes + policies

3. Migration `tasks` — adicionar `department_id` + `request_type_id`
   - Arquivo: Supabase MCP `execute_sql`
   - SQL: 2 `ALTER TABLE` + 2 `CREATE INDEX`

4. Migration `op_checklist_items` — adicionar `generates_request_type_id`
   - Arquivo: Supabase MCP `execute_sql`
   - SQL: 1 `ALTER TABLE`

5. Seed dados piloto
   - Arquivo: Supabase MCP `execute_sql`
   - SQL: INSERT `departments` + INSERT `department_request_types` (6 tipos)

6. Atualizar doc do banco
   - Arquivo: `D:/la-organizer/_remote/docs/03-esquema-banco-dados-la-organizer.md`
   - Adicionar seção nova com as 2 tabelas + colunas em `tasks`

**Validação:** SELECT de `departments` retorna 1 linha. SELECT de `department_request_types` retorna 6 linhas. EXPLAIN de `tasks` mostra novos indexes.

---

### Fatia 2 — TOM Skill + Engine

**Objetivo:** TOM captura e classifica demandas operacionais via WhatsApp; engine persiste corretamente com `department_id` e `request_type_id`.

**Tasks:**

1. Criar skill `skills/operacoes-tecnicas.md`
   - Arquivo: `D:/la-organizer/_remote/skills/operacoes-tecnicas.md`
   - Conteúdo: gatilhos, fluxo de 3 turnos, 6 tipos de demanda com exemplos, instrução de emissão de `<<TASK_UPDATE>>` com campos novos

2. Verificar `applyTaskActions` no engine — garantir que campos `department_id` e `request_type_id` passem no insert
   - Arquivo: `D:/la-organizer/_remote/src/engine.js`
   - Verificar o bloco `a.action === 'create'` — se o spread do objeto `a` for usado no insert, campos extras já passam; se houver whitelist explícita de campos, adicionar os dois

3. Atualizar `TOM-AGENTS.md` e `TOM-SKILLS-CATALOG.md`
   - Arquivos: `D:/la-organizer/_remote/docs/TOM-AGENTS.md`, `D:/la-organizer/_remote/docs/TOM-SKILLS-CATALOG.md`
   - Adicionar entrada da skill `operacoes-tecnicas` com gatilhos e marker

4. Teste manual via WhatsApp: fluxo completo de captura → task criada no banco com `department_id` e `request_type_id` preenchidos

**Validação:** SELECT tasks WHERE department_id IS NOT NULL retorna ao menos 1 registro após teste.

---

### Fatia 3 — PWA tela operacional

**Objetivo:** tela `/mais/operacoes` funcional, com lista filtrada e card de detalhe.

**Tasks:**

1. Adicionar tipos em `types.ts`
   - Arquivo: `D:/la-organizer/_remote/web/src/types.ts`
   - Adicionar interfaces `Department` e `DepartmentRequestType`

2. Criar tela `OperacoesFilaTecnica.tsx`
   - Arquivo: `D:/la-organizer/_remote/web/src/screens/OperacoesFilaTecnica.tsx`
   - Padrão: `Checklists.tsx` (lista + filtros) + badge de `request_type.label` + badge de `priority`
   - Query Supabase com joins em `department_request_types` e `collaborators`
   - Filtros: unidade (via `collaborators.unit` do `assigned_to`), tipo (request_type slug), status, responsável

3. Criar tela `OperacaoDetalhe.tsx`
   - Arquivo: `D:/la-organizer/_remote/web/src/screens/OperacaoDetalhe.tsx`
   - Padrão: `EventoDetalhe.tsx` — header com badge de tipo + campos estruturados + seção timeline via `task_comments`

4. Adicionar rotas em `App.tsx`
   - Arquivo: `D:/la-organizer/_remote/web/src/App.tsx`
   - Adicionar imports + rotas `mais/operacoes` e `mais/operacoes/:taskId` dentro de `requireRoles=['coordinator','director']`

5. Adicionar item em `Mais.tsx`
   - Arquivo: `D:/la-organizer/_remote/web/src/screens/Mais.tsx`
   - Adicionar item `{ to: '/mais/operacoes', label: 'Operações Técnicas', hint: 'Fila de demandas operacionais', requireRoles: ['coordinator', 'director'] }`

**Validação:** Acessar `/mais/operacoes` como coordinator, ver tasks criadas na Fatia 2, filtrar por unidade.

---

### Fatia 4 — Ritual semanal + checklist→task

**Objetivo:** dispatcher envia briefing semanal operacional toda segunda; checklists com itens flagged geram tasks automáticas.

**Tasks:**

1. Implementar `checkDepartmentOperational` no dispatcher
   - Arquivo: `D:/la-organizer/_remote/src/rituals/dispatcher.js`
   - Adicionar função seguindo o padrão de `dispatchChecklists`
   - Adicionar chamada como bloco 13 no `run()`
   - Adicionar diretiva `operacional_semanal` ao CLI force

2. Implementar `checkChecklistConsequences` no dispatcher (ou inline em `dispatchChecklists`)
   - Arquivo: `D:/la-organizer/_remote/src/rituals/dispatcher.js`
   - Verificar após cada `op_checklist_item_completion` com `done=false`: se `generates_request_type_id` presente, criar task
   - Guard de idempotência: não criar task duplicada dentro de 24h para o mesmo item

3. Seed de exemplo: associar 1 item do checklist "Abertura Escola" ao tipo `incidente-tecnico`
   - Arquivo: Supabase MCP `execute_sql`
   - UPDATE `op_checklist_items` SET `generates_request_type_id = <uuid>` WHERE description LIKE '%cabos%'

4. Atualizar `TOM-AGENTS.md` — documentar bloco 13 no dispatcher

**Validação:** Dry-run do dispatcher com `--force=operacional_semanal` retorna `would_dispatch` para Rafinha. Simular checklist item não-concluído → task criada com `department_id` correto.

---

### Fatia 5 — Validação E2E

**Objetivo:** fluxo completo funcionando de ponta a ponta.

**Tasks:**

1. Teste E2E WhatsApp → task → PWA
   - Enviar mensagem de demanda operacional no WhatsApp
   - Verificar task criada no banco com `department_id` e `request_type_id`
   - Verificar que task aparece na fila `/mais/operacoes`
   - Verificar que detalhes do card estão corretos

2. Teste E2E checklist flagged → task automática
   - Completar checklist com 1 item marcado como não-feito
   - Verificar task gerada automaticamente no banco
   - Verificar que task aparece na fila PWA

3. Teste ritual semanal operacional
   - `node src/rituals/dispatcher.js --force=operacional_semanal --phone=<rafinha_phone>`
   - Verificar mensagem WhatsApp com resumo da fila
   - Verificar `ritual_logs` com `ritual_type='dept_operational_briefing'`

4. Teste RLS
   - Verificar que colaborador simples não acessa `/mais/operacoes` (redirect)
   - Verificar que coordinator vê todas as tasks de `operacoes-tecnicas`

5. Atualizar `TOM-AGENTS.md` e `TOM-SKILLS-CATALOG.md` com status Sprint 15 finalizado
6. Atualizar `03-esquema-banco-dados-la-organizer.md` com estado final do schema

---

## 5. Riscos e limites do MVP

### Riscos técnicos

| Risco | Probabilidade | Mitigação |
|---|---|---|
| `applyTaskActions` tem whitelist explícita de campos e `department_id`/`request_type_id` são silenciosamente ignorados no insert | Média | Verificar na Fatia 2 Task 2 antes de qualquer outro trabalho. Se whitelist existir, adicionar os 2 campos. |
| `op_checklist_item_completions` não tem trigger/hook no servidor — `checkChecklistConsequences` precisa ser chamado no fluxo de WhatsApp (engine) em vez do dispatcher | Média | O handler de checklist no engine processa o `<<CHECKLIST_UPDATE>>` — adicionar lógica de consequência ali em vez de no dispatcher se o modelo de dados não permitir detecção via polling. |
| Tasks operacionais têm `context = 'work'` — coordinators as veem, mas `assigned_to = Rafinha` pode criar confusão em briefings pessoais dele | Baixa | `source = 'system'` diferencia; briefing pessoal pode filtrar por source para não poluir. Monitorar. |
| `current_collab_role()` pode não ser disponível sem `set_config` do PWA — tela de fila operacional pode não carregar para coordinator | Baixa | Padrão já estabelecido em Sprint 13: PWA chama `set_config` antes de queries. Documentar no componente. |

### Riscos de produto

| Risco | Probabilidade | Mitigação |
|---|---|---|
| TOM classifica demanda no tipo errado e task vai para a fila errada | Alta | Turno 3 da skill inclui confirmação explícita com tipo exibido. Usuário pode corrigir antes de confirmar. |
| Responsável (Rafinha) não usa a PWA para fechar tasks — fila cresce indefinidamente | Alta | Sprint 15 é piloto de captura + fila. Ritual semanal operacional pressiona o fechamento. Problema de adoção, não arquitetural. |
| `requires_approval = true` para obras não gera workflow formal — task fica em `awaiting_confirmation` sem responsável de aprovação explícito | Média | Para Sprint 15 (piloto), coordinator é implicitamente o aprovador. Sprint futura pode adicionar `approved_by` + notificação direcionada. |
| Checklist com consequência gera tasks duplicadas se item é desmarcado e remarcado | Média | Guard de idempotência de 24h na Fatia 4 resolve para uso normal. Edge case de remarcar no mesmo dia cria no máximo 1 task extra. |

### O que pode quebrar a tese de replicabilidade

- Se cada departamento novo exigir uma skill `.md` completamente diferente, sem template reutilizável: sinal de que a skill precisa ser parametrizada por departamento (1 skill genérica com config de tipos injetada via `department_request_types`)
- Se os tipos de demanda entre departamentos forem tão díspares que `department_request_types` se torna uma tabela de configuração que poucos campos tem em comum: considerar sub-tipos ou campos jsonb de config
- Se a fila operacional de 2+ departamentos for visualizada na mesma tela com lógicas de exibição radicalmente diferentes: a tela precisará ser componentizada por departamento em vez de parametrizada
