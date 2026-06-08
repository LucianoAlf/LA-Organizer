# Fase 3 — Multi-tenant (líder vê só o seu time) — Implementation Plan

> **For agentic workers:** plano executado inline (TDD, vitest). Steps em checkbox.

**Goal:** A `/time` passa a ser multi-tenant: CEO (Alf) vê tudo (semáforo de líderes + drill, já existe); cada líder vê **só o time dele** (membersOf), em desktop e mobile, com números honestos escopados ("do time" vs "da empresa").

**Architecture:** Resolvedor de escopo puro (`team-scope.ts`) decide o modo do viewer (`ceo` | `leader` | `none`) e o conjunto de ids do time. `fetchTeamSnapshot` fica consciente de escopo (queries filtram por `assigned_to in (memberIds)` quando não-CEO; counts ficam honestos por persona). `DashboardTimeDesktop` despacha CeoView (atual) vs LeaderDesktop (novo). `DashboardTimeMobile` filtra pelo mesmo escopo. **Isolamento real (RLS) é Fase 7** — aqui o filtro é de UI/query (decisão dev-vs-prod já aprovada na spec §5/§12).

**Tech Stack:** React 18 + TS + Vite + Tailwind + @tanstack/react-query + supabase-js; vitest pra funções puras.

**Auditoria-base (2026-06-08, dados reais):** times resolvem certo via `team-routing` sem migração — Juliana/Quintela→7 pedagógicos; Jereh→Gabi/Jhonatan/Vitória; Krissya→Arthur/Leo/Kailane; Clayton→Daiana/Fefê; Yuri→John. Líderes sem time hoje: Hugo, Anne, Ana, Admin → empty-state. RLS: gerente/coord/diretor leem todas as tasks de trabalho (filtro de UI é cosmético; RLS real = Fase 7). `is_ceo` não vem no AuthContext → resolver via `allCollabs` do snapshot.

---

## File Structure
- **Create** `web/src/lib/team-scope.ts` — `resolveScope(viewerId, allCollabs)` puro → `{ mode, viewerId, scopeIds, memberIds }`.
- **Create** `web/src/lib/team-scope.test.ts` — testes do resolvedor (CEO / líder com time / líder sem time / colaborador).
- **Modify** `web/src/lib/team-snapshot.ts` — `fetchTeamSnapshot` consciente de escopo; novos campos no `TeamSnapshot` (`scope`, `isCeo`, `viewerId`, `memberIds`).
- **Modify** `web/src/screens/DashboardTimeDesktop.tsx` — despacha CeoView (conteúdo atual) vs `LeaderDesktop` por `snapshot.isCeo`/`mode`.
- **Create** `web/src/screens/LeaderDesktop.tsx` — view do líder (fila de ação do time + "Você" do scorecard próprio + reconhecimento).
- **Create** `web/src/components/team/MyTeamQueue.tsx` — lista do time do líder (reusa padrão da lista do TeamDrillPanel) com link `/time/:id`.
- **Create** `web/src/components/team/YouCard.tsx` — card "Você" (fechamento próprio + badge) a partir do scorecard self.
- **Modify** `web/src/screens/DashboardTimeMobile.tsx` — usa snapshot escopado + rótulo "do time"/"da empresa".

---

## Task 1: Resolvedor de escopo puro

**Files:** Create `web/src/lib/team-scope.ts`; Test `web/src/lib/team-scope.test.ts`

- [ ] **Step 1 — teste falhando** (`team-scope.test.ts`): CEO → mode 'ceo' + scopeIds null; líder com time → mode 'leader' + memberIds = time; líder sem time → mode 'none'; colaborador comum → mode 'none'.
- [ ] **Step 2 — rodar**: `cd _remote/web && npx vitest run src/lib/team-scope.test.ts` → FAIL.
- [ ] **Step 3 — implementar** `resolveScope`:
```ts
import { membersOf, type Collab } from './team-routing';
export type ScopeMode = 'ceo' | 'leader' | 'none';
export interface TeamScope { mode: ScopeMode; viewerId: string; scopeIds: string[] | null; memberIds: string[]; }
export function resolveScope(viewerId: string, allCollabs: Collab[]): TeamScope {
  const viewer = (allCollabs ?? []).find(c => c.id === viewerId) ?? null;
  if (!viewer) return { mode: 'none', viewerId, scopeIds: [], memberIds: [] };
  if (viewer.is_ceo) return { mode: 'ceo', viewerId, scopeIds: null, memberIds: [] };
  const memberIds = membersOf(viewer, allCollabs).map(c => c.id);
  if (memberIds.length === 0) return { mode: 'none', viewerId, scopeIds: [], memberIds: [] };
  return { mode: 'leader', viewerId, scopeIds: memberIds, memberIds };
}
```
- [ ] **Step 4 — rodar**: PASS.
- [ ] **Step 5** — (sem commit entre tasks; CLAUDE.md).

## Task 2: Snapshot consciente de escopo

**Files:** Modify `web/src/lib/team-snapshot.ts`

- [ ] **Step 1** — adicionar campos no `TeamSnapshot`: `scope: 'company'|'team'`, `isCeo: boolean`, `viewerId: string`, `memberIds: string[]`.
- [ ] **Step 2** — em `fetchTeamSnapshot(myId)`: depois de montar `allCollabs`, computar `const sc = resolveScope(myId, allCollabs as Collab[])`. `team` = CEO ? allCollabs sem mim : allCollabs filtrado por `memberIds`. Quando `sc.scopeIds` não-null, todas as queries de tasks ganham `.in('assigned_to', sc.scopeIds)`; `completedToday`/`dueToday`/`overdue` ficam escopados. Eventos filtrados por `collaborator_id in memberIds`. `responded`/`noResponse` iteram só sobre `team`.
- [ ] **Step 3** — retornar `scope: sc.mode==='ceo'?'company':'team'`, `isCeo`, `viewerId:myId`, `memberIds: sc.memberIds`.
- [ ] **Step 4** — `npx tsc --noEmit` → 0; mobile/desktop ainda compilam (campos novos opcionais no consumo).

## Task 3: Despacho de papel no desktop

**Files:** Modify `web/src/screens/DashboardTimeDesktop.tsx`; Create `web/src/screens/LeaderDesktop.tsx`

- [ ] **Step 1** — em `DashboardTimeDesktop`, após carregar snapshot: `if (!snapshot.isCeo) return <LeaderDesktop snapshot={snapshot} scorecards={scorecards} weekStart={weekStart} />;` (CEO segue no fluxo atual).
- [ ] **Step 2** — criar `LeaderDesktop`: `PageHeader title="Time" subtitle="Seu time · só trabalho"`; KPIs escopados (reusa `CeoKpiStrip` que já lê do snapshot); `NeedsYouToday` (já escopado pelo snapshot) + `MyTeamQueue` + `YouCard`. Empty-state honesto quando `memberIds.length===0` (mode 'none' renderiza aviso "você não tem liderados diretos").
- [ ] **Step 3** — `npx tsc --noEmit` → 0; `npx vite build` → exit 0.

## Task 4: Componentes do líder

**Files:** Create `web/src/components/team/MyTeamQueue.tsx`, `web/src/components/team/YouCard.tsx`

- [ ] **Step 1** — `MyTeamQueue`: recebe `snapshot`; lista `snapshot.team` ordenada por atraso desc, cada um com overdue/eventos + link `/time/:id` (mesmo padrão visual da lista do `TeamDrillPanel`).
- [ ] **Step 2** — `YouCard`: recebe o scorecard self do líder (`scorecards.find(s => s.leader_id === viewerId)`); mostra fechamento próprio, atrasadas, insight e badge motivacional. Sem scorecard → card neutro "sem scorecard esta semana".
- [ ] **Step 3** — `npx tsc --noEmit` → 0.

## Task 5: Mobile escopado

**Files:** Modify `web/src/screens/DashboardTimeMobile.tsx`

- [ ] **Step 1** — o snapshot já vem escopado (CEO=empresa, líder=time). Adicionar rótulo no subtitle: `snapshot.scope === 'team' ? 'Seu time · só trabalho' : 'Visão geral · só trabalho'`.
- [ ] **Step 2** — empty-state quando `team.length === 0` (líder sem liderados): aviso honesto em vez de cards zerados.
- [ ] **Step 3** — `npx tsc --noEmit` → 0; `npx vite build` → exit 0.

## Task 6: Validação

- [ ] **Step 1** — `npx vitest run` (toda a suíte) → tudo verde.
- [ ] **Step 2** — Preview 1440×900: CEO (Alf logado) **continua idêntico** ao da Fase 2 (semáforo + drill).
- [ ] **Step 3** — Preview: simular líder (via eval forçando viewerId de Juliana/Jereh, ou query param de debug) → ver a LeaderDesktop só com o time dele; mobile idem em 375px.
- [ ] **Step 4** — Registrar no roadmap (spec §10 item 3 ✓) e seguir pra Fase 5/6.

---

## Self-Review
- **Cobertura da spec:** §5 multi-tenant ✓ (routing na tela + escopo); §3 líder desktop ✓; §3 mobile escopado ✓; §4 números honestos por escopo ✓; isolamento RLS → Fase 7 (consciente).
- **Tipos:** `TeamScope`/`ScopeMode` em team-scope; `TeamSnapshot` ganha `scope/isCeo/viewerId/memberIds` consumidos consistentemente.
- **Guardrail:** dispatcher mobile/desktop intacto; CEO view não muda.
- **Risco:** filtro de UI cosmético (RLS) — aceito em dev, flag pra prod (Fase 7).
