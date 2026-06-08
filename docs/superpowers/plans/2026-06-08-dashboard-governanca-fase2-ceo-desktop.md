# Fase 2 — CEO Desktop (semáforo de líderes + drill) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recomendado p/ os componentes) ou superpowers:executing-plans. Steps usam checkbox `- [ ]`.

**Goal:** Tela DESKTOP da `/time` pro CEO: KPIs honestos clicáveis + faixa "precisa de você hoje" + **semáforo de líderes** (de `leader_scorecards`) + **drill master-detail** líder→time→pessoa. Reusa a honestidade da Fase 1 e a tabela de scorecard já populada.

**Architecture:** Lógica de agrupamento e classificação vira 2 módulos PUROS (port do backend, TDD). A `DashboardTime.tsx` vira dispatcher (mobile = atual; desktop = novo). O desktop é master-detail: lista (KPIs+faixa+semáforo) à esquerda, `TeamDrillPanel` à direita. Drill da pessoa reusa `/time/:id` (`PessoaDetalhe`, read-only — ações são Fase 5).

**Tech Stack:** React+TS, @tanstack/react-query, supabase-js, vitest, Tailwind (DS tokens). Spec: `docs/superpowers/specs/2026-06-08-dashboard-governanca-design.md`. Mockups aprovados: `.superpowers/brainstorm/.../content/{ceo-desktop-v1,ceo-drill-person-v1}.html`.

> **Repo:** sem git manual (Stop hook commita `_remote/`). Verificação = vitest + `tsc --noEmit` + `npm run build` + preview `localhost:4173`. **Guardrail Desktop** (CLAUDE.md): criar `XDesktop.tsx` + dispatcher, NUNCA sobrescrever o mobile. **Decisão do CEO travada:** líder→time é muitos-pra-muitos via regra de função (pedagógico→Juliana+Quintela; Leo→Krissya+coords; Fabi/Jéssica→CEO) — **sem migration de dados** (o `leader-routing.js` já faz isso).

---

## File Structure
- **Create** `web/src/lib/team-routing.ts` + `.test.ts` — port puro de `src/services/leader-routing.js` + inversa `membersOf`.
- **Create** `web/src/lib/scorecard-classify.ts` + `.test.ts` — port puro do bucketing 🔴/🟡/🟢.
- **Create** `web/src/lib/team-snapshot.ts` — extrai `fetchTeamSnapshot`/`TeamSnapshot` de `DashboardTime.tsx` (compartilhado mobile/desktop).
- **Create** `web/src/hooks/useLeaderScorecards.ts` — useQuery da última semana de `leader_scorecards`.
- **Edit** `web/src/screens/DashboardTime.tsx` — vira dispatcher.
- **Create** `web/src/screens/DashboardTimeMobile.tsx` — conteúdo atual movido 1:1.
- **Create** `web/src/screens/DashboardTimeDesktop.tsx` — shell CEO master-detail.
- **Create** `web/src/components/team/{CeoKpiStrip,NeedsYouToday,LeaderSemaphore,LeaderSemaphoreRow,TeamDrillPanel}.tsx`.

---

## Task 1: `lib/team-routing.ts` (port + inversa) — TDD

**Files:** Create `web/src/lib/team-routing.ts`, `web/src/lib/team-routing.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
// web/src/lib/team-routing.test.ts
import { describe, it, expect } from 'vitest';
import { resolveLeaderIdsOf, membersOf, type Collab } from './team-routing';

const C = (p: Partial<Collab> & { id: string }): Collab => ({
  id: p.id, role: p.role ?? 'collaborator', function_role: p.function_role ?? null,
  unit: p.unit ?? null, supervisor_id: p.supervisor_id ?? null, is_ceo: p.is_ceo ?? false, is_active: p.is_active ?? true,
});
const ceo = C({ id: 'ceo', role: 'director', is_ceo: true });
const juliana = C({ id: 'ju', role: 'coordinator', function_role: 'pedagogico' });
const quintela = C({ id: 'qt', role: 'coordinator', function_role: 'pedagogico' });
const krissya = C({ id: 'kr', role: 'manager', unit: 'barra' });
const yuri = C({ id: 'yu', role: 'manager', function_role: 'marketing', unit: 'all' });
const dai = C({ id: 'dai', function_role: 'pedagogico', supervisor_id: 'ju' });
const leo = C({ id: 'leo', function_role: 'pedagogico', unit: 'barra' });
const john = C({ id: 'john', function_role: 'marketing', unit: 'all' });
const fabi = C({ id: 'fabi', function_role: 'farmer', unit: 'all' });
const all = [ceo, juliana, quintela, krissya, yuri, dai, leo, john, fabi];

describe('resolveLeaderIdsOf', () => {
  it('pedagógico cai nos DOIS coordenadores', () => {
    expect(resolveLeaderIdsOf(dai, all).sort()).toEqual(['ju', 'qt']);
  });
  it('Leo (pedagógico + Barra) = Krissya + Juliana + Quintela', () => {
    expect(new Set(resolveLeaderIdsOf(leo, all))).toEqual(new Set(['kr', 'ju', 'qt']));
  });
  it('marketing → Yuri', () => {
    expect(resolveLeaderIdsOf(john, all)).toEqual(['yu']);
  });
  it('órfão (farmer unit=all, sem supervisor) → CEO', () => {
    expect(resolveLeaderIdsOf(fabi, all)).toEqual(['ceo']);
  });
  it('líder não é liderado de um par', () => {
    expect(resolveLeaderIdsOf(juliana, all)).toEqual(['ceo']); // coordinator → fallback CEO
  });
});

describe('membersOf (inversa)', () => {
  it('time da Quintela inclui todos os pedagógicos (Dai, Leo)', () => {
    const ids = membersOf(quintela, all).map(c => c.id).sort();
    expect(ids).toContain('dai'); expect(ids).toContain('leo');
  });
  it('time do CEO inclui os órfãos (Fabi)', () => {
    expect(membersOf(ceo, all).map(c => c.id)).toContain('fabi');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd _remote/web && npx vitest run src/lib/team-routing.test.ts` → FAIL (módulo ausente).

- [ ] **Step 3: Implementar** (port fiel de `src/services/leader-routing.js`, mesma ordem/regras)

```ts
// web/src/lib/team-routing.ts
// PORT de src/services/leader-routing.js (mesma regra do TOM — fonte única de "quem lidera quem").
// Muitos-pra-muitos: pedagógico → todos coords pedagógicos; unidade → gerente; supervisor aditivo; órfão → CEO.
export interface Collab {
  id: string; role: string; function_role: string | null; unit: string | null;
  supervisor_id: string | null; is_ceo: boolean; is_active?: boolean;
}
const UNITS = new Set(['barra', 'campo_grande', 'recreio']);
const LEADER_ROLES = new Set(['manager', 'coordinator', 'director']);

export function resolveLeadersOf(collab: Collab, allCollabs: Collab[]): Collab[] {
  if (!collab) return [];
  const list = Array.isArray(allCollabs) ? allCollabs : [];
  const byId = new Map(list.map(c => [c.id, c]));
  const active = list.filter(c => c && c.is_active !== false);
  const leaders = new Map<string, Collab>();
  const add = (c?: Collab) => {
    if (!c || c.id === collab.id || c.is_active === false) return;
    if (!leaders.has(c.id)) leaders.set(c.id, c);
  };
  const fr = collab.function_role || null;
  const unit = collab.unit || null;
  const isSelfLeader = LEADER_ROLES.has(collab.role);
  if (!isSelfLeader) {
    if (unit && UNITS.has(unit)) for (const c of active) if (c.role === 'manager' && c.unit === unit) add(c);
    if (fr === 'pedagogico') for (const c of active) if (c.role === 'coordinator' && c.function_role === 'pedagogico') add(c);
    if (fr === 'marketing') for (const c of active) if (c.role === 'manager' && c.function_role === 'marketing') add(c);
  }
  if (collab.supervisor_id && byId.has(collab.supervisor_id)) {
    const sup = byId.get(collab.supervisor_id);
    if (sup && !sup.is_ceo) add(sup);
  }
  if (leaders.size === 0) for (const c of active) if (c.is_ceo) add(c);
  return [...leaders.values()];
}
export function resolveLeaderIdsOf(collab: Collab, allCollabs: Collab[]): string[] {
  return resolveLeadersOf(collab, allCollabs).map(c => c.id);
}
/** Inversa: todos os colaboradores ativos cujo conjunto de líderes inclui `leader`. */
export function membersOf(leader: Collab, allCollabs: Collab[]): Collab[] {
  return (allCollabs ?? [])
    .filter(c => c && c.is_active !== false && c.id !== leader.id)
    .filter(c => resolveLeaderIdsOf(c, allCollabs).includes(leader.id));
}
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando → PASS.

---

## Task 2: `lib/scorecard-classify.ts` (bucketing) — TDD

**Files:** Create `web/src/lib/scorecard-classify.ts`, `web/src/lib/scorecard-classify.test.ts`

- [ ] **Step 1: Teste que falha**

```ts
// web/src/lib/scorecard-classify.test.ts
import { describe, it, expect } from 'vitest';
import { classifyScorecard, type ScoreLite } from './scorecard-classify';
const S = (p: Partial<ScoreLite>): ScoreLite => ({ closure_rate: 1, tasks_closed: 0, tasks_overdue: 0, tasks_stuck: 0, ...p });

describe('classifyScorecard (port scorecard-builder.js:202-209)', () => {
  it('🔴 atenção: closure < 0.60', () => expect(classifyScorecard(S({ closure_rate: 0.29, tasks_closed: 2, tasks_overdue: 5 }))).toBe('atencao'));
  it('🔴 atenção: 3+ atrasadas', () => expect(classifyScorecard(S({ closure_rate: 0.9, tasks_closed: 9, tasks_overdue: 3 }))).toBe('atencao'));
  it('🔴 atenção: 2+ travadas', () => expect(classifyScorecard(S({ closure_rate: 0.86, tasks_closed: 6, tasks_stuck: 2 }))).toBe('atencao'));
  it('🟡 olhar: closure < 0.85 sem gatilho vermelho', () => expect(classifyScorecard(S({ closure_rate: 0.80, tasks_closed: 4, tasks_overdue: 1 }))).toBe('atencao')); // overdue>=1 e <0.85... ver nota
  it('🟢 ritmo: sem tarefas', () => expect(classifyScorecard(S({}))).toBe('ritmo'));
  it('🟢 ritmo: 100% sem atraso', () => expect(classifyScorecard(S({ closure_rate: 1, tasks_closed: 8 }))).toBe('ritmo'));
});
```

> **Nota:** o caso `closure 0.80 + overdue 1` cai em 🔴 (overdue≥1 já é olhar, mas closure<0.85 com... na verdade vermelho exige overdue≥3). Revisar: `0.80<0.85 || overdue≥1` → 🟡 olhar, MAS só se NÃO bateu vermelho. 0.80 não é <0.60, overdue 1 não é ≥3, stuck 0 → NÃO vermelho → cai em 🟡. **Corrigir o teste pra `'olhar'`** no Step 1 antes de implementar (o exemplo acima está propositalmente errado p/ você validar a regra ao escrever).

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** (cópia exata da lógica de `renderForDirector`)

```ts
// web/src/lib/scorecard-classify.ts
// PORT de src/services/scorecard-builder.js:202-209 — mesma regra do digest do TOM.
export interface ScoreLite { closure_rate: number; tasks_closed: number; tasks_overdue: number; tasks_stuck: number; }
export type ScoreBucket = 'atencao' | 'olhar' | 'ritmo';

export function classifyScorecard(sc: ScoreLite): ScoreBucket {
  const hasNoTasks = sc.tasks_closed === 0 && sc.tasks_overdue === 0 && sc.tasks_stuck === 0;
  if (!hasNoTasks && (sc.closure_rate < 0.60 || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) return 'atencao';
  if (!hasNoTasks && (sc.closure_rate < 0.85 || sc.tasks_overdue >= 1)) return 'olhar';
  return 'ritmo';
}
export const BUCKET_META: Record<ScoreBucket, { dot: string; label: string }> = {
  atencao: { dot: '#ef5b5b', label: 'Atenção' },
  olhar: { dot: '#f5a623', label: 'Olhar de perto' },
  ritmo: { dot: '#3ECF8E', label: 'No ritmo' },
};
```

- [ ] **Step 4: Ajustar o teste do caso-limite pra `'olhar'` e rodar → PASS.**

---

## Task 3: Extrair `lib/team-snapshot.ts` (compartilhar mobile/desktop)

**Files:** Create `web/src/lib/team-snapshot.ts`; Edit `web/src/screens/DashboardTime.tsx` (remover a função, importar).

- [ ] **Step 1:** Mover `interface TeamSnapshot` + `async function fetchTeamSnapshot(myId)` (já honesto pós-Fase 1, incluindo os imports de `governance-metrics`) de `DashboardTime.tsx` para `web/src/lib/team-snapshot.ts`, exportando ambos. Mover também o helper de resolver `myId` (auth → collaborator) como `export async function fetchMyTeamSnapshot()`.
- [ ] **Step 2:** Em `DashboardTime.tsx`, remover as definições e `import { fetchMyTeamSnapshot, type TeamSnapshot } from '../lib/team-snapshot'`.
- [ ] **Step 3:** `npx tsc --noEmit` → 0 erros. `npx vitest run` (governance-metrics ainda passa).

---

## Task 4: `hooks/useLeaderScorecards.ts`

**Files:** Create `web/src/hooks/useLeaderScorecards.ts`

- [ ] **Step 1: Implementar** (última semana disponível + join nomes; RLS libera director)

```ts
// web/src/hooks/useLeaderScorecards.ts
import { useQuery } from '@tanstack/react-query';
import { supabase, supabaseConfigured } from '../lib/supabase';

export interface LeaderScorecard {
  leader_id: string; week_start: string; closure_rate: number;
  tasks_closed: number; tasks_overdue: number; tasks_stuck: number;
  top_bottlenecks: { category: string; count: number }[] | null;
  insights: string | null; delta_vs_prev: Record<string, unknown> | null;
  leader: { id: string; full_name: string; preferred_name: string | null; role: string; function_role: string | null } | null;
}

export function useLeaderScorecards() {
  return useQuery({
    queryKey: ['leader-scorecards'],
    enabled: supabaseConfigured,
    queryFn: async (): Promise<{ weekStart: string | null; rows: LeaderScorecard[] }> => {
      const { data: latest } = await supabase
        .from('leader_scorecards').select('week_start')
        .order('week_start', { ascending: false }).limit(1).maybeSingle();
      if (!latest?.week_start) return { weekStart: null, rows: [] };
      const { data, error } = await supabase
        .from('leader_scorecards')
        .select('leader_id, week_start, closure_rate, tasks_closed, tasks_overdue, tasks_stuck, top_bottlenecks, insights, delta_vs_prev, leader:collaborators!leader_id(id, full_name, preferred_name, role, function_role)')
        .eq('week_start', latest.week_start);
      if (error) throw error;
      return { weekStart: latest.week_start, rows: (data ?? []) as unknown as LeaderScorecard[] };
    },
  });
}
```

- [ ] **Step 2:** `npx tsc --noEmit` → 0 erros.

---

## Task 5: Dispatcher refactor (Guardrail Desktop)

**Files:** Edit `DashboardTime.tsx`; Create `DashboardTimeMobile.tsx`.

- [ ] **Step 1:** Criar `web/src/screens/DashboardTimeMobile.tsx` = TODO o conteúdo de render atual de `DashboardTime.tsx` (o `export function DashboardTime` vira `export function DashboardTimeMobile`), consumindo `fetchMyTeamSnapshot` do `lib`.
- [ ] **Step 2:** `DashboardTime.tsx` vira dispatcher puro:

```tsx
import { useBreakpoint } from '../hooks/useBreakpoint';
import { DashboardTimeMobile } from './DashboardTimeMobile';
import { DashboardTimeDesktop } from './DashboardTimeDesktop';
export function DashboardTime() {
  const bp = useBreakpoint();
  return bp === 'mobile' ? <DashboardTimeMobile /> : <DashboardTimeDesktop />;
}
```

- [ ] **Step 3:** `npx tsc --noEmit` (vai falhar até o Desktop existir — ok, Task 6 cria). Build só no fim.

---

## Task 6: `DashboardTimeDesktop.tsx` + `components/team/*` (UI)

> **Fonte visual = mockups aprovados** `ceo-desktop-v1.html` (semáforo+master-detail) e `ceo-drill-person-v1.html` (drill). **Usar tokens DS** (`text-tom`, `bg-bg-surface`, `border-border`, `text-fg`) e componentes existentes (`StatCard`, `Badge`, `PageHeader`, `LoadingState`, `EmptyState`). **NÃO** usar HTML nativo de select (usar `CustomSelect`). Layout master-detail: `grid grid-cols-[1fr_minmax(360px,42%)] gap-md` dentro do `DesktopShell` (que já cuida de altura/scroll/padding — não adicionar `fixed`/`overflow`/`px-*`).

**Files:** Create `DashboardTimeDesktop.tsx` + `components/team/{CeoKpiStrip,NeedsYouToday,LeaderSemaphore,LeaderSemaphoreRow,TeamDrillPanel}.tsx`.

- [ ] **Step 1: `DashboardTimeDesktop.tsx`** — orquestrador. `useQuery(['team-snapshot'], fetchMyTeamSnapshot)` + `useLeaderScorecards()`. Estado `const [selLeader, setSelLeader] = useState<string|null>(null)`. Layout: `<PageHeader title="Time" subtitle="Visão de coordenação · só dados de trabalho"/>` → `<CeoKpiStrip snapshot=.../>` → grid 2 col: esquerda `<NeedsYouToday>` + `<LeaderSemaphore scorecards=... onSelect=setSelLeader selected=selLeader/>`; direita `<TeamDrillPanel leaderId={selLeader} allCollabs={snapshot.allCollabs} snapshot=.../>` (ou resumo se `selLeader===null`). Loading/empty/erro reusam `LoadingState`/`EmptyState`. Selo de semana: `scorecards.weekStart` → "semana de DD/MM" se não for a semana corrente.
- [ ] **Step 2: `CeoKpiStrip.tsx`** — props `{ snapshot: TeamSnapshot }`. Renderiza os 5 KPIs honestos (No time, Concluídas, Pra hoje, Atrasadas=`overdueCount`, Compromissos) como cards clicáveis (reusa `StatCard`; envolver em `<button>`/`Button ghost`). `onClick` opcional p/ filtrar (v1: sem filtro, só visual clicável — deixar `onSelect?` preparado).
- [ ] **Step 3: `NeedsYouToday.tsx`** — props `{ snapshot, scorecards }`. Deriva 2-4 itens de maior urgência: pessoas em `overdueByPerson` com count alto, `noResponse` longo, e líderes `classifyScorecard==='atencao'` com `tasks_stuck>=2`. Cada item: nome + motivo curto + `Link to={/time/:id}`. Visual = faixa vermelha do mockup.
- [ ] **Step 4: `LeaderSemaphore.tsx` + `LeaderSemaphoreRow.tsx`** — props `{ scorecards: LeaderScorecard[], selected, onSelect }`. Ordena por bucket (`classifyScorecard`): 🔴 atenção (pior closure 1º) → 🟡 olhar → 🟢 ritmo (colapsado "+N no verde"). Cada `LeaderSemaphoreRow`: dot da cor (`BUCKET_META`), nome (`preferred_name||full_name`), `Math.round(closure_rate*100)+'%'`, `tasks_overdue` atr, delta arrow (`delta_vs_prev.closure_rate_delta`), insight curto. Clicável → `onSelect(leader_id)`; destaque se `selected`.
- [ ] **Step 5: `TeamDrillPanel.tsx`** — props `{ leaderId, allCollabs, snapshot }`. Se `leaderId`: acha o líder em `allCollabs`, roda `membersOf(leader, allCollabs)`, lista cada liderado (nome + `overdueByPerson` count + events do dia via snapshot) com `Link to={/time/:id}`. Mostra também o scorecard do próprio líder no topo. Se `leaderId===null`: resumo ("selecione um líder à esquerda"). Visual = painel direito do mockup `ceo-desktop-v1`.
- [ ] **Step 6:** `npx tsc --noEmit` → 0 erros.

---

## Task 7: Build + validação visual

- [ ] **Step 1:** `cd _remote/web && npm run build` → exit 0.
- [ ] **Step 2:** Re-rodar todos os unit: `npx vitest run` → team-routing + scorecard-classify + governance-metrics PASS.
- [ ] **Step 3:** Preview `localhost:4173` em 1440px logado como CEO (director): conferir contra o mockup `ceo-desktop-v1` — semáforo lê os líderes reais, clicar um líder abre o time dele (membersOf), drill da pessoa leva a `/time/:id`. Testar 375px (mobile) ainda mostra a versão mobile intacta (Guardrail). Limpar SW cache antes.

---

## Self-Review (preenchido)
- **Cobertura do spec §3 (CEO desktop):** dispatcher+desktop (Task 5/6), KPIs honestos clicáveis (Task 6.2 sobre Fase 1), semáforo (Task 4+6.4 sobre leader_scorecards), drill líder→time→pessoa (Task 1 membersOf + Task 6.5 + PessoaDetalhe). ✅
- **Muitos-pra-muitos:** Task 1 testa pedagógico→2 coords, Leo→3, órfão→CEO (regra do CEO). Sem migration. ✅
- **Placeholders:** módulos puros têm código completo; componentes têm spec de props/dados/layout + mockup como fonte visual (JSX completo sai no build via subagente).
- **Tipos:** `Collab`, `ScoreLite`, `LeaderScorecard`, `TeamSnapshot` consistentes entre módulos/hook/componentes.
- **Guardrail Desktop:** mobile preservado (DashboardTimeMobile = cópia 1:1), só desktop é novo. ✅
- **Fora de escopo (Fase 5+):** ações na drill da pessoa (PessoaDetalhe segue read-only); anti-duplicação de cobrança; RLS de líder (Fase 7).
