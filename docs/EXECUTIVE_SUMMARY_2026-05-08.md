# Executive Summary — 2026-05-08 (Sprint 22.x — Agenda Revamp + TOM Mensageria)

**Sessão única, ~25 commits, deploy contínuo Vercel + VPS.**

## Entregue

### PWA Agenda
- Hoje + Semana com tabs **Trabalho · Pessoal · Delegadas** (consistente nos dois)
- CRUD inline em TaskRow + EventRow (DnD, RowMenu, checkbox, dot Eisenhower, badge inline)
- 4 sheets de edit completos: QuickCreate (3 kinds + conflict detection), EditTask, EditEvent, Reschedule
- Picker datetime custom (DateInput + TimeInput) com `position: fixed` z-1000 — corrigiu corte dentro do BottomSheet
- Toast component (slide-up + scale, kinds success/error/info, autohide 4.5s)

### Categorias dinâmicas (Sprint 22.26)
- Tabela `event_categories` com slug + label + tone + context
- Categorias rebrand: LA Music · Aula Particular/Mentoria · Gravação/Produção · Show · Pessoal
- Categoria pessoal por colaborador via "+ Nova categoria"

### TOM ↔ PWA mensageria (Sprint 22.33–22.34m)
3 endpoints `/internal/*` no engine TOM (auth via `x-internal-secret`, CORS habilitado):
- `task-delegated` → assignee recebe Zap quando user delega tarefa
- `event-invites` → cada participant recebe Zap convite
- `task-updated` → assignee recebe Zap quando user reagenda/edita delegada

Cliente em `web/src/lib/tomEngine.ts` retorna `NotifyResult` (awaited, não fire-and-forget). Toast mostra resultado real (success com count, error com motivo).

### Conflict detection (Sprint 22.34i)
PWA: query `start_at < newEnd AND end_at > newStart` antes de criar evento. Se conflito, banner amarelo com lista dos eventos sobrepostos + 2 botões: "Voltar e ajustar" / "Criar mesmo assim".

TOM: já tinha equivalente via `detectDuplicateSemanticEvent`.

### Eisenhower
- Auto-classify desativado (Sprint 22.34d) — fica NULL até user marcar manual via 4 chips
- Trigger respeita manual (Sprint 22.32b: `IF NEW.eisenhower_quadrant IS NOT NULL RETURN NEW`)
- `EisenhowerPicker` reutilizável em QuickCreate task/event + EditTaskSheet + EditEventSheet

### Bugs críticos resolvidos
1. Habit redirect — LLM emitia EVENT_CREATE pra "academia 18h"; engine agora consulta `habits` ativos do user e converte pra TASK com `remind_at`
2. Falso dup "Henrique" vs "Matheus" — adicionado `stripVerbPrefix` + keyword overlap requirement
3. Eisenhower não persistia — trigger sobrescrevia manual; fix com `IF NOT NULL RETURN NEW`
4. Calendário cortado — `position: fixed` + z-1000 (escapa overflow do BottomSheet)
5. Toast translúcido — `bg-bg-elevated` sólido em vez de `bg-success/10`
6. Norton sumindo — Semana filtrava só `context=work`; agora tabs como Hoje
7. **Event-invites returned 200 mas não enviava** (3 horas debugando) — query `collaborators(...)` ambígua porque `event_participants` tem 2 FKs pra `collaborators` (collaborator_id + invited_by). Fix com hint explícito: `collaborators!event_participants_collaborator_id_fkey(...)`
8. Marker_logs INSERT silenciosa — CHECK constraint só aceitava `executed/rejected`. Migration: `marker_logs_result_check` expandido pra `executed/rejected/skipped/redirected`. Esse bug mascarou o bug 7 por horas.
9. CORS no `/internal/*` — middleware adicionado com Origin: * + handle OPTIONS
10. Vercel `.env.production` problemas — gitignore + dashboard env vars

## Bateria E2E PWA↔TOM 11/11 ✅
1. "passar na feira" pessoal
2. Edição confirmada
3. "academia 18h" → tarefa via habit redirect
4. "reunião Henrique amanhã 10h online" sem falso dup
5. Fluxo conversacional "ligar pro Valdemiro"
6-9. Conversacionais cobertos
10. Delegar via PWA → Rafinha recebe Zap
11. Compromisso com Quintela+Rafinha+Anne → 3 invites Zap

Bônus: TOM detectou conflito Academia 18h vs Lala 18h sem ser pedido.

## Migrations aplicadas
- `2026-05-07-sprint22-23-privacy-fix` — RLS UPDATE/DELETE com `context = 'work'`
- `sprint22_26_event_categories` + `sprint22_26b_rebrand`
- `sprint22_29_tasks_creator_crud` — RLS pra creator mexer em delegadas
- `sprint22_30_events_eisenhower` — ALTER + Sprint 22.32b respeita manual
- `sprint22_32_event_participants`
- `sprint22_32b_eisenhower_respect_manual`
- `sprint22_34d_disable_eisenhower_autoclassify`
- `sprint22_34l_marker_logs_result_expand`

## Roadmap pendente
- **Sprint 21**: Autogovernança Guiada — spec + plan prontos, execução pendente
- **Sprint 24**: Runbook (spec criado)
- Heurística Eisenhower auto melhor (hoje desativada)
- Backend retry cron pra event-invites (defesa em profundidade)

## Hosting
- **Vercel**: PWA auto-deploy em ~2min após push pra `origin/main`
- **VPS** (89.116.73.186): apenas engine TOM (porta 3000) + nginx reverse proxy
- `vercel.json` rewrites `/internal/*` → VPS server-side (sem CORS no browser)
- `bash scripts/push-and-deploy.sh /tmp/deploy-X` = push + auto VPS restart se mudou `src/skills/migrations`
