# Mapa de Telas do PWA — LA Organizer

**Documento:** 05
**Versão:** 3.5
**Data:** 8 de maio de 2026 (atualizado Sprint 22.34 — Agenda revamp)
**Plataforma:** PWA mobile-first (React/TypeScript) — Vercel + VPS (nginx + PM2)
**Design:** Dark mode padrão, opção light mode
**Status:** Sprints 0→22 em produção

---

## Estrutura de navegação

### Bottom Navigation (4 tabs fixos)

| Tab | Ícone | Label | Tela principal |
|---|---|---|---|
| 1 | Círculo preenchido | Hoje | Visão do dia atual |
| 2 | Calendário | Semana | Visão semanal |
| 3 | Foguete | Projetos | Projetos ativos |
| 4 | Menu/Mais | Mais | Configurações, histórico, time (coord+) |

### Navegação por role

| Tela | Colaborador | Coordenador | Diretor | Status |
|---|---|---|---|---|
| Login | ✓ | ✓ | ✓ | ✅ Sprint 2 |
| Hoje | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Semana | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Projetos (lista) | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Projeto detalhe | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Dashboard do time `/time` | — | ✓ | ✓ | ✅ Sprint 0 |
| Configurações | ✓ | ✓ | ✓ | ✅ Sprint 1 |
| Histórico | ✓ | ✓ | ✓ | ✅ Sprint 1 |
| Pessoa-Detalhe `/time/:id` | — | ✓ | ✓ | ✅ Sprint 6 |
| Project Wizard `/projetos/novo` | ✓ | ✓ | ✓ | ✅ Sprint 8 |
| Hábitos pessoais `/habitos` | ✓ | ✓ | ✓ | ✅ Sprint 11 |
| Checklists `/checklists` (tabs Trabalho/Pessoal/Delegadas) | ✓ | ✓ | ✓ | ✅ Sprint 11 F2+ → 22.38 |
| Checklists Templates `/mais/checklists-templates` | — | ✓ | ✓ | ✅ Sprint 11 F2+ |
| Aderência operacional `/mais/aderencia-checklists` | — | — | ✓ (manager + director) | ✅ Sprint 22.37 |
| Aderência detalhe `/mais/aderencia-checklists/:id` | — | — | ✓ (manager + director) | ✅ Sprint 22.37 |
| Comunicados `/mais/comunicados` | — | ✓ | ✓ | ✅ Sprint 13 F1 |
| Agenda Escolar `/mais/agenda-escolar` | — | ✓ | ✓ | ✅ Sprint 13 F2 |
| Observabilidade `/mais/observabilidade` | — | ✓ | ✓ | ✅ Sprint 13 F3 |
| Evento Detalhe `/mais/eventos/:id` | — | ✓ | ✓ | ✅ Sprint 14 F1 |
| Configurar Equipe `/mais/agenda-escolar/equipe` | — | ✓ | ✓ | ✅ Sprint 14 F2 |
| Operações Técnicas `/mais/operacoes` | — | ✓ | ✓ | ✅ Sprint 15 F3 |

---

## Componentes globais

### Header
```
┌─────────────────────────────────────────┐
│  Bom dia, Quintela          [Avatar MQ] │
│  Terça, 27 de abril                     │
└─────────────────────────────────────────┘
```

### Bottom nav
```
┌────────────┬────────────┬────────────┬────────────┐
│  ●  Hoje   │ 📅 Semana  │ 🚀 Projetos│  ≡  Mais   │
└────────────┴────────────┴────────────┴────────────┘
```

---

## Telas em produção — detalhamento

---

### Tela 1 — Hoje

**Role:** Todos · **Sprint:** 0

Header com saudação + data. Bloco "📅 Compromissos hoje" (events) sobre bloco "📋 Tarefas". Tarefas com checkbox interativo e badges de overdue/prazo. FAB para criação rápida (Tarefa | Compromisso).

**Sprint 5 ampliou:** EditEventSheet acessível por tap em event row.

**Sprint 12 Bloco D ampliou:** filtro opcional por `action_type` (categoria de execução) — filtra a lista de tarefas sem sair da tela.

---

### Tela 2 — Semana

**Role:** Todos · **Sprint:** 0

Cards verticais por dia (seg–sex), events com horário em destaque pink, tasks como bullets compactos. FAB para criação rápida. Reagendar via tap → bottom sheet com date picker. RescheduleSheet e EditEventSheet disponíveis.

---

### Tela 3 — Projetos (lista)

**Role:** Todos (cada um vê os seus) · **Sprint:** 0

Lista de projetos ativos com: nome, badge de categoria colorida, progress bar, próximo checkpoint, status. Coord/Director vê todos os projetos. Statuses visíveis: `active`, `planning`, `pending_approval`, `paused`.

**Sprint 8:** botão "+ Novo projeto" no header navega para `/projetos/novo` (Project Wizard).

---

### Tela 4 — Projeto Detalhe `/projetos/:id`

**Role:** Todos (com visibilidade por role) · **Sprint:** 0

Header com nome, categoria, status, progresso. 4 abas: Resumo, Checkpoints, Tarefas, Time. Coord/Director cria tarefas no projeto.

---

### Tela 5 — Dashboard do Time `/time`

**Role:** Coordenador, Diretor · **Sprint:** 0 (ampliada Sprint 6)

**Restrição de rota:** `<ProtectedRoute requireRoles={['coordinator', 'director']} />`

**Sprint 0:** taxa de conclusão por pessoa, alertas de atraso, quem respondeu rituais.

**Sprint 6 ampliou:** bloco "📅 Compromissos hoje" agregado no topo (top 5 events do team), card de cada colaborador exibe contagens de tasks E events do dia, tap em card navega para `/time/:id` (Pessoa-Detalhe).

**Privacidade:** apenas `tasks.context='work'` e `events.context='work'`. Respostas de briefing lidas via RPC `briefing_response_count` (SECURITY DEFINER) — `conversation_history.content` nunca exposto.

---

### Tela 6 — Configurações `/configuracoes`

**Role:** Todos · **Sprint:** 1

7 campos editáveis: `briefing_time`, `personal_briefing_time`, `closing_time`, `planning_day`, `coaching_intensity` (light/normal/hard), `notify_deadline_alerts`, `notify_overdue_alerts`. Form simples com toggle switches e radio cards.

---

### Tela 7 — Histórico `/historico`

**Role:** Todos · **Sprint:** 1 (ampliada Sprint 3)

Últimos 30 dias do colaborador. **3 KPIs:** Tarefas (X/Y%), Compromissos (N), Dias ativos (N/30). Lista de dias com dot semântico de aderência. Agrega tarefas E eventos de work context.

---

### Tela 8 — Pessoa-Detalhe `/time/:id`

**Role:** Coordenador, Diretor · **Sprint:** 6

**Restrição de rota:** `<ProtectedRoute requireRoles={['coordinator', 'director']} />`

Header: avatar, nome, role, `function_title`, telefone mascarado (`••••{últimos 4}`). **3 KPIs:** Tarefas abertas, Compromissos hoje, Rituais enviados 7d. Bloco Tarefas pendentes (read-only, work context, limit 20), bloco Compromissos próximos 7 dias (read-only), faixa visual de aderência ritual (7 dots por dia).

**Privacidade:** query de `ritual_logs` seleciona apenas `reference_date, ritual_type, status` — nunca `response_text`. Colaborador comum acessando por URL direta é redirecionado.

---

### Tela 9 — Project Wizard `/projetos/novo`

**Role:** Todos (com gate de aprovação para colaborador comum) · **Sprint:** 8

Wizard multi-step que replica o fluxo 5W2H do TOM no PWA.

**Estrutura:**
```
┌─────────────────────────────────────────┐
│  ← Novo projeto             1/4         │
│  ▓▓▓▓░░░░░░░░░░░░░░░░░░                 │  ← progresso visual
└─────────────────────────────────────────┘
```

**Passo 1 — Identidade (1/4):** `name` (obrigatório, 3-100 chars), `justification` (obrigatório, 10+ chars).

**Passo 2 — Tempo e local (2/4):** `location` (select: campo_grande/recreio/barra/online/outro), `start_date`, `end_date`.

**Passo 3 — Pessoas e método (3/4):** `description`, `methodology`, `estimated_hours_week` (opcional).

**Passo 4 — Confirmação (4/4):** resumo + escolha de categoria (pedagogical/commercial/administrative/operational/event/infrastructure). CTA: "Criar projeto".

**Gate de permissão:**
- Coordinator/Director → `requires_approval=false`, status `planning`
- Collaborator comum → `requires_approval=true`, status `planning` → supervisor notificado via WhatsApp

---

### Tela 10 — Hábitos pessoais `/habitos` *(novo Sprint 11)*

**Route:** `<ProtectedRoute />` (any logged user)

**Role:** Todos · **Sprint:** 11 Bloco C / F2+

Lista de hábitos do colaborador com check diário, StreakRing por hábito (sequência atual e melhor sequência), HabitsHeatmap agregado dos últimos 30 dias.

**Privacidade:** RLS por `collaborator_id` — hábitos pessoais nunca visíveis para coordenador/diretor.

---

### Tela 11 — Checklists `/checklists` *(novo Sprint 11 F2+, refatorada Sprint 22.38)*

**Route:** `<ProtectedRoute />` (any logged user)

**Role:** Todos · **Sprint:** 11 F2+ → 22.38 (tabs)

Centro de checklists do user. **3 tabs** com URL state em `?tab=trabalho|pessoal|delegadas`:

- **Trabalho** (default): checklists operacionais despachados pelo TOM no dia corrente. Render via `ChecklistCard`. Realtime via canal `checklist-item-realtime` (inscrição em `op_checklist_item_completions`, `op_checklist_completions` e `op_checklist_completion_extra_items`). Polling 30s fallback.
- **Pessoal** (Sprint 22.38): listas que o user cria (`personal_checklists` + `personal_checklist_items`). Tipos: 🛒 mercado, ✈️ viagem, 💊 remédios, 📋 geral. CRUD completo via `PersonalChecklistCard` + `PersonalChecklistSheet`. DnD reorder, marcar/desmarcar, nota inline, renomear, mudar tipo, arquivar. RLS owner-only.
- **Delegadas** (Sprint 22.38): leitura de `tasks` onde `created_by = self != assigned_to`. Sub-tabs Ativas/Concluídas (30d). Atrasadas no topo. Render via `DelegatedTaskRow` (link pra `/projetos/:id` se houver, senão `/agenda`).

TOM lê listas pessoais no contexto (gated, só listas com pendências) e edita via `<<PERSONAL_LIST_ACTION>>` (skill `listas-pessoais.md`).

---

### Tela 12 — Checklists Templates `/mais/checklists-templates` *(novo Sprint 11 F2+)*

**Route:** `<ProtectedRoute />` — visível no menu Mais apenas para `requireRoles: ['director', 'coordinator']`

**Role:** Coordenador, Diretor · **Sprint:** 11 F2+

Gerenciamento de templates de checklists operacionais. CRUD via `TemplateSheet`. Suporte a arquivamento/desarquivamento (`Archive`/`ArchiveRestore`). Histórico de última auditoria por template.

---

### Tela 13 — Comunicados `/mais/comunicados` *(novo Sprint 13 F1)*

**Route:** `<ProtectedRoute />` — visível no menu Mais apenas para `requireRoles: ['director', 'coordinator']`

**Role:** Coordenador, Diretor · **Sprint:** 13 F1

Lista de comunicados (announcements) ordenados por data de criação (últimos 30). Status: draft, scheduled, sending (com progresso de jobs), sent, cancelled. Criação via `ComunicadoSheet` (FAB). Cancelamento de comunicados pendentes. Polling de jobs em andamento.

---

### Tela 14 — Agenda Escolar `/mais/agenda-escolar` *(novo Sprint 13 F2)*

**Route:** `<ProtectedRoute />` — visível no menu Mais apenas para `requireRoles: ['director', 'coordinator']`

**Role:** Coordenador, Diretor · **Sprint:** 13 F2

Lista de eventos escolares ativos ordenados por data. Criação via `EventoSheet` (FAB). Cancelamento de evento (propaga `cancelled` para announcements vinculados). Chips de status por etapa de comunicação (leadership/school/unit/dayOf) com indicador `scheduled_at`. Link para `EventoDetalhe` por tap no evento.

---

### Tela 15 — Observabilidade `/mais/observabilidade` *(novo Sprint 13 F3)*

**Route:** `<ProtectedRoute />` — visível no menu Mais apenas para `requireRoles: ['director', 'coordinator']`

**Role:** Coordenador, Diretor · **Sprint:** 13 F3

Dashboard de aprovações e métricas de envio de announcements (últimos 30 dias). Métricas por comunicado: jobs_total, jobs_sent, jobs_failed, jobs_pending, jobs_cancelled. Diretor pode aprovar/rejeitar comunicados em status `pending_approval` via `AprovacaoSheet`. Polling automático a cada 15s. Detecção de duplicatas via `detectDuplicates`.

---

### Tela 16 — Evento Detalhe `/mais/eventos/:id` *(novo Sprint 14 F1)*

**Route:** `<ProtectedRoute />` (any logged user com acesso via Agenda Escolar)

**Role:** Coordenador, Diretor · **Sprint:** 14 F1

Detalhe de um evento escolar com tarefas organizadas por setor (`logistica`, `tecnica`, `pedagogico`, `comunicacao`, `producao`). CRUD de tarefas de evento via `EventTaskSheet`. Toggle de status de tarefa inline. Exclusão com confirmação. Setores colapsáveis. Criação de nova tarefa com setor pré-selecionado.

---

### Tela 17 — Configurar Equipe `/mais/agenda-escolar/equipe` *(novo Sprint 14 F2)*

**Route:** `<ProtectedRoute />` (any logged user com acesso via Agenda Escolar)

**Role:** Coordenador, Diretor · **Sprint:** 14 F2

Configuração do mapeamento setor × responsável por unidade (barra/recreio/campo_grande). Seletor de unidade + selects de colaborador por setor (`event_team_map`). Salva/atualiza via upsert. Feedback inline de confirmação.

---

### Tela 18 — Operações Técnicas `/mais/operacoes` *(novo Sprint 15 F3)*

**Route:** `<ProtectedRoute />` — visível no menu Mais apenas para `requireRoles: ['director', 'coordinator']`

**Role:** Coordenador, Diretor · **Sprint:** 15 F3

Fila operacional do departamento Operações Técnicas. 4 filtros: unidade, tipo de requisição (`request_type_id`), status, responsável. Cards agrupados por prioridade (🔴 critical / 🟠 high / 🟡 medium / 🟢 low). Sem botão "+ Nova" — o canal de criação é exclusivamente o TOM (skill `operacoes-tecnicas`). Dados vinculados a `tasks` com `department_id` + `request_type_id`. Tipos de tarefa e constantes exportados de `types.ts`: `Department`, `DepartmentRequestType`, `OperationalTask`, `STATUS_LABEL_OPERATIONAL`, `PRIORITY_INDICATOR`.

**Mais.tsx:** item "Operações Técnicas" adicionado — label "Fila de demandas operacionais".

---

## Auth — Magic Link via WhatsApp

**Fluxo:**
1. Usuário acessa PWA → tela de login
2. Digita número de WhatsApp
3. TOM envia código OTP via WhatsApp (Edge Function `send-magic-link`)
4. Usuário digita código → autenticado com session JWT
5. Role carregada do banco (`collaborators.role`)

**Sem senha. Sem cadastro manual.** Fallback de email/password disponível em caso de falha do WhatsApp.

---

## Princípios de design

- **Mobile-first:** layout pensado para 375px, funciona em desktop
- **Dark mode padrão:** paleta dark com opção light coerente
- **Privacidade por design:** pessoal nunca vaza para coordenador
- **Espelho, não duplicata:** lógica de negócio fica no TOM/engine, o PWA só exibe e dispara ações estruturadas (markers via webhook quando aplicável)
- **Wizard antes de formulário:** para fluxos formativos (Project Wizard), passos guiados visualmente >>> formulário denso

---

## Tecnologia

| Camada | Escolha |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| PWA | vite-plugin-pwa |
| Estilização | Tailwind CSS + tokens CSS vars |
| Estado | TanStack Query + Context |
| Backend | Supabase (em produção) |
| Auth | Supabase Auth + magic link WhatsApp |
| Deploy | VPS (89.116.73.186, nginx + PM2) |
| Hosting backend TOM | VPS (89.116.73.186, nginx + PM2) |

---

## O que muda v3.1 → v3.2

| Item | v3.1 | v3.2 |
|---|---|---|
| Total de telas | 9 em produção + Project Wizard planejada | 17 em produção |
| Status geral | Sprints 0→7 em produção | Sprints 0→14 em produção |
| Project Wizard | Sprint 8 planejada | ✅ Entregue Sprint 8 |
| Hábitos | Sprint 8+ planejada | ✅ Entregue Sprint 11 |
| Checklists operacionais (colaborador) | Sprint 8+ planejada | ✅ Entregue Sprint 11 F2+ |
| Checklists Templates (coord/dir) | Sprint 8+ planejada | ✅ Entregue Sprint 11 F2+ |
| Comunicados | Sprint 8+ planejada ("Broadcast") | ✅ Entregue Sprint 13 F1 |
| Agenda Escolar | Não previsto | ✅ Entregue Sprint 13 F2 |
| Observabilidade | Não previsto | ✅ Entregue Sprint 13 F3 |
| Evento Detalhe | Não previsto | ✅ Entregue Sprint 14 F1 |
| Configurar Equipe | Não previsto | ✅ Entregue Sprint 14 F2 |
| Hoje — filtro action_type | Não previsto | ✅ Entregue Sprint 12 Bloco D |
| Histórico — agrega events | Apenas tasks | ✅ Inclui tasks + events (work) |
| Hosting PWA | Vercel (decidido) | VPS (nginx + PM2) |

## O que muda v3.2 → v3.3 *(Sprint 15)*

| Item | v3.2 | v3.3 |
|---|---|---|
| Total de telas | 17 em produção | 18 em produção |
| Status geral | Sprints 0→14 em produção | Sprints 0→15 em produção |
| Operações Técnicas | Não previsto | ✅ Entregue Sprint 15 F3 (`/mais/operacoes`) |
| types.ts novos | — | `Department`, `DepartmentRequestType`, `OperationalTask`, `STATUS_LABEL_OPERATIONAL`, `PRIORITY_INDICATOR` |
| Canal de criação operacional | — | Exclusivamente via TOM (sem FAB na tela) |

---

## O que muda v3.3 → v3.4 *(Sprint 22.x — Agenda revamp + TOM mensageria)*

### Hoje (`/hoje`) — refatorada

| Camada | Antes | Depois |
|---|---|---|
| Tabs | 2 (Trabalho/Pessoal) | **3 (Trabalho · Pessoal · Delegadas)** com badges de count |
| TaskRow | Texto plano + checkbox | `<article>` card: GripVertical (DnD), checkbox toggle, **dot Eisenhower (Q1/Q2/Q3 manual)**, RowMenu (Editar/Reagendar/Excluir) inline, badge status |
| EventRow | Texto + click pra editar | Checkbox toggle done, **dot Eisenhower**, RowMenu (Cancelar/Excluir), badge categoria reposicionado pra linha de meta (não quebra título) |
| Hábitos | Junto das tasks | **Bloco próprio no topo da aba Pessoal** (Sprint 22.5) |
| FAB criação | 2 kinds | **3 kinds (Tarefa · Compromisso · Delegar)** via QuickCreateSheet |
| Categorias | Hardcoded | **Tabela `event_categories`**: LA Music · Aula Particular/Mentoria · Gravação/Produção · Show · Pessoal + categorias pessoais por usuário |
| Picker datetime | `<input type=date>` nativo | **DateInput + TimeInput popover** custom (calendar grid + 30min slots) |

### Semana (`/semana`) — refatorada

| Camada | Antes | Depois |
|---|---|---|
| Tabs | Nenhuma — só work | **3 (Trabalho · Pessoal · Delegadas)** espelhando Hoje |
| Eventos | Texto plano (hora + título) | Checkbox toggle done + **dot Eisenhower** + clique abre EditEventSheet |
| Tasks pessoais | Não apareciam (filter context=work) | **Visíveis na aba Pessoal** distribuídas por dia |
| Delegadas | Inexistente | **Distribuídas SEG–SAB** (não flat); ⚠ N indicator de overdue |
| AgendaTabs (Dia/Semana) | Existia | Indicador deslizante iOS-style mantido |
| Toggle done | Só tasks | Tasks **+ events** com mutation que invalida `['events']` |

### CRUD avançado e edit sheets

| Sheet | Função | Sprint |
|---|---|---|
| **EditTaskSheet** | Edit completo: title, context toggle, datetime, Eisenhower; modo "Delegada para X" read-only | 22.30 |
| **EditEventSheet** | Categoria, Eisenhower, ParticipantsPicker com diff (toAdd/toRemove) | 22.32 |
| **RescheduleSheet** | Atalho "só reagendar"; remove filtro `assigned_to=me` pra creator reagendar delegada (RLS Sprint 22.29 já permitia) | 22.34m |
| **QuickCreateSheet** | 3 kinds, categories dinâmicas (`+ Nova categoria pessoal`), participants picker, Eisenhower picker, **detecção de conflito de horário** com banner amarelo | 22.34i |

### Componentes novos

| Componente | Função |
|---|---|
| `EisenhowerPicker.tsx` | 4 chips coloridos manual (sem expor jargão "Eisenhower") |
| `DateInput.tsx` | Calendar popover, `position: fixed` z-1000 (escapa overflow do BottomSheet) |
| `TimeInput.tsx` | Lista 30min slots, mesma estratégia z-index |
| `DateTimeInput.tsx` | Combinação dos dois |
| `Toast.tsx` + `ToastHost` | Window-event-based, slide-up + scale, autohide 4.5s, kinds success/error/info — montado no AppShell |
| `ParticipantsPicker.tsx` | Multi-select de colaboradores pra event_participants |
| `RowMenu.tsx` | Menu kebab inline (⋮) por linha pra Editar/Reagendar/Cancelar/Excluir |
| `Tabs.tsx` | Já existia, agora consistente em Hoje + Semana + ProjetoDetalhe |

### TOM ↔ PWA mensageria (Sprint 22.33–22.34m)

3 endpoints internos no backend (auth via `x-internal-secret`, CORS habilitado pra `/internal/*`):

| Endpoint | Trigger | Mensagem WhatsApp |
|---|---|---|
| `POST /internal/task-delegated` | PWA delega tarefa pra colega | "📌 *<creator>* delegou uma tarefa pra você: ..." |
| `POST /internal/event-invites` | PWA cria evento com participants | "📅 *<creator>* te convidou pra um compromisso: ..." (loop por participant não notificado) |
| `POST /internal/task-updated` | PWA reagenda/edita delegada | "🔄 *<creator>* reagendou/atualizou uma tarefa que tá com você: ..." |

Cliente em `web/src/lib/tomEngine.ts` retorna `NotifyResult` (`{ok, status, sent, reason}`) — fetch awaited (não fire-and-forget). Toast mostra resultado real ao usuário (success verde / error vermelho com motivo).

Idempotência via `marker_logs` (`TASK_DELEGATED`, `EVENT_INVITES`, `TASK_UPDATED`) + `event_participants.notified_at`.

### Tabelas novas / migrations Sprint 22

- `event_categories` (Sprint 22.26): slug + label + tone + context, com categorias pessoais por colaborador
- `event_participants` (Sprint 22.32): event_id + collaborator_id + status (invited/confirmed/declined) + invited_by + invited_at + responded_at + notified_at + RLS
- `tasks.eisenhower_quadrant` ALTER (Sprint 22.30; antes só em tasks via trigger; agora também em events)
- `events.eisenhower_quadrant` ALTER (Sprint 22.30)
- Trigger `fn_calculate_eisenhower` (Sprint 22.32b respeita manual; Sprint 22.34d desativado por gerar Q3/Q1 demais — fica NULL até user marcar)
- `marker_logs.result` CHECK constraint expandido (Sprint 22.34l): `executed/rejected/skipped/redirected`
- RLS Sprint 22.23: UPDATE/DELETE com `context = 'work'` filter
- RLS Sprint 22.29: `auth_update_created_tasks` + `auth_delete_own_tasks` — creator pode mexer em delegadas

### Hospedagem

| Item | v3.3 | v3.4 |
|---|---|---|
| Hosting PWA | VPS (nginx + PM2) | **Vercel auto-deploy** + VPS pro backend TOM |
| Deploy script | manual | `bash scripts/push-and-deploy.sh /tmp/deploy-X` (auto-detect mudanças em `src/skills/migrations` → `ssh tom "git pull && pm2 restart tom"`) |
| Vercel rewrites | — | `/internal/*` → `http://89.116.73.186/internal/*` (server-side, sem CORS) |
| Env vars | `web/.env` local | Vercel dashboard tem `VITE_INTERNAL_API_SECRET` + `VITE_SUPABASE_*` |
