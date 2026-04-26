# Esquema de Banco de Dados — LA Organizer

**Documento:** 03  
**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Referência:** Documento de Conceito v2.0 + Mapa de Funcionalidades v2.0  
**Banco:** Supabase PostgreSQL  
**Projeto Supabase:** a definir (novo projeto dedicado)

---

## Visão geral

27 tabelas organizadas em 9 domínios:

| Domínio | Tabelas | Função |
|---|---|---|
| **Pessoas** | collaborators, user_preferences, collaborator_profiles | Quem usa o sistema, como quer usar, e como o TOM os conhece |
| **Projetos** | projects, project_members, project_checkpoints | Roadmap com timeline, marcos e hierarquia dinâmica por projeto |
| **Tarefas** | tasks, task_comments | Execução do dia a dia (pessoal + trabalho) |
| **Rituais** | daily_plans, daily_plan_items, weekly_plans, ritual_logs | Planejamento pessoal e acompanhamento |
| **Checklists Operacionais** | op_checklists, op_checklist_items, op_checklist_completions, op_checklist_item_completions | Rotinas padronizadas por departamento/função |
| **Hábitos Pessoais** | habit_templates, habits, habit_logs | Hábitos e rotinas pessoais (100% privado) |
| **Broadcast** | broadcast_messages, broadcast_responses | Comunicações em massa com follow-up e rastreamento |
| **Emusys** | emusys_classes | Agenda de aulas, presença e conteúdo puxados do Emusys |
| **Sistema** | conversation_history, collaborator_memory, notifications, google_calendar_sync | Motor do TOM, memória evolutiva, alertas e integrações |

---

## Domínio 1: Pessoas

### Tabela: `collaborators`

Todos os usuários do sistema. A hierarquia é definida por `role` e `supervisor_id`.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| full_name | text | sim | — | Nome completo |
| phone | text | sim | — | Número WhatsApp (formato internacional: 5521999999999) |
| email | text | não | null | Email (usado pra Google Calendar OAuth) |
| role | text | sim | 'collaborator' | 'director', 'manager', 'coordinator', 'collaborator' |
| function_title | text | não | null | Cargo descritivo: 'Professor de Piano', 'Assistente Pedagógico', 'Coordenador Pedagógico' |
| unit | text | não | null | 'campo_grande', 'recreio', 'barra', 'all' |
| supervisor_id | uuid | não | null | FK → collaborators (quem é o líder direto) |
| is_active | boolean | sim | true | Se está ativo no sistema |
| onboarding_completed | boolean | sim | false | Se completou o onboarding com o TOM |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** phone (unique), role, supervisor_id, unit, is_active

**Hierarquia RLS:**
```
director (Alf)
  └── manager (gerentes)
       └── coordinator (Juliana, Quintela)
            └── collaborator (professores, assistentes)
```

**Regra de visibilidade:** cada pessoa vê os dados de quem está abaixo dela na árvore de `supervisor_id`. Recursivo — se Alf é supervisor dos coordenadores e os coordenadores são supervisores dos professores, Alf vê todo mundo.

---

### Tabela: `user_preferences`

Preferências configuráveis por colaborador. 1:1 com collaborators.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators (unique) |
| briefing_time | time | sim | '08:00' | Horário do briefing de trabalho |
| personal_briefing_time | time | sim | '07:00' | Horário do briefing pessoal |
| closing_time | time | sim | '19:00' | Horário do fechamento diário |
| planning_day | int | sim | 0 | Dia do planejamento semanal: 0=Domingo, 1=Segunda |
| planning_time | time | sim | '19:00' | Horário do planejamento semanal |
| coaching_intensity | text | sim | 'normal' | 'light', 'normal', 'hard' |
| notify_deadline_alerts | boolean | sim | true | Receber alertas de prazo |
| notify_overdue_alerts | boolean | sim | true | Receber alertas de atraso |
| notify_team_summary | boolean | sim | true | Receber resumo do time (só coordenadores+) |
| google_calendar_connected | boolean | sim | false | Se Google Calendar está integrado |
| google_calendar_token | jsonb | não | null | Token OAuth do Google Calendar (access_token, refresh_token, expiry) |
| google_calendar_id | text | não | null | ID do calendário Google sincronizado |
| timezone | text | sim | 'America/Sao_Paulo' | Fuso horário do colaborador |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** collaborator_id (unique)

---

### Tabela: `collaborator_profiles`

Perfil evolutivo de cada colaborador construído pelo TOM ao longo do tempo (equivalente ao USER.md do OpenClaw, mas multi-pessoa no banco). O TOM monta esse perfil no prompt antes de cada interação pra personalizar a resposta.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators (unique) |
| communication_style | text | não | null | Como a pessoa se comunica: 'direto', 'detalhista', 'informal', 'tímido' |
| response_pattern | text | não | null | Padrões observados: 'responde rápido de manhã', 'ignora à noite', 'prefere áudio' |
| best_coaching_approach | text | não | null | O que funciona melhor: 'cobrança direta', 'incentivo positivo', 'dados e números' |
| strengths | text | não | null | Pontos fortes observados pelo TOM |
| growth_areas | text | não | null | Áreas de desenvolvimento observadas |
| personal_context | text | não | null | Contexto pessoal relevante (tem filhos, mora longe, toca em banda à noite) — 100% privado |
| vocabulary_notes | text | não | null | Palavras/expressões que a pessoa usa e que o TOM deve reconhecer |
| maturity_level | text | sim | 'beginner' | 'beginner', 'developing', 'proficient', 'advanced' — maturidade no uso do sistema |
| total_interactions | int | sim | 0 | Contador de interações totais |
| avg_response_time_min | numeric(6,1) | não | null | Tempo médio de resposta em minutos |
| completion_rate_30d | numeric(5,2) | não | null | Taxa de conclusão dos últimos 30 dias |
| last_profile_update | timestamptz | não | null | Última vez que o TOM atualizou este perfil |
| profile_notes | text | não | null | Notas livres do TOM sobre a pessoa |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** collaborator_id (unique)

**Atualização:** o TOM atualiza este perfil periodicamente (a cada 20 interações ou semanalmente) com base nas observações acumuladas na conversation_history e ritual_logs.

**RLS:** 100% privado — só o próprio colaborador e o sistema (service_role) veem. Coordenador e diretor NUNCA acessam. São as "notas do TOM" sobre a pessoa.

---

### Tabela: `collaborator_memory`

Memória de longo prazo do TOM sobre cada pessoa. Fatos aprendidos, decisões registradas, lições. Equivalente ao MEMORY.md do OpenClaw mas por pessoa no banco.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| memory_type | text | sim | — | 'fact' (fato aprendido), 'decision' (decisão registrada), 'lesson' (lição/padrão), 'preference' (preferência descoberta), 'context' (contexto importante) |
| content | text | sim | — | O conteúdo da memória |
| source | text | sim | 'conversation' | 'conversation', 'ritual', 'observation', 'explicit' (pessoa disse diretamente) |
| importance | text | sim | 'normal' | 'critical', 'high', 'normal', 'low' |
| decay_at | timestamptz | não | null | Quando essa memória pode ser descartada (null = nunca expira) |
| is_active | boolean | sim | true | Se ainda é relevante |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** collaborator_id + memory_type, collaborator_id + is_active, importance

**Busca semântica:** FTS5 no campo content pra buscas por significado. O TOM puxa as memórias mais relevantes antes de cada interação.

**Consolidação:** periodicamente (semanalmente), o TOM revisa conversation_history, extrai fatos novos, e grava em collaborator_memory. Memórias com decay_at expirado são marcadas como is_active = false.

**RLS:** 100% privado — só sistema (service_role). Nem o próprio colaborador vê as memórias do TOM sobre ele.

---

## Domínio 2: Projetos

### Tabela: `projects`

Projetos com campos estruturados pelo 5W2H (sem expor o nome do framework).

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| name | text | sim | — | Nome do projeto (What — O quê) |
| description | text | não | null | Descrição detalhada do projeto |
| justification | text | não | null | Por que é importante (Why — Por quê) |
| location | text | não | null | Onde vai acontecer (Where — Onde) |
| start_date | date | sim | — | Data de início (When — Quando) |
| end_date | date | sim | — | Data de fim prevista (When — Quando) |
| methodology | text | não | null | Como vai ser feito (How — Como) |
| estimated_hours_week | numeric(5,1) | não | null | Horas estimadas por semana (How much — Quanto) |
| category | text | sim | 'operational' | 'pedagogical', 'commercial', 'administrative', 'operational', 'event', 'infrastructure' |
| status | text | sim | 'planning' | 'planning', 'active', 'paused', 'completed', 'cancelled' |
| progress_percent | int | sim | 0 | Progresso 0–100 (calculado automaticamente pelos checkpoints) |
| color | text | sim | '#3B82F6' | Cor da barra no roadmap visual |
| created_by | uuid | sim | — | FK → collaborators (quem criou) |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** status, category, start_date, end_date, created_by

### Tabela: `project_members`

Relação N:N entre projetos e colaboradores envolvidos.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| project_id | uuid | sim | — | FK → projects |
| collaborator_id | uuid | sim | — | FK → collaborators |
| role_in_project | text | sim | 'member' | 'owner' (criou o projeto), 'leader' (lidera frente/equipe dentro do projeto), 'member' (executa tarefas) |
| created_at | timestamptz | sim | now() | |

**Unique constraint:** project_id + collaborator_id

---

### Tabela: `project_checkpoints`

Marcos dentro de um projeto. São os pontos de controle do roadmap.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| project_id | uuid | sim | — | FK → projects |
| name | text | sim | — | Nome do checkpoint (ex: "Roteiros prontos") |
| description | text | não | null | Descrição detalhada |
| due_date | date | sim | — | Data limite |
| assigned_to | uuid | não | null | FK → collaborators (responsável principal) |
| status | text | sim | 'pending' | 'pending', 'in_progress', 'done', 'overdue' |
| sort_order | int | sim | 0 | Ordem no projeto |
| completed_at | timestamptz | não | null | Quando foi concluído |
| completed_by | uuid | não | null | FK → collaborators |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** project_id, assigned_to, status, due_date

**Trigger:** quando `now()::date > due_date` e status IN ('pending', 'in_progress') → status = 'overdue'

**Cálculo de progresso do projeto:**
```sql
progress_percent = (checkpoints com status 'done' / total de checkpoints) × 100
```
Atualizado via trigger em project_checkpoints após INSERT/UPDATE de status.

---

## Domínio 3: Tarefas

### Tabela: `tasks`

Tarefas concretas do dia a dia. Podem estar vinculadas a um checkpoint ou ser avulsas.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| title | text | sim | — | Título da tarefa |
| description | text | não | null | Descrição detalhada |
| assigned_to | uuid | sim | — | FK → collaborators (responsável) |
| project_id | uuid | não | null | FK → projects (se vinculada a projeto) |
| checkpoint_id | uuid | não | null | FK → project_checkpoints (se vinculada a checkpoint) |
| category | text | sim | 'operational' | 'pedagogical', 'commercial', 'administrative', 'financial', 'operational' |
| context | text | sim | 'work' | 'work', 'personal' — pessoal é 100% privado (RLS bloqueia pra coordenador/diretor) |
| priority | text | sim | 'medium' | 'critical', 'high', 'medium', 'low' |
| eisenhower_quadrant | int | não | null | Calculado automaticamente: 1=fazer, 2=agendar, 3=delegar, 4=eliminar |
| status | text | sim | 'pending' | 'pending', 'in_progress', 'done', 'overdue', 'delegated', 'cancelled' |
| due_date | date | sim | — | Prazo |
| scheduled_date | date | não | null | Dia planejado para execução (pode ser diferente do prazo) |
| delegated_to | uuid | não | null | FK → collaborators (se foi delegada pra outra pessoa) |
| delegated_at | timestamptz | não | null | Quando foi delegada |
| source | text | sim | 'manual' | 'manual', 'agent_briefing', 'agent_closing', 'checkpoint_decomposition', 'coordinator_assignment', 'system' |
| completed_at | timestamptz | não | null | Quando foi concluída |
| completed_by | uuid | não | null | FK → collaborators |
| created_by | uuid | sim | — | FK → collaborators |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** assigned_to + status, assigned_to + due_date, assigned_to + scheduled_date, project_id, checkpoint_id, eisenhower_quadrant

**Trigger de overdue:** quando `now()::date > due_date` e status IN ('pending', 'in_progress') → status = 'overdue'

**Cálculo automático do Eisenhower (via function):**

```sql
-- Executado ao criar/atualizar tarefa
eisenhower_quadrant = CASE
  -- Urgente + Importante (prazo ≤ 2 dias E vinculada a projeto OU prioridade critical/high)
  WHEN (due_date - now()::date <= 2 OR status = 'overdue')
       AND (project_id IS NOT NULL OR priority IN ('critical', 'high'))
  THEN 1

  -- Não urgente + Importante (prazo > 2 dias E vinculada a projeto OU prioridade critical/high)
  WHEN (due_date - now()::date > 2)
       AND (project_id IS NOT NULL OR priority IN ('critical', 'high'))
  THEN 2

  -- Urgente + Não importante (prazo ≤ 2 dias E não vinculada a projeto E prioridade medium/low)
  WHEN (due_date - now()::date <= 2 OR status = 'overdue')
       AND (project_id IS NULL AND priority IN ('medium', 'low'))
  THEN 3

  -- Não urgente + Não importante
  ELSE 4
END
```

---

### Tabela: `task_comments`

Comentários e atualizações em tarefas (incluindo registros automáticos do TOM).

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| task_id | uuid | sim | — | FK → tasks |
| content | text | sim | — | Texto do comentário |
| comment_type | text | sim | 'manual' | 'manual', 'agent_note', 'status_change', 'delegation', 'deadline_extension' |
| created_by | uuid | sim | — | FK → collaborators (ou null se do sistema) |
| created_at | timestamptz | sim | now() | |

**Índices:** task_id, created_at

---

## Domínio 4: Rituais

### Tabela: `weekly_plans`

Planejamento semanal de cada colaborador. Criado no ritual de domingo (ou segunda).

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| week_start | date | sim | — | Data da segunda-feira da semana (referência) |
| goals | text[] | não | '{}' | Até 5 entregas da semana (texto livre) |
| status | text | sim | 'active' | 'active', 'completed', 'skipped' |
| tasks_planned | int | sim | 0 | Total de tarefas planejadas na semana |
| tasks_completed | int | sim | 0 | Total de tarefas concluídas na semana |
| completion_rate | numeric(5,2) | sim | 0 | Taxa de conclusão (%) — calculado |
| retrospective_notes | text | não | null | Notas da retrospectiva de domingo |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Unique constraint:** collaborator_id + week_start

**Índices:** collaborator_id, week_start

---

### Tabela: `daily_plans`

Plano do dia de cada colaborador. Criado pelo briefing das 8h.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| plan_date | date | sim | — | Data do dia |
| weekly_plan_id | uuid | não | null | FK → weekly_plans (vinculação com a semana) |
| status | text | sim | 'active' | 'active', 'closed' |
| items_planned | int | sim | 0 | Total de itens planejados |
| items_completed | int | sim | 0 | Total concluídos |
| completion_rate | numeric(5,2) | sim | 0 | Taxa de conclusão do dia (%) |
| new_demands | text | não | null | Demandas novas que surgiram (registrado no fechamento) |
| closing_notes | text | não | null | Notas do fechamento |
| closed_at | timestamptz | não | null | Quando o fechamento foi feito |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Unique constraint:** collaborator_id + plan_date

**Índices:** collaborator_id + plan_date, status

---

### Tabela: `daily_plan_items`

As "3 coisas do dia" — link entre o plano diário e as tarefas.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| daily_plan_id | uuid | sim | — | FK → daily_plans |
| task_id | uuid | não | null | FK → tasks (se vinculado a tarefa existente) |
| description | text | sim | — | Descrição do item (pode ser tarefa avulsa sem task_id) |
| sort_order | int | sim | 0 | Ordem de prioridade (1 = pior primeiro) |
| is_completed | boolean | sim | false | Se foi concluído |
| completed_at | timestamptz | não | null | Quando foi concluído |
| rescheduled_to | date | não | null | Se não foi feito, pra qual dia foi reagendado |
| created_at | timestamptz | sim | now() | |

**Índices:** daily_plan_id, task_id

---

### Tabela: `ritual_logs`

Registro de cada ritual executado (ou não). Serve pra medir aderência.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| ritual_type | text | sim | — | 'weekly_planning', 'daily_briefing', 'daily_closing', 'team_summary', 'weekly_retrospective' |
| reference_date | date | sim | — | Data de referência |
| status | text | sim | 'sent' | 'sent', 'responded', 'ignored', 'partial' |
| sent_at | timestamptz | sim | now() | Quando foi enviado |
| responded_at | timestamptz | não | null | Quando o colaborador respondeu |
| response_time_minutes | int | não | null | Tempo de resposta em minutos |
| created_at | timestamptz | sim | now() | |

**Unique constraint:** collaborator_id + ritual_type + reference_date

**Índices:** collaborator_id + reference_date, ritual_type, status

---

## Domínio 5: Checklists Operacionais

### Tabela: `op_checklists`

Templates de checklists operacionais por função/departamento. Configurados pelo coordenador ou diretor.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| name | text | sim | — | Nome do checklist (ex: "Abertura da Escola", "Fiscalização de Salas") |
| function_role | text | sim | — | 'secretary_morning', 'secretary_evening', 'pedagogical_assistant', 'coordinator', 'teacher', 'cleaning' |
| checklist_type | text | sim | 'daily' | 'daily', 'weekly' |
| shift | text | não | null | 'morning', 'afternoon', 'evening', 'full' (se daily) |
| unit | text | não | 'all' | 'campo_grande', 'recreio', 'barra', 'all' |
| is_active | boolean | sim | true | Se está ativo |
| created_by | uuid | sim | — | FK → collaborators |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** function_role, checklist_type, unit, is_active

---

### Tabela: `op_checklist_items`

Itens de cada template de checklist.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| checklist_id | uuid | sim | — | FK → op_checklists |
| description | text | sim | — | Texto do item (ex: "Ligar ar-condicionado e luzes") |
| sort_order | int | sim | 0 | Ordem de exibição |
| created_at | timestamptz | sim | now() | |

**Índices:** checklist_id

---

### Tabela: `op_checklist_completions`

Registro de cada preenchimento de checklist (um por dia/pessoa).

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| checklist_id | uuid | sim | — | FK → op_checklists |
| collaborator_id | uuid | sim | — | FK → collaborators |
| reference_date | date | sim | — | Data de referência |
| started_at | timestamptz | não | null | Quando começou a preencher |
| completed_at | timestamptz | não | null | Quando finalizou (todos os itens marcados) |
| channel | text | sim | 'pwa' | 'pwa', 'whatsapp' (de onde preencheu) |
| created_at | timestamptz | sim | now() | |

**Unique constraint:** checklist_id + collaborator_id + reference_date

**Índices:** collaborator_id + reference_date, checklist_id

---

### Tabela: `op_checklist_item_completions`

Itens marcados em cada preenchimento.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| completion_id | uuid | sim | — | FK → op_checklist_completions |
| item_id | uuid | sim | — | FK → op_checklist_items |
| is_checked | boolean | sim | false | Marcado ou não |
| checked_at | timestamptz | não | null | Quando foi marcado |
| notes | text | não | null | Observação (ex: "Ar da sala 3 não tá funcionando") |

**Unique constraint:** completion_id + item_id

**Cálculo de aderência:**
```sql
aderência_diária = checklists_preenchidos_completos / checklists_esperados × 100
-- Preenchimento parcial (completed_at IS NULL) NÃO conta como aderência
```

---

## Domínio 6: Hábitos Pessoais

### Tabela: `habit_templates`

Templates prontos de hábitos que o colaborador pode ativar. Pré-configurados pelo sistema.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| name | text | sim | — | Nome do hábito (ex: "Academia", "Leitura diária") |
| description | text | não | null | Descrição motivacional |
| icon | text | sim | '📌' | Emoji ícone |
| color | text | sim | '#3B82F6' | Cor do hábito no app |
| default_frequency | text | sim | 'daily' | 'daily', 'weekdays', 'weekly', 'custom' |
| default_reminder_time | time | não | null | Horário sugerido do lembrete |
| category | text | sim | 'health' | 'health', 'learning', 'finance', 'mindset', 'social', 'other' |
| is_system | boolean | sim | true | Se é template do sistema (não pode deletar) |
| created_at | timestamptz | sim | now() | |

**Seed data (templates iniciais):**

| Nome | Categoria | Ícone | Frequência | Horário |
|---|---|---|---|---|
| Academia / Exercício | health | 💪 | weekdays | 06:00 |
| Leitura (30 min) | learning | 📚 | daily | 21:00 |
| Meditação / Oração | mindset | 🧘 | daily | 06:30 |
| Afirmações positivas | mindset | ✨ | daily | 07:00 |
| Beber 2L de água | health | 💧 | daily | — |
| Contas a pagar | finance | 💰 | weekly | 09:00 |
| Tomar vitaminas | health | 💊 | daily | 07:00 |
| Praticar instrumento | learning | 🎸 | daily | — |
| Caminhar 30 min | health | 🚶 | weekdays | — |
| Diário / Journaling | mindset | ✍️ | daily | 22:00 |

---

### Tabela: `habits`

Hábitos ativos de cada colaborador. 100% privado — RLS bloqueia pra todo mundo exceto o próprio.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| template_id | uuid | não | null | FK → habit_templates (null se criado do zero) |
| name | text | sim | — | Nome do hábito |
| icon | text | sim | '📌' | Emoji ícone |
| color | text | sim | '#3B82F6' | Cor |
| frequency | text | sim | 'daily' | 'daily', 'weekdays', 'weekly', 'custom' |
| custom_days | int[] | não | null | Dias da semana se frequency='custom' (1=Seg a 7=Dom) |
| reminder_time | time | não | null | Horário do lembrete |
| notify_whatsapp | boolean | sim | true | Se envia lembrete via WhatsApp |
| is_active | boolean | sim | true | Se está ativo |
| current_streak | int | sim | 0 | Dias consecutivos completados |
| best_streak | int | sim | 0 | Melhor streak já alcançado |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** collaborator_id + is_active

---

### Tabela: `habit_logs`

Registro diário de conclusão de hábitos.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| habit_id | uuid | sim | — | FK → habits |
| collaborator_id | uuid | sim | — | FK → collaborators |
| log_date | date | sim | — | Data |
| is_completed | boolean | sim | false | Se completou nesse dia |
| completed_at | timestamptz | não | null | Quando completou |
| notes | text | não | null | Observação opcional |
| created_at | timestamptz | sim | now() | |

**Unique constraint:** habit_id + log_date

**Cálculo de streak:** trigger em habit_logs → ao marcar is_completed=true, incrementa current_streak do habit. Se log_date anterior não tem registro, reseta streak pra 1.

---

## Domínio 7: Broadcast

### Tabela: `broadcast_messages`

Mensagens de broadcast enviadas por coordenadores/líderes via TOM.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| sent_by | uuid | sim | — | FK → collaborators (quem pediu o broadcast) |
| target_group | text | sim | — | 'all', 'coordinators', 'teachers', 'assistants', 'unit_campo_grande', etc. |
| target_ids | uuid[] | sim | — | Array de collaborator_ids que receberam (resolvido pelo TOM no momento do envio) |
| message_content | text | sim | — | Conteúdo da mensagem enviada |
| requires_confirmation | boolean | sim | false | Se precisa de confirmação dos destinatários |
| follow_up_interval_min | int | não | 60 | Intervalo de cobrança em minutos (default: 1h) |
| timeout_hours | int | não | 24 | Após quanto tempo parar de cobrar e gerar relatório |
| status | text | sim | 'active' | 'active', 'completed', 'cancelled' |
| report_sent | boolean | sim | false | Se o relatório final foi enviado ao remetente |
| report_sent_at | timestamptz | não | null | Quando o relatório foi enviado |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Índices:** sent_by, status, created_at

---

### Tabela: `broadcast_responses`

Respostas individuais de cada destinatário a um broadcast.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| broadcast_id | uuid | sim | — | FK → broadcast_messages |
| collaborator_id | uuid | sim | — | FK → collaborators (destinatário) |
| status | text | sim | 'pending' | 'pending', 'confirmed', 'declined', 'no_response' |
| response_text | text | não | null | Texto da resposta (se houver) |
| reminders_sent | int | sim | 0 | Quantas cobranças foram enviadas |
| last_reminder_at | timestamptz | não | null | Quando foi a última cobrança |
| responded_at | timestamptz | não | null | Quando respondeu |
| created_at | timestamptz | sim | now() | |

**Unique constraint:** broadcast_id + collaborator_id

**Índices:** broadcast_id + status, collaborator_id

**Cron de follow-up:** a cada 15 min, verifica broadcasts ativos com requires_confirmation=true. Pra cada destinatário com status='pending', verifica se já passou follow_up_interval_min desde last_reminder_at. Se sim, envia novo lembrete. Se timeout_hours expirou, marca como 'no_response' e gera relatório pro remetente.

---

## Domínio 8: Emusys

### Tabela: `emusys_classes`

Agenda de aulas puxada do endpoint do Emusys. Atualizada periodicamente via cron.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators (professor) |
| emusys_class_id | text | sim | — | ID da aula no Emusys (pra evitar duplicação) |
| student_name | text | sim | — | Nome do aluno |
| class_date | date | sim | — | Data da aula |
| class_time | time | sim | — | Horário da aula |
| class_end_time | time | não | null | Horário de término |
| unit | text | sim | — | 'campo_grande', 'recreio', 'barra' |
| attendance_registered | boolean | sim | false | Se a presença foi lançada no Emusys |
| content_registered | boolean | sim | false | Se o conteúdo foi registrado no Emusys |
| reminder_sent | boolean | sim | false | Se o lembrete pós-aula foi enviado |
| reminder_sent_at | timestamptz | não | null | Quando o lembrete foi enviado |
| last_synced_at | timestamptz | sim | now() | Última sincronização com Emusys |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Unique constraint:** emusys_class_id

**Índices:** collaborator_id + class_date, attendance_registered, content_registered, reminder_sent

**Cron de sincronização:**
- A cada 30 min: puxa agenda do dia do Emusys, atualiza attendance_registered e content_registered
- Após cada aula (class_end_time + 10 min): se attendance_registered = false, dispara lembrete via WhatsApp

---

## Domínio 9: Sistema

### Tabela: `conversation_history`

Histórico de conversas com o TOM WhatsApp. Usado para contexto do modelo.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| direction | text | sim | — | 'inbound' (colaborador → TOM), 'outbound' (TOM → colaborador) |
| message_type | text | sim | 'text' | 'text', 'audio', 'image' |
| content | text | sim | — | Conteúdo da mensagem (texto ou transcrição de áudio) |
| context | text | não | null | Contexto do momento: 'briefing', 'closing', 'planning', 'project_creation', 'free_chat' |
| whatsapp_message_id | text | não | null | ID da mensagem no WhatsApp (UAZAPI) |
| created_at | timestamptz | sim | now() | |

**Índices:** collaborator_id + created_at DESC, context

**Retenção:** manter últimas 500 mensagens por colaborador. Mensagens mais antigas são arquivadas ou deletadas via cron mensal.

---

### Tabela: `notifications`

Fila de notificações a serem enviadas ou já enviadas.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators (destinatário) |
| notification_type | text | sim | — | 'deadline_alert', 'overdue_alert', 'deadline_extension_request', 'team_inactivity', 'project_at_risk', 'checkpoint_reminder', 'delegation_notice' |
| title | text | sim | — | Título curto |
| body | text | sim | — | Corpo da mensagem |
| reference_type | text | não | null | 'task', 'project', 'checkpoint', 'collaborator' |
| reference_id | uuid | não | null | ID da entidade referenciada |
| channel | text | sim | 'whatsapp' | 'whatsapp', 'pwa_push', 'both' |
| status | text | sim | 'pending' | 'pending', 'sent', 'delivered', 'read', 'failed' |
| sent_at | timestamptz | não | null | Quando foi enviado |
| read_at | timestamptz | não | null | Quando foi lido |
| created_at | timestamptz | sim | now() | |

**Índices:** collaborator_id + status, notification_type, status, created_at

---

### Tabela: `google_calendar_sync`

Controle de sincronização de itens com o Google Calendar.

| Campo | Tipo | Obrigatório | Default | Descrição |
|---|---|---|---|---|
| id | uuid | sim | gen_random_uuid() | PK |
| collaborator_id | uuid | sim | — | FK → collaborators |
| source_type | text | sim | — | 'task', 'checkpoint', 'meeting' |
| source_id | uuid | sim | — | ID da tarefa, checkpoint ou reunião |
| google_event_id | text | sim | — | ID do evento no Google Calendar |
| last_synced_at | timestamptz | sim | now() | Última sincronização |
| sync_status | text | sim | 'synced' | 'synced', 'pending', 'error' |
| created_at | timestamptz | sim | now() | |
| updated_at | timestamptz | sim | now() | |

**Unique constraint:** collaborator_id + source_type + source_id

**Índices:** collaborator_id, source_type + source_id, sync_status

---

## Políticas de RLS

### Regra geral de hierarquia

Função auxiliar para resolver a árvore de supervisão:

```sql
CREATE OR REPLACE FUNCTION get_supervised_ids(user_id uuid)
RETURNS uuid[] AS $$
  WITH RECURSIVE tree AS (
    SELECT id FROM collaborators WHERE supervisor_id = user_id
    UNION ALL
    SELECT c.id FROM collaborators c
    INNER JOIN tree t ON c.supervisor_id = t.id
  )
  SELECT array_agg(id) FROM tree;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### Políticas por tabela

| Tabela | Colaborador | Coordenador | Diretor |
|---|---|---|---|
| collaborators | Vê só o próprio perfil | Vê supervisionados + próprio | Vê todos |
| user_preferences | Vê/edita só o próprio | Vê supervisionados, edita só o próprio | Vê todos, edita só o próprio |
| projects | Vê projetos em que é member | Vê todos os projetos | Vê todos |
| project_checkpoints | Vê checkpoints dos seus projetos | Vê todos | Vê todos |
| project_members | Vê memberships dos seus projetos | Vê todas | Vê todas |
| tasks | Vê só as atribuídas a ele (assigned_to). Pessoal (context='personal'): só o próprio, SEMPRE | Vê tasks de trabalho de supervisionados + próprias. NUNCA vê pessoal de outros | Vê tasks de trabalho de todos. NUNCA vê pessoal de outros |
| task_comments | Vê comentários das suas tasks | Vê comentários de tasks de trabalho visíveis | Vê de trabalho. Nunca pessoal |
| daily_plans | Vê só os próprios | Vê de supervisionados + próprios | Vê todos |
| daily_plan_items | Vê só os próprios | Vê de supervisionados + próprios | Vê todos |
| weekly_plans | Vê só os próprios | Vê de supervisionados + próprios | Vê todos |
| ritual_logs | Vê só os próprios | Vê de supervisionados + próprios | Vê todos |
| op_checklists | Vê checklists da sua função | Vê todos + cria/edita | Vê todos + cria/edita |
| op_checklist_items | Vê itens da sua função | Vê todos | Vê todos |
| op_checklist_completions | Vê só os próprios | Vê de supervisionados + próprios | Vê todos |
| op_checklist_item_completions | Vê só os próprios | Vê de supervisionados + próprios | Vê todos |
| emusys_classes | Vê só as próprias aulas | Vê aulas de supervisionados + próprias | Vê todas |
| habit_templates | Vê todos (são templates globais) | Vê todos | Vê todos + cria novos |
| habits | Vê só os próprios — 100% privado | Nunca vê de outros | Nunca vê de outros |
| habit_logs | Vê só os próprios — 100% privado | Nunca vê de outros | Nunca vê de outros |
| conversation_history | Vê só as próprias | Não vê conversas de outros (privacidade) | Não vê conversas (só métricas agregadas) |
| notifications | Vê só as próprias | Vê só as próprias | Vê só as próprias |
| google_calendar_sync | Vê só os próprios | Vê só os próprios | Vê só os próprios |

**Nota sobre privacidade:** conversas com o TOM são privadas. Coordenadores e diretor veem métricas (taxa de resposta, tempo de resposta) mas NÃO o conteúdo das conversas.

---

## Diagrama de relações

```
collaborators (1) ──── (1) user_preferences
      │
      ├──── (N) projects ──── (N) project_checkpoints
      │           │                      │
      │           └── (N) project_members │
      │                                   │
      ├──── (N) tasks ────────────────────┘
      │           │
      │           └── (N) task_comments
      │
      ├──── (N) weekly_plans
      │           │
      │           └── (N) daily_plans
      │                      │
      │                      └── (N) daily_plan_items ── (0..1) tasks
      │
      ├──── (N) ritual_logs
      │
      ├──── (N) op_checklist_completions ── (N) op_checklist_item_completions
      │           │
      │           └── FK → op_checklists ── (N) op_checklist_items
      │
      ├──── (N) emusys_classes
      │
      ├──── (N) conversation_history
      ├──── (N) notifications
      └──── (N) google_calendar_sync
```

---

## Triggers e functions automáticas

| Trigger | Tabela | Evento | Ação |
|---|---|---|---|
| mark_overdue_tasks | tasks | Cron diário 6h | Marca status = 'overdue' onde due_date < hoje e status IN ('pending', 'in_progress') |
| mark_overdue_checkpoints | project_checkpoints | Cron diário 6h | Marca status = 'overdue' onde due_date < hoje e status IN ('pending', 'in_progress') |
| calculate_eisenhower | tasks | INSERT/UPDATE | Recalcula eisenhower_quadrant baseado em prazo, prioridade e vínculo com projeto |
| update_project_progress | project_checkpoints | UPDATE de status | Recalcula progress_percent do projeto pai |
| update_daily_completion | daily_plan_items | UPDATE de is_completed | Recalcula items_completed e completion_rate do daily_plan pai |
| update_weekly_completion | tasks | UPDATE de status | Recalcula tasks_completed e completion_rate do weekly_plan da semana |
| auto_updated_at | todas | UPDATE | Atualiza campo updated_at automaticamente |

---

## Crons programados (pg_cron)

| Cron | Frequência | Function | Descrição |
|---|---|---|---|
| dispatch_rituals | A cada 15 min | fn_dispatch_rituals() | Consulta user_preferences, identifica quem está no horário, dispara Edge Function via pg_net |
| mark_overdue | Diário 6h | fn_mark_overdue() | Marca tasks e checkpoints atrasados |
| send_deadline_alerts | Diário 7h | fn_send_deadline_alerts() | Cria notifications para tarefas vencendo hoje/amanhã |
| sync_google_calendar | A cada 15 min | fn_sync_google_calendar() | Sincroniza itens pendentes com Google Calendar |
| sync_emusys_classes | A cada 30 min | fn_sync_emusys_classes() | Puxa agenda do Emusys, atualiza status de presença e conteúdo |
| check_emusys_pending | A cada 15 min | fn_check_emusys_pending() | Verifica aulas finalizadas sem presença/conteúdo → dispara lembrete WhatsApp |
| dispatch_op_checklists | A cada 15 min | fn_dispatch_op_checklists() | Envia checklists operacionais no início do turno configurado |
| check_op_checklists_pending | Diário 20h | fn_check_op_checklists_pending() | Verifica checklists não preenchidos no dia → alerta ao colaborador |
| calculate_op_adherence | Semanal sexta 18h | fn_calculate_op_adherence() | Calcula aderência semanal de checklists operacionais por função/pessoa |
| cleanup_conversations | Mensal | fn_cleanup_conversations() | Arquiva conversas com mais de 500 mensagens por colaborador |
| calculate_weekly_metrics | Domingo 23h | fn_calculate_weekly_metrics() | Consolida métricas semanais de todos os colaboradores |
| follow_up_broadcasts | A cada 15 min | fn_follow_up_broadcasts() | Verifica broadcasts ativos, envia cobranças, gera relatório após timeout |
| consolidate_memory | Semanal domingo 22h | fn_consolidate_memory() | Revisa conversation_history, extrai fatos, atualiza collaborator_memory e collaborator_profiles |

---

## Dados iniciais (seed)

### Collaborators (time inicial)

```sql
-- Diretor
INSERT INTO collaborators (full_name, phone, role, function_title, unit)
VALUES ('Luciano Alf', '5521XXXXXXXXX', 'director', 'CEO / Fundador', 'all');

-- Coordenadores
INSERT INTO collaborators (full_name, phone, role, function_title, unit, supervisor_id)
VALUES 
  ('Juliana Baltazar', '5521XXXXXXXXX', 'coordinator', 'Coordenadora Pedagógica', 'all', (SELECT id FROM collaborators WHERE full_name = 'Luciano Alf')),
  ('Marcos Quintela', '5521XXXXXXXXX', 'coordinator', 'Coordenador Pedagógico', 'all', (SELECT id FROM collaborators WHERE full_name = 'Luciano Alf'));

-- Exemplo: professor
INSERT INTO collaborators (full_name, phone, role, function_title, unit, supervisor_id)
VALUES ('Jordan', '5521XXXXXXXXX', 'collaborator', 'Assistente Pedagógico', 'campo_grande', (SELECT id FROM collaborators WHERE full_name = 'Juliana Baltazar'));
```

### User preferences (defaults criados automaticamente)

```sql
-- Trigger: ao inserir collaborator, cria user_preferences com defaults
CREATE OR REPLACE FUNCTION fn_create_default_preferences()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_preferences (collaborator_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_create_preferences
AFTER INSERT ON collaborators
FOR EACH ROW EXECUTE FUNCTION fn_create_default_preferences();
```

---

## Estimativa de volume

| Tabela | Registros/mês (40 colaboradores) | Crescimento |
|---|---|---|
| collaborators | 40 (estável) | Baixo |
| user_preferences | 40 (estável) | Baixo |
| projects | 5-10 novos | Baixo |
| project_checkpoints | 20-50 novos | Baixo |
| project_members | 30-60 | Baixo |
| tasks | 400-800 | Médio |
| task_comments | 200-400 | Médio |
| daily_plans | 800 (40 × 20 dias úteis) | Linear |
| daily_plan_items | 2.400 (800 × 3 itens) | Linear |
| weekly_plans | 160 (40 × 4 semanas) | Linear |
| ritual_logs | 3.200 (40 × 80 rituais/mês) | Linear |
| op_checklists | 10-20 templates (estável) | Baixo |
| op_checklist_items | 60-120 itens (estável) | Baixo |
| op_checklist_completions | 600-800 (30 funções × 20 dias) | Linear |
| op_checklist_item_completions | 3.000-5.000 | Linear |
| emusys_classes | 2.000-4.000 (dependendo de professores e alunos) | Linear |
| conversation_history | 4.000-8.000 | Alto (com retenção) |
| notifications | 1.000-2.000 | Médio |
| google_calendar_sync | 500-1.000 | Médio |

**Conclusão:** volume baixo pra PostgreSQL. Sem necessidade de particionamento ou otimizações especiais. A tabela de maior volume (conversation_history) tem política de retenção de 500 mensagens por colaborador.

---

**Próximo passo:** Documento 04 — Fluxos conversacionais do TOM.
