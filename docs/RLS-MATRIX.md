# RLS Matrix — LA Organizer

**Documento:** auditoria + contrato vigente de Row Level Security
**Sprint:** 4 (auditoria + hardening)
**Estado:** ✅ CONGELADO — 16/16 invariantes passam em `scripts/rls-test.js`

---

## Princípios

1. **`context` (`work | personal`) é o único eixo de privacidade** em `tasks` e `events`.
2. **`category` é informacional** — nunca aparece em policy.
3. **`service_role`** bypassa RLS via atributo `BYPASSRLS`; policies `TO service_role` são redundantes mas garantem que `authenticated` não case acidentalmente.
4. **Default deny** — se uma tabela tem RLS habilitado e nenhuma policy `authenticated` cobre o caso, o supabase-js (anon key) não vê nada. É seguro mas pode quebrar funcionalidade — gaps funcionais são tratados separadamente de leaks.
5. **Coord/Director** veem trabalho do time (`context='work'`), nunca `context='personal'`.

---

## Roles

| Role | Origem | Acesso |
|---|---|---|
| `service_role` | TOM engine (server, .env SUPABASE_SERVICE_ROLE_KEY) | full bypass |
| `authenticated` | Qualquer usuário logado via PWA (magic link / email) | sujeito a policies |
| `anon` | Cliente sem sessão | nenhum acesso material esperado (apenas auth flows) |

Helpers SECURITY DEFINER:
- `current_collab_id()` — retorna `collaborator_id` derivado do JWT
- `current_collab_role()` — retorna `'collaborator' | 'coordinator' | 'director'`

---

## Status pós-hardening (migração `sprint4_rls_hardening_leaks`)

### 🔴 → ✅ Leaks fechados

| Tabela | Antes | Depois |
|---|---|---|
| `collaborators` | `auth_read_collaborators` `qual=true` (vazava PII de todos) | `auth_read_collaborators`: self por email OR coord/director |
| `project_checkpoints` | `qual=true` (vazava todos) | filtra por `project_id IN (projetos visíveis ao user)` |
| `project_members` | `qual=true` (vazava grafo) | self OR projetos visíveis OR coord/director |
| `marker_logs` | RLS=off (qualquer auth lia) | RLS=on + única policy `service_role` |
| `task_reminders` | RLS=off (qualquer auth lia) | RLS=on + única policy `service_role` |

### 🟡 → ✅ Gaps funcionais cobertos

| Tabela | Gap | Solução |
|---|---|---|
| `ritual_logs` | Collaborator não lia próprios via PWA | Adicionado `auth_read_own_ritual_logs` (collaborator_id=self) |
| `user_preferences` | PWA não conseguia criar primeira row | Adicionado `auth_insert_own_prefs` (collaborator_id=self) |

### ✅ OK — manter

| Tabela | Cobertura |
|---|---|
| `events` | `auth_read_own_events`, `auth_read_work_events_coord`, `auth_insert_own_events` (own + created_by), `auth_update_own_events`, `auth_delete_own_events`, `service_role_all_events` |
| `tasks` | `auth_read_own_tasks`, `auth_read_work_tasks_coord`, `auth_insert_own_tasks` (own + created_by), `auth_update_own_tasks`, `Service role full access` |
| `projects` | `auth_read_projects` (owner OR member OR coord/director), `Service role full access` |
| `user_preferences` | `auth_read_own_prefs`, `auth_update_own_prefs`, `Service role full access` |
| `auth_magic_codes` | só `service_role_all_amc` (correto — magic codes nunca são lidas pelo client) |

### 🛡 TOM-only (apenas service_role)

Tabelas com RLS habilitado e SOMENTE policy `service_role`. PWA não acessa via supabase-js.

`broadcast_messages`, `broadcast_responses`, `collaborator_memory`, `collaborator_profiles`, `conversation_history`, `daily_plan_items`, `daily_plans`, `emusys_classes`, `google_calendar_sync`, `habit_logs`, `habit_templates`, `habits`, `notifications`, `op_checklist_completions`, `op_checklist_item_completions`, `op_checklist_items`, `op_checklists`, `task_comments`, `weekly_plans`

Total: **19 tabelas TOM-only**. Adequado — são domínios do engine que o PWA não precisa ler diretamente.

---

## Matriz final (CONGELADA — 28/04/2026)

### Tabelas com acesso PWA

| Tabela | SELECT (collab) | SELECT (coord/dir) | INSERT | UPDATE | DELETE |
|---|---|---|---|---|---|
| `tasks` | own | own + work do time | own + creator=self | own | — |
| `events` | own | own + work do time | own + creator=self | own | own |
| `projects` | owner / member | + tudo | (TOM) | (TOM) | — |
| `project_members` | self / projetos visíveis | + tudo | (TOM) | (TOM) | — |
| `project_checkpoints` | projetos visíveis | + tudo | (TOM) | (TOM) | — |
| `collaborators` | self | + tudo | (TOM) | (TOM) | — |
| `user_preferences` | own | own | own | own | — |
| `ritual_logs` | own | tudo | (TOM) | (TOM) | — |

### Tabelas TOM-only (sem acesso PWA)

Listadas em "TOM-only" acima — todas com policy única `service_role`.

### Tabelas com RLS desabilitado

> **Política:** nenhuma. Toda tabela em `public` deve ter RLS habilitado.

Após Etapa 3: **0 tabelas**.

---

## Regras invariantes (servem como teste)

1. Authenticated `colab A` nunca vê `tasks` ou `events` `personal` de `colab B`.
2. Authenticated `coord` vê `tasks/events` `work` de `colab B`, nunca `personal`.
3. Authenticated `colab A` nunca vê `conversation_history`, `collaborator_memory`, `notifications` de ninguém via supabase-js.
4. `marker_logs` e `task_reminders` nunca são legíveis por `authenticated`.
5. `auth_magic_codes` nunca é legível por `authenticated`.
6. Qualquer policy `FOR ALL TO public USING (true)` é proibida (regressão Sprint 3).

Estas viram asserções em `scripts/rls-test.ts` (Etapa 2).

---

## Histórico

- **Sprint 0–2:** RLS construído ad-hoc. "Service role full access" criadas com `TO public` por engano (regressão silenciosa).
- **Sprint 3 (28/04/2026):** Crítico descoberto em smoke multiuser (Alf vê Anne). Re-escopo emergencial para `TO service_role`.
- **Sprint 4 (28/04/2026):** Auditoria completa (30 tabelas, 41 policies). Harness `scripts/rls-test.js` com 16 invariantes. 5 leaks fechados (collaborators PII, project_checkpoints, project_members, marker_logs, task_reminders), 2 gaps funcionais cobertos (ritual_logs read-own, user_preferences insert-own). Matriz CONGELADA.
- **Sprint 6 (28/04/2026):** 3 invariantes ritual_logs novas (19/19).
- **Hot-fix Sprint 6 (28/04/2026):** policy `auth_read_project_members` simplificada (`collaborator_id = self OR coord/director`). A versão da Sprint 4 tinha subquery auto-referenciando `project_members`, provocando `infinite recursion detected in policy` quando combinada com a policy de `projects`. Erro chegava ao PWA quando havia row em `project_members` para o user logado — gap de cobertura no harness (test users sem membership). Hot-fix + 2 invariantes anti-recursion (alice query tasks JOIN projects + alice lê próprios memberships) + fixture project/membership. Resultado: **21/21**. Trade-off: collab agora vê apenas próprias memberships; restaurar "ver outros membros do mesmo projeto" exigiria SECURITY DEFINER fn — adiar até demanda real.
