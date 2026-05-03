# Roadmap LA Organizer — Histórico Sprint 0→14

> Histórico cronológico das sprints. Para o estado atual do produto, ver PRD (`docs/06-prd-la-organizer-v3.md`). Para schema do banco, ver `docs/03-esquema-banco-dados-la-organizer.md`.
>
> **Nota sobre sprints 0–10:** não há specs ou reports granulares para este período. O histórico foi reconstruído a partir do PRD v3.1 (escrito em 2026-04-28 com estado Sprints 0→7 em produção) e dos comentários inline do engine.js. Sprints 8–10 foram inferidas pelos artefatos entregues (telas no App.tsx, markers no engine).

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

## Próximos passos

1. **Validar Sprint 14 F2 em uso real** (1–2 semanas) — confirmar se kits estão corretos, se mapa de equipe funciona na prática, se lembrete T-1 ajuda ou incomoda
2. **Reavaliar override de equipe e múltiplos lembretes** após validação acima
3. **Onboardar coordenadores (Juliana e Quintela)** — pré-requisito atendido (Project Wizard + features de coordenação estáveis)
4. **Code-splitting PWA** — bundle em 633KB; só prioridade se carregamento lento começar a incomodar usuários
5. **Testes automatizados** — só vale o esforço com mais de 1 dev no projeto
6. **Fase 3** — Dashboard gerencial avançado + check-in RH (escopo a definir)
