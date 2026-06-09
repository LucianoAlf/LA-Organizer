# Governança fatiada por delegação — Sub-fase 1 (fundação) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada tarefa passa a ter um "dono de cobrança" (`governance_owner_id` = o líder que a delegou); os digests de governança do TOM passam a mostrar a cada líder só as tarefas dele + as soltas do time (se for gerente).

**Architecture:** Uma coluna `tasks.governance_owner_id` (uuid). Um trigger BEFORE INSERT preenche automaticamente quando um LÍDER delega (assigned_to ≠ created_by e created_by é líder). Backfill nas existentes. Uma função pura espelhada (JS no TOM, TS no PWA) decide quem vê cada tarefa. O digest do líder (`dispatcher.js`) filtra por essa função. Sem classificação por tema.

**Tech Stack:** Supabase Postgres (migration + trigger), Node CommonJS (`src/`), TypeScript (PWA `web/`), test runners já usados nos arquivos `leader-routing.test.js` (node) e `team-routing.test.ts` (vitest).

**Spec:** `docs/superpowers/specs/2026-06-09-governanca-fatiada-por-delegacao-design.md`

**Workflow do repo (IMPORTANTE):** Este repo NÃO faz commit por task (ver `_remote/CLAUDE.md`): o auto-deploy hook commita+pusha `_remote/` no fim do turno. Arquivos do TOM (`src/`) sobem por **SCP + `pm2 restart`**. Então o "passo de commit" de cada task aqui é: validar (testes/`node --check`/`tsc`) e, pra arquivos do TOM, **deploy via SCP**. Nada de `git commit` manual.

**Fora desta sub-fase (planos próprios depois):** Sub-fase 2 = captura por voz no TOM (re-delegação "isso é da Rose"). Sub-fase 3 = PWA (filtro no Dashboard time + botão "Passar cobrança pra…"). O trigger desta sub-fase já captura a delegação automática nas DUAS pontas (TOM e PWA criam via INSERT em `tasks`), então a sub-fase 1 já entrega valor sozinha.

---

## Task 1: Migration — coluna + índice + trigger + backfill

**Files:**
- Create: `supabase/migrations/20260609160000_governance_owner.sql`

- [ ] **Step 1: Escrever a migration**

Criar o arquivo com este conteúdo exato:

```sql
-- Governança fatiada por delegação (Fase 2, sub-fase 1).
-- governance_owner_id = o LÍDER que delegou a tarefa (dono da cobrança).
-- NULL = tarefa solta (não-delegada por líder) → catch-all: gerente da unidade do dono (resolvido no app).

alter table public.tasks
  add column if not exists governance_owner_id uuid references public.collaborators(id) on delete set null;

create index if not exists tasks_governance_owner_idx
  on public.tasks(governance_owner_id) where governance_owner_id is not null;

-- Trigger: ao INSERIR, se um LÍDER delegou pra outra pessoa, marca posse = quem criou.
-- Líder = role manager/coordinator/director OU presente em governance_leaders.
create or replace function public.set_governance_owner_on_insert()
returns trigger language plpgsql as $$
begin
  if new.governance_owner_id is null
     and new.assigned_to is not null
     and new.created_by is not null
     and new.assigned_to <> new.created_by then
    if exists (select 1 from public.collaborators c
               where c.id = new.created_by and c.role in ('manager','coordinator','director'))
       or exists (select 1 from public.governance_leaders gl where gl.leader_id = new.created_by) then
      new.governance_owner_id := new.created_by;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_governance_owner_on_insert on public.tasks;
create trigger trg_governance_owner_on_insert
  before insert on public.tasks
  for each row execute function public.set_governance_owner_on_insert();

-- Backfill: tarefas já delegadas por um líder ganham posse = quem criou.
update public.tasks t
set governance_owner_id = t.created_by
where t.governance_owner_id is null
  and t.assigned_to is not null and t.created_by is not null
  and t.assigned_to <> t.created_by
  and (
    exists (select 1 from public.collaborators c where c.id = t.created_by and c.role in ('manager','coordinator','director'))
    or exists (select 1 from public.governance_leaders gl where gl.leader_id = t.created_by)
  );
```

- [ ] **Step 2: Aplicar a migration**

Aplicar via MCP Supabase (`apply_migration`, project `cesnbnrynvxvgdhfmaua`, name `governance_owner`) com o SQL acima.

- [ ] **Step 3: Verificar coluna, trigger e backfill**

Rodar (execute_sql):

```sql
select count(*) total,
  count(governance_owner_id) com_dono,
  count(*) filter (where governance_owner_id is null) sem_dono
from public.tasks;
select tgname from pg_trigger where tgname = 'trg_governance_owner_on_insert';
```

Esperado: a coluna existe, `com_dono` > 0 (as delegadas históricas), `sem_dono` cobre o resto, e o trigger aparece.

- [ ] **Step 4: Smoke-test do trigger (insert delegado vs próprio)**

```sql
-- (a) líder delega pra outro → posse setada. Use ids reais: created_by = um manager, assigned_to = outro.
-- (b) auto-criada (assigned_to = created_by) → posse NULL.
-- Rodar 2 INSERTs de teste com data_classification='test', conferir governance_owner_id, e deletar depois.
```
Esperado: (a) `governance_owner_id` = o líder; (b) NULL. Apagar as linhas de teste no fim.

---

## Task 2: Função pura no TOM — `governanceViewerIdsOf`

**Files:**
- Modify: `src/services/leader-routing.js` (adicionar export)
- Test: `src/services/leader-routing.test.js` (adicionar casos)

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao fim de `src/services/leader-routing.test.js` (seguir o estilo/harness já usado no arquivo — mesmas fixtures de colaboradores). Fixtures mínimas: Jereh `{id:'jereh', role:'manager', unit:'campo_grande', is_active:true}`, Rose `{id:'rose', role:'manager', unit:'all', is_active:true}`, Krissya `{id:'kris', role:'manager', unit:'all', is_active:true}`, Gabi `{id:'gabi', unit:'campo_grande', explicit_leader_ids:[]}`, Vitoria `{id:'vit', unit:'campo_grande', explicit_leader_ids:[]}`. `allCollabs = [jereh, rose, kris, gabi, vit]`.

```js
const { governanceViewerIdsOf } = require('./leader-routing');

// 1. Rose delegou → só a Rose vê (Jereh não)
{
  const viewers = governanceViewerIdsOf({ governance_owner_id: 'rose', assigned_to: 'gabi' }, gabi, allCollabs);
  assert.deepStrictEqual(viewers, ['rose']);
}
// 2. Jereh delegou tarefa financeira → Jereh vê (tema ignorado)
{
  const viewers = governanceViewerIdsOf({ governance_owner_id: 'jereh', assigned_to: 'gabi' }, gabi, allCollabs);
  assert.deepStrictEqual(viewers, ['jereh']);
}
// 3. Tarefa solta da Gabi (NULL) → gerente da unidade (Jereh)
{
  const viewers = governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'gabi' }, gabi, allCollabs);
  assert.deepStrictEqual(viewers, ['jereh']);
}
// 4. Tarefa solta da Vitória (NULL) → Jereh, NÃO Krissya
{
  const viewers = governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'vit' }, vit, allCollabs);
  assert.deepStrictEqual(viewers, ['jereh']);
}
// 5. Krissya delegou → Krissya
{
  const viewers = governanceViewerIdsOf({ governance_owner_id: 'kris', assigned_to: 'vit' }, vit, allCollabs);
  assert.deepStrictEqual(viewers, ['kris']);
}
// 6. Solta sem unidade → vazio (caller cai no CEO)
{
  const semUnit = { id: 'x', unit: null, explicit_leader_ids: [] };
  const viewers = governanceViewerIdsOf({ governance_owner_id: null, assigned_to: 'x' }, semUnit, [...allCollabs, semUnit]);
  assert.deepStrictEqual(viewers, []);
}
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js` (ou o mesmo comando que o arquivo já usa).
Expected: FAIL — `governanceViewerIdsOf is not a function`.

- [ ] **Step 3: Implementar a função**

Adicionar em `src/services/leader-routing.js` (e incluir no `module.exports`):

```js
/**
 * Quem VÊ a tarefa na governança = o delegador explícito (governance_owner_id),
 * OU, se a tarefa é solta (NULL), o gerente da unidade do dono + arestas manuais.
 * Retorna array de collaborator ids. Vazio → caller cai no CEO.
 * @param {{governance_owner_id?: string|null, assigned_to: string}} task
 * @param {{id:string, unit?:string|null, explicit_leader_ids?:string[]}} owner
 * @param {Array} allCollabs
 * @returns {string[]}
 */
function governanceViewerIdsOf(task, owner, allCollabs) {
  if (task && task.governance_owner_id) return [task.governance_owner_id];
  const ids = new Set();
  const unit = owner && owner.unit ? owner.unit : null;
  if (unit) {
    for (const c of (allCollabs || [])) {
      if (c.role === 'manager' && c.unit === unit && c.is_active !== false && !c.is_ceo) ids.add(c.id);
    }
  }
  for (const lid of ((owner && owner.explicit_leader_ids) || [])) {
    const L = (allCollabs || []).find((c) => c.id === lid);
    if (L && !L.is_ceo) ids.add(lid);
  }
  return [...ids];
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js`
Expected: PASS (todos, incluindo os 6 novos).

---

## Task 3: Função pura espelhada no PWA — `governanceViewerIdsOf`

**Files:**
- Modify: `web/src/lib/team-routing.ts` (adicionar export + tipo)
- Test: `web/src/lib/team-routing.test.ts` (adicionar casos)

- [ ] **Step 1: Escrever os testes que falham**

Adicionar a `web/src/lib/team-routing.test.ts` (mesmo harness/vitest do arquivo), espelhando os 6 casos da Task 2 (Rose→[rose]; Jereh→[jereh]; Gabi solta→[jereh]; Vitória solta→[jereh]; Krissya→[kris]; sem unidade→[]). Usar o tipo `Collab` já existente no arquivo (tem `explicit_leader_ids?`).

```ts
import { governanceViewerIdsOf } from './team-routing';
// ...mesmas fixtures e 6 asserts (expect(...).toEqual([...])) da Task 2.
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /d/la-organizer/_remote/web && npx vitest run src/lib/team-routing.test.ts`
Expected: FAIL — `governanceViewerIdsOf` não exportado.

- [ ] **Step 3: Implementar (mirror exato da versão JS)**

Adicionar em `web/src/lib/team-routing.ts`:

```ts
/** Espelho de src/services/leader-routing.js governanceViewerIdsOf — manter idêntico. */
export function governanceViewerIdsOf(
  task: { governance_owner_id?: string | null; assigned_to: string },
  owner: Collab | undefined,
  allCollabs: Collab[],
): string[] {
  if (task && task.governance_owner_id) return [task.governance_owner_id];
  const ids = new Set<string>();
  const unit = owner && owner.unit ? owner.unit : null;
  if (unit) {
    for (const c of (allCollabs || [])) {
      if (c.role === 'manager' && c.unit === unit && (c as any).is_active !== false && !c.is_ceo) ids.add(c.id);
    }
  }
  for (const lid of ((owner && owner.explicit_leader_ids) || [])) {
    const L = (allCollabs || []).find((c) => c.id === lid);
    if (L && !L.is_ceo) ids.add(lid);
  }
  return [...ids];
}
```

- [ ] **Step 4: Rodar testes + tsc**

Run: `cd /d/la-organizer/_remote/web && npx vitest run src/lib/team-routing.test.ts && npx tsc --noEmit`
Expected: PASS + tsc exit 0.

---

## Task 4: Wire — digest do líder filtra pela posse

**Files:**
- Modify: `src/rituals/dispatcher.js` — função `ceoTeamUnclosedTasksReport` (select + filtro por `opts.leaderId`) e `sendLeaderGovernanceDigest` (passa `leaderId`).

- [ ] **Step 1: Adicionar `governance_owner_id` ao SELECT da query de tarefas**

Em `ceoTeamUnclosedTasksReport` (~linha 2357), no `.select(...)`, incluir `governance_owner_id`:

```js
    let _tkQ = supabase
      .from('tasks')
      .select('id, title, due_date, category, assigned_to, governance_owner_id, staleness_check_sent_at, data_classification, coordination_request_count, collaborators!tasks_assigned_to_fkey(full_name)')
      .eq('context', 'work')
      .eq('data_classification', 'real')
      .eq('status', 'pending')
      .lt('due_date', today)
      .order('due_date', { ascending: true })
      .limit(80);
    // Fase 2 — digest do líder: NÃO restringe por scopeIds (a posse pode ser de gente fora
    // da unidade); pega tudo e filtra pela função pura abaixo. scopeIds só é usado se NÃO houver leaderId.
    if (opts.scopeIds && !opts.leaderId) _tkQ = _tkQ.in('assigned_to', opts.scopeIds);
    const { data: stale, error } = await _tkQ;
```

- [ ] **Step 2: Filtrar por `governanceViewerIdsOf` quando `opts.leaderId`**

Logo após o guard `if (!stale || stale.length === 0) {...}` (~linha 2378), inserir:

```js
    // Fase 2 — fatiamento por delegação: o líder vê o que ele delegou + as soltas do time dele.
    let scoped = stale;
    if (opts.leaderId) {
      const { governanceViewerIdsOf } = require('../services/leader-routing');
      scoped = stale.filter((t) =>
        governanceViewerIdsOf(t, collabById.get(t.assigned_to), allCollabs).includes(opts.leaderId),
      );
      if (scoped.length === 0) {
        await logRitualEvent(ceo.id, 'ceo_team_unclosed_tasks', 'skipped', `no_slice_for_leader=${opts.leaderId}`, ymdRef);
        continue;
      }
    }
```

Depois, **trocar todas as referências subsequentes de `stale` por `scoped`** dentro do bloco do loop (a partir daqui até o fim do `for`): `const totalCount = scoped.length;`, `const ids = scoped.map(...)`, `const filteredStale = scoped.filter(...)`. (O `stale` cru já foi consumido; o resto da função opera sobre `scoped`.)

- [ ] **Step 3: `sendLeaderGovernanceDigest` passa `leaderId` em vez de `scopeIds` (só tarefas)**

Em `sendLeaderGovernanceDigest` (~linha 2816), trocar a chamada de tarefas:

```js
    const tasksR = prefs.show_tarefas ? await ceoTeamUnclosedTasksReport(now, { returnText: true, leaderId, groupByOwner: true }) : null;
```

(O `eventsR` continua com `scopeIds: teamIds` — eventos não são fatiados nesta fase.)

- [ ] **Step 4: Syntax check**

Run: `cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js`
Expected: sem erro.

- [ ] **Step 5: Deploy do TOM (SCP + restart)**

```bash
scp /d/la-organizer/_remote/src/services/leader-routing.js tom:/opt/LA-Organizer/src/services/leader-routing.js
scp /d/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
ssh tom "pm2 restart tom && echo RESTARTED"
```

---

## Task 5: Validação end-to-end (dry-run na VPS)

**Files:** nenhum (validação).

- [ ] **Step 1: Dry-run do digest do líder e conferir o fatiamento**

```bash
ssh tom 'cd /opt/LA-Organizer && node --env-file=.env -e '"'"'
const d = require("./src/rituals/dispatcher");
(async()=>{
  const r = await d.sendLeaderGovernanceDigest(new Date(), {force:true, dryRun:true});
  for(const x of ((r&&r.results)||[])){ console.log("=== LÍDER:", x.leader, "time:", x.team, "==="); (x.messages||[]).forEach(m=>console.log(m)); }
})().catch(e=>console.error("ERR", e.message));
'"'"''
```
Expected: cada líder recebe só as tarefas que ele delegou + as soltas do time dele (gerente). Conferir com uma consulta SQL que uma tarefa com `governance_owner_id = Rose` aparece SÓ no bloco da Rose e NÃO no do Jereh.

- [ ] **Step 2: Conferir o CEO ainda vê tudo**

```bash
ssh tom 'cd /opt/LA-Organizer && node --env-file=.env -e '"'"'
require("./src/rituals/dispatcher").sendGovernanceDigest(new Date(),{force:true,dryRun:true}).then(r=>r.results.forEach(x=>x.messages.forEach(m=>console.log(m)))).catch(e=>console.error("ERR",e.message));
'"'"''
```
Expected: o digest do CEO continua mostrando TODAS as tarefas atrasadas (sem filtro de posse), com o Diagnóstico 🔍.

- [ ] **Step 3: Registrar no `tom_known_issues` que a Fase 2 sub-fase 1 entrou**

INSERT em `tom_known_issues` (area `dispatcher`, status `corrigido`) documentando: governança agora fatiada por `governance_owner_id` (delegador); digest do líder filtra por `governanceViewerIdsOf`; soltas caem no gerente da unidade; CEO vê tudo.

---

## Self-Review (feito)

- **Cobertura da spec:** coluna+trigger+backfill (Task 1) ✓; função pura JS (Task 2) + TS (Task 3) ✓; digest fatiado (Task 4) ✓; CEO vê tudo (Task 4/5) ✓; catch-all gerente + arestas (Task 2/3) ✓; edge sem unidade→CEO (Task 2 caso 6) ✓. Captura automática na criação = trigger (Task 1) cobre TOM+PWA. Re-delegação por voz (TOM) e UI do PWA = **sub-fases 2 e 3** (fora deste plano, por decisão de rollout da spec).
- **Placeholders:** nenhum — todo passo tem código/SQL/comando reais. (Os 2 INSERTs de smoke-test da Task 1 Step 4 e o registro da Task 5 Step 3 são intencionalmente descritos com dados reais a preencher na hora, por dependerem de ids do banco.)
- **Consistência de tipos:** `governanceViewerIdsOf(task, owner, allCollabs)` idêntico em JS e TS; `opts.leaderId` usado na Task 4 bate com o que `sendLeaderGovernanceDigest` passa.
