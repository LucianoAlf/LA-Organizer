# 03 — Esquema do Banco de Dados — LA Organizer

> **Fonte de verdade:** Supabase Postgres, schema `public`.
> **Última revisão:** 2026-05-03 (atualizado Sprint 15)
> **Tabelas base:** 38 | **Views:** 1 (`v_recent_events`)

---

## 1. Visão Geral

O banco suporta duas superfícies: **TOM** (agente LLM via WhatsApp) e **PWA** (interface React). O acesso é feito via Supabase client com **service role** no engine (bypass RLS) e com **anon/authenticated key + set_config** no PWA (respeita RLS).

### Áreas funcionais

```
┌─────────────────────────────────────────────────────────────┐
│  CORE                                                       │
│  collaborators · user_preferences · collaborator_profiles   │
│  collaborator_memory · conversation_history · auth_magic_codes │
│  marker_logs · tom_metrics · ritual_logs                    │
├─────────────────────────────────────────────────────────────┤
│  TASKS & PROJETOS                                           │
│  tasks · projects · project_checkpoints · project_members   │
│  task_comments · task_reminders · notifications             │
│  daily_plans · daily_plan_items · weekly_plans              │
├─────────────────────────────────────────────────────────────┤
│  EVENTOS                                                    │
│  events (calendário pessoal) · school_events · event_team_map │
│  google_calendar_sync · emusys_classes                      │
├─────────────────────────────────────────────────────────────┤
│  COMUNICAÇÃO                                                │
│  announcements · announcement_jobs                          │
│  broadcast_messages · broadcast_responses                   │
├─────────────────────────────────────────────────────────────┤
│  HÁBITOS & CHECKLISTS                                       │
│  habits · habit_logs · habit_templates                      │
│  op_checklists · op_checklist_items                         │
│  op_checklist_completions · op_checklist_item_completions   │
│  op_checklists_audit                                        │
├─────────────────────────────────────────────────────────────┤
│  OPERAÇÕES (novo Sprint 15)                                 │
│  departments · department_request_types                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Tabelas Core

### `collaborators`
Cadastro central de todos os usuários do sistema. Identificados no WhatsApp pelo `phone`.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| full_name | text | NO | — | |
| phone | text | NO | — | Identificador WhatsApp |
| email | text | YES | — | |
| role | text | NO | 'collaborator' | CHECK ∈ {director, manager, coordinator, collaborator} |
| function_title | text | YES | — | Cargo descritivo |
| unit | text | YES | — | CHECK ∈ {campo_grande, recreio, barra, all} ou NULL |
| supervisor_id | uuid | YES | — | FK → collaborators(id) (autorreferência) |
| is_active | boolean | NO | true | |
| onboarding_completed | boolean | NO | false | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- role CHECK: director, manager, coordinator, collaborator
- unit CHECK: campo_grande, recreio, barra, all, ou NULL

**Relacionamentos:**
- supervisor_id → collaborators(id)

**RLS:**
- `Service role full access`: ALL (true)
- `auth_read_collaborators`: SELECT — próprio email (via JWT) OU role ∈ {coordinator, director}

---

### `user_preferences`
Preferências de ritmo e notificação por colaborador. Uma linha por colaborador (UNIQUE).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE, UNIQUE |
| briefing_time | time | NO | '08:00' | Hora do briefing de trabalho |
| personal_briefing_time | time | NO | '07:00' | Hora do briefing pessoal |
| closing_time | time | NO | '19:00' | Hora do fechamento |
| planning_day | integer | NO | 0 | CHECK ∈ {0, 1} (0=domingo, 1=segunda) |
| planning_time | time | NO | '19:00' | Hora do planejamento semanal |
| max_daily_tasks | integer | NO | 3 | CHECK 1–7 |
| coaching_intensity | text | NO | 'normal' | CHECK ∈ {light, normal, hard} |
| notify_deadline_alerts | boolean | NO | true | |
| notify_overdue_alerts | boolean | NO | true | |
| notify_team_summary | boolean | NO | true | |
| google_calendar_connected | boolean | NO | false | |
| google_calendar_token | jsonb | YES | — | OAuth token |
| google_calendar_id | text | YES | — | |
| timezone | text | NO | 'America/Sao_Paulo' | |
| do_not_disturb_until | timestamptz | YES | — | Snooze temporário |
| do_not_disturb_reason | text | YES | — | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- coaching_intensity CHECK: light, normal, hard
- max_daily_tasks CHECK: 1–7
- planning_day CHECK: 0 ou 1

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL
- `auth_read_own_prefs`: SELECT — collaborator_id = current_collab_id()
- `auth_update_own_prefs`: UPDATE — collaborator_id = current_collab_id()
- `auth_insert_own_prefs`: INSERT

---

### `collaborator_profiles`
Perfil comportamental e métricas de engajamento. Atualizado pelo TOM a cada ~20 interações. Uma linha por colaborador (UNIQUE).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE, UNIQUE |
| communication_style | text | YES | — | Descritivo livre |
| response_pattern | text | YES | — | |
| best_coaching_approach | text | YES | — | |
| strengths | text | YES | — | |
| growth_areas | text | YES | — | |
| personal_context | text | YES | — | |
| vocabulary_notes | text | YES | — | |
| maturity_level | text | NO | 'beginner' | CHECK ∈ {beginner, developing, proficient, advanced} |
| total_interactions | integer | NO | 0 | |
| avg_response_time_min | numeric | YES | — | |
| completion_rate_30d | numeric | YES | — | |
| last_profile_update | timestamptz | YES | — | |
| profile_notes | text | YES | — | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- maturity_level CHECK: beginner, developing, proficient, advanced

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `collaborator_memory`
Memória semântica de longo prazo do TOM por colaborador. Fatos, decisões, lições e preferências aprendidas em conversa.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| memory_type | text | NO | — | CHECK ∈ {fact, decision, lesson, preference, context} |
| content | text | NO | — | Texto livre da memória |
| source | text | NO | 'conversation' | CHECK ∈ {conversation, ritual, observation, explicit} |
| importance | text | NO | 'normal' | CHECK ∈ {critical, high, normal, low} |
| decay_at | timestamptz | YES | — | Expiração automática opcional |
| is_active | boolean | NO | true | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- memory_type CHECK: fact, decision, lesson, preference, context
- source CHECK: conversation, ritual, observation, explicit
- importance CHECK: critical, high, normal, low

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `conversation_history`
Histórico de mensagens trocadas entre TOM e cada colaborador. Últimas ~500 mensagens por pessoa (limpeza mensal via cron).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| direction | text | NO | — | CHECK ∈ {inbound, outbound} |
| message_type | text | NO | 'text' | CHECK ∈ {text, audio, image} |
| content | text | NO | — | |
| context | text | YES | — | CHECK ∈ {briefing, personal_briefing, closing, planning, project_creation, broadcast, checklist, emusys, onboarding, free_chat} ou NULL |
| whatsapp_message_id | text | YES | — | ID externo UAZAPI |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- direction CHECK: inbound, outbound
- message_type CHECK: text, audio, image
- context CHECK: ver lista acima ou NULL

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `marker_logs`
Log de observabilidade para cada marker emitido pelo TOM (ex.: `<<TASK_CREATED>>`). Falha de log nunca derruba o pipeline.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| marker_type | text | NO | — | Nome do marker (ex.: TASK_CREATED) |
| collaborator_id | uuid | YES | — | FK → collaborators(id) |
| result | text | NO | — | CHECK ∈ {executed, rejected} |
| reason | text | YES | — | Motivo de rejeição (máx 300 chars) |
| raw_excerpt | text | YES | — | Trecho bruto do marker (máx 500 chars) |
| created_at | timestamptz | YES | now() | |

**Constraints:**
- result CHECK: executed, rejected

**Relacionamentos:**
- collaborator_id → collaborators(id)

**RLS:**
- `service_role_all_marker_logs`: ALL

---

### `tom_metrics`
Métricas por chamada ao LLM: latência, tokens, provider, leak detection, marker emitido.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| ts | timestamptz | NO | now() | Timestamp da chamada |
| collaborator_id | uuid | YES | — | FK → collaborators(id) |
| message_kind | text | NO | — | CHECK ∈ {text, audio, ritual, internal} |
| provider_used | text | YES | — | CHECK ∈ {claude, openai, none} |
| fallback_from | text | YES | — | Provider original se houve fallback |
| latency_ms | integer | YES | — | |
| input_tokens | integer | YES | — | |
| output_tokens | integer | YES | — | |
| sanitized_chars | integer | YES | 0 | Chars removidos por sanitização |
| leak_blocked | boolean | YES | false | Leak de dados pessoais detectado |
| leak_match | text | YES | — | Padrão que disparou o bloqueio |
| marker_emitted | text | YES | — | Marker principal emitido na resposta |
| marker_result | text | YES | — | CHECK ∈ {executed, rejected, none} ou NULL |
| error_kind | text | YES | — | Tipo do erro se falhou |
| skill_active | text | YES | — | Skill ativa durante a chamada |
| actionable_intent | boolean | YES | false | Intenção acionável detectada |

**Constraints:**
- message_kind CHECK: text, audio, ritual, internal
- provider_used CHECK: claude, openai, none
- marker_result CHECK: executed, rejected, none, ou NULL

**Relacionamentos:**
- collaborator_id → collaborators(id)

**RLS:**
- `service_role_full_access`: ALL

---

### `ritual_logs`
Registro de cada ritual enviado/respondido (briefing, closing, planning). Um registro por ritual por data.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| ritual_type | text | NO | — | Ex.: daily_briefing, personal_briefing, daily_closing, weekly_planning |
| reference_date | date | NO | — | Data de referência do ritual |
| status | text | NO | 'sent' | Ex.: sent, responded, ignored |
| sent_at | timestamptz | YES | now() | |
| responded_at | timestamptz | YES | — | |
| response_time_minutes | integer | YES | — | |
| detail | text | YES | — | Notas adicionais |
| created_at | timestamptz | NO | now() | |

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL
- `auth_read_own_ritual_logs`: SELECT — collaborator_id = current_collab_id()
- `auth_read_ritual_logs_coord`: SELECT — role ∈ {coordinator, director}

---

### `auth_magic_codes`
Códigos de autenticação magic-link enviados via WhatsApp para login no PWA.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| phone | text | NO | — | Telefone do solicitante |
| collaborator_id | uuid | YES | — | FK → collaborators(id) |
| email | text | YES | — | |
| ip_hint | text | YES | — | |
| user_agent | text | YES | — | |
| status | text | NO | 'sent' | CHECK ∈ {sent, verified, failed, expired} |
| created_at | timestamptz | NO | now() | |
| expires_at | timestamptz | YES | — | |
| used_at | timestamptz | YES | — | |

**Constraints:**
- status CHECK: sent, verified, failed, expired

**Relacionamentos:**
- collaborator_id → collaborators(id)

**RLS:**
- `service_role_all_amc`: ALL

---

## 3. Tasks & Projetos

### `tasks`
Tarefas individuais ou vinculadas a projeto/checkpoint/evento escolar. Centro do produto.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| title | text | NO | — | |
| description | text | YES | — | |
| assigned_to | uuid | NO | — | FK → collaborators(id) |
| project_id | uuid | YES | — | FK → projects(id) ON DELETE SET NULL |
| checkpoint_id | uuid | YES | — | FK → project_checkpoints(id) ON DELETE SET NULL |
| category | text | NO | 'operational' | CHECK ∈ {pedagogical, commercial, administrative, financial, operational} |
| context | text | NO | 'work' | CHECK ∈ {work, personal} |
| priority | text | NO | 'medium' | CHECK ∈ {critical, high, medium, low} |
| eisenhower_quadrant | integer | YES | — | CHECK 1–4; calculado por trigger |
| status | text | NO | 'pending' | CHECK — ver abaixo |
| due_date | date | NO | — | |
| scheduled_date | date | YES | — | Dia planejado no briefing |
| delegated_to | uuid | YES | — | FK → collaborators(id) |
| delegated_at | timestamptz | YES | — | |
| source | text | NO | 'manual' | CHECK ∈ {manual, agent_briefing, agent_closing, checkpoint_decomposition, coordinator_assignment, system} |
| completed_at | timestamptz | YES | — | |
| completed_by | uuid | YES | — | FK → collaborators(id) |
| created_by | uuid | NO | — | FK → collaborators(id) |
| remind_at | timestamptz | YES | — | Lembrete único agendado |
| action_type | text | YES | — | CHECK ∈ {now, task, call, meeting, delegate, project} ou NULL |
| school_event_id | uuid | YES | — | FK → school_events(id) ON DELETE SET NULL (Sprint 14 F1) |
| event_sector | text | YES | — | CHECK ∈ {logistica, tecnica, pedagogico, comunicacao, producao} (Sprint 14 F1) |
| notes | text | YES | — | Notas internas (Sprint 14 F1) |
| support_team | text[] | YES | — | IDs ou nomes do time de apoio (Sprint 14 F1) |
| reminded_at | timestamptz | YES | — | Timestamp do lembrete T-1 enviado (Sprint 14 F2) |
| department_id | uuid | YES | — | FK → departments(id) ON DELETE SET NULL (novo Sprint 15) |
| request_type_id | uuid | YES | — | FK → department_request_types(id) ON DELETE SET NULL (novo Sprint 15) |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: pending, in_progress, done, overdue, delegated, cancelled, awaiting_confirmation *(awaiting_confirmation: Sprint 14 F1)*
- source CHECK: manual, agent_briefing, agent_closing, checkpoint_decomposition, coordinator_assignment, system
- category CHECK: pedagogical, commercial, administrative, financial, operational
- context CHECK: work, personal
- priority CHECK: critical, high, medium, low
- eisenhower_quadrant CHECK: 1–4
- action_type CHECK: now, task, call, meeting, delegate, project (ou NULL)
- event_sector CHECK: logistica, tecnica, pedagogico, comunicacao, producao

**Relacionamentos:**
- assigned_to → collaborators(id)
- project_id → projects(id) ON DELETE SET NULL
- checkpoint_id → project_checkpoints(id) ON DELETE SET NULL
- delegated_to → collaborators(id)
- completed_by → collaborators(id)
- created_by → collaborators(id)
- school_event_id → school_events(id) ON DELETE SET NULL
- department_id → departments(id) ON DELETE SET NULL *(novo Sprint 15)*
- request_type_id → department_request_types(id) ON DELETE SET NULL *(novo Sprint 15)*

**RLS:**
- `Service role full access`: ALL
- `auth_insert_own_tasks`: INSERT
- `auth_read_own_tasks`: SELECT — assigned_to = current_collab_id()
- `auth_read_work_tasks_coord`: SELECT — context='work' AND role ∈ {coordinator, director}
- `auth_update_own_tasks`: UPDATE — assigned_to = current_collab_id()

---

### `projects`
Projetos com ciclo de vida (aprovação → planejamento → ativo → concluído). Vinculam tarefas e checkpoints.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| name | text | NO | — | |
| description | text | YES | — | |
| justification | text | YES | — | "Por quê" |
| location | text | YES | — | "Onde" |
| start_date | date | NO | — | |
| end_date | date | NO | — | |
| methodology | text | YES | — | "Como" |
| estimated_hours_week | numeric | YES | — | |
| category | text | NO | 'operational' | CHECK ∈ {pedagogical, commercial, administrative, operational, event, infrastructure} |
| status | text | NO | 'planning' | CHECK ∈ {pending_approval, planning, active, paused, completed, cancelled} |
| progress_percent | integer | NO | 0 | CHECK 0–100; calculado automaticamente |
| color | text | NO | '#3B82F6' | Hex color |
| created_by | uuid | NO | — | FK → collaborators(id) |
| requires_approval | boolean | NO | false | |
| approved_by | uuid | YES | — | FK → collaborators(id) |
| approved_at | timestamptz | YES | — | |
| rejection_reason | text | YES | — | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: pending_approval, planning, active, paused, completed, cancelled
- category CHECK: pedagogical, commercial, administrative, operational, event, infrastructure
- progress_percent CHECK: 0–100

**Relacionamentos:**
- created_by → collaborators(id)
- approved_by → collaborators(id)

**RLS:**
- `Service role full access`: ALL
- `auth_insert_own_projects`: INSERT
- `auth_read_projects`: SELECT — created_by = current_collab_id() OU membro OU role ∈ {coordinator, director}

---

### `project_checkpoints`
Marcos de entrega de um projeto. Podem ser decompostos em tasks pelo TOM.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | — | FK → projects(id) ON DELETE CASCADE |
| name | text | NO | — | |
| description | text | YES | — | |
| due_date | date | YES | — | |
| assigned_to | uuid | YES | — | FK → collaborators(id) |
| status | text | NO | 'pending' | CHECK ∈ {pending, in_progress, done, overdue} |
| sort_order | integer | NO | 0 | |
| completed_at | timestamptz | YES | — | |
| completed_by | uuid | YES | — | FK → collaborators(id) |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: pending, in_progress, done, overdue

**Relacionamentos:**
- project_id → projects(id) ON DELETE CASCADE
- assigned_to → collaborators(id)
- completed_by → collaborators(id)

**RLS:**
- `Service role full access`: ALL
- `auth_insert_project_checkpoints`: INSERT
- `auth_read_project_checkpoints`: SELECT — projetos do colaborador ou role ∈ {coordinator, director}
- `auth_update_project_checkpoints`: UPDATE — mesma regra

---

### `project_members`
Membros de cada projeto com papel (owner/leader/member). UNIQUE (project_id, collaborator_id).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| project_id | uuid | NO | — | FK → projects(id) ON DELETE CASCADE |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| role_in_project | text | NO | 'member' | CHECK ∈ {owner, leader, member} |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- role_in_project CHECK: owner, leader, member
- UNIQUE (project_id, collaborator_id)

**Relacionamentos:**
- project_id → projects(id) ON DELETE CASCADE
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL
- `auth_insert_project_members`: INSERT
- `auth_read_project_members`: SELECT — collaborator_id = current_collab_id() OU role ∈ {coordinator, director}

---

### `task_comments`
Comentários e notas de auditoria em tarefas (manual ou gerado pelo agente).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| task_id | uuid | NO | — | FK → tasks(id) ON DELETE CASCADE |
| content | text | NO | — | |
| comment_type | text | NO | 'manual' | CHECK ∈ {manual, agent_note, status_change, delegation, deadline_extension} |
| created_by | uuid | YES | — | FK → collaborators(id) |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- comment_type CHECK: manual, agent_note, status_change, delegation, deadline_extension

**Relacionamentos:**
- task_id → tasks(id) ON DELETE CASCADE
- created_by → collaborators(id)

**RLS:**
- `Service role full access`: ALL

---

### `task_reminders`
Lembretes pontuais agendados para tarefas (além do `remind_at` inline na task).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| task_id | uuid | NO | — | FK → tasks(id) ON DELETE CASCADE |
| remind_at | timestamptz | NO | — | Quando disparar |
| sent_at | timestamptz | YES | — | |
| label | text | YES | — | Descrição do lembrete |
| created_at | timestamptz | NO | now() | |

**Relacionamentos:**
- task_id → tasks(id) ON DELETE CASCADE

**RLS:**
- `service_role_all_task_reminders`: ALL

---

### `daily_plans`
Plano diário de tarefas de um colaborador. UNIQUE (collaborator_id, plan_date).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| plan_date | date | NO | — | |
| weekly_plan_id | uuid | YES | — | FK → weekly_plans(id) ON DELETE SET NULL |
| status | text | NO | 'active' | CHECK ∈ {active, closed} |
| items_planned | integer | NO | 0 | |
| items_completed | integer | NO | 0 | |
| completion_rate | numeric | NO | 0 | |
| new_demands | text | YES | — | Demandas surgidas no dia |
| closing_notes | text | YES | — | Notas do fechamento |
| closed_at | timestamptz | YES | — | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: active, closed
- UNIQUE (collaborator_id, plan_date)

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE
- weekly_plan_id → weekly_plans(id) ON DELETE SET NULL

**RLS:**
- `Service role full access`: ALL

---

### `daily_plan_items`
Itens individuais dentro de um daily_plan (podem ser vinculados ou não a uma task).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| daily_plan_id | uuid | NO | — | FK → daily_plans(id) ON DELETE CASCADE |
| task_id | uuid | YES | — | FK → tasks(id) ON DELETE SET NULL |
| description | text | NO | — | |
| sort_order | integer | NO | 0 | |
| is_completed | boolean | NO | false | |
| completed_at | timestamptz | YES | — | |
| rescheduled_to | date | YES | — | Se adiado para outra data |
| created_at | timestamptz | NO | now() | |

**Relacionamentos:**
- daily_plan_id → daily_plans(id) ON DELETE CASCADE
- task_id → tasks(id) ON DELETE SET NULL

**RLS:**
- `Service role full access`: ALL

---

### `weekly_plans`
Plano semanal com metas e retrospectiva. UNIQUE (collaborator_id, week_start).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| week_start | date | NO | — | Segunda-feira da semana |
| goals | text[] | YES | '{}' | Array de metas textuais |
| status | text | NO | 'active' | CHECK ∈ {active, completed, skipped} |
| tasks_planned | integer | NO | 0 | |
| tasks_completed | integer | NO | 0 | |
| completion_rate | numeric | NO | 0 | |
| retrospective_notes | text | YES | — | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: active, completed, skipped
- UNIQUE (collaborator_id, week_start)

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `notifications`
Fila de notificações enviadas via WhatsApp ou PWA push.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| notification_type | text | NO | — | CHECK — ver abaixo |
| title | text | NO | — | |
| body | text | NO | — | |
| reference_type | text | YES | — | CHECK ∈ {task, project, checkpoint, collaborator, broadcast, checklist, emusys_class} ou NULL |
| reference_id | uuid | YES | — | ID do objeto referenciado |
| channel | text | NO | 'whatsapp' | CHECK ∈ {whatsapp, pwa_push, both} |
| status | text | NO | 'pending' | CHECK ∈ {pending, sent, delivered, read, failed} |
| sent_at | timestamptz | YES | — | |
| read_at | timestamptz | YES | — | |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- notification_type CHECK: deadline_alert, overdue_alert, deadline_extension_request, team_inactivity, project_at_risk, checkpoint_reminder, delegation_notice, emusys_reminder, checklist_reminder, broadcast_reminder
- reference_type CHECK: task, project, checkpoint, collaborator, broadcast, checklist, emusys_class (ou NULL)
- channel CHECK: whatsapp, pwa_push, both
- status CHECK: pending, sent, delivered, read, failed

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

## 4. Eventos

### `events`
Eventos do calendário pessoal/trabalho de cada colaborador (criados pelo TOM ou manualmente).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| title | text | NO | — | |
| description | text | YES | — | |
| context | text | NO | 'work' | CHECK ∈ {work, personal} |
| category | text | NO | — | CHECK ∈ {la_music, mentoria, aula_particular, outra_escola, estudio, pessoal} |
| start_at | timestamptz | NO | — | |
| end_at | timestamptz | NO | — | CHECK end_at > start_at |
| modality | text | NO | 'presencial' | CHECK ∈ {online, presencial, hibrido} |
| location_text | text | YES | — | |
| meeting_url | text | YES | — | CHECK só presente se modality ∈ {online, hibrido} |
| project_id | uuid | YES | — | FK → projects(id) ON DELETE SET NULL |
| status | text | NO | 'scheduled' | CHECK ∈ {scheduled, done, cancelled} |
| source | text | NO | 'manual' | CHECK ∈ {manual, tom, imported} |
| created_by | uuid | YES | — | FK → collaborators(id) |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- context CHECK: work, personal
- category CHECK: la_music, mentoria, aula_particular, outra_escola, estudio, pessoal
- modality CHECK: online, presencial, hibrido
- status CHECK: scheduled, done, cancelled
- source CHECK: manual, tom, imported
- end_at > start_at (check)
- meeting_url só permitida se modality ∈ {online, hibrido}

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE
- project_id → projects(id) ON DELETE SET NULL
- created_by → collaborators(id)

**RLS:**
- `service_role_all_events`: ALL
- `auth_insert_own_events`: INSERT
- `auth_read_own_events`: SELECT — collaborator_id = current_collab_id()
- `auth_read_work_events_coord`: SELECT — context='work' AND role ∈ {coordinator, director}
- `auth_update_own_events`: UPDATE — collaborator_id = current_collab_id()
- `auth_delete_own_events`: DELETE — collaborator_id = current_collab_id()

---

### `school_events` *(Sprint 13/14)*
Eventos institucionais da escola (shows, recitais, formatura, etc.). Geram tasks automáticas por setor.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| title | text | NO | — | |
| event_date | date | NO | — | |
| start_time | time | YES | — | |
| location | text | YES | — | |
| unit | text | YES | — | CHECK ∈ {barra, recreio, campo_grande} |
| status | text | NO | 'active' | CHECK ∈ {active, cancelled} |
| notify_leadership | boolean | NO | true | Notificar liderança |
| notify_school | boolean | NO | true | Notificar escola toda |
| notify_unit | boolean | NO | true | Notificar unidade |
| notify_day_of | boolean | NO | true | Lembrete no dia (Sprint 13 — T0 lembrete) |
| event_type | text | YES | — | CHECK ∈ {show, recital, workshop, treinamento, oficinas, reuniao, formatura, evento} (Sprint 14 F2) |
| created_by | uuid | YES | — | FK → collaborators(id) |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- unit CHECK: barra, recreio, campo_grande
- status CHECK: active, cancelled
- event_type CHECK: show, recital, workshop, treinamento, oficinas, reuniao, formatura, evento

**Relacionamentos:**
- created_by → collaborators(id)

**RLS:**
- `school_events_select`: SELECT — true (todos leem)
- `school_events_write`: ALL — role ∈ {director, coordinator}

---

### `event_team_map` *(Sprint 14 F2)*
Mapeia o responsável por setor×unidade para eventos escolares. UNIQUE (unit, sector).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| unit | text | NO | — | CHECK ∈ {barra, recreio, campo_grande} |
| sector | text | NO | — | CHECK ∈ {logistica, tecnica, pedagogico, comunicacao, producao} |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- unit CHECK: barra, recreio, campo_grande
- sector CHECK: logistica, tecnica, pedagogico, comunicacao, producao
- UNIQUE (unit, sector)

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `event_team_map_read`: SELECT — role ∈ {coordinator, director}
- `event_team_map_write`: ALL — role ∈ {coordinator, director}

---

### `google_calendar_sync`
Mapeamento entre objetos internos (task/checkpoint/meeting) e eventos do Google Calendar. UNIQUE (collaborator_id, source_type, source_id).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| source_type | text | NO | — | CHECK ∈ {task, checkpoint, meeting} |
| source_id | uuid | NO | — | ID do objeto interno |
| google_event_id | text | NO | — | ID do evento no Google |
| last_synced_at | timestamptz | NO | now() | |
| sync_status | text | NO | 'synced' | CHECK ∈ {synced, pending, error} |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- source_type CHECK: task, checkpoint, meeting
- sync_status CHECK: synced, pending, error
- UNIQUE (collaborator_id, source_type, source_id)

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `emusys_classes`
Aulas importadas do sistema Emusys (polling periódico). Rastreia presença e conteúdo registrados.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| emusys_class_id | text | NO | — | ID externo no Emusys |
| student_name | text | NO | — | |
| class_date | date | NO | — | |
| class_time | time | NO | — | |
| class_end_time | time | YES | — | |
| unit | text | NO | — | CHECK ∈ {campo_grande, recreio, barra} |
| attendance_registered | boolean | NO | false | |
| content_registered | boolean | NO | false | |
| reminder_sent | boolean | NO | false | |
| reminder_sent_at | timestamptz | YES | — | |
| last_synced_at | timestamptz | NO | now() | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- unit CHECK: campo_grande, recreio, barra

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `v_recent_events` (view)
View que agrega eventos recentes. Definição a confirmar via DDL.

---

## 5. Comunicação

### `announcements` *(Sprint 13/14)*
Comunicados criados pelo TOM ou coordenadores. Passam por fluxo de aprovação se criados por não-diretores.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| created_by | uuid | YES | — | FK → collaborators(id) |
| body | text | NO | — | Texto do comunicado |
| audience | jsonb | NO | '{}' | Segmentação de audiência |
| status | text | NO | 'scheduled' | CHECK — ver abaixo |
| scheduled_at | timestamptz | YES | — | Horário de envio agendado |
| cancel_retraction_sent | boolean | NO | false | Se retratação foi enviada no cancelamento |
| source_event_id | uuid | YES | — | FK → school_events(id) (origem no evento escolar) |
| reviewed_by | uuid | YES | — | FK → collaborators(id) (Sprint 13 F3) |
| rejection_reason | text | YES | — | Motivo de rejeição (Sprint 13 F3) |
| coordinator_notified_at | timestamptz | YES | — | Quando coordenador foi notificado (Sprint 13 F3) |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: pending_approval *(Sprint 13 F3)*, scheduled, sending, sent, cancelled, rejected *(Sprint 13 F3)*

**Relacionamentos:**
- created_by → collaborators(id)
- reviewed_by → collaborators(id)
- source_event_id → school_events(id)

**RLS:**
- `announcements_write` (cmd=w): UPDATE — role = director
- `announcements_select`: SELECT — role ∈ {director, coordinator}
- `announcements_write` (cmd=*): ALL (sem cláusula — provavelmente service role ou insert aberto)

---

### `announcement_jobs` *(Sprint 13/14)*
Fila de disparo individual por destinatário de um comunicado.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| announcement_id | uuid | NO | — | FK → announcements(id) ON DELETE CASCADE |
| recipient_id | uuid | YES | — | FK → collaborators(id) |
| phone | text | NO | — | Número de destino |
| status | text | NO | 'pending' | CHECK ∈ {pending, sent, failed, cancelled} |
| retry_count | integer | NO | 0 | |
| sent_at | timestamptz | YES | — | |
| error | text | YES | — | Mensagem de erro se falhou |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: pending, sent, failed, cancelled

**Relacionamentos:**
- announcement_id → announcements(id) ON DELETE CASCADE
- recipient_id → collaborators(id)

**RLS:**
- `announcement_jobs_select`: SELECT — role ∈ {director, coordinator}

---

### `broadcast_messages`
Mensagens broadcast enviadas pelo TOM a grupos de colaboradores, com rastreamento de confirmação.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| sent_by | uuid | NO | — | FK → collaborators(id) |
| target_group | text | NO | — | Nome do grupo alvo |
| target_ids | text[] | NO | — | Array de IDs dos destinatários |
| message_content | text | NO | — | |
| requires_confirmation | boolean | NO | false | Se exige resposta de confirmação |
| follow_up_interval_min | integer | YES | 60 | Intervalo de follow-up em minutos |
| timeout_hours | integer | YES | 24 | Timeout para respostas |
| status | text | NO | 'active' | CHECK ∈ {active, completed, cancelled} |
| report_sent | boolean | NO | false | |
| report_sent_at | timestamptz | YES | — | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: active, completed, cancelled

**Relacionamentos:**
- sent_by → collaborators(id)

**RLS:**
- `Service role full access`: ALL

---

### `broadcast_responses`
Resposta individual de cada destinatário a um broadcast. UNIQUE (broadcast_id, collaborator_id).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| broadcast_id | uuid | NO | — | FK → broadcast_messages(id) ON DELETE CASCADE |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| status | text | NO | 'pending' | CHECK ∈ {pending, confirmed, declined, no_response} |
| response_text | text | YES | — | |
| reminders_sent | integer | NO | 0 | |
| last_reminder_at | timestamptz | YES | — | |
| responded_at | timestamptz | YES | — | |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- status CHECK: pending, confirmed, declined, no_response
- UNIQUE (broadcast_id, collaborator_id)

**Relacionamentos:**
- broadcast_id → broadcast_messages(id) ON DELETE CASCADE
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

## 6. Hábitos & Checklists

### `habit_templates`
Templates pré-definidos de hábitos (biblioteca do sistema).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| name | text | NO | — | |
| description | text | YES | — | |
| icon | text | NO | '📌' | |
| color | text | NO | '#3B82F6' | |
| default_frequency | text | NO | 'daily' | CHECK ∈ {daily, weekdays, weekly, custom} |
| default_reminder_time | time | YES | — | |
| category | text | NO | 'health' | CHECK ∈ {health, learning, finance, mindset, social, other} |
| is_system | boolean | NO | true | |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- default_frequency CHECK: daily, weekdays, weekly, custom
- category CHECK: health, learning, finance, mindset, social, other

**RLS:**
- `Service role full access`: ALL

---

### `habits`
Hábitos ativos de cada colaborador (criados a partir de template ou do zero).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| template_id | uuid | YES | — | FK → habit_templates(id) |
| name | text | NO | — | |
| icon | text | NO | '📌' | |
| color | text | NO | '#3B82F6' | |
| frequency | text | NO | 'daily' | CHECK ∈ {daily, weekdays, weekly, custom} |
| custom_days | integer[] | YES | — | Array de dias da semana (0=dom) para frequency=custom |
| reminder_time | time | YES | — | |
| notify_whatsapp | boolean | NO | true | |
| is_active | boolean | NO | true | |
| current_streak | integer | NO | 0 | |
| best_streak | integer | NO | 0 | |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- frequency CHECK: daily, weekdays, weekly, custom

**Relacionamentos:**
- collaborator_id → collaborators(id) ON DELETE CASCADE
- template_id → habit_templates(id)

**RLS:**
- `Service role full access`: ALL

---

### `habit_logs`
Registro diário de execução de cada hábito. UNIQUE (habit_id, log_date).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| habit_id | uuid | NO | — | FK → habits(id) ON DELETE CASCADE |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| log_date | date | NO | — | |
| is_completed | boolean | NO | false | |
| completed_at | timestamptz | YES | — | |
| notes | text | YES | — | |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- UNIQUE (habit_id, log_date)

**Relacionamentos:**
- habit_id → habits(id) ON DELETE CASCADE
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `op_checklists` *(Sprint 11 F2+)*
Templates de checklists operacionais (diários ou semanais) por função, turno e unidade.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| name | text | NO | — | |
| function_role | text | NO | — | Função/cargo alvo |
| checklist_type | text | NO | 'daily' | CHECK ∈ {daily, weekly} |
| shift | text | YES | — | CHECK ∈ {morning, afternoon, evening, full} ou NULL |
| unit | text | YES | 'all' | CHECK ∈ {campo_grande, recreio, barra, all} ou NULL |
| is_active | boolean | NO | true | |
| completion_threshold | integer | NO | 80 | % mínimo para considerar completo |
| dispatch_time | time | NO | '08:00' | Horário de disparo via WhatsApp |
| days_of_week | integer[] | NO | [1,2,3,4,5] | Dias de disparo (0=dom) |
| created_by | uuid | NO | — | FK → collaborators(id) |
| updated_by | uuid | YES | — | FK → collaborators(id) |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- checklist_type CHECK: daily, weekly
- shift CHECK: morning, afternoon, evening, full (ou NULL)
- unit CHECK: campo_grande, recreio, barra, all (ou NULL)

**Relacionamentos:**
- created_by → collaborators(id)
- updated_by → collaborators(id)

**RLS:**
- `Service role full access`: ALL
- `op_checklists_select_auth`: SELECT — true (todos leem)
- `op_checklists_write_mgmt`: ALL — role ∈ {director, coordinator}

---

### `op_checklist_items` *(Sprint 11 F2+)*
Itens individuais de um template de checklist operacional.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| checklist_id | uuid | NO | — | FK → op_checklists(id) ON DELETE CASCADE |
| description | text | NO | — | |
| sort_order | integer | NO | 0 | |
| is_active | boolean | NO | true | |
| updated_by | uuid | YES | — | FK → collaborators(id) |
| generates_request_type_id | uuid | YES | — | FK → department_request_types(id) ON DELETE SET NULL (novo Sprint 15) — quando is_checked=false gera task automática |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | YES | now() | |

**Relacionamentos:**
- checklist_id → op_checklists(id) ON DELETE CASCADE
- updated_by → collaborators(id)
- generates_request_type_id → department_request_types(id) ON DELETE SET NULL *(novo Sprint 15)*

**RLS:**
- `Service role full access`: ALL
- `op_checklist_items_select_auth`: SELECT — true
- `op_checklist_items_write_mgmt`: ALL — role ∈ {director, coordinator}

---

### `op_checklist_completions` *(Sprint 11 F2+)*
Instância de preenchimento de um checklist por colaborador/data. UNIQUE (checklist_id, collaborator_id, reference_date).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| checklist_id | uuid | NO | — | FK → op_checklists(id) ON DELETE CASCADE |
| collaborator_id | uuid | NO | — | FK → collaborators(id) ON DELETE CASCADE |
| reference_date | date | NO | — | |
| started_at | timestamptz | YES | — | |
| completed_at | timestamptz | YES | — | |
| channel | text | NO | 'pwa' | CHECK ∈ {pwa, whatsapp} |
| dispatched_at | timestamptz | YES | — | Quando foi enviado via WhatsApp |
| created_at | timestamptz | NO | now() | |

**Constraints:**
- channel CHECK: pwa, whatsapp
- UNIQUE (checklist_id, collaborator_id, reference_date)

**Relacionamentos:**
- checklist_id → op_checklists(id) ON DELETE CASCADE
- collaborator_id → collaborators(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `op_checklist_item_completions` *(Sprint 11 F2+)*
Estado de cada item dentro de uma completion. UNIQUE (completion_id, item_id).

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| completion_id | uuid | NO | — | FK → op_checklist_completions(id) ON DELETE CASCADE |
| item_id | uuid | NO | — | FK → op_checklist_items(id) ON DELETE CASCADE |
| is_checked | boolean | NO | false | |
| checked_at | timestamptz | YES | — | |
| notes | text | YES | — | |
| late | boolean | NO | false | Marcado após horário limite |
| channel | text | NO | 'whatsapp' | CHECK ∈ {pwa, whatsapp} |

**Constraints:**
- channel CHECK: pwa, whatsapp
- UNIQUE (completion_id, item_id)

**Relacionamentos:**
- completion_id → op_checklist_completions(id) ON DELETE CASCADE
- item_id → op_checklist_items(id) ON DELETE CASCADE

**RLS:**
- `Service role full access`: ALL

---

### `op_checklists_audit` *(Sprint 11 F2+)*
Trilha de auditoria para criação, atualização e desativação de templates de checklist.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| template_id | uuid | NO | — | FK → op_checklists(id) ON DELETE CASCADE |
| action | text | NO | — | CHECK ∈ {created, updated, deactivated, activated, item_added, item_removed, item_updated, reordered} |
| changed_by | uuid | YES | — | FK → collaborators(id) |
| changed_at | timestamptz | NO | now() | |
| details | jsonb | YES | — | Detalhes da mudança |

**Constraints:**
- action CHECK: created, updated, deactivated, activated, item_added, item_removed, item_updated, reordered

**Relacionamentos:**
- template_id → op_checklists(id) ON DELETE CASCADE
- changed_by → collaborators(id)

**RLS:**
- `op_checklists_audit_select_mgmt`: SELECT — role ∈ {director, coordinator}

---

## 7. Operações *(novo Sprint 15)*

### `departments` *(novo Sprint 15)*
Departamentos operacionais da escola. Cada departamento pode ter tipos de requisição próprios e um responsável padrão.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| slug | text | NO | — | UNIQUE — identificador URL-safe |
| name | text | NO | — | |
| description | text | YES | — | |
| is_active | boolean | NO | true | |
| unit_scope_enabled | boolean | NO | false | Se filtra por unidade |
| default_responsible_id | uuid | YES | — | FK → collaborators(id) ON DELETE SET NULL (Sprint 15 F4) |
| created_at | timestamptz | NO | now() | |
| updated_at | timestamptz | NO | now() | |

**Constraints:**
- UNIQUE (slug)

**Relacionamentos:**
- default_responsible_id → collaborators(id) ON DELETE SET NULL

**Seed Sprint 15 F1:** `operacoes-tecnicas` (Operações Técnicas) — default_responsible_id = Rafinha (id c9e72a40).

**RLS:**
- `Service role full access`: ALL
- `departments_select_auth`: SELECT — true (todos leem)
- `departments_write_mgmt`: ALL — role ∈ {director, coordinator}

---

### `department_request_types` *(novo Sprint 15)*
Tipos de requisição de um departamento operacional. Governam prioridade, aprovação e geração automática de tasks.

| Coluna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| id | uuid | NO | gen_random_uuid() | PK |
| department_id | uuid | NO | — | FK → departments(id) ON DELETE CASCADE |
| slug | text | NO | — | Identificador dentro do departamento |
| label | text | NO | — | Nome legível |
| description | text | YES | — | |
| default_priority | text | NO | 'medium' | CHECK ∈ {critical, high, medium, low} |
| requires_approval | boolean | NO | false | |
| generates_task | boolean | NO | true | |
| is_active | boolean | NO | true | |
| sort_order | integer | NO | 0 | |

**Constraints:**
- default_priority CHECK: critical, high, medium, low
- UNIQUE (department_id, slug)

**Relacionamentos:**
- department_id → departments(id) ON DELETE CASCADE

**Seed Sprint 15 F1 (departamento operacoes-tecnicas):**
| slug | label | default_priority | requires_approval |
|---|---|---|---|
| incidente-tecnico | Incidente Técnico | high | false |
| reposicao-estoque | Reposição de Estoque | medium | false |
| apoio-tecnico-montagem | Apoio Técnico / Montagem | medium | false |
| obra-infraestrutura | Obra / Infraestrutura | low | true |
| preventivo-auditoria | Preventivo / Auditoria | low | false |
| compra-fornecedor | Compra com Fornecedor | medium | true |

**RLS:**
- `Service role full access`: ALL
- `dept_request_types_select_auth`: SELECT — true (todos leem)
- `dept_request_types_write_mgmt`: ALL — role ∈ {director, coordinator}

---

## 8. RLS & Helpers

### Funções helper

| Função | Retorno | Descrição |
|---|---|---|
| `current_collab_id()` | uuid | Lê `current_setting('app.current_user_id', true)` — retorna o UUID do colaborador autenticado |
| `current_collab_role()` | text | Consulta `collaborators.role` para o ID retornado por `current_collab_id()` |

### Padrão de uso no PWA

Antes de qualquer mutação via Supabase client (anon key), o PWA executa:

```js
await supabase.rpc('set_config', {
  key: 'app.current_user_id',
  value: collaborator.id
})
```

Isso popula o GUC `app.current_user_id` na sessão Postgres, que as funções `current_collab_id()` e `current_collab_role()` consomem nas policies RLS.

O **engine** (TOM backend) usa a **service role key**, que bypassa todas as policies RLS.

### Resumo das policies por tabela

| Tabela | Políticas notáveis |
|---|---|
| collaborators | Leitura: próprio email OU coordinator/director |
| tasks | Leitura/edição própria; coordinator/director vê todas work |
| events | CRUD próprio; coordinator/director lê work events |
| projects | Leitura: criador OU membro OU coordinator/director |
| project_checkpoints | Leitura/edição vinculada ao projeto |
| project_members | Leitura própria OU coordinator/director |
| ritual_logs | Leitura própria + coordinator/director |
| user_preferences | CRUD próprio apenas |
| school_events | SELECT aberto a todos; escrita apenas coordinator/director |
| event_team_map | Leitura e escrita: coordinator/director |
| op_checklists / items | SELECT aberto; escrita coordinator/director |
| op_checklists_audit | Leitura: coordinator/director |
| announcements | SELECT coordinator/director; UPDATE (aprovação) director |
| announcement_jobs | SELECT coordinator/director |
| departments | SELECT aberto a todos; escrita coordinator/director *(novo Sprint 15)* |
| department_request_types | SELECT aberto a todos; escrita coordinator/director *(novo Sprint 15)* |
| Demais tabelas | Service role full access (engine only) |

---

*Documento gerado a partir do DDL real (information_schema + pg_constraint + pg_policies) em 2026-05-03. Atualizado Sprint 15 em 2026-05-03.*
