# Roadmap LA Organizer — Histórico Sprint 0→20

> Histórico cronológico das sprints. Para o estado atual do produto, ver PRD (`docs/06-prd-la-organizer-v3.md`). Para schema do banco, ver `docs/03-esquema-banco-dados-la-organizer.md`. Para limites de papel do TOM, ver `docs/TOM-LIMITES.md`.
>
> **Nota sobre sprints 0–10:** não há specs ou reports granulares para este período. O histórico foi reconstruído a partir do PRD v3.1 (escrito em 2026-04-28) e dos comentários inline do engine.js.
>
> **Atualizado Sprint 20 (2026-05-05):** adicionada seção Sprint 20 (Gerência) + radar pós-sprint com 11 hotfixes. Decisão estratégica do PO: **fechar fase de expansão de departamentos**.
>
> **Atualizado Sprint 26 (2026-05-10):** adicionadas seções Sprint 21 (Listas Pessoais), Sprint 22 (Mídia Bidirecional + Confirmação de Leitura + Comunicados com Anexo) e Sprint 26 (Agenda LA Music v2 — schema expandido, 5 visualizações, CRUD, TOM skill, cron mensal, link Comunicados↔Eventos, fila anti-ban Meta, fix crítico function_role→role). Sprints 23–25 do board de produto absorvidas nessas entregas. Pendente real: Sprint 23 (revisão de skills, system.js 96KB→45KB), Audit Lote 2/3, Auth E2E.

---

## Fase 0 — Infraestrutura base

**Status:** entregue
**Período:** anterior a Sprint 0 PWA

**Entregas:**
- VPS configurada (Ubuntu)
- Supabase Postgres com schema inicial
- Webhook UAZAPI → Node.js
- TOM engine (engine.js) com pipeline processMessage
- pm2 para gestão de processos
- Integração WhatsApp ↔ Claude API

---

## Fase 1 — TOM WhatsApp (agente completo)

**Status:** funcionalmente concluída
**Período:** anterior a Sprint 0 PWA

> Histórico não documentado em detalhes — ver PRD seção 4.1 para lista completa de capacidades.

**Entregas principais:**
- Onboarding conversacional (5 perguntas)
- Rituais: briefing trabalho (8h), briefing pessoal (7h), fechamento (19h), planejamento semanal (domingo), retrospectiva semanal (coordenador), resumo do time (coordenador, 19h30)
- Nudge de aderência (19h, condicional: ≥2 tasks atrasadas ou ≥1 projeto parado)
- Criação, ticar, reagendar, delegar tasks
- Pedir prazo + aprovação coordenador
- Criação de projeto 5W2H via conversa (7 perguntas)
- Compromissos (criar/atualizar/cancelar/concluir via WhatsApp)
- Separação pessoal × trabalho
- Hábitos pessoais (criar, marcar, streak)
- Do not disturb por colaborador
- Consolidação de memória (cron domingo 22h)
- Tratamento de áudio (Whisper/OpenAI)
- 4 guards: serialização de fila, dedupe, validação de markers, anti-leak
- Observabilidade: `ritual_logs`, `marker_logs`
- Resiliência: restart behavior, fallback provider, segredos rotacionados
- Skills: `rituais-diarios`, `gestao-memoria`, `cadastro-projeto-5w2h`, `priorizacao-inteligente`, `planejamento-semanal`, `criar-compromisso`, `habitos-pessoais`, `pausa-temporaria`, `tratamento-audio`, `checklist-tarefas`

**Markers implementados:** `<<ONBOARDING_DONE>>`, `<<MEMORY_SAVE>>`, `<<PROJECT_CREATE>>`, `<<TASK_UPDATE>>`, `<<CHECKPOINT_BATCH>>`, `<<EVENT_CREATE>>`

---

## Sprint 0 — PWA base

**Status:** entregue
**Período:** início Fase 2

> Histórico não documentado em detalhes — reconstruído a partir do PRD.

**Entregas:**
- PWA React mobile-first (Vite + TypeScript)
- Autenticação (base para magic link)
- Telas: Hoje, Semana, Projetos (lista), Projeto Detalhe
- Dashboard do time (`/time`) — Coordenador+
- AppShell com navegação bottom tab

---

## Sprint 1 — Configurações e Histórico

**Status:** entregue

> Histórico não documentado em detalhes — reconstruído a partir do PRD.

**Entregas:**
- Tela Configurações (`/configuracoes`) — horários, intensidade do TOM
- Tela Histórico (`/historico`) — aderência dos últimos 30 dias

---

## Sprint 2 — Login magic link

**Status:** entregue

> Histórico não documentado em detalhes — reconstruído a partir do PRD.

**Entregas:**
- Login via magic link por WhatsApp (`/login`)
- Anne Susan entra como segunda usuária (collaborator, Campo Grande)

---

## Sprints 3–5 — Estabilização e segurança

**Status:** entregue

> Histórico não documentado em detalhes.

**Entregas (inferidas do PRD):**
- Rotação de segredos UAZAPI (Sprint 5)
- Anti-leak guard no engine (regex bloqueando termos de stack)
- MCP tools desligadas no TOM
- Privacidade por design: hábitos 100% privados, `context='personal'` isolado

---

## Sprint 6 — Pessoa Detalhe

**Status:** entregue

> Histórico não documentado em detalhes — reconstruído a partir do PRD.

**Entregas:**
- Tela Pessoa Detalhe (`/time/:id`) — Coordenador+

---

## Sprint 7 — Segurança e resiliência

**Status:** entregue

> Histórico não documentado em detalhes — reconstruído a partir do PRD.

**Entregas:**
- Rotação de segredos Supabase
- Privatização do repositório
- Anti-leak guard documentado na seção 3.2 e 9 do PRD
- MCP tools desligadas no Claude CLI do engine

---

## Sprint 8 — Project Wizard + Hábitos PWA

**Status:** entregue

> Histórico não documentado em detalhes — Sprint 8 estava "planejada" no PRD v3.1, portanto entregue antes do período com specs.

**Entregas:**
- Project Wizard (`/projetos/novo`) — wizard 4-passos replicando fluxo 5W2H
  - Colaborador cria → `status='planning'` aguarda aprovação
  - Coordenador/Diretor cria → entra em produção imediato
  - Dispara `<<PROJECT_CREATE>>` no engine
- Skill `aprovar-projeto.md` (gate de aprovação de projetos de colaborador)
- Tela Hábitos (`/habitos`) — privado por design
- Hábitos integrados ao PWA (criar, marcar, streak)

---

## Sprints 9–10 — Iterações PWA

**Status:** entregue

> Histórico não documentado em detalhes. Sprints inferidas pela numeração; sem specs disponíveis.

**Provável conteúdo:** iterações de UX nas telas existentes, estabilização, correções.

---

## Sprint 11 F2+ — Checklists Operacionais

**Status:** entregue
**Data:** 2026-04-29
**Spec:** `docs/superpowers/specs/2026-04-29-checklists-operacionais-design.md`
**Spec CRUD:** `docs/superpowers/specs/2026-04-29-checklists-crud-templates-design.md`

> Nota: nomeada "Sprint 11 F2+" nos artefatos — indica que Sprint 11 teve pelo menos uma fatia anterior não documentada em spec.

**Entregas:**
- DB: tabelas `checklist_templates` e `checklist_instances` com RLS; 4 templates seed (abertura manhã, fechamento noite, show/evento, reunião mensal)
- Dispatch: cron dispara instâncias por função e turno conforme templates ativos
- WhatsApp: TOM recebe respostas de checklist, parser `parseChecklistActionMarker`, marker `<<CHECKLIST_ACTION>>`; `applyChecklistAction()` no engine
- PWA: tela `/checklists` (visualizar e ticar itens, realtime Supabase), tela `/mais/checklists-templates` (CRUD de templates — Coord+)
- Skill TOM: `checklists-operacionais.md`
- Marker novo: `<<CHECKLIST_ACTION>>`

---

## Sprint 12 — (não documentado)

**Status:** inferido como entregue (numeração entre Sprint 11 e Sprint 13)

> Sem spec ou plan disponível. Conteúdo desconhecido.

---

## Sprint 13 — Coordenação operacional + comunicação interna

**Status:** entregue (4 fatias)

### Fatia 1 — Comunicados segmentados (2026-04-29)
**Spec:** `docs/superpowers/specs/2026-04-29-sprint13-fatia1-comunicados-design.md`

**Entregas:**
- DB: tabela `announcements` com campos de audiência (unit, role, individual), estado (`draft`/`pending_approval`/`scheduled`/`sending`/`sent`/`cancelled`/`rejected`), fila com retry/anti-spam
- TOM skill: `comunicados.md` — coordinator/director cria comunicado via chat, marker `<<ANNOUNCEMENT_ACTION>>`; `applyAnnouncementAction()` no engine
- Broadcaster: função `dispatchAnnouncements(now)` no dispatcher com fila ativa e retry
- PWA: tela `/mais/comunicados` (Coord+) — lista e sheet de criação

### Fatia 2 — Eventos institucionais (2026-04-29)
**Spec:** `docs/superpowers/specs/2026-04-29-sprint13-fatia2-eventos-design.md`

**Entregas:**
- DB: tabela `school_events` com campos de data, local, unidade, audiência, plano de comunicação (`cancel_retraction_sent`, `coordinator_notified_at`)
- Auto-geração de anúncios: lógica por etapa (T-3 escola toda, T-1 unidade, imediato liderança)
- TOM skill: `eventos-institucionais.md` — criar/cancelar evento via chat, marker `<<SCHOOL_EVENT_ACTION>>`
- PWA: tela `/mais/agenda-escolar` (Coord+) — lista de eventos com `AgendaEscolar.tsx` e `EventoSheet.tsx`

### Fatia 2 T0 — Lembrete no dia do evento (2026-04-30)
**Spec:** `docs/superpowers/specs/2026-04-30-sprint13-fatia2-t0-lembrete-dia.md`

**Entregas:**
- DB migration: campo `reminded_t0_at` em `school_events`
- Engine: `buildEventAnnouncements` inclui etapa T0 (lembrete no dia às 09h)
- PWA: `EventoSheet.tsx` e `AgendaEscolar.tsx` atualizados para exibir badge T0 configurado
- TOM skill: `eventos-institucionais.md` atualizada com campo `reminder_day_of`

### Fatia 3 — Aprovação + Observabilidade (2026-04-30)
**Spec:** `docs/superpowers/specs/2026-04-30-sprint13-fatia3-aprovacao-observabilidade-design.md`

**Entregas:**
- DB: coluna `status` em `announcements` ampliada para máquina de estados (`pending_approval` → `scheduled`/`rejected`); RLS por role; colunas de auditoria
- Fluxo TOM: coordinator cria → director recebe notificação → aprova/rejeita via `APROVAR <id>` / `REJEITAR <id> [motivo]`
- Marker `<<ANNOUNCEMENT_APPROVAL>>`; `applyAnnouncementApproval()` no engine
- Skill TOM: `aprovacao-comunicados.md` (carregada para director e coordinator)
- PWA: tela `/mais/observabilidade` (Coord+) — fila de aprovações pendentes, fila ao vivo, histórico, contadores (`jobs_total`, `jobs_sent`, `jobs_failed`, `jobs_cancelled`, `jobs_pending`), alerta de duplicidade; `AprovacaoSheet.tsx`

---

## Sprint 14 — Tarefas de Eventos

**Status:** entregue (2 fatias)
**Data:** 2026-05-01
**Report:** `docs/superpowers/reports/2026-05-01-sprint14-executive-summary.md`

### Fatia 1 — CRUD de Tasks de Evento (PWA) (2026-05-01)
**Spec:** `docs/superpowers/specs/2026-05-01-sprint14-fatia1-event-tasks-design.md`

**Entregas:**
- DB: `tasks` ganhou `school_event_id`, `event_sector`, `notes`, `support_team`, status `awaiting_confirmation` + índice composto
- Tela `/mais/eventos/:id` com 5 acordeões por setor: Logística, Técnica, Pedagógico, Comunicação, Produção
- Setores com tasks abertas expandidos por padrão; vazios colapsados
- TaskSheet (bottom sheet): responsável principal, equipe de apoio, notas, prazo, status
- Toggle de conclusão inline, edição e exclusão com confirmação
- Acesso via card na Agenda Escolar (`AgendaEscolar.tsx` atualizado)

### Fatia 2 — TOM Kit + Mapa de Equipe + Lembretes (2026-05-01)
**Spec:** `docs/superpowers/specs/2026-05-01-sprint14-fatia2-tom-kit-equipe-design.md`

**Entregas:**
- DB: `school_events.event_type` (8 valores: show, recital, workshop, treinamento, oficinas, reunião, formatura, genérico), tabela `event_team_map` (unit × sector → collaborator) com RLS, `tasks.reminded_at`
- Engine: 5 famílias de kit hardcoded (32 tasks total):
  - show/recital → 9 tasks
  - workshop/treinamento/oficinas → 6 tasks
  - reunião → 4 tasks
  - formatura → 8 tasks
  - evento genérico → 5 tasks
- `applySchoolEventAction` (create path): lê mapa de equipe da unidade, gera kit atribuindo tasks por setor; fallback ao criador quando não há mapa
- Dispatcher: bloco `remindEventTasks` — envia WhatsApp T-1 às 09h BRT para tasks `school_event_id IS NOT NULL` pendentes; dedup via `reminded_at`
- TOM skill `eventos-institucionais.md`: campo `event_type` no marker, regras de inferência, novo resumo de confirmação (5ª linha)
- PWA: tela `/mais/agenda-escolar/equipe` (`ConfigurarEquipe.tsx`) com tabs por unidade × 5 selects de setor (upsert no `event_team_map`)

---

## Sprint 15 — Camada Operacional Replicável

**Status:** entregue (4 fatias)
**Data:** 2026-05-03

### Fatia 1 — DB + Seed Operações Técnicas (Sprint 15 F1)

**Entregas:**
- DB: tabela `departments` (id, slug UNIQUE, name, description, is_active, unit_scope_enabled, default_responsible_id FK collaborators) com RLS (select: todos; write: coord/director)
- DB: tabela `department_request_types` (id, department_id FK ON DELETE CASCADE, slug, label, description, default_priority CHECK, requires_approval, generates_task, is_active, sort_order) com RLS (select: todos; write: coord/director); UNIQUE (department_id, slug)
- DB: `tasks` ganhou `department_id` (FK departments ON DELETE SET NULL) e `request_type_id` (FK department_request_types ON DELETE SET NULL) — ambos nullable com índices parciais
- DB: `op_checklist_items` ganhou `generates_request_type_id` (FK department_request_types ON DELETE SET NULL) — índice parcial
- Seed: departamento `operacoes-tecnicas` + 6 tipos de requisição; `default_responsible_id` = Rafinha (id c9e72a40, phone 5521973008639)

### Fatia 2 — Engine + Skill TOM (Sprint 15 F2)

**Entregas:**
- Engine (`applyTaskActions`, create path): whitelist expandida aceita `department_id`, `request_type_id`, `description`, `notes`; validação UUID; lookup do request_type; auto-deriva `department_id` quando só `request_type_id` fornecido; auto-set `status='awaiting_confirmation'` quando `requires_approval=true`
- Skill TOM `skills/operacoes-tecnicas.md`: 3 turnos (captura/triagem/confirmação), 6 tipos hardcoded com UUIDs do seed, regra de impacto-em-aula (bumpa priority para critical), carregada para TODOS os roles em `prompts/system.js`

### Fatia 3 — PWA Fila Operacional (Sprint 15 F3)

**Entregas:**
- Tela `OperacoesFilaTecnica.tsx` em `/mais/operacoes` — fila do departamento Operações Técnicas
- 4 filtros: unidade, tipo de requisição, status, responsável
- Cards agrupados por prioridade (🔴 critical / 🟠 high / 🟡 medium / 🟢 low)
- Sem botão "+ Nova" — TOM é o canal de criação
- `Mais.tsx` atualizado: item "Operações Técnicas" visível para coordinator/director
- `types.ts` atualizado: `Department`, `DepartmentRequestType`, `OperationalTask`, `STATUS_LABEL_OPERATIONAL`, `PRIORITY_INDICATOR`

### Fatia 4 — Dispatcher (Sprint 15 F4)

**Entregas:**
- Bloco novo `checkDepartmentOperational`: segunda 07:25–07:35 BRT; para cada `departments` ativo com `default_responsible_id`, envia briefing semanal via WhatsApp com contadores de fila por prioridade; idempotência via `ritual_logs` (`ritual_type='dept_operational_briefing'`, `reference_date=today`)
- Bloco novo `checkChecklistConsequences`: todo tick; quando `op_checklist_item_completions` registra `is_checked=false` em item com `generates_request_type_id`, cria task automática (`source='system'`); idempotência via sentinel `cic:<id>` em `tasks.notes`
- Wired em `run()` entre `dispatchChecklists` e `notifyCoordinators`

**Decisão de produto:**
- Briefing semanal: segunda 07:30 BRT (não sexta 17h) — timing de ação, coerência com briefing matinal pessoal, pareamento com `daily_plans`

---

---

## Sprint 16 — Coordenação Conversacional via TOM (2026-05-03)

**Status:** entregue + bugs cognitivos diagnosticados (input para Sprint 17)
**Spec:** `docs/superpowers/specs/2026-05-03-sprint16-coordenacao-conversacional-design.md`
**Plan:** `docs/superpowers/plans/2026-05-03-sprint16-coordenacao-conversacional.md`
**Reports:** `docs/superpowers/reports/2026-05-03-sprint16-bugs-cognitivos.md`
**Commits principais:** `5a02562`, `027d660`, `484d708`, `7614997`

### Entregas

- Tabela `coordination_requests` (mode, status, message_body, response_summary, deadline, cancelled_reason)
- Marker `<<COORDINATION_REQUEST>>` (relay_literal, relay_assisted, followup) + `<<COORDINATION_RESPONSE>>`
- Skill `coordenacao-conversacional.md` (auxiliar global) — relay/followup, regras de alçada (collaborator não emite followup, coord/manager não cobra director)
- COORD_HINT injetado no prompt quando recipient tem recados pendentes
- Engine: `applyCoordinationRequestAction` com gating, INSERT, sendMessage, UPDATE
- Detecção de resposta automática (LLM emite COORDINATION_RESPONSE quando recipient responde)
- Dispatcher: `checkCoordinationTimeouts` envia alerta quando `response_deadline_hours` expira

### Bugs cognitivos identificados (input Sprint 17)
- Perda de referente anafórico ("agradece a ele" sem ator ativo)
- Mistura de threads paralelas
- Deadline implícita ignorada
- Microconfirmação faltante
- Confusão de papel quando user é simultaneamente requester e recipient

---

## Sprint 17 — Active Coordination Context (ACC) (2026-05-03)

**Status:** entregue + validado E2E
**Spec:** `docs/superpowers/specs/2026-05-03-sprint17-acc-design.md`
**Plan:** `docs/superpowers/plans/2026-05-03-sprint17-acc.md`
**Commit:** `986049c`

### Entregas

- `buildActiveCoordinationContext(collab)` injeta bloco `[ACTIVE_COORDINATION_CONTEXT]` com FOCUS_CANDIDATE + FOCUS_CONFIDENCE (high/medium/low/none)
- 4 queries de seleção de contexto ativo + 7 prioridades de heurística (resposta recente <30min → high; request recém-criado <30min → high; clustering por ator → medium etc.)
- Skill `coordenacao-conversacional.md` atualizada com tabela de heurísticas e política por confidence
- Convive com COORD_HINT (Sprint 16) — funções complementares

### Validação

- "Agradece a ele" resolvido automaticamente para Rafinha sem perguntar
- Microconfirmação em medium ("Vou avisar o Yuri — pode?")
- "Diz que está autorizado" resolvido para o request mais recente em que TOM era recipient

---

## Sprint 18 — Integridade de Agenda e Execução (2026-05-03→05)

**Status:** entregue (ativada de fato em 2026-05-05 com fix do `loadSkill` durante Sprint 19)
**Spec:** `docs/superpowers/specs/2026-05-03-sprint18-integridade-design.md`
**Plan:** `docs/superpowers/plans/2026-05-03-sprint18-integridade.md`
**Commits:** `5834130` (feat) + `637e697` (loadSkill fix) + `14b2e35` + `837f461` (jaroWinkler hotfixes)

### Princípio mãe
"alertar > sugerir > confirmar > criar" — bloqueio só em impossibilidade física confirmada.

### Entregas

- 3 helpers detectores em `engine.js`:
  - `detectTemporalConflict` (HARD se mesma sala/local confirmado, SOFT caso contrário; via PostgreSQL `tsrange &&`)
  - `detectDuplicateSemanticEvent` (Jaro-Winkler com strip de suffix)
  - `detectDuplicateSemanticTask` (mesmo, threshold 0.7, boosts +0.05 dept/+0.05 type)
- Pre-check hooks em `applyEventActions` create + `applyTaskActions` create
- A1: DUP nunca auto-bloqueia (retorna soft payload; skill apresenta microconfirmação)
- A2: SOFT pede microconfirmação; só insere em novo turno após confirmação
- A3: dia carregado é alerta complementar, não bloqueia
- Skill `integridade-agenda.md` (auxiliar global)
- Dispatcher: `detectStaleTasks` (segunda 09h, 14d, max 5) + `detectUnclosedPastEvents` (diário 09:30, max 3)

### Bugs descobertos durante uso (corrigidos durante Sprint 19)
- `loadSkill('integridade-agenda.md')` chamado com `.md` duplicado → skill nunca carregava em produção
- Boost +0.2 dept + +0.2 type em jaroWinkler causava falsos positivos sistemáticos
- Strip do suffix "— UNIDADE/SALA" antes do jaroWinkler era necessário (suffix dominava match)

---

## Sprint 19 — Camada Pedagógica (2026-05-04→05)

**Status:** ENCERRADA + validada E2E em produção
**Spec:** `docs/superpowers/specs/2026-05-03-sprint19-pedagogico-design.md`
**Plan:** `docs/superpowers/plans/2026-05-03-sprint19-pedagogico.md`
**Closure report:** `docs/superpowers/reports/2026-05-05-sprint19-closure.md`
**Commits:** `8d6be1a` (feat) + 12 hotfixes/radar (`637e697` → `49fa159`)

### Princípio
Pedagógico é **configuração + skill + alçada** — não é módulo. Reusa Sprint 15/16/17 sem novo motor.

### F1 — Schema + Seed
- `tasks.subdomain` (text CHECK ∈ {'school','kids'})
- `collaborators.pedagogical_role` (text CHECK ∈ {'lead','assistant','mentor'})
- Tabela `pedagogical_assignments(collaborator_id, scope_type, scope_value)` com PK composta + RLS
- Seed: department `pedagogico` + 7 request types (acompanhamento-professor, apoio-ao-aluno, alinhamento-de-turma, alinhamento-com-responsavel, evento-pedagogico, pendencia-pedagogica, suporte-ao-professor)
- 11 colaboradores criados/atualizados com `pedagogical_role`: lead (Juliana, Quintela), assistant (Leo, Ramon, Dai, Matheus Felipe, Jordan, Rodrigo), mentor (Peterson, Kinho, Renan)
- 10 atribuições de escopo

### F2 — Engine helpers + handlers
- 4 helpers novos: `getPedagogicalRole`, `findPedagogicalAssignee`, `scopeOverlap`, `canDelegatePedagogical`
- Gate pedagógico tem **PRECEDÊNCIA** sobre gate genérico Sprint 16 (DENY pedagógico = DENY final)
- Regra de match de escopo: 1 match (unit OR specialty OR subdomain) já autoriza assistant
- `applyTaskActions` create aceita `subdomain`

### F3 — Skill `pedagogico.md`
- Auxiliar global (carrega para todos os roles)
- Hierarquia, mapa de escopo, 7 request types, regra de precedência, regra de match de escopo, 6 exemplos verbatim do PRD §7
- UUIDs reais embutidos (departamento + 7 request types)

### F4 — Loader em `system.js` + pickSkill
- `loadSkill('pedagogico')` injetado como auxiliar global em `buildSystemPrompt`
- pickSkill ganhou 2 branches novos: pedagogico (gatilhos: aluno/professor/turma/recital/banda/kids/school + nomes da equipe) e operacoes-tecnicas (sala/ar-condic/lâmpada/equipamento/instrumento/material)

### Validação E2E em produção
- ✅ Task pedagógica criada: *"Alinhamento com responsável — frequência baixa aluna Marina (canto)"* → dept=pedagogico, req_type=alinhamento-com-responsavel, subdomain=school, assignee=Juliana
- ✅ Task operacional criada: *"Ar-condicionado parou — Recreio Sala 5"* → dept=operacoes-tecnicas, req_type=incidente-tecnico, priority=critical
- ✅ TOM identificou subdomain inferido pelo contexto ("violão iniciante 7 anos" → kids → Quintela)

### Radar pós-Sprint 19 (4 ajustes UX entregues no mesmo dia)
- **R1:** PWA traduz `Crítico` → "Urgente" + concordância de gênero (Alta/Média/Baixa); `unitLabel('all')` → "Todas"
- **R2:** Cabeçalho relay enxuto — só primeiro nome ("O Luciano me pediu" sem `(CEO/Fundador)`)
- **R3:** TOM se apresenta na 1ª vez com cada novo collaborator
- **R4:** Bug B2 — alucinação `"✅ Registrado!"` substituída por microconfirmação determinística no engine (`_buildIntegrityConfirmText`) cobrindo dup_task/dup_event/temporal_hard/temporal_soft

### Não-objetivos afirmados
- ❌ Não cria módulo Eventos. `evento-pedagogico` = task com nota.
- ❌ Professor não vira collaborator no MVP.
- ❌ Sem dashboard pedagógico analítico, sem timeline custom de caso.

---

## Sprint 20 — Camada de Gerência + Radar pós-sprint (2026-05-05)

**Status:** ENCERRADA + decisão estratégica de fechar fase de departamentos
**Spec:** `docs/superpowers/specs/2026-05-05-sprint20-gerencia-design.md`
**Plan:** `docs/superpowers/plans/2026-05-05-sprint20-gerencia.md`
**Closure report:** `docs/superpowers/reports/2026-05-05-sprint20-closure.md`
**Limites doc:** `docs/TOM-LIMITES.md`
**Commits:** `920d5c7` (feat) + 11 hotfixes radar (`dd7930c` → `1daf538`)

### Princípio
Gerência é **filtro inteligente da unidade** — gerente articula, avalia e roteia. Não resolve tudo sozinho.
Sem schema novo: reuso de `role='manager'` + coluna `unit` (Sprint 15).

### F1 — Seed (zero migrations)
- Department `gerencia` + 8 request types (risco-de-evasao, recuperacao-de-aluno, alinhamento-com-responsavel, problema-de-atendimento, experiencia-da-unidade, negociacao-relacional, pendencia-gerencial, articulacao-interna)
- 3 gerentes: Jereh (`campo_grande`), Clayton (`recreio`), Krissya (`barra`)
- Diferenciação manager+unit específica vs `unit='all'` (Yuri/Marketing)

### F2 — Engine
- Helper `findAssistantByUnit` com mapeamento snake_case ↔ Title Case
- Mensagem custom no gate pedagógico para manager: sugere relay como alternativa + oferece assistente da unidade
- Gate `canDelegatePedagogical` **intacto**

### F3 — Skill `gerencia.md` (~13KB após hotfixes)
- Primary apenas (não auxiliar global)
- 6 exemplos canônicos PRD §6
- UUIDs reais embutidos
- Fronteira com Pedagógico não-negociável (relay, nunca followup)

### F4 — pickSkill Priority 4.65
- Antes de pedagogico (4.7) com gatilhos restritos: nomes gerentes, risco-evasao, retenção, atendimento, recepção, articulação

### F5 — PWA filtro Responsável
- Aba Gerência: manager + coordinator + director ativos

### Validações E2E
- ✅ P1 risco evasão (Felipe/Krissya) — task gerência criada com self-intro
- ✅ P2 relay sobre pai insatisfeito — followup detectado, cumprimento curto
- ✅ P4 problema atendimento (Gustavo/Jereh) — Eisenhower funcionando
- ❌ P3 Carlos Henrique — bug unidade arrastada, corrigido `1daf538`
- ⏸️ P5/P6/N1/N2 — não rodados (decisão estratégica de fechamento)

### Radar pós-sprint (11 hotfixes — UX + governança)
1. `dd7930c` — risco-de-evasao não vira pedagógico/apoio-ao-aluno
2. `2b7997e` — findCollaboratorBy* incluir onboarding_completed (self-intro funcional)
3. `87ab68e` — microconfirmação numerada (1/2/3) substitui pergunta livre
4. `f851f5e` — Q2 cadência self-intro (full / half / short por tempo)
5. `e5d3b71` — pergunta de tratamento Eisenhower + diretiva pt-BR
6. `48ed7f6` — problema-de-atendimento ≠ incidente-tecnico
7. `4bc3071` — skill gerência exige UUIDs no marker
8. `d6bfd96` — cooldown 6h deadline/overdue + skill pergunta horário
9. `192c631` — COORD_HINT como contexto natural (não só gatilho de RESPONSE)
10. `9d2e68d` — dedup defensivo coord_request 90s + skill confirmação curta
11. `1daf538` — unidade da task vem do aluno, não do assignee

---

## ⚓ Decisão estratégica (2026-05-05) — Fechar fase de departamentos

Após Sprint 20 e 11 hotfixes pós-sprint, PO sinalizou (corretamente):
- TOM corria risco de virar "menino de recado" — relay infinito, contexto arrastando
- Skills inflando com regra-por-bug em vez de princípios
- Risco operacional: WhatsApp pode banir TOM por padrão de spam

**Direção pós-Sprint 20:**
- ✅ Os 4 departamentos cobrem a operação atual (Marketing + Operações Técnicas + Pedagógico + Gerência)
- ❌ NÃO criar mais departamentos
- 🎯 Próxima frente: **governança e organização pessoal da liderança** (Alf, Anne, coord)

Limites formalizados em `docs/TOM-LIMITES.md`.

---

## Backlog descartado

| Item | Decisão | Motivo |
|---|---|---|
| Backup Backblaze B2 | Descartado definitivamente | Supabase backup diário + GitHub já cobrem; over-engineering para single-tenant |
| Override de equipe por evento específico | Diferido | Aguarda uso real da feature base (`event_team_map` por unidade) |
| Lembretes múltiplos T-3 + T-1 para tasks de evento | Diferido | Risco de spam; aguarda feedback do T-1 único |
| Aprovação para eventos institucionais | Diferido | Fora de escopo Sprint 13 F3; futura Sprint |
| Edição de conteúdo dos kits pela interface | Diferido | Hardcoded suficiente enquanto single-dev; YAGNI |
| Geração retroativa de tasks para eventos existentes | Descartado | Só eventos novos geram kit automaticamente |

---

## Sprint 21 — Listas Pessoais + Hábitos Privados via TOM

**Status:** entregue
**Data:** ~2026-05-06

### Entregas
- DB: tabela `personal_checklists` com `context` (personal/work), `list_type`, `owner_collab_id`; tabela de items associada
- Marker `<<PERSONAL_LIST_ACTION>>` (create_list, add_item, remove_item, complete_item, clear_list)
- Engine: `applyPersonalListAction` com validação de schema + fallback aliases (action: "create_list" ↔ "create", title ↔ name)
- Skill `listas-pessoais.md`: criação, edição e consulta de listas pessoais via conversa
- Fix: `personal_checklists.context NOT NULL` violation corrigido (default 'personal' inserido no engine)
- PWA: `Checklists.tsx` com abas Pessoal / Trabalho; `PersonalChecklistSheet.tsx`, `PersonalChecklistCard.tsx`

---

## Sprint 22 — Mídia Bidirecional + Comunicados com Anexo

**Status:** entregue (6/6)
**Data:** ~2026-05-08

### TOM recebe mídia (bidirecional entrada)
- **Imagem:** OpenAI `gpt-5.4-mini` com vision multimodal — analisa e injeta descrição no prompt
- **PDF:** Gemini Files API (`gemini-3.1-flash-lite`) — upload multipart, polling até `ACTIVE`, extração de texto completa; contexto injetado com prefixo explícito "O usuário ACABOU DE ENVIAR um PDF agora"
- **Vídeo:** Gemini Files API (até 2GB) — análise de conteúdo via multimodal
- Fix: modelo `gpt-5.4-mini` usa `max_completion_tokens` (não `max_tokens`); ambos modelos validados como existentes em produção

### TOM envia mídia (bidirecional saída)
- `whatsapp.sendMedia(phone, {url, type, caption, filename, mimetype})` via UAZAPI — imagens e documentos com legenda

### Storage buckets (Supabase)
- `comunicado-anexos` (public): flyers de eventos + anexos de comunicados
- `tom-incoming-media` (private): mídia recebida pelo TOM para processamento

### Comunicados com anexo (PWA)
- `ComunicadoSheet.tsx`: upload de anexo (image/document), preview inline, badge de tipo
- Dispatcher: `sendMedia` quando `attachment_url + attachment_type` presentes
- DB: `announcements.attachment_url`, `attachment_type`, `attachment_mime`, `attachment_filename`, `attachment_size_bytes`

### Confirmação de leitura (Comunicados)
- DB: `announcements.requires_confirmation`, `announcement_jobs.confirmed_at`, `reminder_sent_at`, `confirmation_response`
- Engine: detector de resposta afirmativa → marca `confirmed_at` no job correspondente
- Cron: lembrete pra não-confirmados após 6h, idempotente via `reminder_sent_at`
- PWA: checkbox "Confirmação de leitura" no sheet; contador "X/Y confirmaram" na lista; tela detalhe com stats + botão reenviar lembrete manual

---

## Sprint 26 — Agenda LA Music v2 (2026-05-10)

**Status:** entregue + validado E2E em produção

> Nota: sprints 23–25 referenciadas no board de produto foram absorvidas parcialmente em Sprint 22 (mídia/confirmação) e Sprint 26 (agenda). Sprint 23 (revisão de skills / redução de prompt) permanece pendente.

### Fatia A — Schema + EventoSheet expandido
- DB migration `agenda_escolar_v2_schema`: tabela `event_types` (14 tipos canônicos com emoji + color_hex + sort_order); `school_events` ganhou `end_date`, `description`, `image_url`, `image_filename`, `is_all_day`, `units[]` (multi-unidade); FK `event_type → event_types.id` substituindo CHECK constraint legada
- `EventoSheet.tsx` reescrito: tipo com CustomSelect (emoji + label), datas início/fim, horário condicional, multi-unidade por Checkbox (Vazio = escola toda), local, descrição (500 chars), upload de cartaz/flyer (5MB para bucket `comunicado-anexos`), notificações configuráveis
- Acesso de leitura aberto a toda equipe (RLS `qual=true` para `school_events`)

### Fatia B — 5 visualizações + period nav unificado
- 5 chips: **Calendário · Mês · Trimestre · Semestre · Ano**
- Period nav no padrão `DateNavHeader` (surface bar, chevrons, botão "Hoje" só aparece fora do período atual) — unificado com Hoje/Semana
- Lista agrupada por mês com separadores, badges de proximidade (Hoje/Amanhã/Em N dias/Em curso), type badges coloridos, suporte a ranges de dias
- **Visão Calendário:** grid 6×7 estilo Google Calendar — domingo em brand red, hoje em pill verde tom, stripes coloridas por `event_type.color_hex`, ranges preenchem todos os dias do período, click no dia abre painel com lista de eventos

### Fatia C — TOM como agente de agenda
- Skill `agenda-escolar.md` (renomeada para Agenda LA Music): consulta filtrada por unidade, disparo de resumo mensal com confirmação prévia
- `system.js`: contexto `📅 Agenda — próximos 30 dias` injetado no prompt de todos os usuários
- Dispatcher: cron automático dia 1 de cada mês às 09h BRT, idempotente (header check)

### Fatia D — Link bidirecional Comunicados ↔ Eventos
- Migration `announcements_event_link`: FK `announcements.source_event_id → school_events.id` + index
- `ComunicadoSheet`: dropdown "Vincular a evento" (próximos 90 dias), salva `source_event_id`
- `ComunicadoDetalhe`: linha "Evento" clicável no resumo
- `EventoDetalhe`: seção "Comunicados deste evento" com status de cada comunicado
- `Comunicados` lista: badge `📅 título` no card quando vinculado

### CRUD completo da Agenda
- **Editar:** `EventoSheet` com prop `editTarget` — pré-preenche todos os campos, faz UPDATE, oculta seção de notificações (sem re-notificar)
- **Cancelar evento:** soft-cancel + cancela comunicados pending vinculados
- **Excluir evento:** hard delete com confirmação
- Fix: `overflow-hidden` removido do card para dropdown RowMenu não ficar por trás

### Design System — ConfigurarEquipe
- 5 `<select>` nativos Windows → `CustomSelect`
- Tabs Barra/Recreio/Campo Grande → componente `Tabs`
- Botão "Salvar" brand/vermelho → `bg-tom text-black`

### Fila WhatsApp anti-ban Meta
- Dispatcher: mini-batch até **20 jobs/tick** com **delay aleatório 3–6s** entre envios
- 40 pessoas → ~2 minutos (antes: 3h20 com 1 msg/tick a cada 5min)
- Variação aleatória evita padrão mecânico detectável pela Meta

### Bug crítico corrigido
- `audience.function_role` filtrava em coluna `function_role` (sempre null) em vez de `role` em 3 pontos: `engine.js:792` (jobs via PWA), `engine.js:1096` (jobs via TOM/SCHOOL_EVENT_ACTION), `dispatcher.js:480` (createJobsFromAudience). Resultado: comunicados para "liderança" chegavam a 0 destinatários.

### Validação E2E em produção
- ✅ TOM listou agenda do mês filtrada por unidade
- ✅ Criou evento via wizard (plano comunicação + 9 tasks kit performance atribuídas à equipe da Barra)
- ✅ Evento apareceu imediatamente no PWA — Agenda LA Music → Junho 2026 → Barra
- ✅ Disparou agenda de junho para 18 colaboradores em ~2 minutos

---

## Próximos passos

### Validações em uso real (2026-05-10)
1. ✅ Coordenação conversacional validada em produção (Sprints 16–17)
2. ✅ Microconfirmações Sprint 18+19 validadas
3. ✅ Fluxo pedagógico E2E validado com Juliana/Quintela
4. ✅ Agenda LA Music validada E2E: TOM → evento → PWA → comunicado → 18 colaboradores notificados

### Pendente genuíno (2026-05-10)

#### Sprint 23 — Revisão de Skills (alta prioridade)
- `system.js` está em **96KB** — meta ~45KB
- Consolidar regras infladas em princípios (gerencia + pedagogico + coordenacao)
- Anti "menino de recado" técnico: TOM deve facilitar, não relay infinito
- Cleanup `composeSystemPrompt` (confirmar dead code ou alinhar com `buildSystemPrompt`)

#### Audit de telas PWA (lote 2 e 3)
- Lote 2: DashboardTime + PessoaDetalhe + Histórico + Observabilidade + Templates
- Lote 3: Ops + Sistema (Fila/Observabilidade/Detalhe/Login/Mais)
- Objetivo: garantir design system unificado em todas as telas

#### Auth flow E2E
- Magic link WhatsApp → PWA install → onboarding completo
- Ainda não validado de ponta a ponta com novo collaborator real

#### Sprint futura — Governança de Contexto
- Classificação assistida pessoal vs trabalho
- Fricção seletiva, heurísticas engine, `context_mismatch_flag`
- Spec em `docs/SPRINT-FUTURA-GOVERNANCA-CONTEXTO.md`

#### Sprint futura — Checklist de Produção de Evento (one-shot por projeto)
- Tasks por setor (Logística/Técnica/Pedagógico/Comunicação/Produção)
- Linha do tempo automática 30d/15d/7d/1d
- Mapa de equipe no dia (override por evento específico, diferido Sprint 14)

### Fora de escopo (decisão 2026-05-05, mantida)
- Mais departamentos operacionais (financeiro, comercial, etc.)
- Auditoria/analytics avançado
- TOM em grupos de WhatsApp como participante ativo (risco banimento Meta)
- Professor como collaborator (manter via assistente/coord)
- Múltiplos lembretes T-3/T-1 para tasks de evento (diferido — aguarda feedback do T-1 único)
- Override de equipe por evento específico (diferido — aguarda uso real do `event_team_map`)

### Cleanup arquitetural
- Code-splitting PWA — bundle ~951KB; só prioridade se carregamento lento incomodar
- Testes automatizados — só vale com mais de 1 dev no projeto
