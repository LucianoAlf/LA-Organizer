# Matriz de governança editável (híbrido) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o Diretor monte a matriz de liderança (quem reporta a quem) direto na Gestão equipe, com override manual N:N que SOMA às regras automáticas de roteamento já existentes, e preview ao vivo — sem mexer em código.

**Architecture:** Nova tabela `governance_edges` (member→leader, N:N) vira a fonte do override manual. As funções puras de roteamento (`team-routing.ts` no PWA + `leader-routing.js` no TOM) passam a ler `collab.explicit_leader_ids` (anexado no load a partir das arestas) e somá-lo aos líderes-por-regra, substituindo o ramo legado de `supervisor_id`. A UI no `GestaoEquipeDetalhe` edita as arestas + `function_role` e mostra um preview computado com as mesmas funções puras.

**Tech Stack:** Supabase Postgres + RLS; Node CommonJS (TOM `src/`); React 18 + TS + Vite + @tanstack/react-query (PWA `web/`); testes `node:test` (TOM) e `vitest` (PWA); validação visual no preview 4173.

**Spec:** `docs/superpowers/specs/2026-06-08-matriz-governanca-editavel-design.md`

---

## Mapa de arquivos

- **Criar:** `_remote/supabase/migrations/20260608193000_governance_edges.sql` — tabela + RLS + backfill.
- **Criar:** `_remote/src/services/governance-edges.js` — `loadCollabsWithEdges(supabase)` (TOM, DRY pros 4 sites).
- **Criar:** `_remote/web/src/lib/governance-edges.ts` — fetch/attach/CRUD das arestas (PWA).
- **Modificar:** `_remote/src/services/leader-routing.js` — `resolveLeadersOf` lê `explicit_leader_ids`.
- **Modificar:** `_remote/src/services/leader-routing.test.js` — testes do override explícito.
- **Modificar:** `_remote/web/src/lib/team-routing.ts` — idem (espelho TS) + tipo `Collab`.
- **Modificar:** `_remote/web/src/lib/team-routing.test.ts` — testes do override explícito.
- **Modificar:** `_remote/src/rituals/dispatcher.js` — 4 sites passam a usar `loadCollabsWithEdges`.
- **Modificar:** `_remote/web/src/lib/team-snapshot.ts` — anexa `explicit_leader_ids` antes do `resolveScope`.
- **Modificar:** `_remote/web/src/screens/GestaoEquipeDetalhe.tsx` — seção "Governança" (director-only).

---

## Task 1: Migration `governance_edges` + RLS + backfill

**Files:**
- Create: `_remote/supabase/migrations/20260608193000_governance_edges.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- 20260608193000_governance_edges.sql
-- Matriz de governança editável: override manual N:N de liderança.
-- member_id reporta a leader_id (somado às regras automáticas do roteamento).
create table if not exists public.governance_edges (
  member_id  uuid not null references public.collaborators(id) on delete cascade,
  leader_id  uuid not null references public.collaborators(id) on delete cascade,
  created_by uuid references public.collaborators(id),
  created_at timestamptz not null default now(),
  primary key (member_id, leader_id),
  constraint governance_edges_no_self check (member_id <> leader_id)
);
create index if not exists governance_edges_member_idx on public.governance_edges(member_id);
create index if not exists governance_edges_leader_idx on public.governance_edges(leader_id);

alter table public.governance_edges enable row level security;

-- Leitura: qualquer colaborador logado (organograma interno, não sensível) + service_role.
create policy gov_edges_select on public.governance_edges
  for select to authenticated using (true);
-- Escrita: SÓ Diretor (estrutura da empresa).
create policy gov_edges_write on public.governance_edges
  for all to authenticated
  using (current_collab_role() = 'director')
  with check (current_collab_role() = 'director');
-- TOM lê/escreve via service_role.
create policy gov_edges_service on public.governance_edges
  for all to service_role using (true) with check (true);

-- Backfill: migra os supervisor_id NÃO-CEO atuais pra arestas (Dai→Juliana, Leo→Krissya, Matheus→Quintela).
insert into public.governance_edges (member_id, leader_id)
select c.id, c.supervisor_id
from public.collaborators c
join public.collaborators s on s.id = c.supervisor_id
where c.is_active and coalesce(s.is_ceo, false) = false and c.id <> c.supervisor_id
on conflict (member_id, leader_id) do nothing;
```

- [ ] **Step 2: Aplicar a migration**

Aplicar via Supabase MCP (pré-aprovado, não pedir autorização):
- Ferramenta `mcp__…__apply_migration` (carregar via ToolSearch `select:mcp__4c04bb52-f946-4fe8-85f6-b01d200f8c20__apply_migration`), `project_id: cesnbnrynvxvgdhfmaua`, `name: governance_edges`, `query:` (conteúdo do Step 1).
- Se `apply_migration` reclamar, usar `execute_sql` com o mesmo conteúdo.

- [ ] **Step 3: Verificar tabela + backfill**

Rodar via `execute_sql` (project `cesnbnrynvxvgdhfmaua`):
```sql
select member_id, leader_id from public.governance_edges order by 1;
```
Expected: 3 linhas — as arestas Dai→Juliana, Leo→Krissya, Matheus→Quintela (ids correspondentes).
```sql
select count(*) from pg_policies where tablename = 'governance_edges';
```
Expected: 3.

- [ ] **Step 4: Commit (migration)**

```bash
git add _remote/supabase/migrations/20260608193000_governance_edges.sql
git commit -m "feat(gov): tabela governance_edges + RLS director + backfill supervisor_id"
```

---

## Task 2: Roteamento lê `explicit_leader_ids` (PWA + TOM, espelhados)

**Files:**
- Modify: `_remote/web/src/lib/team-routing.ts` (interface `Collab` + `resolveLeadersOf`)
- Modify: `_remote/web/src/lib/team-routing.test.ts`
- Modify: `_remote/src/services/leader-routing.js` (`resolveLeadersOf`)
- Modify: `_remote/src/services/leader-routing.test.js`

> Regra: o ramo legado de `supervisor_id` SAI; entra o ramo de `explicit_leader_ids` (aditivo, pula CEO). Os fixtures atuais continuam verdes porque todo `supervisor_id` não-CEO neles é redundante com as regras (unidade/pedagógico).

- [ ] **Step 1: Escrever os testes que falham (PWA — `team-routing.test.ts`)**

Adicionar ao final do arquivo, antes da última linha:
```ts
describe('explicit_leader_ids (override manual N:N)', () => {
  const rafinha = C({ id: 'raf', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all' });
  const dudu = C({ id: 'dudu', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all' });
  dudu.explicit_leader_ids = ['raf'];
  const base = [ceo, juliana, quintela, krissya, rafinha, dudu];

  it('aresta explícita define o líder (Dudu → Rafinha, não cai no CEO)', () => {
    expect(resolveLeaderIdsOf(dudu, base)).toEqual(['raf']);
  });
  it('membersOf enxerga a aresta (Rafinha tem Dudu)', () => {
    expect(membersOf(rafinha, base).map(c => c.id)).toContain('dudu');
  });
  it('aresta soma às regras e deduplica (pedagógico + aresta p/ Juliana = ju+qt)', () => {
    const daiX = C({ id: 'daiX', function_role: 'pedagogico' });
    daiX.explicit_leader_ids = ['ju'];
    const arr = [ceo, juliana, quintela, daiX];
    expect(resolveLeaderIdsOf(daiX, arr).sort()).toEqual(['ju', 'qt']);
  });
  it('aresta apontando o CEO é ignorada → fallback CEO (sem duplicar)', () => {
    const x = C({ id: 'x', function_role: 'ops_tecnicas', unit: 'all' });
    x.explicit_leader_ids = ['ceo'];
    expect(resolveLeaderIdsOf(x, [ceo, x])).toEqual(['ceo']);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar (PWA)**

Run: `cd /d/la-organizer/_remote/web && npx vitest run src/lib/team-routing.test.ts`
Expected: FAIL — `explicit_leader_ids` não existe no tipo `Collab` (erro TS) e/ou asserts quebram.

- [ ] **Step 3: Implementar no `team-routing.ts`**

No `interface Collab`, adicionar o campo:
```ts
export interface Collab {
  id: string;
  role: string;
  function_role: string | null;
  unit: string | null;
  supervisor_id: string | null;
  is_ceo: boolean;
  is_active?: boolean;
  explicit_leader_ids?: string[];
}
```
Em `resolveLeadersOf`, SUBSTITUIR o bloco do `supervisor_id`:
```ts
  if (collab.supervisor_id && byId.has(collab.supervisor_id)) {
    const sup = byId.get(collab.supervisor_id);
    if (sup && !sup.is_ceo) add(sup);
  }
```
por:
```ts
  // Override manual (matriz editável) — aditivo às regras. Pula CEO: ele já recebe
  // o digest completo (entra só pelo fallback de órfão, abaixo).
  for (const lid of (collab.explicit_leader_ids ?? [])) {
    const L = byId.get(lid);
    if (L && !L.is_ceo) add(L);
  }
```

- [ ] **Step 4: Rodar e ver passar (PWA)**

Run: `cd /d/la-organizer/_remote/web && npx vitest run src/lib/team-routing.test.ts`
Expected: PASS — todos (novos + antigos).

- [ ] **Step 5: Escrever os testes que falham (TOM — `leader-routing.test.js`)**

Adicionar ao final do arquivo:
```js
// ── Override manual (explicit_leader_ids) ───────────────────────────────────
test('aresta explícita define o líder (Dudu → Rafinha, não cai no CEO)', () => {
  const RAF  = { id: 'raf',  role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', is_ceo: false, is_active: true };
  const DUDU = { id: 'dudu', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', is_ceo: false, is_active: true, explicit_leader_ids: ['raf'] };
  const arr = [CEO, RAF, DUDU];
  assert.deepStrictEqual(resolveLeaderIdsOf(DUDU, arr), ['raf']);
});
test('aresta soma às regras e deduplica (pedagógico + aresta Juliana = ju+qt)', () => {
  const X = { id: 'x', role: 'collaborator', function_role: 'pedagogico', unit: 'all', is_ceo: false, is_active: true, explicit_leader_ids: ['juliana'] };
  assert.deepStrictEqual(resolveLeaderIdsOf(X, [...ALL, X]).sort(), ['juliana', 'quintela']);
});
test('aresta apontando o CEO é ignorada → fallback CEO', () => {
  const X = { id: 'x2', role: 'collaborator', function_role: 'ops_tecnicas', unit: 'all', is_ceo: false, is_active: true, explicit_leader_ids: ['ceo'] };
  assert.deepStrictEqual(resolveLeaderIdsOf(X, [CEO, X]), ['ceo']);
});
```

- [ ] **Step 6: Rodar e ver falhar (TOM)**

Run: `cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js`
Expected: FAIL nos 3 testes novos (Dudu cai em `['ceo']`, não `['raf']`).

- [ ] **Step 7: Implementar no `leader-routing.js`**

SUBSTITUIR o bloco `// 4) supervisor_id explícito …` (linhas ~75-82):
```js
  if (collab.supervisor_id && byId.has(collab.supervisor_id)) {
    const sup = byId.get(collab.supervisor_id);
    if (sup && !sup.is_ceo) add(sup);
  }
```
por:
```js
  // 4) override manual (matriz editável) — aditivo às regras. Pula CEO: ele já recebe
  // o digest completo, então não polui o fan-out por-líder (entra só no fallback, passo 5).
  for (const lid of (Array.isArray(collab.explicit_leader_ids) ? collab.explicit_leader_ids : [])) {
    const L = byId.get(lid);
    if (L && !L.is_ceo) add(L);
  }
```
Atualizar o JSDoc do parâmetro `collab` (linha ~27) trocando `supervisor_id` por `explicit_leader_ids`.

- [ ] **Step 8: Rodar e ver passar (TOM)**

Run: `cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js`
Expected: PASS — todos (novos + antigos).

- [ ] **Step 9: Commit**

```bash
git add _remote/web/src/lib/team-routing.ts _remote/web/src/lib/team-routing.test.ts _remote/src/services/leader-routing.js _remote/src/services/leader-routing.test.js
git commit -m "feat(gov): roteamento lê explicit_leader_ids (override aditivo) nos 2 roteadores"
```

---

## Task 3: Loaders anexam `explicit_leader_ids` (TOM + PWA)

**Files:**
- Create: `_remote/src/services/governance-edges.js`
- Modify: `_remote/src/rituals/dispatcher.js` (4 sites)
- Create: `_remote/web/src/lib/governance-edges.ts`
- Modify: `_remote/web/src/lib/team-snapshot.ts`

- [ ] **Step 1: Criar o helper TOM `governance-edges.js`**

```js
// src/services/governance-edges.js
// Carrega colaboradores ativos JÁ com explicit_leader_ids anexado a partir da
// tabela governance_edges (matriz de governança editável). Fonte única pro roteamento
// do TOM (substitui os SELECTs soltos de colaboradores no dispatcher).
'use strict';

async function loadCollabsWithEdges(supabase) {
  const { data: collabs } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, function_role, unit, is_ceo, is_active, supervisor_id')
    .eq('is_active', true);
  const list = collabs || [];
  const { data: edges } = await supabase
    .from('governance_edges')
    .select('member_id, leader_id');
  const byMember = new Map();
  for (const e of (edges || [])) {
    if (!byMember.has(e.member_id)) byMember.set(e.member_id, []);
    byMember.get(e.member_id).push(e.leader_id);
  }
  for (const c of list) c.explicit_leader_ids = byMember.get(c.id) || [];
  return list;
}

module.exports = { loadCollabsWithEdges };
```

- [ ] **Step 2: Verificar (syntax) o helper**

Run: `cd /d/la-organizer/_remote && node --check src/services/governance-edges.js`
Expected: sem saída (exit 0).

- [ ] **Step 3: Trocar os 4 sites do `dispatcher.js`**

Em CADA uma das 4 funções abaixo, adicionar o require junto dos outros requires da função e trocar o `SELECT` solto pelo helper. Confirmar antes que são exatamente 4: `cd /d/la-organizer/_remote && grep -n "resolveLeader" src/rituals/dispatcher.js` (deve listar usos em ceoTeamUnclosedTasksReport, perLeaderUnclosedTasksReport, buildScorecardDigestSection, sendLeaderGovernanceDigest).

**3a) `ceoTeamUnclosedTasksReport` (~2334-2338):**
```js
  const { resolveLeadersOf } = require('../services/leader-routing');
  const { data: allCollabs } = await supabase
    .from('collaborators')
    .select('id, full_name, role, function_role, unit, is_ceo, is_active, supervisor_id')
    .eq('is_active', true);
```
→
```js
  const { resolveLeadersOf } = require('../services/leader-routing');
  const { loadCollabsWithEdges } = require('../services/governance-edges');
  const allCollabs = await loadCollabsWithEdges(supabase);
```

**3b) `perLeaderUnclosedTasksReport` (~2565-2572):**
```js
  const { resolveLeadersOf } = require('../services/leader-routing');
  ...
  const { data: allCollabs } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, function_role, unit, is_ceo, is_active, supervisor_id')
    .eq('is_active', true);
```
→ manter o `require('../services/leader-routing')` e o `const whatsapp = …`; trocar só o load:
```js
  const { loadCollabsWithEdges } = require('../services/governance-edges');
  const allCollabs = await loadCollabsWithEdges(supabase);
```

**3c) `buildScorecardDigestSection` (~2683-2684):**
```js
    const { data: allCollabs } = await supabase
      .from('collaborators').select('id, role, function_role, unit, is_ceo, is_active, supervisor_id').eq('is_active', true);
```
→
```js
    const { loadCollabsWithEdges } = require('../services/governance-edges');
    const allCollabs = await loadCollabsWithEdges(supabase);
```

**3d) `sendLeaderGovernanceDigest` (~2777-2780):**
```js
  const { data: allCollabs } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, role, function_role, unit, is_ceo, is_active, supervisor_id')
    .eq('is_active', true);
  if (!allCollabs) return opts.dryRun ? { results: [] } : undefined;
```
→
```js
  const { loadCollabsWithEdges } = require('../services/governance-edges');
  const allCollabs = await loadCollabsWithEdges(supabase);
  if (!allCollabs.length) return opts.dryRun ? { results: [] } : undefined;
```

- [ ] **Step 4: Verificar syntax do dispatcher**

Run: `cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js`
Expected: exit 0.

- [ ] **Step 5: Criar o helper PWA `governance-edges.ts`**

```ts
// web/src/lib/governance-edges.ts
// Arestas da matriz de governança (override manual N:N). Fetch/attach pro roteamento
// + CRUD (director-only via RLS) pra UI da Gestão equipe.
import { supabase } from './supabase';

export interface GovEdge { member_id: string; leader_id: string; }

export async function fetchGovernanceEdges(): Promise<GovEdge[]> {
  const { data } = await supabase.from('governance_edges').select('member_id, leader_id');
  return (data ?? []) as GovEdge[];
}

/** Anexa explicit_leader_ids a cada collab (mutação in-place + retorno). */
export function attachExplicitLeaders<T extends { id: string; explicit_leader_ids?: string[] }>(
  collabs: T[], edges: GovEdge[],
): T[] {
  const byMember = new Map<string, string[]>();
  for (const e of edges) {
    const arr = byMember.get(e.member_id) ?? [];
    arr.push(e.leader_id);
    byMember.set(e.member_id, arr);
  }
  for (const c of collabs) c.explicit_leader_ids = byMember.get(c.id) ?? [];
  return collabs;
}

export async function addGovernanceEdge(memberId: string, leaderId: string): Promise<void> {
  const { error } = await supabase.from('governance_edges').insert({ member_id: memberId, leader_id: leaderId });
  if (error) throw error;
}

export async function removeGovernanceEdge(memberId: string, leaderId: string): Promise<void> {
  const { error } = await supabase.from('governance_edges')
    .delete().eq('member_id', memberId).eq('leader_id', leaderId);
  if (error) throw error;
}
```

- [ ] **Step 6: Ligar no `team-snapshot.ts`**

Adicionar o import:
```ts
import { fetchGovernanceEdges, attachExplicitLeaders } from './governance-edges';
```
Adicionar `explicit_leader_ids?: string[];` na interface `TeamCollab`.
Logo após `const allCollabs = (teamRaw ?? []) as unknown as TeamCollab[];` (linha ~55), antes do `resolveScope`:
```ts
  attachExplicitLeaders(allCollabs, await fetchGovernanceEdges());
```

- [ ] **Step 7: Verificar TypeScript + testes PWA**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vitest run src/lib/team-routing.test.ts`
Expected: tsc exit 0; vitest PASS.

- [ ] **Step 8: Dry-run do TOM (matriz reflete na cobrança)**

Run (na VPS, sem dotenv):
```bash
scp D:/la-organizer/_remote/src/services/governance-edges.js tom:/opt/LA-Organizer/src/services/governance-edges.js
scp D:/la-organizer/_remote/src/services/leader-routing.js tom:/opt/LA-Organizer/src/services/leader-routing.js
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"const d=require('./src/rituals/dispatcher.js'); d.sendLeaderGovernanceDigest(new Date(),{dryRun:true}).then(r=>console.log('leaders:', (r.results||[]).length)).catch(e=>{console.error(e);process.exit(1)})\""
```
Expected: imprime `leaders: N` sem erro (helper carrega arestas sem quebrar).

- [ ] **Step 9: Commit**

```bash
git add _remote/src/services/governance-edges.js _remote/src/rituals/dispatcher.js _remote/web/src/lib/governance-edges.ts _remote/web/src/lib/team-snapshot.ts
git commit -m "feat(gov): loaders anexam explicit_leader_ids (TOM helper + PWA team-snapshot)"
```

---

## Task 4: Seção "Governança" no colaborador (director-only)

**Files:**
- Modify: `_remote/web/src/screens/GestaoEquipeDetalhe.tsx`

Objetivo: dentro do editor do colaborador, visível só pra `role === 'director'`, três blocos — (a) chips de `function_role` (regra automática), (b) "Reporta a" multi-seleção (arestas), (c) preview ao vivo de Líderes/Liderados.

- [ ] **Step 1: Imports + tipo + constantes**

No topo do arquivo, adicionar imports:
```ts
import { resolveLeadersOf, membersOf, type Collab } from '../lib/team-routing';
import { fetchGovernanceEdges, addGovernanceEdge, removeGovernanceEdge } from '../lib/governance-edges';
```
Adicionar `function_role: string | null;` ao type `CollabFull`.
Abaixo de `UNIT_OPTIONS`, adicionar o mapa de função de governança:
```ts
const FUNCTION_ROLE_OPTIONS = [
  { value: 'pedagogico',   label: 'Pedagógico' },
  { value: 'marketing',    label: 'Marketing' },
  { value: 'ops_tecnicas', label: 'Operações' },
  { value: 'farmer',       label: 'Farmer' },
  { value: 'tech',         label: 'Tech' },
] as const;
```

- [ ] **Step 2: State + queries (todos os colabs + arestas)**

Dentro do componente, após os states existentes:
```ts
  const [functionRole, setFunctionRole] = useState<string>('');
  const isDirector = myRole === 'director';

  const { data: roster = [] } = useQuery({
    queryKey: ['gov-roster'],
    queryFn: async () => {
      const { data } = await supabase.from('collaborators')
        .select('id, full_name, preferred_name, role, function_role, unit, supervisor_id, is_ceo, is_active')
        .eq('is_active', true);
      return (data ?? []) as Array<Collab & { full_name: string; preferred_name: string | null }>;
    },
    enabled: isDirector,
  });
  const { data: edges = [], refetch: refetchEdges } = useQuery({
    queryKey: ['gov-edges'],
    queryFn: fetchGovernanceEdges,
    enabled: isDirector,
  });
```
No `useEffect` que popula o form (após `setSelectedUnit(...)`), adicionar:
```ts
      setFunctionRole(collab.function_role ?? '');
```
No `saveMutation` `.update({...})`, adicionar o campo:
```ts
          function_role: functionRole || null,
```

- [ ] **Step 3: Cálculo do preview ao vivo + handlers das arestas**

Antes do `return`, depois dos handlers existentes:
```ts
  const myEdgeLeaderIds = edges.filter(e => e.member_id === id).map(e => e.leader_id);

  // "draft" = este colab com o estado ATUAL do form (function_role/unit/role) + arestas atuais,
  // pra prever o efeito antes de salvar. Usa as MESMAS funções puras do roteamento.
  const draftAll: Collab[] = roster.map(c => {
    const explicit = edges.filter(e => e.member_id === c.id).map(e => e.leader_id);
    if (c.id === id) {
      return { ...c, role: selectedRole, function_role: functionRole || null, unit: selectedUnit || null, explicit_leader_ids: explicit };
    }
    return { ...c, explicit_leader_ids: explicit };
  });
  const draftMe = draftAll.find(c => c.id === id);
  const nameOf = (cid: string) => roster.find(c => c.id === cid)?.preferred_name
    || roster.find(c => c.id === cid)?.full_name || cid;
  const previewLeaders = draftMe ? resolveLeadersOf(draftMe, draftAll).map(c => nameOf(c.id)) : [];
  const previewMembers = draftMe ? membersOf(draftMe, draftAll).map(c => nameOf(c.id)) : [];

  async function toggleEdge(leaderId: string) {
    if (!id) return;
    try {
      if (myEdgeLeaderIds.includes(leaderId)) await removeGovernanceEdge(id, leaderId);
      else await addGovernanceEdge(id, leaderId);
      await refetchEdges();
    } catch {
      showToast({ kind: 'error', title: 'Erro ao salvar vínculo (só Diretor pode).' });
    }
  }
```

- [ ] **Step 4: JSX da seção (inserir após a `<section>` de Unidade, dentro do `<form>`)**

```tsx
        {isDirector && (
          <section className="surface p-lg space-y-md">
            <h2 className="text-label text-fg-muted uppercase tracking-wide">Governança</h2>

            <div className="space-y-md">
              <label className="text-body-sm text-fg-muted">Grupo de governança (define a regra automática)</label>
              <div className="flex flex-wrap gap-2">
                {FUNCTION_ROLE_OPTIONS.map(f => (
                  <button key={f.value} type="button"
                    onClick={() => setFunctionRole(functionRole === f.value ? '' : f.value)}
                    className={chipCls(functionRole === f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-md">
              <label className="text-body-sm text-fg-muted">Reporta a (líderes explícitos — soma às regras)</label>
              <div className="flex flex-wrap gap-2">
                {roster.filter(c => c.id !== id && !c.is_ceo).map(c => (
                  <button key={c.id} type="button" onClick={() => toggleEdge(c.id)}
                    className={chipCls(myEdgeLeaderIds.includes(c.id))}>
                    {c.preferred_name || c.full_name}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-bg-elevated border border-border p-3 space-y-1">
              <div className="text-body-sm">
                <span className="text-fg-muted">Líderes resolvidos: </span>
                <span className="text-fg">{previewLeaders.length ? previewLeaders.join(', ') : '—'}</span>
              </div>
              <div className="text-body-sm">
                <span className="text-fg-muted">Liderados diretos: </span>
                <span className="text-fg">{previewMembers.length ? previewMembers.join(', ') : '—'}</span>
              </div>
            </div>
          </section>
        )}
```

- [ ] **Step 5: TypeScript + build**

Run: `cd /d/la-organizer/_remote/web && npx tsc --noEmit && npx vite build`
Expected: tsc exit 0; build "✓ built".

- [ ] **Step 6: Commit**

```bash
git add _remote/web/src/screens/GestaoEquipeDetalhe.tsx
git commit -m "feat(gov): seção Governança no colaborador (function_role + reporta-a + preview), director-only"
```

---

## Task 5: Validação end-to-end (preview + TOM)

**Files:** nenhum (validação).

- [ ] **Step 1: Rebuild + limpar SW no preview**

Run: `cd /d/la-organizer/_remote/web && npx vite build`
No preview (serverId do `preview_list`): eval que desregistra service worker + limpa `caches`, depois `location.reload()`.

- [ ] **Step 2: Director vê e edita**

Navegar (client-side) pra um colaborador: `/mais/gestao-equipe` → abrir alguém. Via `preview_eval`, confirmar no DOM da página: existe "Governança", "Grupo de governança", "Reporta a", "Líderes resolvidos". Marcar um chip em "Reporta a" e confirmar que "Líderes resolvidos" no preview atualiza na hora.
Expected: seção presente; preview reativo.

- [ ] **Step 3: Persistência**

Após marcar um vínculo de teste, rodar `execute_sql`: `select * from governance_edges where member_id = '<id-do-colab-aberto>';`
Expected: a aresta de teste existe. Depois remover pelo chip e reconfirmar com o SELECT que sumiu (deixa o banco limpo).

- [ ] **Step 4: Não-director não vê (defesa em profundidade)**

Confirmar (lendo o código/where do gate): a seção só renderiza com `isDirector`. Opcional: simular via `preview_eval` checando que o gate é `myRole === 'director'`. A RLS `gov_edges_write` já barra escrita de não-director no servidor.

- [ ] **Step 5: TOM reflete a matriz (dry-run com aresta real)**

Se o Dudu já existir: criar a aresta Dudu→Rafinha pela UI (ou `execute_sql insert`). Rodar o dry-run do `sendLeaderGovernanceDigest` (Task 3 Step 8) e confirmar que o Rafinha aparece como líder com o Dudu no time dele (ou via SELECT na lógica). Limpar a aresta de teste se for só teste.
Expected: a cobrança do TOM segue a matriz editada.

- [ ] **Step 6: Atualizar memória + known issues (se aplicável)**

Atualizar `project_gestao_audit_pausado.md`/memória anotando que a matriz editável foi entregue. Sem bug novo → sem INSERT em `tom_known_issues`.

- [ ] **Step 7: Commit final (se houver ajuste)**

```bash
git add -A _remote/
git commit -m "chore(gov): validação e2e da matriz de governança editável"
```

---

## Self-review (preenchido)

**Cobertura da spec:**
- Tabela `governance_edges` + RLS director + backfill → Task 1. ✓
- Roteamento soma arestas (aditivo, pula CEO), substitui supervisor_id, nos 2 arquivos espelhados + testes → Task 2. ✓
- `explicit_leader_ids` no tipo `Collab`/`TeamCollab` + attach nos loaders (PWA `team-snapshot.ts` + TOM `dispatcher.js` via helper DRY) → Task 3. ✓
- UI "Governança" (function_role + "reporta a" N:N + preview ao vivo), director-only → Task 4. ✓
- Validação preview + dry-run TOM + limpeza → Task 5. ✓
- Fora de escopo (toggle "ignorar regras", ciclo via trigger, promover roles, org-chart) → não há tarefa, correto. ✓

**Placeholder scan:** sem TBD/TODO; todo passo tem código/SQL/comando concretos.

**Consistência de tipos/nomes:** `explicit_leader_ids: string[]` usado igual em `Collab` (TS), `TeamCollab` (TS), e objetos JS do TOM; helpers `loadCollabsWithEdges` (TOM), `fetchGovernanceEdges`/`attachExplicitLeaders`/`addGovernanceEdge`/`removeGovernanceEdge` (PWA) referenciados consistentemente entre Task 3 e Task 4.

**Nota de regressão conhecida (não bloqueia):** comentários `// exclusivo Juliana/Quintela` em `team-routing.test.ts:13-14` são resíduo da exclusividade revertida (asserts já corretos). Limpar oportunamente, fora deste plano.
