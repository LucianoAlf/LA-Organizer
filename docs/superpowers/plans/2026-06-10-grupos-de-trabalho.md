# Grupos de Trabalho — Plano de Implementação

> **STATUS (10/06 ~14h BRT): MVP ENTREGUE (T1–T8 + deploy + seed).** Migration+RLS+CHECK+trigger ✓ ·
> service 5/5 ✓ (134/134 geral) · engine: create pro grupo (nome validado server-side), resolveTaskByShortId
> com pool, complete anti-corrida ("já concluída por X"), notificações com histórico ✓ · prompt: bloco
> 👥 grupos + tasks do pool do remetente ✓ · dispatcher: remindGroupTasks (fan-out T-1) + fan-out nos
> 2 check*Reminders; 3 T-1 por pessoa excluem grupo ✓ · PWA: tela Grupos (Mais+sidebar), Eu|Grupo no
> QuickCreate, Hoje inclui pool + badge 👥 ✓ · grupo Financeiro (Rose ★ + Ana) seedado ✓.
> Bug pego na validação: work_group_members tem 2 FKs pra collaborators → embeds exigem FK explícita
> (corrigido nos 3 pontos; mesma família do event_participants).
> **PENDÊNCIAS (fase imediata):** escalação de task de grupo travada → líder (hoje não escala);
> relatórios buildTeamSummary/leader-briefing com linha por grupo; view Semana/Agenda incluir pool
> (só Hoje cobre); validação RLS com login non-coinciding real (piloto cobre); e2e real Rose→Ana.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pool de tarefas por grupo nomeado (Financeiro = Rose ★ + Ana): grupo é dono da tarefa (`assigned_group_id`), qualquer membro vê e conclui, lembretes pra todos, escalação só pra líder — spec aprovada em `docs/superpowers/specs/2026-06-10-grupos-de-trabalho-design.md`.

**Architecture:** Arquitetura A (grupo como dono): `work_groups` + `work_group_members` + `tasks.assigned_group_id` com CHECK exatamente-um-dono; RLS com ramo de grupo via `current_collab_id()`; engine resolve `assigned_group` por nome server-side (padrão notes/comunicados); PWA com tela de gestão + abas Pessoa|Grupo + badge 👥.

**Tech Stack:** Supabase (Postgres+RLS), Node CJS (engine/dispatcher), React+TS+Tailwind tokens DS, node --test.

**Regras do projeto:** `current_collab_id()` nunca `auth.uid()` · id NUNCA do marker (nome→id resolvido contra o banco) · fala=persistência · tokens DS (lição Anotações: tipografia/spacing/radius SÓ da escala; Badge/Button; receita canônica de input) · consultar `tom_known_issues` antes de cada bug · deploy scp+pm2 pré-aprovado.

---

### Task 1: Migration — work_groups + members + assigned_group_id + RLS

Via MCP `apply_migration` (name: `work_groups_module`).

- [ ] **1.1** Aplicar:

```sql
create table work_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  leader_id uuid not null references collaborators(id),
  created_by uuid references collaborators(id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table work_group_members (
  group_id uuid not null references work_groups(id) on delete cascade,
  collaborator_id uuid not null references collaborators(id),
  added_by uuid references collaborators(id),
  created_at timestamptz not null default now(),
  primary key (group_id, collaborator_id)
);
create index wgm_collab_idx on work_group_members (collaborator_id);

alter table tasks add column assigned_group_id uuid references work_groups(id);
alter table tasks alter column assigned_to drop not null;
alter table tasks add constraint tasks_exactly_one_owner
  check ((assigned_to is not null) <> (assigned_group_id is not null));
create index tasks_group_idx on tasks (assigned_group_id) where assigned_group_id is not null;

-- Líder sempre é membro (salvaguarda além da UI)
create or replace function ensure_leader_is_member() returns trigger language plpgsql as $$
begin
  insert into work_group_members (group_id, collaborator_id, added_by)
  values (new.id, new.leader_id, new.created_by)
  on conflict do nothing;
  return new;
end $$;
create trigger wg_leader_member after insert or update of leader_id on work_groups
  for each row execute function ensure_leader_is_member();

alter table work_groups enable row level security;
alter table work_group_members enable row level security;

create policy wg_read on work_groups for select to authenticated using (true);
create policy wgm_read on work_group_members for select to authenticated using (true);

-- Pode criar: manager/coordinator/director OU líder de departamento (governance_leaders)
create or replace function can_manage_groups() returns boolean language sql stable as $$
  select exists (
    select 1 from collaborators c where c.id = current_collab_id()
      and c.role in ('manager','coordinator','director')
  ) or exists (
    select 1 from governance_leaders gl where gl.leader_id = current_collab_id()
  )
$$;

create policy wg_insert on work_groups for insert to authenticated
  with check (can_manage_groups() and created_by = current_collab_id());
create policy wg_update on work_groups for update to authenticated
  using (leader_id = current_collab_id() or exists (
    select 1 from collaborators c where c.id = current_collab_id() and c.role = 'director'));
create policy wgm_write on work_group_members for all to authenticated
  using (exists (select 1 from work_groups g where g.id = group_id and (g.leader_id = current_collab_id()
    or exists (select 1 from collaborators c where c.id = current_collab_id() and c.role = 'director'))))
  with check (exists (select 1 from work_groups g where g.id = group_id and (g.leader_id = current_collab_id()
    or exists (select 1 from collaborators c where c.id = current_collab_id() and c.role = 'director'))));

-- Ramo de grupo nas policies de TASKS: localizar as policies existentes
-- (select polname, qual from pg_policies where tablename='tasks') e ADICIONAR
-- policy extra (não editar as vigentes):
create policy tasks_group_member_all on tasks for all to authenticated
  using (assigned_group_id in (select group_id from work_group_members where collaborator_id = current_collab_id()))
  with check (assigned_group_id in (select group_id from work_group_members where collaborator_id = current_collab_id()));
```

- [ ] **1.2** Verificar: policies novas listadas; `insert` numa task com ambos os donos → falha no CHECK; sem nenhum → falha.

### Task 2: Service puro de resolução de grupo (TDD)

**Files:** Create `src/services/work-groups.js` + `src/services/work-groups.test.js`.

- [ ] **2.1** Testes primeiro (FAIL): `resolveGroupByName(supabase, 'financeiro')` → match exato por slug/nome (case/acento-insensível); prefixo único resolve; ambíguo/ausente → null + candidates; `slugify('Financeiro CG')='financeiro-cg'`; `loadActiveGroups` retorna membros.
- [ ] **2.2** Implementar (supabase injetado, mesmo padrão notes.js): `slugify`, `loadActiveGroups(supabase)` (`work_groups` active + `work_group_members` + nomes), `resolveGroupByName(supabase, ref)` → `{group}|{candidates}|null`, `memberIdsOf(group)`, `isMember(group, collabId)`.
- [ ] **2.3** `node --test` verde + `node --check`.

### Task 3: Engine — criar tarefa pro grupo

**Files:** Modify `src/engine.js`.

- [ ] **3.1** Localizar o handler de create em `applyTaskActions` (grep `action !== 'create'`/insert em tasks; vizinhança de engine.js:8175 chama applyTaskActions). No payload da action, aceitar `assigned_group` (string). Fluxo: se presente → `resolveGroupByName`; ambíguo/ausente → failMessage "_Não achei o grupo X. Grupos ativos: …_" (lista nomes reais) SEM criar; ok → insert com `assigned_group_id=group.id`, `assigned_to=null`, forçar `context='work'`. `created_by` = remetente (como hoje).
- [ ] **3.2** Notificação pós-create: avisar membros (exceto criador) "📋 Nova tarefa do grupo *Financeiro*: …" via whatsapp.sendMessage + insert conversation_history de cada um (lição RSVP-HISTORY-MISSING: send direto SEM histórico deixa o LLM cego).
- [ ] **3.3** `resolveTaskByShortId` (engine.js:3449): além de `assigned_to = remetente`, incluir `assigned_group_id IN (grupos do remetente)` — carregar ids via `work_group_members`.
- [ ] **3.4** Conclusão com anti-corrida: no complete de task com `assigned_group_id`, UPDATE `.eq('id', id).neq('status','done').select('id')`; 0 rows → buscar `completed_by` e responder "_já concluída por X há pouco_"; sucesso → `completed_by`=remetente + notificar `created_by` e demais membros (com histórico).
- [ ] **3.5** `node --check` + suítes existentes intactas.

### Task 4: Prompt — bloco GRUPOS DE TRABALHO

**Files:** Modify `src/prompts/system.js`.

- [ ] **4.1** Carregar `loadActiveGroups` junto dos dados (padrão recentNotes desta semana) e render:

```
## 👥 Grupos de trabalho ativos
• *Financeiro* (líder: Rose) — membros: Rose, Ana Paula
Pra criar tarefa de grupo: <<TASK>> create com "assigned_group":"Financeiro" (NUNCA invente grupo; só os listados). Tarefa de grupo: qualquer membro conclui.
```

- [ ] **4.2** Tarefas de grupo do remetente aparecem nos blocos de tarefas com prefixo `👥 [Grupo]` (workTasks/openTasksNoDue: queries por assigned_to ganham união com grupos do remetente — localizar TASK_COLS queries em system.js:1360/1649).
- [ ] **4.3** `node --check`.

### Task 5: Dispatcher — lembretes pra todos, escalação só líder, relatórios por grupo

**Files:** Modify `src/rituals/dispatcher.js`.

- [ ] **5.1** `checkTaskReminders` (≈4719) e `checkReminders` (≈4795): quando `tasks.assigned_group_id` não-nulo → destinatários = membros do grupo (cada um com seu isQuietNow/DND; conversation_history por membro). Select das queries ganha `assigned_group_id`.
- [ ] **5.2** Cobranças/followups por assigned_to (≈961/1024/1086): tarefas de grupo → mesmos sends por membro; escalação via `coordination_request_count` (≈2156) → SÓ `leader_id` do grupo.
- [ ] **5.3** Relatórios `buildTeamSummary`/`buildLeaderBriefing` (grep nos services/dispatcher): linha única "👥 Financeiro — Rose+Ana: N abertas", sem duplicar por pessoa.
- [ ] **5.4** `node --check` + smoke local.

### Task 6: PWA — tela Grupos de trabalho

**Files:** Create `web/src/screens/gestao/GruposTrabalho.tsx` (+hook `useWorkGroups.ts`); Modify `web/src/App.tsx` (rota `mais/grupos-trabalho` sob ProtectedRoute manager/coordinator/director), tela GestaoEquipe (entrada "Grupos de trabalho").

- [ ] **6.1** Hook: list (groups+members), createGroup (slugify; created_by=eu), updateGroup, add/removeMember. RLS protege.
- [ ] **6.2** Tela responsiva token-pura (lição Anotações): lista de grupos (card: nome `text-body-lg`, Badge líder ★, chips de membros), criar/editar com `Field`+`CustomSelect` (líder, com sub "recebe as escalações") + chips com ✕ + "+ adicionar" (roster). Desativar bloqueado se houver task aberta do grupo (count + aviso).
- [ ] **6.3** tsc + build + preview 375/1440.

### Task 7: PWA — abas Pessoa|Grupo no criar/editar tarefa

**Files:** Modify `web/src/components/QuickCreateSheet.tsx` (+ drawer de edição de task se houver seletor de responsável — localizar por grep `assigned_to` em web/src/components).

- [ ] **7.1** No kind task/delegated: toggle Pessoa|Grupo (2 Buttons sm). Grupo → `CustomSelect` de grupos ativos + card `text-body-sm text-fg-muted` "Membros: … · qualquer um conclui". Insert: `assigned_group_id`, `assigned_to: null`, `context:'work'`.
- [ ] **7.2** tsc + build.

### Task 8: PWA — minhas listas incluem tarefas dos meus grupos

- [ ] **8.1** Grep `\.eq\('assigned_to'` em web/src (hooks de Hoje/Semana/Agenda/listas): adicionar união `assigned_group_id IN meusGrupos` (hook compartilhado `useMyGroupIds`). Badge `<Badge tone="success">👥 {nomeGrupo}</Badge>` no card.
- [ ] **8.2** Concluir no PWA usa o caminho normal (RLS já autoriza membro) — conferir update de complete não filtra por assigned_to=eu no client.
- [ ] **8.3** tsc + build + preview.

### Task 9: Testes + e2e

- [ ] **9.1** `node --test` todas as suítes backend.
- [ ] **9.2** RLS com usuário non-coinciding (Rose 8bfb18b6 é non-coinciding? validar com um da lista): membro vê/conclui; não-membro não vê (queries via anon key + jwt de teste OU validação manual no app).
- [ ] **9.3** E2E VPS: criar grupo Financeiro (Rose ★ + Ana Paula) → Rose: "TOM, cria tarefa pro financeiro: conferir cheques" → task com assigned_group_id; Ana vê no app; Ana conclui; Rose notificada; segunda conclusão → "já concluída".

### Task 10: Deploy + piloto

- [ ] **10.1** SCP engine.js, system.js, dispatcher.js, work-groups.js + pm2 restart; node --check na VPS.
- [ ] **10.2** Seed produção: grupo "Financeiro" (slug financeiro, líder Rose, membros Rose+Ana Paula).
- [ ] **10.3** Avisar Rose+Ana (texto do Alf) + atualizar STATUS deste plano + registrar known issues que surgirem.

## Self-review
- Spec→plano: modelo de dados §T1, RLS §T1, engine §T3-T4, lembretes/escalação/relatórios §T5, UI 3 frentes §T6-T8, edge cases (corrida §3.4, desativar §6.2, herança recorrência: `_cloneTemplate` copia assigned_group_id — incluir em T3.1), testes §T9, rollout §T10. ✓
- Recorrência: adicionar `assigned_group_id` ao clone em recurrence-engine.js/materialize-recurrence.ts (T3.1 nota). ✓ (incluído)
- Sem placeholder; anchors reais (3449/4069/4719/4795/2156/961-1086). ✓
