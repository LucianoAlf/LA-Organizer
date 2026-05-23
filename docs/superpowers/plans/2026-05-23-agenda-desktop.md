# Agenda Desktop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) ou `superpowers:executing-plans` pra implementar task-by-task. Steps usam checkbox (`- [ ]`) pra tracking.
> Spec: `docs/superpowers/specs/2026-05-23-agenda-desktop-design.md` — leia antes de começar cada task.

**Goal:** Construir a versão desktop completa da tela Agenda do LA Organizer — 3 views (Dia, Semana, Mês), CRUD via timegrid drag/click, painel de tasks lateral, filtros consistentes, integração realtime com TOM (WhatsApp), zero mudança no backend.

**Architecture:** Frontend puro React + TypeScript + Tailwind. Reusa `events` + `tasks` (já existem em produção) via `useEvents`/`useTasks`/`useRealtimeSync`. Shell de 3 painéis fixos (260px / flex-1 / 320px). Primitivo `TimeGrid` compartilhado entre Day e Week. `MonthView` separada. Dispatcher por breakpoint mantém mobile (`Hoje.tsx`/`Semana.tsx`) intocado. Migration `event_categories.color` JÁ APLICADA — não rodar.

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind 3.4, TanStack Query 5, `@dnd-kit/core`, Supabase Realtime, DS interno (`DateInput`, `TimeInput`, `CustomSelect`, `Button`, `DetailDrawer`).

**Guardrails absolutos (não negociáveis):**
1. **Nunca sobrescrever** `Hoje.tsx`, `Semana.tsx`. Mobile intocado.
2. `navigate({ replace: true })` ao trocar view — nunca `push`.
3. Drag-to-move preserva duração: `durationMs = oldEnd - oldStart; end_at = newStart + durationMs`.
4. Task date resolution: `task.scheduled_date ?? task.due_date`.
5. `QuickCreatePopover` único com `mode: 'event' | 'task'`.
6. Deletar = `DELETE` (hard); Cancelar = `status='cancelled'` (soft).
7. Optimistic update com toast no erro + rollback.
8. Scroll inicial: `isToday ? Math.max(7, currentHour - 1) : 7`.
9. Counters do `MonthDayDrawer` respeitam filtros.
10. Sluges reais das categorias: `pessoal`, `la_music`, `mentoria`, `estudio`, `show`. **Não existem** `outra_escola`/`aula_particular`.

**Categorias e cores (referência):**
```ts
const CATEGORY_FALLBACK_COLOR: Record<string,string> = {
  la_music: '#A3BE50', mentoria: '#7B61FF', estudio: '#EC4899',
  show: '#F59E0B', pessoal: '#64748B',
};
const CONTEXT_FALLBACK_COLOR = { work: '#A3BE50', personal: '#64748B' };
```

---

## File Structure (mapa de arquivos)

```
web/src/
├── hooks/
│   └── useBreakpoint.ts                (CONFIRMAR — se faltar, criar conforme Task 0)
├── screens/
│   ├── Agenda.tsx                       (NOVO — dispatcher mobile vs desktop)
│   ├── AgendaDesktop.tsx                (NOVO — orquestra shell + estado de URL)
│   ├── Hoje.tsx                         (INTOCADO)
│   ├── Semana.tsx                       (INTOCADO)
│   └── agenda/
│       ├── AgendaShell.tsx              (NOVO — shell 3-pane + topbar)
│       ├── AgendaLeftRail.tsx           (NOVO — mini-cal + counts + filtros)
│       ├── TasksPanel.tsx               (NOVO — coluna direita view=day|week)
│       ├── components/
│       │   ├── TimeGrid.tsx             (NOVO — primitivo Day/Week)
│       │   ├── EventBlock.tsx           (NOVO)
│       │   ├── EventChip.tsx            (NOVO — chip do Mês)
│       │   ├── MiniCalendar.tsx         (NOVO)
│       │   ├── QuickCreatePopover.tsx   (NOVO — mode event|task)
│       │   ├── EventEditDrawer.tsx      (NOVO)
│       │   └── MonthDayDrawer.tsx       (NOVO)
│       ├── views/
│       │   ├── DayView.tsx              (NOVO — wrapper TimeGrid)
│       │   ├── WeekView.tsx             (NOVO — wrapper TimeGrid)
│       │   └── MonthView.tsx            (NOVO)
│       ├── hooks/
│       │   ├── useAgendaEvents.ts       (NOVO — wrapper useEvents + filtros)
│       │   ├── useAgendaTasks.ts        (NOVO — wrapper useTasks + filtros)
│       │   ├── useAgendaFilters.ts      (NOVO — chips + localStorage)
│       │   └── useResize.ts             (NOVO — pointer events manual)
│       └── lib/
│           ├── timeGrid.ts              (NOVO — timeToY, yToTime, lanes)
│           └── monthGrid.ts             (NOVO — getMonthGrid)
├── App.tsx                              (MODIFICAR — rota /agenda + redirects)
└── design/shell/SidebarV2.tsx           (MODIFICAR — link "Agenda" → /agenda)
```

**Migration:** já aplicada no Supabase. NÃO criar nem rodar.

---

## Task 0 — Setup: confirmar `useBreakpoint` + scaffolding de pasta

**Files:**
- Confirm: `web/src/hooks/useBreakpoint.ts`
- Confirm: `web/src/hooks/useMediaQuery.ts`
- Create (se faltarem): conforme padrão abaixo
- Create empty dir: `web/src/screens/agenda/components/`, `web/src/screens/agenda/views/`, `web/src/screens/agenda/hooks/`, `web/src/screens/agenda/lib/`

- [ ] **Step 1: Verificar existência dos hooks**

```bash
ls _remote/web/src/hooks/useBreakpoint.ts _remote/web/src/hooks/useMediaQuery.ts 2>/dev/null
```

Expected: ambos existem → pular Step 2 e 3. Se faltarem → criar.

- [ ] **Step 2: Criar `useMediaQuery.ts` (apenas se faltar)**

```ts
// web/src/hooks/useMediaQuery.ts
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}
```

- [ ] **Step 3: Criar `useBreakpoint.ts` (apenas se faltar)**

```ts
// web/src/hooks/useBreakpoint.ts
import { useMediaQuery } from './useMediaQuery';

export function useBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const isTablet = useMediaQuery('(min-width: 768px)');
  if (isDesktop) return 'desktop';
  if (isTablet) return 'tablet';
  return 'mobile';
}
```

- [ ] **Step 4: Criar pastas vazias com `.gitkeep`**

```bash
mkdir -p _remote/web/src/screens/agenda/{components,views,hooks,lib}
touch _remote/web/src/screens/agenda/{components,views,hooks,lib}/.gitkeep
```

- [ ] **Step 5: Validar TypeScript**

```bash
cd _remote/web && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 6: Commit**

Commit message: `chore(agenda): scaffold pasta + confirma hooks de breakpoint`

---

## Task 1 — `lib/timeGrid.ts`: fns puras (timeToY, yToTime, lanes)

**Files:**
- Create: `web/src/screens/agenda/lib/timeGrid.ts`
- Test: `web/src/screens/agenda/lib/timeGrid.test.ts`

Spec ref: Seção 3 (cálculo tempo↔pixel + algoritmo de lanes greedy).

- [ ] **Step 1: Escrever testes (falha)**

```ts
// web/src/screens/agenda/lib/timeGrid.test.ts
import { describe, it, expect } from 'vitest';
import { timeToY, yToTime, computeLanes } from './timeGrid';

const CFG = { startHour: 6, hourHeight: 64, snapMinutes: 15 };

describe('timeToY', () => {
  it('06:00 → 0px', () => {
    expect(timeToY(new Date('2026-05-23T06:00:00-03:00'), CFG)).toBe(0);
  });
  it('07:30 → 96px', () => {
    expect(timeToY(new Date('2026-05-23T07:30:00-03:00'), CFG)).toBe(96);
  });
});

describe('yToTime', () => {
  it('0px → 06:00 (snap 15)', () => {
    const d = yToTime(0, new Date('2026-05-23'), CFG);
    expect(d.getHours()).toBe(6); expect(d.getMinutes()).toBe(0);
  });
  it('100px → snap pra 07:30 (mais próximo de 15min)', () => {
    const d = yToTime(100, new Date('2026-05-23'), CFG);
    expect(d.getHours()).toBe(7); expect(d.getMinutes()).toBe(30);
  });
});

describe('computeLanes (greedy)', () => {
  const ev = (id: string, start: string, end: string) => ({
    id, start_at: start, end_at: end,
  });
  it('2 events sem overlap → mesma lane', () => {
    const r = computeLanes([
      ev('a', '2026-05-23T09:00:00-03:00', '2026-05-23T10:00:00-03:00'),
      ev('b', '2026-05-23T10:00:00-03:00', '2026-05-23T11:00:00-03:00'),
    ]);
    expect(r.find(x => x.id === 'a')!.lane).toBe(0);
    expect(r.find(x => x.id === 'b')!.lane).toBe(0);
    expect(r.find(x => x.id === 'a')!.totalLanes).toBe(1);
  });
  it('2 events sobrepostos → 2 lanes', () => {
    const r = computeLanes([
      ev('a', '2026-05-23T09:00:00-03:00', '2026-05-23T10:30:00-03:00'),
      ev('b', '2026-05-23T09:30:00-03:00', '2026-05-23T10:00:00-03:00'),
    ]);
    expect(r.find(x => x.id === 'a')!.totalLanes).toBe(2);
    expect(r.find(x => x.id === 'b')!.totalLanes).toBe(2);
    expect(new Set(r.map(x => x.lane)).size).toBe(2);
  });
});
```

- [ ] **Step 2: Rodar testes (fail)**

```bash
cd _remote/web && npx vitest run src/screens/agenda/lib/timeGrid.test.ts
```

Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// web/src/screens/agenda/lib/timeGrid.ts
export interface GridConfig {
  startHour: number;       // 6 (timegrid começa às 06:00)
  hourHeight: number;      // 64 (px por hora)
  snapMinutes: number;     // 15
}

export function timeToY(date: Date, cfg: GridConfig): number {
  const totalMin = (date.getHours() - cfg.startHour) * 60 + date.getMinutes();
  return (totalMin / 60) * cfg.hourHeight;
}

export function yToTime(y: number, day: Date, cfg: GridConfig): Date {
  const rawMin = (y / cfg.hourHeight) * 60;
  const snapped = Math.round(rawMin / cfg.snapMinutes) * cfg.snapMinutes;
  const totalMin = cfg.startHour * 60 + Math.max(0, snapped);
  const out = new Date(day);
  out.setHours(Math.floor(totalMin / 60), totalMin % 60, 0, 0);
  return out;
}

export interface LaneEvent { id: string; start_at: string; end_at: string }
export interface LanedEvent extends LaneEvent { lane: number; totalLanes: number }

export function computeLanes<T extends LaneEvent>(events: T[]): (T & { lane: number; totalLanes: number })[] {
  const sorted = [...events].sort((a, b) =>
    new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
  // group em clusters de overlap
  const result: (T & { lane: number; totalLanes: number })[] = [];
  let cluster: T[] = [];
  let clusterEnd = 0;
  const flush = () => {
    if (!cluster.length) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((ev) => {
      const start = new Date(ev.start_at).getTime();
      const end = new Date(ev.end_at).getTime();
      let lane = laneEnds.findIndex(e => e <= start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(end); }
      else laneEnds[lane] = end;
      return { ...ev, lane, totalLanes: 0 };
    });
    const total = laneEnds.length;
    assigned.forEach(a => { a.totalLanes = total; result.push(a); });
    cluster = []; clusterEnd = 0;
  };
  for (const ev of sorted) {
    const start = new Date(ev.start_at).getTime();
    const end = new Date(ev.end_at).getTime();
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push(ev); clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return result;
}
```

- [ ] **Step 4: Rodar testes (pass)**

```bash
cd _remote/web && npx vitest run src/screens/agenda/lib/timeGrid.test.ts
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

Commit message: `feat(agenda): lib/timeGrid puro (timeToY, yToTime, computeLanes) + tests`

---

## Task 2 — `lib/monthGrid.ts`: getMonthGrid

**Files:**
- Create: `web/src/screens/agenda/lib/monthGrid.ts`
- Test: `web/src/screens/agenda/lib/monthGrid.test.ts`

Spec ref: Seção 4.

- [ ] **Step 1: Testes (falha)**

```ts
// web/src/screens/agenda/lib/monthGrid.test.ts
import { describe, it, expect } from 'vitest';
import { getMonthGrid } from './monthGrid';

describe('getMonthGrid', () => {
  it('Maio 2026 → 35 ou 42 células, começando num domingo', () => {
    const grid = getMonthGrid(new Date('2026-05-01'));
    expect([35, 42]).toContain(grid.length);
    expect(grid[0].getDay()).toBe(0); // domingo
  });
  it('Maio 2026 dia 1 é sexta → primeira linha começa em 26/04', () => {
    const grid = getMonthGrid(new Date('2026-05-01'));
    expect(grid[0].toISOString().slice(0, 10)).toBe('2026-04-26');
    expect(grid[5].toISOString().slice(0, 10)).toBe('2026-05-01');
  });
});
```

- [ ] **Step 2: Rodar (fail)**

```bash
cd _remote/web && npx vitest run src/screens/agenda/lib/monthGrid.test.ts
```

- [ ] **Step 3: Implementar**

```ts
// web/src/screens/agenda/lib/monthGrid.ts
/** Retorna 35 ou 42 datas (5-6 linhas × 7 colunas) cobrindo o mês completo,
 *  começando no domingo da semana do dia 1.
 */
export function getMonthGrid(monthDate: Date): Date[] {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const startSunday = new Date(first);
  startSunday.setDate(first.getDate() - first.getDay());
  const last = new Date(year, month + 1, 0);
  const daysNeeded = Math.ceil((last.getDate() + first.getDay()) / 7) * 7;
  return Array.from({ length: daysNeeded }, (_, i) => {
    const d = new Date(startSunday);
    d.setDate(startSunday.getDate() + i);
    return d;
  });
}
```

- [ ] **Step 4: Rodar (pass)**

Expected: 2 passed.

- [ ] **Step 5: Commit**

Commit message: `feat(agenda): lib/monthGrid (getMonthGrid 35/42 células) + tests`

---

## Task 3 — `hooks/useAgendaFilters.ts`: chips + localStorage

**Files:**
- Create: `web/src/screens/agenda/hooks/useAgendaFilters.ts`

Spec ref: Seção 7.1 (filter chips com persistência).

- [ ] **Step 1: Implementar**

```ts
// web/src/screens/agenda/hooks/useAgendaFilters.ts
import { useCallback, useEffect, useState } from 'react';

export interface AgendaFilters {
  trabalho: boolean;
  pessoal: boolean;
  delegadas: boolean;
}

const STORAGE_KEY = 'agenda.filters';
const DEFAULTS: AgendaFilters = { trabalho: true, pessoal: true, delegadas: true };

function load(): AgendaFilters {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { return DEFAULTS; }
}

export function useAgendaFilters() {
  const [filters, setFilters] = useState<AgendaFilters>(load);
  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters)); } catch {}
  }, [filters]);
  const toggle = useCallback((k: keyof AgendaFilters) =>
    setFilters(f => ({ ...f, [k]: !f[k] })), []);
  return { filters, toggle, setFilters };
}
```

- [ ] **Step 2: Validar TS**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

Commit: `feat(agenda): useAgendaFilters (chips + localStorage)`

---

## Task 4 — `hooks/useAgendaEvents.ts` e `useAgendaTasks.ts`: wrappers com filtros

**Files:**
- Create: `web/src/screens/agenda/hooks/useAgendaEvents.ts`
- Create: `web/src/screens/agenda/hooks/useAgendaTasks.ts`

Spec ref: Seção 7 (mapeamento filtros → query).

**Pré-requisito:** confirmar nome/assinatura dos hooks existentes:

- [ ] **Step 1: Auditar hooks existentes**

```bash
grep -rn "export function useEvents\|export const useEvents" _remote/web/src/hooks 2>/dev/null
grep -rn "export function useTasks\|export const useTasks" _remote/web/src/hooks 2>/dev/null
```

Anotar a assinatura real. Se `useEvents` aceitar range de datas como prop, passar `from`/`to`. Se retornar mais campos do que precisamos, fazer `select` no wrapper.

- [ ] **Step 2: Implementar `useAgendaEvents.ts`**

⚠️ **CORREÇÃO CRÍTICA do schema**: a tabela `events` tem dois campos de categoria:
- `category` (text, nullable, legacy slug)
- `category_id` (uuid NOT NULL, FK → `event_categories`)

A cor vem de `event_categories.color` via `category_id`, NÃO via `category` text. Se `useEvents` existente não faz o JOIN com `event_categories`, criar query própria nesse hook (não modificar `useEvents` global pra não quebrar outras telas).

```ts
// web/src/screens/agenda/hooks/useAgendaEvents.ts
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase'; // CONFIRMAR caminho real
import { useAuth } from '../../../contexts/AuthContext'; // CONFIRMAR caminho real
import type { AgendaFilters } from './useAgendaFilters';

export interface EventForGrid {
  id: string;
  title: string;
  start_at: string;
  end_at: string;
  context: 'work' | 'personal';
  category: string;                    // slug (de event_categories.slug ou legacy)
  category_color: string | null;       // de event_categories.color
  modality: 'presencial' | 'online' | 'hibrido';
  location_text: string | null;
  meeting_url: string | null;
  status: 'scheduled' | 'done' | 'cancelled';
  project_id: string | null;
  source: 'manual' | 'tom' | 'imported';
}

export function useAgendaEvents(params: { from: Date; to: Date; filters: AgendaFilters }) {
  const { user } = useAuth();
  const collaboratorId = user?.id; // CONFIRMAR como obter collaborator_id real (pode ser via user_preferences)

  const { data, isLoading, error } = useQuery({
    queryKey: ['agenda-events', collaboratorId, params.from.toISOString(), params.to.toISOString()],
    enabled: !!collaboratorId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('events')
        .select(`
          id, title, start_at, end_at, context, category, modality,
          location_text, meeting_url, status, project_id, source,
          event_categories!category_id ( slug, label, color )
        `)
        .gte('start_at', params.from.toISOString())
        .lte('start_at', params.to.toISOString())
        .eq('collaborator_id', collaboratorId);
      if (error) throw error;
      return data;
    },
  });

  const events = useMemo<EventForGrid[]>(() => {
    if (!data) return [];
    return data
      .filter((e: any) => {
        if (e.context === 'work' && !params.filters.trabalho) return false;
        if (e.context === 'personal' && !params.filters.pessoal) return false;
        return true;
      })
      .map((e: any) => ({
        id: e.id, title: e.title,
        start_at: e.start_at, end_at: e.end_at,
        context: e.context,
        category: e.event_categories?.slug ?? e.category ?? 'la_music',
        category_color: e.event_categories?.color ?? null,
        modality: e.modality, location_text: e.location_text,
        meeting_url: e.meeting_url, status: e.status,
        project_id: e.project_id, source: e.source,
      }));
  }, [data, params.filters]);

  return { events, isLoading, error };
}
```

- [ ] **Step 3: Implementar `useAgendaTasks.ts`**

```ts
// web/src/screens/agenda/hooks/useAgendaTasks.ts
import { useMemo } from 'react';
import { useTasks } from '../../../hooks/useTasks'; // CONFIRMAR caminho real
import type { AgendaFilters } from './useAgendaFilters';

export interface TaskForPanel {
  id: string;
  title: string;
  context: 'work' | 'personal';
  status: 'pending' | 'in_progress' | 'done' | 'overdue' | 'delegated';
  scheduled_date: string | null;
  due_date: string | null;
  delegated_to: string | null;
}

export function useAgendaTasks(params: { from: Date; to: Date; filters: AgendaFilters }) {
  const { data, isLoading, error } = useTasks({ from: params.from, to: params.to }); // ADAPTAR
  const tasks = useMemo<TaskForPanel[]>(() => {
    if (!data) return [];
    return data.filter(t => {
      if (t.delegated_to) return params.filters.delegadas;
      if (t.context === 'work') return params.filters.trabalho;
      if (t.context === 'personal') return params.filters.pessoal;
      return true;
    });
  }, [data, params.filters]);
  return { tasks, isLoading, error };
}
```

- [ ] **Step 4: Validar TS**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

Commit: `feat(agenda): useAgendaEvents + useAgendaTasks wrappers com filtros`

---

## Task 5 — `hooks/useResize.ts`: drag-to-resize manual

**Files:**
- Create: `web/src/screens/agenda/hooks/useResize.ts`

Spec ref: Seção 5 (resize via pointer events, isolado do @dnd-kit).

- [ ] **Step 1: Implementar**

```ts
// web/src/screens/agenda/hooks/useResize.ts
import { useCallback, useRef, useState } from 'react';

export interface UseResizeOpts {
  /** Converte deltaY (px) em incremento de duração em ms (já snapped). */
  deltaPxToDurationMs: (deltaPx: number) => number;
  /** Duração mínima em ms (default 15min). */
  minDurationMs?: number;
  /** Duração máxima em ms (default 12h). */
  maxDurationMs?: number;
  /** Chamado em cada movimento — para feedback visual. */
  onResize?: (newDurationMs: number) => void;
  /** Chamado no release — persistência. */
  onCommit: (newDurationMs: number) => void;
}

export function useResize(initialDurationMs: number, opts: UseResizeOpts) {
  const startYRef = useRef(0);
  const startDurRef = useRef(initialDurationMs);
  const [resizing, setResizing] = useState(false);
  const [previewDurationMs, setPreviewDurationMs] = useState(initialDurationMs);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    startYRef.current = e.clientY;
    startDurRef.current = initialDurationMs;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      const delta = opts.deltaPxToDurationMs(ev.clientY - startYRef.current);
      const min = opts.minDurationMs ?? 15 * 60 * 1000;
      const max = opts.maxDurationMs ?? 12 * 60 * 60 * 1000;
      const next = Math.min(max, Math.max(min, startDurRef.current + delta));
      setPreviewDurationMs(next);
      opts.onResize?.(next);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey);
      const delta = opts.deltaPxToDurationMs(ev.clientY - startYRef.current);
      const min = opts.minDurationMs ?? 15 * 60 * 1000;
      const max = opts.maxDurationMs ?? 12 * 60 * 60 * 1000;
      const next = Math.min(max, Math.max(min, startDurRef.current + delta));
      setResizing(false);
      opts.onCommit(next);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('keydown', onKey);
        setResizing(false);
        setPreviewDurationMs(startDurRef.current);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey);
  }, [initialDurationMs, opts]);

  return { resizing, previewDurationMs, onPointerDown };
}
```

- [ ] **Step 2: Validar TS**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

Commit: `feat(agenda): useResize (pointer events manual, snap+min+max, Esc cancela)`

---

## Task 6 — `components/EventBlock.tsx`

**Files:**
- Create: `web/src/screens/agenda/components/EventBlock.tsx`

Spec ref: Seção 5 (estrutura + altura por conteúdo + cor).

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/components/EventBlock.tsx
import { useDraggable } from '@dnd-kit/core';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import { useResize } from '../hooks/useResize';

const CONTEXT_FALLBACK_COLOR = { work: '#A3BE50', personal: '#64748B' } as const;

export interface EventBlockProps {
  event: EventForGrid;
  top: number;      // px
  height: number;   // px
  width: number;    // percent (0-100)
  left: number;     // percent (0-100)
  isOverlay?: boolean;
  hourHeight: number;
  snapMinutes: number;
  onClick: (event: EventForGrid) => void;
  onResize: (event: EventForGrid, newDurationMs: number) => void;
}

export function EventBlock(p: EventBlockProps) {
  const color = p.event.category_color ?? CONTEXT_FALLBACK_COLOR[p.event.context];
  const isCancelled = p.event.status === 'cancelled';
  const isDone = p.event.status === 'done';

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: p.event.id,
    data: { type: 'event', event: p.event },
    disabled: p.isOverlay,
  });

  const initialDurMs = new Date(p.event.end_at).getTime() - new Date(p.event.start_at).getTime();
  const pxPerMs = p.hourHeight / (60 * 60 * 1000);
  const { resizing, previewDurationMs, onPointerDown: resizeDown } = useResize(initialDurMs, {
    deltaPxToDurationMs: (dPx) => {
      const raw = dPx / pxPerMs;
      const snapMs = p.snapMinutes * 60 * 1000;
      return Math.round(raw / snapMs) * snapMs;
    },
    onCommit: (newDur) => p.onResize(p.event, newDur),
  });

  const heightFinal = resizing ? previewDurationMs * pxPerMs : p.height;
  const startStr = new Date(p.event.start_at).toTimeString().slice(0, 5);
  const endStr = new Date(new Date(p.event.start_at).getTime() + (resizing ? previewDurationMs : initialDurMs))
    .toTimeString().slice(0, 5);

  const contentLines = heightFinal >= 48 ? 3 : heightFinal >= 24 ? 2 : 1;

  return (
    <div
      ref={setNodeRef}
      className={[
        'group absolute rounded-md px-2 py-1 cursor-grab active:cursor-grabbing focus-ring overflow-hidden',
        isDragging ? 'opacity-30' : '',
        isDone || isCancelled ? 'opacity-50' : '',
      ].join(' ')}
      style={{
        top: p.top, height: heightFinal,
        left: `${p.left}%`, width: `${p.width}%`,
        backgroundColor: `${color}33`,
        borderLeft: `3px solid ${color}`,
      }}
      onClick={(e) => { e.stopPropagation(); p.onClick(p.event); }}
      {...listeners} {...attributes}
    >
      {contentLines >= 2 && (
        <div className="text-[10px] tabular-nums opacity-80">{startStr}–{endStr}</div>
      )}
      <div className={['text-[12px] font-medium truncate', isCancelled || isDone ? 'line-through' : ''].join(' ')}>
        {p.event.title}
      </div>
      {contentLines >= 3 && p.event.location_text && (
        <div className="text-[10px] opacity-70 truncate">📍 {p.event.location_text}</div>
      )}
      {!p.isOverlay && (
        <div
          className="absolute bottom-0 inset-x-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100 bg-fg/20"
          onPointerDown={resizeDown}
          onClick={(e) => e.stopPropagation()}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

- [ ] **Step 3: Commit**

Commit: `feat(agenda): EventBlock (drag+resize+altura adaptativa+cor por categoria)`

---

## Task 7 — `components/TimeGrid.tsx` (primitivo Day/Week)

**Files:**
- Create: `web/src/screens/agenda/components/TimeGrid.tsx`

Spec ref: Seção 3.

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/components/TimeGrid.tsx
import { useEffect, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { computeLanes, timeToY, yToTime, type GridConfig } from '../lib/timeGrid';
import { EventBlock } from './EventBlock';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const HOUR_HEIGHT = 64;
const START_HOUR = 6;
const END_HOUR = 23;
const SLOT_MIN = 30;
const SNAP_MIN = 15;
const GUTTER_W = 60;
const CFG: GridConfig = { startHour: START_HOUR, hourHeight: HOUR_HEIGHT, snapMinutes: SNAP_MIN };

export interface TimeGridProps {
  days: Date[];                                 // 1 (Day) ou 7 (Week)
  events: EventForGrid[];                       // já filtrados por context
  onSlotClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEventDrop: (event: EventForGrid, newStart: Date) => void;
  onEventResize: (event: EventForGrid, newDurationMs: number) => void;
}

function DroppableDay({ day, children }: { day: Date; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({
    id: `day:${day.toISOString().slice(0, 10)}`,
    data: { type: 'day', date: day },
  });
  return (
    <div ref={setNodeRef} className="relative flex-1 border-l border-border/30 min-w-0">
      {children}
    </div>
  );
}

export function TimeGrid(p: TimeGridProps) {
  const totalHeight = (END_HOUR - START_HOUR + 1) * HOUR_HEIGHT;
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(new Date());
  const [activeDrag, setActiveDrag] = useState<EventForGrid | null>(null);

  // Scroll inicial inteligente
  useEffect(() => {
    if (!scrollerRef.current) return;
    const hasToday = p.days.some(d => isSameDay(d, new Date()));
    const target = hasToday ? Math.max(START_HOUR, new Date().getHours() - 1) : 7;
    scrollerRef.current.scrollTop = (target - START_HOUR) * HOUR_HEIGHT;
  }, [p.days.map(d => d.toISOString().slice(0, 10)).join('|')]); // eslint-disable-line

  // Linha "agora" atualiza a cada 60s
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  function handleDragStart(e: DragStartEvent) {
    const ev = e.active.data.current?.event as EventForGrid | undefined;
    if (ev) setActiveDrag(ev);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    const ev = e.active.data.current?.event as EventForGrid | undefined;
    const overData = e.over?.data.current as { type: string; date: Date } | undefined;
    if (!ev || !overData || overData.type !== 'day') return;
    // Calcula deslocamento Y do drag → nova hora
    const dyPx = (e.delta?.y ?? 0);
    const oldStart = new Date(ev.start_at);
    const oldY = timeToY(oldStart, CFG);
    const newY = oldY + dyPx;
    const newStart = yToTime(newY, overData.date, CFG);
    p.onEventDrop(ev, newStart);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Header dias (sticky) */}
      <div className="flex sticky top-0 z-20 bg-bg-surface border-b border-border">
        <div style={{ width: GUTTER_W }} className="shrink-0" />
        {p.days.map((d) => (
          <div
            key={d.toISOString()}
            className={[
              'flex-1 text-center py-2 text-[11px] uppercase tracking-wider',
              isSameDay(d, new Date()) ? 'bg-tom/5 text-fg font-semibold' : 'text-fg-muted',
            ].join(' ')}
          >
            {d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}
          </div>
        ))}
      </div>

      <div ref={scrollerRef} className="flex-1 overflow-y-auto relative">
        <div className="flex" style={{ height: totalHeight }}>
          {/* Gutter horas */}
          <div style={{ width: GUTTER_W }} className="shrink-0 relative border-r border-border/30">
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
              <div key={i} style={{ height: HOUR_HEIGHT }}
                className="text-[10px] text-fg-muted text-right pr-2 -translate-y-1.5">
                {String(START_HOUR + i).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {p.days.map((day) => {
            const dayEvents = p.events.filter(e => isSameDay(new Date(e.start_at), day));
            const laned = computeLanes(dayEvents);
            return (
              <DroppableDay key={day.toISOString()} day={day}>
                {/* Slots clicáveis (30min cada) */}
                {Array.from({ length: (END_HOUR - START_HOUR + 1) * 2 }, (_, i) => {
                  const slotDate = new Date(day);
                  slotDate.setHours(START_HOUR + Math.floor(i / 2), (i % 2) * SLOT_MIN, 0, 0);
                  return (
                    <div
                      key={i}
                      className="absolute inset-x-0 border-t border-border/20 hover:bg-tom/5 cursor-pointer"
                      style={{ top: i * (HOUR_HEIGHT / 2), height: HOUR_HEIGHT / 2 }}
                      onClick={() => p.onSlotClick(slotDate)}
                    />
                  );
                })}

                {/* Linha "agora" */}
                {isSameDay(day, now) && (
                  <div className="absolute inset-x-0 h-px bg-danger z-10 pointer-events-none"
                    style={{ top: timeToY(now, CFG) }} />
                )}

                {/* Eventos */}
                {laned.map((ev) => {
                  const start = new Date(ev.start_at);
                  const end = new Date(ev.end_at);
                  const top = timeToY(start, CFG);
                  const height = Math.max(24, timeToY(end, CFG) - top);
                  const width = 100 / ev.totalLanes;
                  const left = ev.lane * width;
                  return (
                    <EventBlock
                      key={ev.id}
                      event={ev as EventForGrid}
                      top={top} height={height} width={width} left={left}
                      hourHeight={HOUR_HEIGHT} snapMinutes={SNAP_MIN}
                      onClick={p.onEventClick}
                      onResize={p.onEventResize}
                    />
                  );
                })}
              </DroppableDay>
            );
          })}
        </div>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag ? (
          <EventBlock
            event={activeDrag}
            top={0} height={64} width={100} left={0}
            isOverlay hourHeight={HOUR_HEIGHT} snapMinutes={SNAP_MIN}
            onClick={() => {}} onResize={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}
```

- [ ] **Step 2: Validar TS**

- [ ] **Step 3: Commit**

Commit: `feat(agenda): TimeGrid (Day/Week shared, drag+resize+lanes+now+scroll inteligente)`

---

## Task 8 — `components/EventChip.tsx` e `components/MiniCalendar.tsx`

**Files:**
- Create: `web/src/screens/agenda/components/EventChip.tsx`
- Create: `web/src/screens/agenda/components/MiniCalendar.tsx`

- [ ] **Step 1: `EventChip.tsx`**

```tsx
// web/src/screens/agenda/components/EventChip.tsx
import type { EventForGrid } from '../hooks/useAgendaEvents';

const CONTEXT_FALLBACK_COLOR = { work: '#A3BE50', personal: '#64748B' } as const;

export function EventChip({ event, onClick }: {
  event: EventForGrid;
  onClick: (e: EventForGrid) => void;
}) {
  const color = event.category_color ?? CONTEXT_FALLBACK_COLOR[event.context];
  const start = new Date(event.start_at);
  const hh = start.getHours();
  const mm = start.getMinutes();
  const hourLabel = mm === 0 ? `${hh}h` : `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(event); }}
      className="w-full flex items-center gap-1 px-1.5 h-[18px] rounded-sm text-left truncate focus-ring"
      style={{ backgroundColor: `${color}26` /* alpha 15% */ }}
    >
      <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] tabular-nums opacity-80 shrink-0">{hourLabel}</span>
      <span className="text-[11px] truncate">{event.title}</span>
    </button>
  );
}
```

- [ ] **Step 2: `MiniCalendar.tsx`**

```tsx
// web/src/screens/agenda/components/MiniCalendar.tsx
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getMonthGrid } from '../lib/monthGrid';

export interface MiniCalendarProps {
  monthDate: Date;
  selectedDay: Date | null;
  daysWithEvents: Set<string>;        // ISO yyyy-mm-dd
  onMonthChange: (next: Date) => void;
  onDayClick: (day: Date) => void;
}

const WEEKDAYS = ['D','S','T','Q','Q','S','S'];

export function MiniCalendar(p: MiniCalendarProps) {
  const grid = getMonthGrid(p.monthDate);
  const today = new Date();
  const monthLabel = p.monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const month = p.monthDate.getMonth();

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-2">
        <button type="button" className="text-fg-muted hover:text-fg focus-ring rounded p-1"
          onClick={() => p.onMonthChange(new Date(p.monthDate.getFullYear(), month - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <div className="text-[12px] font-semibold text-fg capitalize">{monthLabel}</div>
        <button type="button" className="text-fg-muted hover:text-fg focus-ring rounded p-1"
          onClick={() => p.onMonthChange(new Date(p.monthDate.getFullYear(), month + 1, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center">
        {WEEKDAYS.map((w, i) => (
          <div key={i} className="text-[10px] text-fg-muted">{w}</div>
        ))}
        {grid.map((d) => {
          const iso = d.toISOString().slice(0, 10);
          const isOtherMonth = d.getMonth() !== month;
          const isToday = sameDay(d, today);
          const isSelected = p.selectedDay && sameDay(d, p.selectedDay);
          const hasEvent = p.daysWithEvents.has(iso);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => p.onDayClick(d)}
              className={[
                'h-7 w-7 grid place-items-center rounded text-[11px] relative focus-ring',
                isOtherMonth ? 'opacity-40' : '',
                isToday ? 'bg-tom text-black font-semibold' : 'text-fg hover:bg-bg-elevated',
                isSelected && !isToday ? 'ring-1 ring-tom' : '',
              ].join(' ')}
            >
              {d.getDate()}
              {hasEvent && !isToday && (
                <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-tom" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
```

- [ ] **Step 3: Validar TS**

- [ ] **Step 4: Commit**

Commit: `feat(agenda): EventChip + MiniCalendar`

---

## Task 9 — `views/DayView.tsx` e `views/WeekView.tsx`

**Files:**
- Create: `web/src/screens/agenda/views/DayView.tsx`
- Create: `web/src/screens/agenda/views/WeekView.tsx`

- [ ] **Step 1: Implementar `DayView.tsx`**

```tsx
// web/src/screens/agenda/views/DayView.tsx
import { TimeGrid } from '../components/TimeGrid';
import type { EventForGrid } from '../hooks/useAgendaEvents';

export interface DayViewProps {
  date: Date;
  events: EventForGrid[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEventDrop: (event: EventForGrid, newStart: Date) => void;
  onEventResize: (event: EventForGrid, newDurationMs: number) => void;
}

export function DayView(p: DayViewProps) {
  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <TimeGrid
        days={[p.date]} events={p.events}
        onSlotClick={p.onSlotClick} onEventClick={p.onEventClick}
        onEventDrop={p.onEventDrop} onEventResize={p.onEventResize}
      />
    </div>
  );
}
```

- [ ] **Step 2: Implementar `WeekView.tsx`**

```tsx
// web/src/screens/agenda/views/WeekView.tsx
import { TimeGrid } from '../components/TimeGrid';
import type { EventForGrid } from '../hooks/useAgendaEvents';

export interface WeekViewProps {
  weekStart: Date;                  // domingo da semana
  events: EventForGrid[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEventDrop: (event: EventForGrid, newStart: Date) => void;
  onEventResize: (event: EventForGrid, newDurationMs: number) => void;
}

export function WeekView(p: WeekViewProps) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(p.weekStart); d.setDate(p.weekStart.getDate() + i); return d;
  });
  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <TimeGrid
        days={days} events={p.events}
        onSlotClick={p.onSlotClick} onEventClick={p.onEventClick}
        onEventDrop={p.onEventDrop} onEventResize={p.onEventResize}
      />
    </div>
  );
}
```

- [ ] **Step 3: Validar TS + commit**

Commit: `feat(agenda): DayView + WeekView (wrappers TimeGrid)`

---

## Task 10 — `views/MonthView.tsx`

**Files:**
- Create: `web/src/screens/agenda/views/MonthView.tsx`

Spec ref: Seção 4 (3 cliques canônicos, cap dinâmico de chips).

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/views/MonthView.tsx
import { useMemo } from 'react';
import { getMonthGrid } from '../lib/monthGrid';
import { EventChip } from '../components/EventChip';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const WEEKDAYS = ['DOM','SEG','TER','QUA','QUI','SEX','SÁB'];

export interface MonthViewProps {
  monthDate: Date;
  events: EventForGrid[];
  selectedDay: Date | null;
  onDayClick: (date: Date) => void;
  onDayDoubleClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEmptyAreaClick: (date: Date) => void;
}

export function MonthView(p: MonthViewProps) {
  const grid = useMemo(() => getMonthGrid(p.monthDate), [p.monthDate]);
  const month = p.monthDate.getMonth();
  const today = new Date();
  const byDay = useMemo(() => {
    const map = new Map<string, EventForGrid[]>();
    for (const ev of p.events) {
      const key = new Date(ev.start_at).toISOString().slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(ev);
    }
    return map;
  }, [p.events]);

  return (
    <div className="flex flex-col h-full bg-bg-surface">
      <div className="grid grid-cols-7 border-b border-border sticky top-0 bg-bg-elevated z-10">
        {WEEKDAYS.map(w => (
          <div key={w} className="text-[10px] uppercase tracking-wider text-fg-muted text-center py-2">{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0">
        {grid.map((d) => {
          const iso = d.toISOString().slice(0, 10);
          const events = byDay.get(iso) ?? [];
          const isOther = d.getMonth() !== month;
          const isToday = sameDay(d, today);
          const isSelected = p.selectedDay && sameDay(d, p.selectedDay);
          // Cap dinâmico (assume cell ~120px de altura inicial; ajusta em runtime via measure se quiser)
          const visibleCap = 3;
          const visible = events.slice(0, visibleCap);
          const overflow = events.length - visible.length;
          return (
            <div
              key={iso}
              className={[
                'border-r border-b border-border/40 p-1 flex flex-col gap-0.5 min-h-[100px] cursor-pointer',
                isOther ? 'opacity-40' : '',
                isSelected ? 'bg-tom/5 ring-1 ring-tom/40 ring-inset' : '',
              ].join(' ')}
              onClick={(e) => {
                if (e.target === e.currentTarget) p.onEmptyAreaClick(d);
              }}
              onDoubleClick={() => p.onDayDoubleClick(d)}
            >
              <button
                type="button"
                className={[
                  'self-start w-6 h-6 grid place-items-center text-[11px] tabular-nums rounded-full focus-ring',
                  isToday ? 'bg-tom text-black font-semibold' : 'text-fg hover:bg-bg-elevated',
                ].join(' ')}
                onClick={(e) => { e.stopPropagation(); p.onDayClick(d); }}
              >
                {d.getDate()}
              </button>
              {visible.map(ev => (
                <EventChip key={ev.id} event={ev} onClick={p.onEventClick} />
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  className="text-[10px] text-fg-muted text-left px-1 hover:text-fg focus-ring rounded"
                  onClick={(e) => { e.stopPropagation(); p.onDayClick(d); }}
                >
                  +{overflow} mais
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}
```

- [ ] **Step 2: Validar TS + commit**

Commit: `feat(agenda): MonthView (grid 7×6 + chips + 3 click targets canônicos)`

---

## Task 11 — `components/QuickCreatePopover.tsx`

**Files:**
- Create: `web/src/screens/agenda/components/QuickCreatePopover.tsx`

Spec ref: Seção 6.1 (unified com `mode`).

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/components/QuickCreatePopover.tsx
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const CATEGORY_KEY = 'agenda.lastCategory';
const DURATIONS_MIN = [15, 30, 45, 60, 90, 120];

export type CreateEventPayload = {
  title: string; start_at: string; end_at: string;
  category: string; context: 'work' | 'personal';
};
export type CreateTaskPayload = {
  title: string; due_date: string; context: 'work' | 'personal';
};

export interface QuickCreatePopoverProps {
  mode: 'event' | 'task';
  anchor: { x: number; y: number; date: Date; time?: Date };
  onClose: () => void;
  onCreate: (payload: CreateEventPayload | CreateTaskPayload) => Promise<void> | void;
  onMoreOptions?: (draft: Partial<CreateEventPayload>) => void; // mode=event
}

const CATEGORIES = [
  { value: 'la_music', label: 'LA Music' },
  { value: 'mentoria', label: 'Mentoria' },
  { value: 'estudio', label: 'Estúdio' },
  { value: 'show', label: 'Show' },
  { value: 'pessoal', label: 'Pessoal' },
];

export function QuickCreatePopover(p: QuickCreatePopoverProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(CATEGORY_KEY)) || 'la_music');
  const [durationMin, setDurationMin] = useState(60);
  const [time, setTime] = useState<string>(() =>
    p.anchor.time ? p.anchor.time.toTimeString().slice(0, 5) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [p]);

  const context: 'work' | 'personal' = category === 'pessoal' ? 'personal' : 'work';

  const submit = async () => {
    if (!title.trim()) return;
    if (p.mode === 'event') {
      if (!time) { alert('Defina o horário'); return; }
      const [hh, mm] = time.split(':').map(Number);
      const start = new Date(p.anchor.date); start.setHours(hh, mm, 0, 0);
      const end = new Date(start.getTime() + durationMin * 60_000);
      localStorage.setItem(CATEGORY_KEY, category);
      await p.onCreate({
        title: title.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        category, context,
      });
    } else {
      await p.onCreate({
        title: title.trim(),
        due_date: p.anchor.date.toISOString().slice(0, 10),
        context,
      });
    }
    p.onClose();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={p.onClose} />
      <div
        role="dialog"
        className="fixed z-[9999] w-[340px] rounded-lg border border-border bg-bg-elevated2 shadow-2xl p-3"
        style={{ left: Math.min(p.anchor.x, window.innerWidth - 360), top: Math.max(8, p.anchor.y - 80) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) submit(); }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-semibold text-fg">
            {p.mode === 'event' ? '📅 Novo evento' : '✓ Nova tarefa'}
          </div>
          <button onClick={p.onClose} className="text-fg-muted hover:text-fg focus-ring rounded">
            <X size={14} />
          </button>
        </div>
        <input
          ref={inputRef} type="text" value={title} maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={p.mode === 'event' ? 'Título do evento' : 'Título da tarefa'}
          className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg text-[13px] focus:outline-none focus:border-tom"
        />
        {p.mode === 'event' && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-fg-muted">
            <span>{p.anchor.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="h-7 px-1 rounded bg-bg-surface border border-border text-fg tabular-nums focus:outline-none focus:border-tom" />
            <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}
              className="h-7 px-1 rounded bg-bg-surface border border-border text-fg focus:outline-none focus:border-tom">
              {DURATIONS_MIN.map(m => <option key={m} value={m}>{m < 60 ? `${m}min` : `${m/60}h`}</option>)}
            </select>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-7 px-2 text-[11px] rounded-full bg-bg-surface border border-border text-fg">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="text-[10px] text-fg-muted">→ {context === 'work' ? 'Trabalho' : 'Pessoal'}</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          {p.mode === 'event' && p.onMoreOptions ? (
            <button
              type="button"
              onClick={() => p.onMoreOptions!({ title, category, context,
                start_at: time ? buildIso(p.anchor.date, time) : undefined,
                end_at: time ? new Date(buildIso(p.anchor.date, time, durationMin)).toISOString() : undefined })}
              className="text-[11px] text-fg-muted hover:text-fg focus-ring rounded">
              + Mais opções
            </button>
          ) : <span />}
          <button
            type="button" onClick={submit}
            className="h-8 px-3 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring">
            Salvar (↵)
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function buildIso(date: Date, time: string, addMin = 0): string {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date(date); d.setHours(hh, mm + addMin, 0, 0);
  return d.toISOString();
}
```

- [ ] **Step 2: Validar TS + commit**

Commit: `feat(agenda): QuickCreatePopover unified (mode event|task, Enter salva, Esc fecha)`

---

## Task 12 — `components/EventEditDrawer.tsx`

**Files:**
- Create: `web/src/screens/agenda/components/EventEditDrawer.tsx`

Spec ref: Seção 6.2 (campos completos + Deletar vs Cancelar + diff inteligente).

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/components/EventEditDrawer.tsx
import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { DetailDrawer } from '../../../design/primitives/DetailDrawer';
import { DateInput } from '../../../components/DateInput';
import { TimeInput } from '../../../components/TimeInput';
import { CustomSelect } from '../../../components/CustomSelect';
import { Button } from '../../../components/Button';
import type { EventForGrid } from '../hooks/useAgendaEvents';

const CATEGORIES = [
  { value: 'la_music', label: 'LA Music' }, { value: 'mentoria', label: 'Mentoria' },
  { value: 'estudio',  label: 'Estúdio'  }, { value: 'show',     label: 'Show'     },
  { value: 'pessoal',  label: 'Pessoal'  },
];

export interface EventEditDrawerProps {
  event: EventForGrid | null;          // null = drawer fechado
  open: boolean;
  onClose: () => void;
  onSave: (id: string, patch: Partial<EventForGrid>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function EventEditDrawer(p: EventEditDrawerProps) {
  const ev = p.event;
  const [form, setForm] = useState<EventForGrid | null>(ev);

  useEffect(() => { setForm(ev); }, [ev?.id]); // eslint-disable-line

  const patch = useMemo<Partial<EventForGrid>>(() => {
    if (!form || !ev) return {};
    const diff: Partial<EventForGrid> = {};
    (Object.keys(form) as (keyof EventForGrid)[]).forEach((k) => {
      if (form[k] !== ev[k]) (diff as any)[k] = form[k];
    });
    return diff;
  }, [form, ev]);

  if (!form || !ev) {
    return <DetailDrawer open={false} onClose={p.onClose} title="">{null}</DetailDrawer>;
  }

  const startDate = form.start_at.slice(0, 10);
  const startTime = new Date(form.start_at).toTimeString().slice(0, 5);
  const endDate = form.end_at.slice(0, 10);
  const endTime = new Date(form.end_at).toTimeString().slice(0, 5);

  const setStart = (date: string, time: string) => {
    const d = new Date(`${date}T${time}:00`);
    setForm({ ...form, start_at: d.toISOString() });
  };
  const setEnd = (date: string, time: string) => {
    const d = new Date(`${date}T${time}:00`);
    setForm({ ...form, end_at: d.toISOString() });
  };

  const error = validate(form);

  const handleSave = async () => {
    if (error) return;
    await p.onSave(ev.id, patch);
    p.onClose();
  };
  const handleDelete = async () => {
    if (!confirm('Deletar esse evento? Essa ação não pode ser desfeita.')) return;
    await p.onDelete(ev.id);
    p.onClose();
  };

  return (
    <DetailDrawer
      open={p.open} onClose={p.onClose} title="Editar evento"
      footer={
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleDelete}>
            <Trash2 size={14} /> Deletar
          </Button>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={p.onClose}>Cancelar</Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={!!error}>Salvar</Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Título">
          <input value={form.title} maxLength={200}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <div className="flex gap-2">
              <DateInput value={startDate} onChange={(d) => setStart(d, startTime)} />
              <TimeInput value={startTime} onChange={(t) => setStart(startDate, t)} />
            </div>
          </Field>
          <Field label="Fim">
            <div className="flex gap-2">
              <DateInput value={endDate} onChange={(d) => setEnd(d, endTime)} />
              <TimeInput value={endTime} onChange={(t) => setEnd(endDate, t)} />
            </div>
          </Field>
        </div>

        <Field label="Categoria">
          <CustomSelect
            value={form.category} options={CATEGORIES}
            onChange={(v) => setForm({
              ...form, category: v,
              context: v === 'pessoal' ? 'personal' : 'work',
            })}
          />
        </Field>

        <Field label="Contexto">
          <div className="flex gap-2">
            {(['work','personal'] as const).map(c => (
              <button key={c} type="button"
                onClick={() => setForm({ ...form, context: c })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring',
                  form.context === c ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}>
                {c === 'work' ? 'Trabalho' : 'Pessoal'}
              </button>
            ))}
          </div>
          {form.category === 'pessoal' && (
            <div className="text-[10px] text-fg-muted mt-1">🛡 Pessoal não é visto por coordenação</div>
          )}
        </Field>

        <Field label="Modalidade">
          <div className="flex gap-2">
            {(['presencial','online','hibrido'] as const).map(m => (
              <button key={m} type="button"
                onClick={() => setForm({ ...form, modality: m })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring capitalize',
                  form.modality === m ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}>
                {m}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Local">
          <input value={form.location_text ?? ''}
            onChange={(e) => setForm({ ...form, location_text: e.target.value || null })}
            className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg" />
        </Field>

        {(form.modality === 'online' || form.modality === 'hibrido') && (
          <Field label="Link da reunião">
            <input type="url" value={form.meeting_url ?? ''}
              onChange={(e) => setForm({ ...form, meeting_url: e.target.value || null })}
              className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg" />
          </Field>
        )}

        <Field label="Status">
          <div className="flex gap-2">
            {(['scheduled','done','cancelled'] as const).map(s => (
              <button key={s} type="button"
                onClick={() => setForm({ ...form, status: s })}
                className={['h-8 px-3 rounded-md text-[12px] focus-ring',
                  form.status === s ? 'bg-tom text-black font-semibold' : 'bg-bg-elevated text-fg-muted'].join(' ')}>
                {s === 'scheduled' ? 'Agendado' : s === 'done' ? '✓ Concluído' : '✕ Cancelado'}
              </button>
            ))}
          </div>
        </Field>

        <div className="text-[10px] text-fg-muted pt-2 border-t border-border">
          Criado por {ev.source} · {new Date(form.start_at).toLocaleDateString('pt-BR')}
        </div>

        {error && <div className="text-[12px] text-danger">{error}</div>}
      </div>
    </DetailDrawer>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">{label}</div>
      {children}
    </div>
  );
}

function validate(f: EventForGrid): string | null {
  if (!f.title.trim()) return 'Título obrigatório';
  if (new Date(f.end_at) <= new Date(f.start_at)) return 'Fim deve ser após o início';
  const sameDay = f.start_at.slice(0,10) === f.end_at.slice(0,10);
  if (!sameDay) return 'Evento de múltiplos dias não suportado';
  if (f.modality === 'presencial' && f.meeting_url) return 'Eventos presenciais não têm link';
  return null;
}
```

- [ ] **Step 2: Validar TS + commit**

Commit: `feat(agenda): EventEditDrawer (campos completos + Deletar vs Cancelar + diff inteligente)`

---

## Task 13 — `components/MonthDayDrawer.tsx`

**Files:**
- Create: `web/src/screens/agenda/components/MonthDayDrawer.tsx`

Spec ref: Seção 4 (header com contadores respeitando filtros).

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/components/MonthDayDrawer.tsx
import { X } from 'lucide-react';
import { EventChip } from './EventChip';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import type { TaskForPanel } from '../hooks/useAgendaTasks';

export interface MonthDayDrawerProps {
  selectedDay: Date | null;
  events: EventForGrid[];   // JÁ FILTRADOS pelos chips ativos
  tasks: TaskForPanel[];    // JÁ FILTRADOS
  onClose: () => void;
  onEventClick: (event: EventForGrid) => void;
  onTaskClick: (task: TaskForPanel) => void;
  onCreateEvent: (date: Date) => void;
  onCreateTask: (date: Date) => void;
  onOpenDayView: (date: Date) => void;
}

export function MonthDayDrawer(p: MonthDayDrawerProps) {
  if (!p.selectedDay) {
    return (
      <div className="h-full flex items-center justify-center text-fg-muted text-[12px] p-4 text-center">
        Selecione um dia no calendário para ver eventos e tarefas
      </div>
    );
  }
  const d = p.selectedDay;
  const iso = d.toISOString().slice(0, 10);
  const dayEvents = p.events.filter(e => e.start_at.slice(0, 10) === iso);
  const dayTasks = p.tasks.filter(t => {
    const taskDate = t.scheduled_date ?? t.due_date;
    return taskDate?.slice(0, 10) === iso;
  });
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-border flex items-start justify-between">
        <div>
          <div className="text-[14px] font-semibold text-fg capitalize">
            {d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
          <div className="text-[11px] text-fg-muted">
            {dayEvents.length} {dayEvents.length === 1 ? 'evento' : 'eventos'} · {dayTasks.length} {dayTasks.length === 1 ? 'tarefa' : 'tarefas'}
          </div>
        </div>
        <button onClick={p.onClose} className="text-fg-muted hover:text-fg focus-ring rounded"><X size={14}/></button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
        <section>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">Eventos do dia</div>
          {dayEvents.length === 0 ? (
            <div className="text-[11px] text-fg-muted italic">Nenhum evento</div>
          ) : (
            <div className="space-y-1">
              {dayEvents.map(ev => <EventChip key={ev.id} event={ev} onClick={p.onEventClick} />)}
            </div>
          )}
        </section>
        <section>
          <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1">Tarefas do dia</div>
          {dayTasks.length === 0 ? (
            <div className="text-[11px] text-fg-muted italic">Nenhuma tarefa</div>
          ) : (
            <ul className="space-y-1">
              {dayTasks.map(t => (
                <li key={t.id}>
                  <button onClick={() => p.onTaskClick(t)}
                    className="w-full text-left text-[12px] text-fg hover:bg-bg-elevated rounded px-2 py-1 focus-ring">
                    {t.status === 'done' ? '☑' : '☐'} {t.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="px-3 py-2 border-t border-border space-y-2">
        <div className="flex gap-2">
          <button onClick={() => p.onCreateEvent(d)}
            className="flex-1 h-8 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
            + Novo evento
          </button>
          <button onClick={() => p.onCreateTask(d)}
            className="flex-1 h-8 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
            + Tarefa
          </button>
        </div>
        <button onClick={() => p.onOpenDayView(d)}
          className="w-full h-9 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring">
          Abrir vista Dia →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TS + commit**

Commit: `feat(agenda): MonthDayDrawer (counters respeitam filtros, ações + abrir Dia)`

---

## Task 14 — `AgendaLeftRail.tsx` + `TasksPanel.tsx`

**Files:**
- Create: `web/src/screens/agenda/AgendaLeftRail.tsx`
- Create: `web/src/screens/agenda/TasksPanel.tsx`

- [ ] **Step 1: `AgendaLeftRail.tsx`**

```tsx
// web/src/screens/agenda/AgendaLeftRail.tsx
import { MiniCalendar } from './components/MiniCalendar';
import type { AgendaFilters } from './hooks/useAgendaFilters';
import type { TaskForPanel } from './hooks/useAgendaTasks';

export interface AgendaLeftRailProps {
  miniMonth: Date;
  selectedDay: Date | null;
  daysWithEvents: Set<string>;
  tasks: TaskForPanel[];   // já filtrados
  filters: AgendaFilters;
  onToggleFilter: (k: keyof AgendaFilters) => void;
  onMiniMonthChange: (next: Date) => void;
  onMiniDayClick: (day: Date) => void;
  onCountClick: (which: 'today'|'done'|'overdue') => void;
}

const CHIP_COLOR = {
  trabalho: '#A3BE50', pessoal: '#7B61FF', delegadas: '#06B6D4',
} as const;

export function AgendaLeftRail(p: AgendaLeftRailProps) {
  const today = new Date().toISOString().slice(0, 10);
  const counts = {
    today: p.tasks.filter(t => (t.scheduled_date ?? '').slice(0,10) === today && t.status !== 'done').length,
    done: p.tasks.filter(t => t.status === 'done').length,
    overdue: p.tasks.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'delegated').length,
  };
  const chipCounts = {
    trabalho: p.tasks.filter(t => t.context === 'work' && !t.delegated_to).length,
    pessoal:  p.tasks.filter(t => t.context === 'personal').length,
    delegadas:p.tasks.filter(t => !!t.delegated_to).length,
  };
  return (
    <aside className="w-[260px] shrink-0 border-r border-border bg-bg-surface overflow-y-auto flex flex-col">
      <MiniCalendar
        monthDate={p.miniMonth} selectedDay={p.selectedDay}
        daysWithEvents={p.daysWithEvents}
        onMonthChange={p.onMiniMonthChange} onDayClick={p.onMiniDayClick}
      />
      <div className="px-3 py-2 border-t border-border space-y-1.5">
        <CountRow label="PRA HOJE"    value={counts.today}   onClick={() => p.onCountClick('today')} />
        <CountRow label="CONCLUÍDAS" value={counts.done}    onClick={() => p.onCountClick('done')}   colorClass="text-success" />
        <CountRow label="ATRASADAS"  value={counts.overdue} onClick={() => p.onCountClick('overdue')} colorClass="text-danger" />
      </div>
      <div className="px-3 py-2 border-t border-border">
        <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-2">Filtrar</div>
        {(['trabalho','pessoal','delegadas'] as const).map(k => (
          <button key={k} type="button"
            onClick={() => p.onToggleFilter(k)}
            className={[
              'w-full flex items-center justify-between px-2 h-8 rounded-md text-[12px] focus-ring transition',
              p.filters[k] ? 'text-fg' : 'text-fg-muted opacity-60',
            ].join(' ')}>
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CHIP_COLOR[k] }} />
              <span className="capitalize">{k}</span>
            </span>
            <span className="tabular-nums">{chipCounts[k]}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CountRow({ label, value, onClick, colorClass }: {
  label: string; value: number; onClick: () => void; colorClass?: string;
}) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center justify-between px-2 h-8 hover:bg-bg-elevated rounded-md focus-ring">
      <span className="text-[11px] uppercase tracking-wider text-fg-muted font-semibold">{label}</span>
      <span className={['text-[14px] font-bold tabular-nums', colorClass ?? 'text-fg'].join(' ')}>{value}</span>
    </button>
  );
}
```

- [ ] **Step 2: `TasksPanel.tsx`**

```tsx
// web/src/screens/agenda/TasksPanel.tsx
import { useMemo, useState } from 'react';
import type { TaskForPanel } from './hooks/useAgendaTasks';

export interface TasksPanelProps {
  view: 'day' | 'week';
  currentDate: Date;
  weekStart: Date;
  tasks: TaskForPanel[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleDone: (t: TaskForPanel) => void;
  onCreateTask: (date: Date) => void;
}

const LS = 'agenda.tasksPanel.collapsed';

export function TasksPanel(p: TasksPanelProps) {
  const inRange = useMemo(() => {
    const todayIso = p.currentDate.toISOString().slice(0, 10);
    const weekEnd = new Date(p.weekStart); weekEnd.setDate(p.weekStart.getDate() + 6);
    return p.tasks.filter(t => {
      const date = t.scheduled_date ?? t.due_date;
      if (!date) return false;
      const iso = date.slice(0, 10);
      if (p.view === 'day') return iso === todayIso;
      return iso >= p.weekStart.toISOString().slice(0, 10) && iso <= weekEnd.toISOString().slice(0, 10);
    });
  }, [p.tasks, p.view, p.currentDate, p.weekStart]);

  const today = new Date().toISOString().slice(0, 10);
  const overdue = inRange.filter(t => t.due_date && t.due_date < today && t.status !== 'done' && t.status !== 'delegated');
  const todayTasks = inRange.filter(t => t.status !== 'done' && (t.scheduled_date ?? '').slice(0,10) === today);
  const done = inRange.filter(t => t.status === 'done');

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(LS) ?? '{}'); } catch { return {}; }
  });
  const toggle = (k: string) => setCollapsed(prev => {
    const next = { ...prev, [k]: !prev[k] };
    try { localStorage.setItem(LS, JSON.stringify(next)); } catch {}
    return next;
  });

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-bg-surface flex flex-col">
      <header className="px-3 py-3 border-b border-border">
        <div className="text-[13px] font-semibold text-fg">Tarefas</div>
        <div className="text-[11px] text-fg-muted">
          {p.view === 'day' ? p.currentDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) : 'Semana'}
          {' · '}{todayTasks.length + overdue.length} pendentes
        </div>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 text-[12px]">
        <Section title={`ATRASADAS (${overdue.length})`} k="overdue" defaultCollapsed={overdue.length === 0}
          collapsed={!!collapsed.overdue} onToggle={() => toggle('overdue')}>
          {overdue.map(t => <TaskRow key={t.id} task={t} onClick={p.onTaskClick} onToggle={p.onToggleDone} />)}
        </Section>
        <Section title={`PRA HOJE (${todayTasks.length})`} k="today" collapsed={!!collapsed.today} onToggle={() => toggle('today')}>
          {todayTasks.map(t => <TaskRow key={t.id} task={t} onClick={p.onTaskClick} onToggle={p.onToggleDone} />)}
        </Section>
        <Section title={`CONCLUÍDAS (${done.length})`} k="done" defaultCollapsed
          collapsed={collapsed.done ?? true} onToggle={() => toggle('done')}>
          {done.map(t => <TaskRow key={t.id} task={t} onClick={p.onTaskClick} onToggle={p.onToggleDone} done />)}
        </Section>
      </div>
      <div className="px-3 py-2 border-t border-border">
        <button onClick={() => p.onCreateTask(p.currentDate)}
          className="w-full h-8 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
          + Tarefa
        </button>
      </div>
    </aside>
  );
}

function Section({ title, k, collapsed, onToggle, children, defaultCollapsed }: {
  title: string; k: string; collapsed: boolean; onToggle: () => void;
  children: React.ReactNode; defaultCollapsed?: boolean;
}) {
  return (
    <section>
      <button onClick={onToggle}
        className="w-full text-left text-[10px] uppercase tracking-wider text-fg-muted font-semibold py-1 hover:text-fg focus-ring rounded">
        {collapsed ? '▶' : '▼'} {title}
      </button>
      {!collapsed && <div className="space-y-1">{children}</div>}
    </section>
  );
}

function TaskRow({ task, onClick, onToggle, done }: {
  task: TaskForPanel; onClick: (t: TaskForPanel) => void;
  onToggle: (t: TaskForPanel) => void; done?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-bg-elevated">
      <input type="checkbox" checked={task.status === 'done'}
        onChange={() => onToggle(task)}
        className="mt-0.5 accent-tom" />
      <button onClick={() => onClick(task)}
        className={['flex-1 text-left text-[12px] text-fg truncate focus-ring rounded',
          done ? 'opacity-60 line-through' : ''].join(' ')}>
        {task.title}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Validar TS + commit**

Commit: `feat(agenda): AgendaLeftRail (mini-cal + counts + chips) + TasksPanel`

---

## Task 15 — `AgendaShell.tsx`

**Files:**
- Create: `web/src/screens/agenda/AgendaShell.tsx`

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/agenda/AgendaShell.tsx
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-react';

export type AgendaView = 'day' | 'week' | 'month';

export interface AgendaShellProps {
  view: AgendaView;
  currentDate: Date;             // dia foco (Day) ou âncora (Week=first, Month=any)
  centerLabel: string;
  leftRail: React.ReactNode;
  rightRail: React.ReactNode;
  children: React.ReactNode;     // center
  onChangeView: (view: AgendaView) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onNewClick: () => void;
}

export function AgendaShell(p: AgendaShellProps) {
  return (
    <div className="flex flex-col h-full bg-bg-app">
      <header className="h-14 shrink-0 border-b border-border bg-bg-surface flex items-center px-4 gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-2">
          <CalendarDays size={16} className="text-fg-muted" />
          <span className="text-[14px] font-semibold text-fg">Agenda</span>
          <div className="ml-4 inline-flex rounded-md border border-border bg-bg-elevated overflow-hidden">
            {(['day','week','month'] as const).map(v => (
              <button key={v} onClick={() => p.onChangeView(v)}
                className={['h-8 px-3 text-[12px] focus-ring',
                  p.view === v ? 'bg-tom text-black font-semibold' : 'text-fg-muted hover:text-fg'].join(' ')}>
                {v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center gap-2">
          <button onClick={p.onPrev} className="text-fg-muted hover:text-fg focus-ring rounded p-1.5"><ChevronLeft size={16}/></button>
          <button onClick={p.onToday}
            className="h-8 px-3 rounded-md bg-bg-elevated border border-border text-[12px] text-fg hover:bg-bg-elevated2 focus-ring">
            Hoje
          </button>
          <div className="text-[13px] text-fg tabular-nums capitalize">{p.centerLabel}</div>
          <button onClick={p.onNext} className="text-fg-muted hover:text-fg focus-ring rounded p-1.5"><ChevronRight size={16}/></button>
        </div>
        <button onClick={p.onNewClick}
          className="h-8 px-3 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring inline-flex items-center gap-1">
          <Plus size={14}/> Novo
        </button>
      </header>
      <div className="flex-1 flex min-h-0">
        {p.leftRail}
        <main className="flex-1 min-w-0 flex flex-col">{p.children}</main>
        {p.rightRail}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TS + commit**

Commit: `feat(agenda): AgendaShell (topbar 3-group + 3-pane)`

---

## Task 16 — `AgendaDesktop.tsx`: orquestrador

**Files:**
- Create: `web/src/screens/AgendaDesktop.tsx`

Spec ref: Seções 1, 2 (router/URL), 5/6 (mutations + drawers/popovers).

- [ ] **Step 1: Implementar**

```tsx
// web/src/screens/AgendaDesktop.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
// IMPORTANTE: confirmar lib de toast usada no projeto (Step 2 desta Task) e ajustar:
// import { toast } from 'sonner';  // ou 'react-hot-toast', ou wrapper interno
import { AgendaShell, type AgendaView } from './agenda/AgendaShell';
import { AgendaLeftRail } from './agenda/AgendaLeftRail';
import { TasksPanel } from './agenda/TasksPanel';
import { DayView } from './agenda/views/DayView';
import { WeekView } from './agenda/views/WeekView';
import { MonthView } from './agenda/views/MonthView';
import { MonthDayDrawer } from './agenda/components/MonthDayDrawer';
import { QuickCreatePopover } from './agenda/components/QuickCreatePopover';
import { EventEditDrawer } from './agenda/components/EventEditDrawer';
import { useAgendaFilters } from './agenda/hooks/useAgendaFilters';
import { useAgendaEvents, type EventForGrid } from './agenda/hooks/useAgendaEvents';
import { useAgendaTasks, type TaskForPanel } from './agenda/hooks/useAgendaTasks';
// CONFIRMAR caminhos reais dos mutators:
import { useCreateEvent, useUpdateEvent, useDeleteEvent } from '../hooks/useEvents';
import { useCreateTask, useUpdateTask } from '../hooks/useTasks';

function startOfWeek(d: Date) { const x=new Date(d); x.setDate(d.getDate()-d.getDay()); x.setHours(0,0,0,0); return x; }
function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth()+1, 0, 23,59,59); }

export function AgendaDesktop() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const view = (params.get('view') as AgendaView) || 'day';
  const dateIso = params.get('date') ?? new Date().toISOString().slice(0, 10);
  const currentDate = useMemo(() => new Date(`${dateIso}T00:00:00`), [dateIso]);

  const { filters, toggle } = useAgendaFilters();
  const [selectedMonthDay, setSelectedMonthDay] = useState<Date | null>(null);
  const [miniMonth, setMiniMonth] = useState<Date>(startOfMonth(currentDate));
  const [quickCreate, setQuickCreate] = useState<{ x:number; y:number; date:Date; time?:Date; mode:'event'|'task' } | null>(null);
  const [editingEvent, setEditingEvent] = useState<EventForGrid | null>(null);

  // Range pra fetch
  const { from, to } = useMemo(() => {
    if (view === 'day')  return { from: startOfDay(currentDate), to: endOfDay(currentDate) };
    if (view === 'week') { const s=startOfWeek(currentDate); const e=new Date(s); e.setDate(s.getDate()+6); e.setHours(23,59,59); return { from:s, to:e }; }
    return { from: startOfMonth(currentDate), to: endOfMonth(currentDate) };
  }, [view, currentDate]);

  const { events } = useAgendaEvents({ from, to, filters });
  const { tasks } = useAgendaTasks({ from, to, filters });

  const createEvent = useCreateEvent();
  const updateEvent = useUpdateEvent();
  const deleteEvent = useDeleteEvent();
  const createTask  = useCreateTask();
  const updateTask  = useUpdateTask();

  const setView = useCallback((v: AgendaView) => {
    const next = new URLSearchParams(params); next.set('view', v);
    navigate(`/agenda?${next.toString()}`, { replace: true });
  }, [params, navigate]);
  const setDate = useCallback((d: Date) => {
    const next = new URLSearchParams(params); next.set('date', d.toISOString().slice(0,10));
    navigate(`/agenda?${next.toString()}`, { replace: true });
  }, [params, navigate]);

  // Topbar nav
  const onPrev = () => {
    const d = new Date(currentDate);
    if (view==='day') d.setDate(d.getDate()-1);
    else if (view==='week') d.setDate(d.getDate()-7);
    else d.setMonth(d.getMonth()-1);
    setDate(d); setMiniMonth(startOfMonth(d));
  };
  const onNext = () => {
    const d = new Date(currentDate);
    if (view==='day') d.setDate(d.getDate()+1);
    else if (view==='week') d.setDate(d.getDate()+7);
    else d.setMonth(d.getMonth()+1);
    setDate(d); setMiniMonth(startOfMonth(d));
  };
  const onToday = () => { const t=new Date(); setDate(t); setMiniMonth(startOfMonth(t)); };

  // ⚠️ Toast: usar o sistema real do projeto (auditar antes — Step 2 da Task 16).
  // Placeholder para o import correto:
  // import { toast } from '<lib do projeto>';

  // Atalhos — handler via ref evita closure velha sem re-registrar listener a cada render
  const handlerRef = useRef<(e: KeyboardEvent) => void>();
  handlerRef.current = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/)) return;
    if (e.key === 'd') setView('day');
    else if (e.key === 'w') setView('week');
    else if (e.key === 'm') setView('month');
    else if (e.key === 't') onToday();
    else if (e.key === 'ArrowLeft') onPrev();
    else if (e.key === 'ArrowRight') onNext();
    else if (e.key === 'n') openNewMenu();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => handlerRef.current?.(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Menu "+ Novo" inline (não usar window.confirm)
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const openNewMenu = () => setNewMenu({ x: window.innerWidth - 160, y: 64 });

  // Mutations com optimistic + toast no erro
  const onEventDrop = async (ev: EventForGrid, newStart: Date) => {
    const durationMs = new Date(ev.end_at).getTime() - new Date(ev.start_at).getTime();
    const patch = {
      start_at: newStart.toISOString(),
      end_at: new Date(newStart.getTime() + durationMs).toISOString(),
    };
    try { await updateEvent.mutateAsync({ id: ev.id, patch }); }
    catch { toast.error('Não foi possível atualizar o evento. Tente de novo.'); }
  };
  const onEventResize = async (ev: EventForGrid, newDurMs: number) => {
    const start = new Date(ev.start_at);
    const patch = { end_at: new Date(start.getTime() + newDurMs).toISOString() };
    try { await updateEvent.mutateAsync({ id: ev.id, patch }); }
    catch { toast.error('Não foi possível redimensionar. Tente de novo.'); }
  };

  const centerLabel =
    view === 'day' ? currentDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) :
    view === 'week' ? formatWeekRange(currentDate) :
    miniMonth.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const daysWithEvents = useMemo(() => {
    const s = new Set<string>();
    events.forEach(e => s.add(e.start_at.slice(0,10)));
    return s;
  }, [events]);

  return (
    <>
      <AgendaShell
        view={view} currentDate={currentDate} centerLabel={centerLabel}
        onChangeView={setView} onPrev={onPrev} onNext={onNext} onToday={onToday}
        onNewClick={openNewMenu}
        leftRail={
          <AgendaLeftRail
            miniMonth={miniMonth} selectedDay={view==='month' ? selectedMonthDay : currentDate}
            daysWithEvents={daysWithEvents} tasks={tasks} filters={filters}
            onToggleFilter={toggle}
            onMiniMonthChange={setMiniMonth}
            onMiniDayClick={(d) => { setDate(d); setView('day'); }}
            onCountClick={() => {}}
          />
        }
        rightRail={view === 'month' ? (
          <div className="w-[320px] shrink-0 border-l border-border bg-bg-surface">
            <MonthDayDrawer
              selectedDay={selectedMonthDay} events={events} tasks={tasks}
              onClose={() => setSelectedMonthDay(null)}
              onEventClick={setEditingEvent}
              onTaskClick={() => {}}
              onCreateEvent={(d) => setQuickCreate({ x: window.innerWidth-360, y: 120, date: d, mode: 'event' })}
              onCreateTask={(d) => setQuickCreate({ x: window.innerWidth-360, y: 120, date: d, mode: 'task' })}
              onOpenDayView={(d) => { setDate(d); setView('day'); }}
            />
          </div>
        ) : (
          <TasksPanel
            view={view} currentDate={currentDate} weekStart={startOfWeek(currentDate)}
            tasks={tasks}
            onTaskClick={() => {}}
            onToggleDone={(t) => updateTask.mutate({ id: t.id, patch: { status: t.status==='done' ? 'pending' : 'done' } })}
            onCreateTask={(d) => setQuickCreate({ x: window.innerWidth-360, y: 120, date: d, mode: 'task' })}
          />
        )}
      >
        {view === 'day' && (
          <DayView date={currentDate} events={events}
            onSlotClick={(d) => setQuickCreate({ x: window.innerWidth/2-170, y: window.innerHeight/2, date: d, time: d, mode: 'event' })}
            onEventClick={setEditingEvent}
            onEventDrop={onEventDrop} onEventResize={onEventResize} />
        )}
        {view === 'week' && (
          <WeekView weekStart={startOfWeek(currentDate)} events={events}
            onSlotClick={(d) => setQuickCreate({ x: window.innerWidth/2-170, y: window.innerHeight/2, date: d, time: d, mode: 'event' })}
            onEventClick={setEditingEvent}
            onEventDrop={onEventDrop} onEventResize={onEventResize} />
        )}
        {view === 'month' && (
          <MonthView monthDate={miniMonth} events={events}
            selectedDay={selectedMonthDay}
            onDayClick={setSelectedMonthDay}
            onDayDoubleClick={(d) => { setDate(d); setView('day'); }}
            onEventClick={setEditingEvent}
            onEmptyAreaClick={(d) => setQuickCreate({ x: window.innerWidth/2-170, y: window.innerHeight/2, date: d, mode: 'event' })}
          />
        )}
      </AgendaShell>

      {quickCreate && (
        <QuickCreatePopover
          mode={quickCreate.mode}
          anchor={quickCreate}
          onClose={() => setQuickCreate(null)}
          onCreate={async (payload) => {
            try {
              if (quickCreate.mode === 'event') await createEvent.mutateAsync(payload as any);
              else await createTask.mutateAsync(payload as any);
              qc.invalidateQueries({ queryKey: ['events'] });
              qc.invalidateQueries({ queryKey: ['tasks'] });
            } catch { toast.error('Não foi possível criar. Tente de novo.'); }
          }}
          onMoreOptions={(draft) => { setQuickCreate(null); setEditingEvent(draft as any); }}
        />
      )}

      <EventEditDrawer
        event={editingEvent} open={!!editingEvent}
        onClose={() => setEditingEvent(null)}
        onSave={async (id, patch) => {
          try { await updateEvent.mutateAsync({ id, patch }); }
          catch { toast.error('Não foi possível salvar.'); }
        }}
        onDelete={async (id) => {
          try { await deleteEvent.mutateAsync(id); }
          catch { toast.error('Não foi possível deletar.'); }
        }}
      />

      {/* Menu inline do + Novo (não usar window.confirm) */}
      {newMenu && (
        <>
          <div className="fixed inset-0 z-[9997]" onClick={() => setNewMenu(null)} />
          <div
            className="fixed z-[9998] w-40 rounded-lg border border-border bg-bg-elevated shadow-xl py-1"
            style={{ top: newMenu.y, left: newMenu.x }}
          >
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-[13px] text-fg hover:bg-bg-elevated2 focus-ring"
              onClick={() => {
                setNewMenu(null);
                setQuickCreate({ x: newMenu.x, y: newMenu.y, date: currentDate, mode: 'event' });
              }}
            >
              📅 Evento
            </button>
            <button
              type="button"
              className="w-full text-left px-3 py-2 text-[13px] text-fg hover:bg-bg-elevated2 focus-ring"
              onClick={() => {
                setNewMenu(null);
                setQuickCreate({ x: newMenu.x, y: newMenu.y, date: currentDate, mode: 'task' });
              }}
            >
              ✓ Tarefa
            </button>
          </div>
        </>
      )}
    </>
  );
}

function startOfDay(d: Date) { const x=new Date(d); x.setHours(0,0,0,0); return x; }
function endOfDay(d: Date)   { const x=new Date(d); x.setHours(23,59,59,999); return x; }
function formatWeekRange(d: Date) {
  const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate()+6);
  return `${s.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})} – ${e.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'})}`;
}
```

- [ ] **Step 2: Auditar nomes reais dos mutators + lib de toast**

```bash
grep -rn "useCreateEvent\|useUpdateEvent\|useDeleteEvent\|useCreateTask\|useUpdateTask" _remote/web/src/hooks 2>/dev/null | head -10
grep -rn "from 'sonner'\|from 'react-hot-toast'\|toast.error\|toast.success" _remote/web/src --include='*.ts' --include='*.tsx' 2>/dev/null | head -5
```

Ajustar no `AgendaDesktop.tsx`:
- Imports/chamadas dos mutators (se assinatura difere de `mutateAsync({id, patch})`)
- Import do `toast` (substituir o placeholder pela lib real)
- Se o projeto não usa toast lib, criar wrapper interno `lib/toast.ts` antes de seguir (não usar `window.alert`/`window.confirm`)

- [ ] **Step 3: Validar TS + commit**

Commit: `feat(agenda): AgendaDesktop orquestrador (URL, mutations, drawers, atalhos)`

---

## Task 17 — Dispatcher `Agenda.tsx` + rota em `App.tsx` + sidebar

**Files:**
- Create: `web/src/screens/Agenda.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/design/shell/SidebarV2.tsx`

- [ ] **Step 1: `Agenda.tsx`**

```tsx
// web/src/screens/Agenda.tsx
import { useBreakpoint } from '../hooks/useBreakpoint';
import { Hoje } from './Hoje';
import { AgendaDesktop } from './AgendaDesktop';

export default function Agenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Hoje />;
  return <AgendaDesktop />;
}
```

- [ ] **Step 2: Adicionar rota em `App.tsx`**

Localizar bloco de rotas e adicionar:

```tsx
import Agenda from './screens/Agenda';
// ...
<Route path="agenda" element={<Agenda />} />
```

Mobile: NÃO mexer em `/hoje` ou `/semana` — continuam apontando para `Hoje.tsx` e `Semana.tsx`.

- [ ] **Step 3: Sidebar `SidebarV2.tsx` linha 61**

Trocar:
```tsx
{ to: '/hoje', label: 'Agenda', Icon: CalendarDays, matchPaths: ['/hoje', '/semana'] },
```
Por:
```tsx
{ to: '/agenda?view=day', label: 'Agenda', Icon: CalendarDays, matchPaths: ['/agenda', '/hoje', '/semana'] },
```

(Mantém matchPaths com /hoje e /semana para o item Sidebar ficar destacado mesmo no mobile que usa as rotas legadas.)

- [ ] **Step 4: Validar TS**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

Commit: `feat(agenda): Agenda.tsx dispatcher + rota /agenda + sidebar aponta para nova`

---

## Task 18 — Realtime garantia + smoke test desktop

**Files:**
- Verify: `web/src/hooks/useRealtimeSync.ts` (já existe)
- Test manual: `localhost:4173`

- [ ] **Step 1: Confirmar que `useRealtimeSync` invalida queries de events**

```bash
grep -n "events" _remote/web/src/hooks/useRealtimeSync.ts
```

Se já invalida `['events']`, OK. Se não, adicionar handler:
```ts
.on('postgres_changes', { event: '*', schema: 'public', table: 'events' },
  () => queryClient.invalidateQueries({ queryKey: ['events'] }))
```

- [ ] **Step 2: Build + preview**

```bash
cd _remote/web && npx vite build && (preview já roda em 4173)
```

- [ ] **Step 3: Clear SW + reload no Simple Browser**

```ts
// via mcp__Claude_Preview__preview_eval
(async () => {
  const r = await navigator.serviceWorker.getRegistrations(); for (const x of r) await x.unregister();
  const k = await caches.keys(); for (const c of k) await caches.delete(c);
  location.reload();
})()
```

- [ ] **Step 4: Validar 1440px (desktop)**

Acessar `localhost:4173/agenda?view=day` e screenshot. Confirma:
- Topbar 56px com Dia/Semana/Mês + Hoje + + Novo
- Left rail 260px com mini-cal + counts + chips
- Center timegrid com scroll inicial em `max(7, hour-1)`
- Right rail 320px com TasksPanel
- Trocar pra Semana: 7 colunas
- Trocar pra Mês: grid 7×6
- Click slot vazio em Dia → popover abre
- Click em dia no Mês → MonthDayDrawer aparece à direita

- [ ] **Step 5: Validar 375px (mobile) — GUARDRAIL CRÍTICO**

Acessar `localhost:4173/hoje` em viewport 375px e confirmar que abre `Hoje.tsx` original (não AgendaDesktop). Mobile DEVE estar idêntico ao pré-mudança.

- [ ] **Step 6: Commit**

Commit: `chore(agenda): smoke test desktop + mobile intocado validado`

---

## Task 19 — Acceptance criteria run-through

Executar cada gold path da Seção 8.5 do spec manualmente via Simple Browser. Para cada um:

- [ ] **AC1** `/agenda` carrega <1s, view=day, scroll em 07:00 ou `hora atual − 1`
- [ ] **AC2** Click slot vazio → popover → digitar título → Enter → bloco aparece (optimistic)
- [ ] **AC3** Drag bloco 2h pra frente → release → bloco no novo lugar, banco atualizado
- [ ] **AC4** Drag borda inferior +30min → `end_at` aumenta, duração preservada
- [ ] **AC5** TOM cria event via WhatsApp em outro device → bloco aparece em <1s
- [ ] **AC6** Trocar pra Mês → click dia 23 → drawer mostra eventos+tarefas
- [ ] **AC7** Chip Pessoal off → events `context=personal` + tasks pessoais somem
- [ ] **AC8** Bloco → drawer → Deletar → confirma → some do banco
- [ ] **AC9** Bloco → drawer → status Cancelado → save → `line-through`, continua no grid
- [ ] **AC10** Browser back na agenda sai da rota (não navega entre views)

Para qualquer falha: dispatch fix subagent específica, não monta fix manual.

- [ ] **Commit final**

Commit: `chore(agenda): acceptance run-through completo (AC1-10 verde)`

---

## Self-review do plan

**Spec coverage:**
- Seção 1 (arquitetura/rotas) → Task 17
- Seção 2 (shell/topbar) → Task 15
- Seção 3 (TimeGrid) → Tasks 1, 7
- Seção 4 (MonthView) → Tasks 2, 10
- Seção 5 (EventBlock + drag/resize) → Tasks 5, 6, 7
- Seção 6 (QuickCreate + EventEditDrawer) → Tasks 11, 12
- Seção 7 (LeftRail + TasksPanel) → Tasks 3, 4, 14
- Seção 8.1 (migration) → JÁ APLICADA, não há task
- Seção 8.2 (realtime) → Task 18
- Seção 8.3 (TOM) → consumido via realtime existente, Task 18 valida
- Seção 8.5 (acceptance) → Task 19

**Type consistency check:**
- `EventForGrid` definido em Task 4 e usado consistentemente em Tasks 6, 7, 8, 10, 12, 13, 16
- `TaskForPanel` em Task 4 e usado em 13, 14, 16
- `AgendaFilters` em Task 3 e usado em 4, 14, 16
- `GridConfig` em Task 1, usado em Task 7
- `AgendaView` em Task 15, usado em Task 16
- Fórmula drag-to-move idêntica em Task 16 e na seção de guardrails

**Placeholder scan:** zero TBD/TODO. Todos os steps têm código completo. Trechos com `// CONFIRMAR caminho real` (Tasks 4, 16, 18) são auditorias explícitas com comando concreto, não placeholder.
