# Agenda Desktop Redesign v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o `TasksPanel` + `AgendaLeftRail` atuais por um `AgendaDesktopLeftPanel` 400px que espelha o modelo mental do mobile (Hábitos + Compromissos + Tarefas com gradação de urgência), promover tabs de contexto pro topbar, adicionar all-day strip ao TimeGrid, e remover mini-cal + coluna direita.

**Architecture:** Decomposição em primitivas (CollapsibleSection, HabitWeekHeatmap, AllDayStrip) consumidas por 3 sub-views (Day/Week/Month) coordenadas por um container `AgendaDesktopLeftPanel`. Reuso máximo de componentes mobile já existentes (EventRow, TaskRow, StatCard, AdaptiveSheet, EditTaskSheet, EditEventSheet) sem modificá-los. Sync de filtros via extensão do `useAgendaFilters` com campo `currentContext` opcional, mantendo compatibilidade total com mobile.

**Tech Stack:** React 18 · TypeScript · Vite · Tailwind 3.4 · TanStack Query 5 · @dnd-kit/core · Supabase · vite-pwa. Sem framework de teste; validação via `tsc --noEmit`, `vite build`, e Claude Preview (`preview_eval` + `preview_screenshot` em `localhost:4173`).

**Spec:** `docs/superpowers/specs/2026-05-24-agenda-desktop-redesign-v2.md`
**Mockups:** `.superpowers/brainstorm/31029-1779626907/content/layout-b-refined.html` (Dia) e `layout-week-month.html` (Semana/Mês)

---

## File Structure (decisão de decomposição)

**Novos arquivos:**

```
_remote/web/src/screens/agenda/leftPanel/
├── AgendaDesktopLeftPanel.tsx          (router: Day | Week | Month)
├── DayPanel.tsx                        (estado Day)
├── WeekPanel.tsx                       (estado Week)
├── MonthPanel.tsx                      (estado Month, com sub-estado dia selecionado)
├── CollapsibleSection.tsx              (primitive: chevron + título + count + children)
└── HabitWeekHeatmap.tsx                (primitive: linha hábito × 7 quadrados)

_remote/web/src/screens/agenda/components/
└── AllDayStrip.tsx                     (strip acima do TimeGrid)
```

**Modificados:**

```
_remote/web/src/screens/agenda/hooks/useAgendaFilters.ts   (adicionar currentContext)
_remote/web/src/screens/agenda/AgendaShell.tsx             (adicionar tabs contexto no topbar)
_remote/web/src/screens/agenda/AgendaDesktop.tsx           (trocar TasksPanel+AgendaLeftRail por AgendaDesktopLeftPanel; remover MonthDayDrawer)
_remote/web/src/screens/agenda/components/TimeGrid.tsx     (renderizar AllDayStrip no topo)
```

**Removidos:**

```
_remote/web/src/screens/agenda/TasksPanel.tsx       (substituído)
_remote/web/src/screens/agenda/AgendaLeftRail.tsx   (substituído)
```

**Não tocados (guardrail mobile):**
- Tudo em `_remote/web/src/components/*.tsx` (EventRow, TaskRow, StatCard, Sheets)
- `_remote/web/src/screens/Hoje.tsx`, `Semana.tsx`
- `_remote/web/src/screens/agenda/components/MonthDayDrawer.tsx` (fica órfão; será deletado em T13)

---

## Convenções deste plano

- **Caminho base:** todos os paths são relativos a `D:\la-organizer\`. A pasta de código é `_remote/web/`.
- **Build check:** `cd _remote/web && npx tsc --noEmit` deve passar sem erros após cada task.
- **Visual check:** quando uma task afeta UI, validar via `mcp__Claude_Preview__preview_eval` + `mcp__Claude_Preview__preview_screenshot` na URL `http://localhost:4173/agenda?view=day` (e `?view=week`, `?view=month` quando aplicável).
- **Commits:** sem `--no-verify`. Auto-deploy hook do `_remote/` cuida do push.
- **Sem framework de teste:** o "teste" é compilar + abrir no browser. Quando uma task tiver lógica pura (ex: agrupar tarefas por urgência), o plano pede uma função extraída pra arquivo separado com smoke test inline (script Node ad-hoc).

---

## Task 1: Extender `useAgendaFilters` com `currentContext`

**Files:**
- Modify: `_remote/web/src/screens/agenda/hooks/useAgendaFilters.ts`

**Por quê primeiro:** as tabs de contexto e o painel novo dependem desse estado. Mudança backward-compatible — mobile continua usando flags antigas, desktop passa a usar `currentContext`.

- [ ] **Step 1: Ler o arquivo atual pra entender API existente**

```bash
cat _remote/web/src/screens/agenda/hooks/useAgendaFilters.ts
```

- [ ] **Step 2: Adicionar campo `currentContext` + setter**

Editar o hook pra acrescentar (sem remover nada existente):

```typescript
// Tipo a expor (junto com o que já existe)
export type AgendaContext = 'work' | 'personal' | 'delegated';

// Dentro do hook, adicionar:
const [currentContext, setCurrentContext] = useState<AgendaContext>(() => {
  try {
    const saved = localStorage.getItem('agenda.desktop.currentContext');
    if (saved === 'work' || saved === 'personal' || saved === 'delegated') return saved;
  } catch { /* ignore */ }
  return 'work';
});

const changeContext = (ctx: AgendaContext) => {
  setCurrentContext(ctx);
  try { localStorage.setItem('agenda.desktop.currentContext', ctx); } catch { /* ignore */ }
};

// No return, adicionar `currentContext` e `changeContext` junto com os campos existentes.
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd _remote/web && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 4: Verificar mobile não quebrou**

Abrir `http://localhost:4173/hoje` e `http://localhost:4173/semana` via `preview_screenshot`. Telas devem renderizar idênticas a antes.

- [ ] **Step 5: Commit**

```bash
cd _remote/web && git add src/screens/agenda/hooks/useAgendaFilters.ts && git commit -m "feat(agenda): adiciona currentContext em useAgendaFilters

Estado persistido em localStorage agenda.desktop.currentContext.
Backward compatible — flags antigas mantidas, mobile inalterado."
```

---

## Task 2: Criar `CollapsibleSection` primitive

**Files:**
- Create: `_remote/web/src/screens/agenda/leftPanel/CollapsibleSection.tsx`

- [ ] **Step 1: Criar diretório e arquivo**

```bash
mkdir -p _remote/web/src/screens/agenda/leftPanel
```

- [ ] **Step 2: Implementar componente**

```typescript
// _remote/web/src/screens/agenda/leftPanel/CollapsibleSection.tsx
import { useState, useEffect, type ReactNode } from 'react';

interface Props {
  /** Identificador único pra persistir estado em localStorage. */
  storageKey: string;
  /** Título exibido em uppercase pequeno. */
  title: string;
  /** Conteúdo opcional do lado direito do header (count, streak médio, etc). */
  meta?: ReactNode;
  /** Estado inicial quando não há preferência salva. Default: aberto. */
  defaultOpen?: boolean;
  children: ReactNode;
}

const LS_PREFIX = 'agenda.desktop.leftPanel.section.';

export function CollapsibleSection({ storageKey, title, meta, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(LS_PREFIX + storageKey);
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch { /* ignore */ }
    return defaultOpen;
  });

  useEffect(() => {
    try { localStorage.setItem(LS_PREFIX + storageKey, open ? '1' : '0'); } catch { /* ignore */ }
  }, [storageKey, open]);

  return (
    <section className="mb-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-1.5 py-1.5 text-[10px] uppercase tracking-wider text-fg-muted font-semibold hover:text-fg focus-ring rounded"
      >
        <span className="text-[9px] text-fg-muted/70">{open ? '▼' : '▶'}</span>
        <span>{title}</span>
        {meta != null && <span className="ml-auto text-[10px] text-fg-muted/70 font-normal">{meta}</span>}
      </button>
      {open && <div className="space-y-0.5">{children}</div>}
    </section>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
cd _remote/web && git add src/screens/agenda/leftPanel/CollapsibleSection.tsx && git commit -m "feat(agenda): primitive CollapsibleSection

Section colapsável com persistência localStorage. Reuso em DayPanel/WeekPanel/MonthPanel."
```

---

## Task 3: Criar `HabitWeekHeatmap` primitive

**Files:**
- Create: `_remote/web/src/screens/agenda/leftPanel/HabitWeekHeatmap.tsx`

Antes de implementar, o subagent precisa LER `_remote/web/src/components/HabitRow.tsx` (se existir) e/ou `Hoje.tsx` pra entender o tipo `Habit` e a função que marca feito.

- [ ] **Step 1: Conferir tipo Habit**

```bash
grep -rn "interface Habit\|type Habit" _remote/web/src/ | head -5
```

- [ ] **Step 2: Implementar componente**

Assume tipo: `{ id: string; name: string; current_streak?: number }` e dados de adesão como `boolean[]` de tamanho 7 (Dom→Sáb).

```typescript
// _remote/web/src/screens/agenda/leftPanel/HabitWeekHeatmap.tsx
interface Props {
  habitName: string;
  /** 7 valores Dom→Sáb indicando se o hábito foi marcado naquele dia. */
  week: boolean[];
  /** Índice 0-6 do dia "hoje" (pra destacar). null se a semana atual não contém hoje. */
  todayIndex: number | null;
  streak?: number;
}

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;

export function HabitWeekHeatmap({ habitName, week, todayIndex, streak }: Props) {
  return (
    <div className="flex items-center gap-2 py-1 text-[11px]">
      <span className="flex-1 text-fg truncate">{habitName}</span>
      <div className="flex gap-[3px]">
        {week.map((done, i) => {
          const isToday = i === todayIndex;
          const base = 'w-[14px] h-[14px] rounded-[3px] grid place-items-center text-[8px] font-medium';
          const fill = done ? 'bg-tom text-black' : 'bg-bg-elevated text-fg-muted/50';
          const ring = isToday ? ' outline outline-[1.5px] outline-tom outline-offset-[1px]' : '';
          return (
            <span key={i} className={`${base} ${fill}${ring}`}>{DAY_LABELS[i]}</span>
          );
        })}
      </div>
      {streak != null && streak > 0 && (
        <span className="text-[11px] text-warning font-semibold tabular-nums">🔥 {streak}</span>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
cd _remote/web && git add src/screens/agenda/leftPanel/HabitWeekHeatmap.tsx && git commit -m "feat(agenda): primitive HabitWeekHeatmap

Linha hábito × 7 quadrados D-S-T-Q-Q-S-S com destaque no dia atual."
```

---

## Task 4: Criar `AllDayStrip` component

**Files:**
- Create: `_remote/web/src/screens/agenda/components/AllDayStrip.tsx`

- [ ] **Step 1: Conferir tipo Task pra extrair os campos certos**

```bash
grep -n "interface Task\|type Task " _remote/web/src/types/*.ts _remote/web/src/lib/*.ts 2>/dev/null | head -5
```

- [ ] **Step 2: Implementar componente**

```typescript
// _remote/web/src/screens/agenda/components/AllDayStrip.tsx
import type { TaskForPanel } from '../hooks/useAgendaTasks';

interface Props {
  /** Tarefas com due_date no período visível, SEM remind_at (sem hora). */
  tasks: TaskForPanel[];
  onTaskClick: (t: TaskForPanel) => void;
}

const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
};

export function AllDayStrip({ tasks, onTaskClick }: Props) {
  if (tasks.length === 0) return null;

  return (
    <div className="border-b border-dashed border-border px-3 py-2 bg-bg-app">
      <div className="text-[9px] uppercase tracking-wider text-fg-muted font-semibold mb-1.5">
        Dia todo · vencimentos sem hora
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tasks.map(t => {
          const q = t.eisenhower_quadrant != null ? String(t.eisenhower_quadrant) : null;
          const dot = q && QUADRANT_DOT[q];
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onTaskClick(t)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] border-l-[3px] bg-bg-elevated border-fg-muted hover:bg-bg-elevated2 focus-ring text-fg"
            >
              {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
              <span className="truncate max-w-[160px]">{t.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

Expected: zero erros. Se `TaskForPanel` não tem `eisenhower_quadrant`, adicionar no tipo em `hooks/useAgendaTasks.ts` (campo `eisenhower_quadrant?: number | null`).

- [ ] **Step 4: Commit**

```bash
cd _remote/web && git add src/screens/agenda/components/AllDayStrip.tsx && git commit -m "feat(agenda): AllDayStrip pra tarefas com due_date sem hora"
```

---

## Task 5: Criar `DayPanel` (estado Day do painel esquerdo)

**Files:**
- Create: `_remote/web/src/screens/agenda/leftPanel/DayPanel.tsx`

**Pré-requisito:** subagent deve LER `_remote/web/src/screens/Hoje.tsx` e `_remote/web/src/components/TaskRow.tsx`, `EventRow.tsx`, `StatCard.tsx` pra usar EXATAMENTE a API existente.

- [ ] **Step 1: Implementar componente**

```typescript
// _remote/web/src/screens/agenda/leftPanel/DayPanel.tsx
import { useMemo } from 'react';
import { StatCard } from '../../../components/StatCard';
import { EventRow } from '../../../components/EventRow';
import { TaskRow } from '../../../components/TaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface Habit {
  id: string;
  name: string;
  done_today: boolean;
  current_streak: number;
}

interface Props {
  currentDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  habits: Habit[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onToggleHabit: (h: Habit) => void;
}

function classifyOverdue(dueIso: string, todayIso: string): 'plus4' | 'd2_3' | 'd1' | 'today' | 'future' {
  if (dueIso > todayIso) return 'future';
  if (dueIso === todayIso) return 'today';
  const due = new Date(dueIso + 'T00:00:00Z');
  const today = new Date(todayIso + 'T00:00:00Z');
  const diff = Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
  if (diff >= 4) return 'plus4';
  if (diff >= 2) return 'd2_3';
  return 'd1';
}

export function DayPanel(p: Props) {
  const todayIso = p.currentDate.toISOString().slice(0, 10);

  // Filtrar tarefas do dia + atrasadas
  const inWindow = useMemo(() => p.tasks.filter(t => {
    const d = t.scheduled_date ?? t.due_date;
    if (!d) return false;
    return d.slice(0, 10) <= todayIso;
  }), [p.tasks, todayIso]);

  const pending = inWindow.filter(t => t.status !== 'done');
  const overdue = pending.filter(t => t.due_date && t.due_date.slice(0, 10) < todayIso);
  const todayTasks = pending.filter(t => (t.scheduled_date ?? '').slice(0, 10) === todayIso && !(t.due_date && t.due_date.slice(0, 10) < todayIso));
  const done = inWindow.filter(t => t.status === 'done');

  const groups = useMemo(() => {
    const g = { plus4: [] as TaskForPanel[], d2_3: [] as TaskForPanel[], d1: [] as TaskForPanel[] };
    for (const t of overdue) {
      if (!t.due_date) continue;
      const c = classifyOverdue(t.due_date.slice(0, 10), todayIso);
      if (c === 'plus4') g.plus4.push(t);
      else if (c === 'd2_3') g.d2_3.push(t);
      else if (c === 'd1') g.d1.push(t);
    }
    return g;
  }, [overdue, todayIso]);

  const dayEvents = useMemo(() =>
    p.events
      .filter(e => e.start_at.slice(0, 10) === todayIso)
      .sort((a, b) => a.start_at.localeCompare(b.start_at)),
  [p.events, todayIso]);

  const habitsDoneCount = p.habits.filter(h => h.done_today).length;
  const avgStreak = p.habits.length > 0
    ? Math.round(p.habits.reduce((s, h) => s + (h.current_streak || 0), 0) / p.habits.length)
    : 0;

  return (
    <div className="flex flex-col h-full">
      <header className="px-3 pt-3 pb-2 border-b border-border">
        <div className="text-[14px] font-semibold text-fg">Meu Dia</div>
        <div className="text-[11px] text-fg-muted capitalize">
          {p.currentDate.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {/* STATS */}
        <div className="flex gap-2 mb-3">
          <StatCard label="Pra hoje" value={todayTasks.length} tone="neutral" />
          <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length > 0 ? 'danger' : 'neutral'} />
          <StatCard label="Feitas" value={done.length} tone={done.length > 0 ? 'success' : 'neutral'} />
        </div>

        {/* HÁBITOS */}
        {p.habits.length > 0 && (
          <CollapsibleSection
            storageKey="day.habits"
            title="🔥 Hábitos hoje"
            meta={<>{habitsDoneCount}/{p.habits.length} · 🔥 {avgStreak}d</>}
            defaultOpen
          >
            {p.habits.map(h => (
              <button
                key={h.id}
                type="button"
                onClick={() => p.onToggleHabit(h)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-elevated focus-ring text-left"
              >
                <span className={`w-[14px] h-[14px] rounded-[3px] border-[1.5px] ${h.done_today ? 'bg-tom border-tom' : 'border-fg-muted/50'} grid place-items-center`}>
                  {h.done_today && <span className="text-[10px] text-black font-bold leading-none">✓</span>}
                </span>
                <span className={`flex-1 text-[12px] ${h.done_today ? 'line-through text-fg-muted' : 'text-fg'}`}>{h.name}</span>
                {h.current_streak > 0 && <span className="text-[11px] text-warning font-semibold tabular-nums">🔥 {h.current_streak}</span>}
              </button>
            ))}
          </CollapsibleSection>
        )}

        {/* COMPROMISSOS */}
        <CollapsibleSection
          storageKey="day.events"
          title="🕒 Compromissos"
          meta={dayEvents.length}
          defaultOpen
        >
          {dayEvents.length === 0
            ? <div className="px-2 py-2 text-[11px] text-fg-muted italic">Sem compromissos hoje</div>
            : dayEvents.map(e => (
              <EventRow key={e.id} event={e} onClick={() => p.onEventClick(e)} />
            ))
          }
        </CollapsibleSection>

        {/* TAREFAS */}
        <CollapsibleSection
          storageKey="day.tasks"
          title="📋 Tarefas"
          meta={overdue.length + todayTasks.length}
          defaultOpen
        >
          {groups.plus4.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-danger font-semibold py-1 px-1">🚨 Parou há 4+ dias · {groups.plus4.length}</div>
              {groups.plus4.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
            </>
          )}
          {groups.d2_3.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-warning font-semibold py-1 px-1">🟠 Atrasou 2-3 dias · {groups.d2_3.length}</div>
              {groups.d2_3.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
            </>
          )}
          {groups.d1.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-warning font-semibold py-1 px-1" style={{ color: '#fb923c' }}>🔴 Atrasou ontem · {groups.d1.length}</div>
              {groups.d1.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
            </>
          )}
          {todayTasks.length > 0 && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold py-1 px-1">⭐ Pra hoje · {todayTasks.length}</div>
              {todayTasks.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
            </>
          )}
          {(groups.plus4.length + groups.d2_3.length + groups.d1.length + todayTasks.length) === 0 && (
            <div className="px-2 py-2 text-[11px] text-fg-muted italic">Sem tarefas pra hoje</div>
          )}
        </CollapsibleSection>

        {done.length > 0 && (
          <CollapsibleSection storageKey="day.done" title="▶ Concluídas" meta={done.length} defaultOpen={false}>
            {done.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}
```

> **Nota ao implementador:** `as never` em `task={t as never}` é placeholder se houver incompatibilidade entre `TaskForPanel` e o tipo esperado por `TaskRow`. Conferir e adaptar pra `task={t as Task}` ou similar, baseado no que `TaskRow` aceita. Se `StatCard` não suportar tone `'success'`/`'danger'`, conferir os tones disponíveis no arquivo e ajustar.

- [ ] **Step 2: Resolver type mismatches**

```bash
cd _remote/web && npx tsc --noEmit 2>&1 | grep -A2 "DayPanel" | head -30
```

Corrigir `as never` casts pra tipos corretos baseado nas assinaturas reais de `TaskRow` e `StatCard`.

- [ ] **Step 3: TypeScript check passa**

```bash
cd _remote/web && npx tsc --noEmit
```

Expected: zero erros.

- [ ] **Step 4: Commit**

```bash
cd _remote/web && git add src/screens/agenda/leftPanel/DayPanel.tsx && git commit -m "feat(agenda): DayPanel — espelho mobile do Hoje no desktop

Stats + Hábitos colapsável + Compromissos colapsável + Tarefas com 4 subgrupos
de urgência (4+ dias, 2-3, ontem, hoje) + Concluídas colapsada por padrão.
Reusa StatCard, EventRow, TaskRow do mobile."
```

---

## Task 6: Criar `WeekPanel`

**Files:**
- Create: `_remote/web/src/screens/agenda/leftPanel/WeekPanel.tsx`

- [ ] **Step 1: Implementar componente**

```typescript
// _remote/web/src/screens/agenda/leftPanel/WeekPanel.tsx
import { useMemo } from 'react';
import { StatCard } from '../../../components/StatCard';
import { EventRow } from '../../../components/EventRow';
import { TaskRow } from '../../../components/TaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import { HabitWeekHeatmap } from './HabitWeekHeatmap';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface HabitWithWeek {
  id: string;
  name: string;
  /** boolean[7], índice 0 = Dom, 6 = Sáb. */
  week: boolean[];
  current_streak: number;
}

interface Props {
  weekStart: Date;
  currentDate: Date;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  habits: HabitWithWeek[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onPickDay: (d: Date) => void;
}

const DAY_NAMES = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'] as const;

export function WeekPanel(p: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => {
    const d = new Date(p.weekStart);
    d.setDate(p.weekStart.getDate() + i);
    return d;
  }), [p.weekStart]);

  const weekStartIso = p.weekStart.toISOString().slice(0, 10);
  const weekEndIso = days[6].toISOString().slice(0, 10);

  const inRange = (iso: string) => iso >= weekStartIso && iso <= weekEndIso;

  const tasksInWeek = p.tasks.filter(t => {
    const d = (t.scheduled_date ?? t.due_date ?? '').slice(0, 10);
    return d && inRange(d);
  });
  const eventsInWeek = p.events.filter(e => inRange(e.start_at.slice(0, 10)));

  const overdue = tasksInWeek.filter(t => t.due_date && t.due_date.slice(0, 10) < todayIso && t.status !== 'done');
  const done = tasksInWeek.filter(t => t.status === 'done');
  const totalCount = tasksInWeek.length + eventsInWeek.length;

  const todayIndex = days.findIndex(d => d.toISOString().slice(0, 10) === todayIso);
  const todayIdx = todayIndex === -1 ? null : todayIndex;

  return (
    <div className="flex flex-col h-full">
      <header className="px-3 pt-3 pb-2 border-b border-border">
        <div className="text-[14px] font-semibold text-fg">Esta semana</div>
        <div className="text-[11px] text-fg-muted">
          {p.weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a {days[6].toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · 7 dias
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        <div className="flex gap-2 mb-3">
          <StatCard label="Total semana" value={totalCount} tone="neutral" />
          <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length > 0 ? 'danger' : 'neutral'} />
          <StatCard label="Feitas" value={done.length} tone={done.length > 0 ? 'success' : 'neutral'} />
        </div>

        {p.habits.length > 0 && (
          <CollapsibleSection
            storageKey="week.habits"
            title="🔥 Hábitos da semana"
            meta={<>{p.habits.reduce((s, h) => s + h.week.filter(Boolean).length, 0)}/{p.habits.length * 7}</>}
            defaultOpen
          >
            {p.habits.map(h => (
              <HabitWeekHeatmap key={h.id} habitName={h.name} week={h.week} todayIndex={todayIdx} streak={h.current_streak} />
            ))}
          </CollapsibleSection>
        )}

        <CollapsibleSection
          storageKey="week.byday"
          title="📆 Por dia"
          meta={`${totalCount} itens`}
          defaultOpen
        >
          {days.map((d, idx) => {
            const iso = d.toISOString().slice(0, 10);
            const dayEvents = eventsInWeek.filter(e => e.start_at.slice(0, 10) === iso).sort((a, b) => a.start_at.localeCompare(b.start_at));
            const dayTasks = tasksInWeek.filter(t => (t.scheduled_date ?? t.due_date ?? '').slice(0, 10) === iso);
            const isToday = iso === todayIso;
            const total = dayEvents.length + dayTasks.length;

            return (
              <div key={iso} className={idx > 0 ? 'border-t border-border/40 mt-1 pt-1' : ''}>
                <button
                  type="button"
                  onClick={() => p.onPickDay(d)}
                  className={`w-full flex items-baseline gap-2 px-1 py-1.5 hover:bg-bg-elevated rounded focus-ring text-left ${isToday ? 'text-tom' : 'text-fg'}`}
                >
                  <span className={`text-[10px] uppercase font-semibold tracking-wider ${isToday ? 'text-tom' : 'text-fg-muted'}`}>{DAY_NAMES[idx]}</span>
                  <span className={`text-[14px] font-semibold tabular-nums ${isToday ? 'text-tom' : 'text-fg'}`}>{d.getDate()}</span>
                  <span className="ml-auto text-[9px] text-fg-muted">
                    {isToday && 'hoje · '}{total} {total === 1 ? 'item' : 'itens'}
                  </span>
                </button>
                {dayEvents.map(e => <EventRow key={e.id} event={e} onClick={() => p.onEventClick(e)} />)}
                {dayTasks.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
              </div>
            );
          })}
        </CollapsibleSection>
      </div>
    </div>
  );
}
```

> **Nota:** mesma situação do DayPanel — `as never` é placeholder pra alinhar tipos.

- [ ] **Step 2: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd _remote/web && git add src/screens/agenda/leftPanel/WeekPanel.tsx && git commit -m "feat(agenda): WeekPanel — heatmap semanal de hábitos + lista por dia

Stats da semana, hábitos em heatmap horizontal D-S-T-Q-Q-S-S com hoje
em destaque, compromissos+tarefas agrupados por dia. Click no header de dia
muda currentDate (pickDay)."
```

---

## Task 7: Criar `MonthPanel`

**Files:**
- Create: `_remote/web/src/screens/agenda/leftPanel/MonthPanel.tsx`

- [ ] **Step 1: Implementar componente com 2 sub-estados**

```typescript
// _remote/web/src/screens/agenda/leftPanel/MonthPanel.tsx
import { useMemo } from 'react';
import { StatCard } from '../../../components/StatCard';
import { EventRow } from '../../../components/EventRow';
import { TaskRow } from '../../../components/TaskRow';
import { CollapsibleSection } from './CollapsibleSection';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface Props {
  monthDate: Date;
  selectedDay: Date | null;
  tasks: TaskForPanel[];
  events: EventForGrid[];
  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onClearSelectedDay: () => void;
  onOpenDayView: (d: Date) => void;
}

function isoOf(d: Date) { return d.toISOString().slice(0, 10); }

function daysSince(dueIso: string, todayIso: string): number {
  const due = new Date(dueIso + 'T00:00:00Z');
  const today = new Date(todayIso + 'T00:00:00Z');
  return Math.round((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}

export function MonthPanel(p: Props) {
  const todayIso = new Date().toISOString().slice(0, 10);

  // ===== MODO: DIA SELECIONADO =====
  if (p.selectedDay) {
    const iso = isoOf(p.selectedDay);
    const dayEvents = p.events.filter(e => e.start_at.slice(0, 10) === iso).sort((a, b) => a.start_at.localeCompare(b.start_at));
    const dayTasks = p.tasks.filter(t => (t.scheduled_date ?? t.due_date ?? '').slice(0, 10) === iso);
    const pending = dayTasks.filter(t => t.status !== 'done');
    const overdue = dayTasks.filter(t => t.due_date && t.due_date.slice(0, 10) < todayIso && t.status !== 'done');
    const done = dayTasks.filter(t => t.status === 'done');

    return (
      <div className="flex flex-col h-full">
        <header className="px-3 pt-3 pb-2 border-b border-border flex items-start justify-between">
          <div>
            <div className="text-[14px] font-semibold text-fg capitalize">
              {p.selectedDay.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}
            </div>
            <div className="text-[11px] text-fg-muted">dia selecionado</div>
          </div>
          <button onClick={p.onClearSelectedDay} className="text-[11px] text-tom hover:underline focus-ring rounded px-1">← voltar</button>
        </header>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          <div className="flex gap-2 mb-3">
            <StatCard label={`Pra ${p.selectedDay.getDate()}`} value={pending.length} tone="neutral" />
            <StatCard label="Atrasadas" value={overdue.length} tone={overdue.length > 0 ? 'danger' : 'neutral'} />
            <StatCard label="Feitas" value={done.length} tone={done.length > 0 ? 'success' : 'neutral'} />
          </div>

          <CollapsibleSection storageKey="month.day.events" title="🕒 Compromissos" meta={dayEvents.length} defaultOpen>
            {dayEvents.length === 0
              ? <div className="px-2 py-2 text-[11px] text-fg-muted italic">Sem compromissos</div>
              : dayEvents.map(e => <EventRow key={e.id} event={e} onClick={() => p.onEventClick(e)} />)
            }
          </CollapsibleSection>

          <CollapsibleSection storageKey="month.day.tasks" title="📋 Tarefas" meta={dayTasks.length} defaultOpen>
            {dayTasks.length === 0
              ? <div className="px-2 py-2 text-[11px] text-fg-muted italic">Sem tarefas</div>
              : dayTasks.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)
            }
          </CollapsibleSection>

          <button
            type="button"
            onClick={() => p.onOpenDayView(p.selectedDay!)}
            className="w-full mt-3 px-3 py-2 rounded-md bg-bg-elevated border border-border text-[12px] text-tom hover:bg-bg-elevated2 focus-ring"
          >
            Abrir dia {p.selectedDay.getDate()} em Day view →
          </button>
        </div>
      </div>
    );
  }

  // ===== MODO: SEM DIA SELECIONADO =====
  const monthStart = new Date(p.monthDate.getFullYear(), p.monthDate.getMonth(), 1);
  const monthEnd = new Date(p.monthDate.getFullYear(), p.monthDate.getMonth() + 1, 0);
  const startIso = isoOf(monthStart);
  const endIso = isoOf(monthEnd);
  const inMonth = (iso: string) => iso >= startIso && iso <= endIso;

  const monthTasks = p.tasks.filter(t => {
    const d = (t.scheduled_date ?? t.due_date ?? '').slice(0, 10);
    return d && inMonth(d);
  });
  const monthEvents = p.events.filter(e => inMonth(e.start_at.slice(0, 10)));

  const overdueAll = monthTasks.filter(t => t.due_date && t.due_date.slice(0, 10) < todayIso && t.status !== 'done');
  const done = monthTasks.filter(t => t.status === 'done');
  const total = monthTasks.length + monthEvents.length;

  const groups = useMemo(() => {
    const g = { plus15: [] as TaskForPanel[], d5_14: [] as TaskForPanel[] };
    for (const t of overdueAll) {
      if (!t.due_date) continue;
      const diff = daysSince(t.due_date.slice(0, 10), todayIso);
      if (diff >= 15) g.plus15.push(t);
      else if (diff >= 5) g.d5_14.push(t);
    }
    return g;
  }, [overdueAll, todayIso]);

  return (
    <div className="flex flex-col h-full">
      <header className="px-3 pt-3 pb-2 border-b border-border">
        <div className="text-[14px] font-semibold text-fg capitalize">
          {p.monthDate.toLocaleDateString('pt-BR', { month: 'long' })} · resumo
        </div>
        <div className="text-[11px] text-fg-muted">selecione um dia pra ver detalhe</div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        <div className="flex gap-2 mb-3">
          <StatCard label="Total mês" value={total} tone="neutral" />
          <StatCard label="Atrasadas" value={overdueAll.length} tone={overdueAll.length > 0 ? 'danger' : 'neutral'} />
          <StatCard label="Feitas" value={done.length} tone={done.length > 0 ? 'success' : 'neutral'} />
        </div>

        {overdueAll.length > 0 && (
          <CollapsibleSection storageKey="month.topoverdue" title="🚨 Top atrasos" meta={overdueAll.length} defaultOpen>
            {groups.plus15.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-danger font-semibold py-1 px-1">Parou 15+ dias · {groups.plus15.length}</div>
                {groups.plus15.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
              </>
            )}
            {groups.d5_14.length > 0 && (
              <>
                <div className="text-[10px] uppercase tracking-wider text-warning font-semibold py-1 px-1">Parou 5-14 dias · {groups.d5_14.length}</div>
                {groups.d5_14.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
              </>
            )}
          </CollapsibleSection>
        )}

        <CollapsibleSection storageKey="month.tasks" title="📋 Tarefas do mês" meta={monthTasks.length} defaultOpen={false}>
          {monthTasks.map(t => <TaskRow key={t.id} task={t as never} onToggle={() => p.onToggleTaskDone(t)} onEdit={() => p.onTaskClick(t)} />)}
        </CollapsibleSection>

        <CollapsibleSection storageKey="month.events" title="🕒 Compromissos do mês" meta={monthEvents.length} defaultOpen={false}>
          {monthEvents.map(e => <EventRow key={e.id} event={e} onClick={() => p.onEventClick(e)} />)}
        </CollapsibleSection>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd _remote/web && git add src/screens/agenda/leftPanel/MonthPanel.tsx && git commit -m "feat(agenda): MonthPanel — top atrasos quando sem dia, drawer dia quando selecionado

Sem dia selecionado: KPIs + Top atrasos (15+ / 5-14 dias) + seções colapsadas.
Com dia selecionado: vira drawer (compromissos+tarefas+CTA Open Day View).
Substitui MonthDayDrawer."
```

---

## Task 8: Criar container `AgendaDesktopLeftPanel`

**Files:**
- Create: `_remote/web/src/screens/agenda/leftPanel/AgendaDesktopLeftPanel.tsx`

- [ ] **Step 1: Implementar router**

```typescript
// _remote/web/src/screens/agenda/leftPanel/AgendaDesktopLeftPanel.tsx
import { DayPanel } from './DayPanel';
import { WeekPanel } from './WeekPanel';
import { MonthPanel } from './MonthPanel';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import type { EventForGrid } from '../hooks/useAgendaEvents';

interface Habit { id: string; name: string; done_today: boolean; current_streak: number; }
interface HabitWithWeek { id: string; name: string; week: boolean[]; current_streak: number; }

interface Props {
  view: 'day' | 'week' | 'month';
  currentDate: Date;
  weekStart: Date;
  monthDate: Date;
  selectedMonthDay: Date | null;

  tasks: TaskForPanel[];
  events: EventForGrid[];
  habitsDay: Habit[];
  habitsWeek: HabitWithWeek[];

  onTaskClick: (t: TaskForPanel) => void;
  onToggleTaskDone: (t: TaskForPanel) => void;
  onEventClick: (e: EventForGrid) => void;
  onToggleHabit: (h: Habit) => void;

  onPickDay: (d: Date) => void;            // Week: trocar pra Day view
  onClearSelectedDay: () => void;          // Month: limpar seleção
  onOpenDayView: (d: Date) => void;        // Month: trocar pra Day view
}

export function AgendaDesktopLeftPanel(p: Props) {
  return (
    <aside className="w-[400px] shrink-0 border-r border-border bg-bg-surface flex flex-col min-h-0 max-md:hidden">
      {p.view === 'day' && (
        <DayPanel
          currentDate={p.currentDate}
          tasks={p.tasks}
          events={p.events}
          habits={p.habitsDay}
          onTaskClick={p.onTaskClick}
          onToggleTaskDone={p.onToggleTaskDone}
          onEventClick={p.onEventClick}
          onToggleHabit={p.onToggleHabit}
        />
      )}
      {p.view === 'week' && (
        <WeekPanel
          weekStart={p.weekStart}
          currentDate={p.currentDate}
          tasks={p.tasks}
          events={p.events}
          habits={p.habitsWeek}
          onTaskClick={p.onTaskClick}
          onToggleTaskDone={p.onToggleTaskDone}
          onEventClick={p.onEventClick}
          onPickDay={p.onPickDay}
        />
      )}
      {p.view === 'month' && (
        <MonthPanel
          monthDate={p.monthDate}
          selectedDay={p.selectedMonthDay}
          tasks={p.tasks}
          events={p.events}
          onTaskClick={p.onTaskClick}
          onToggleTaskDone={p.onToggleTaskDone}
          onEventClick={p.onEventClick}
          onClearSelectedDay={p.onClearSelectedDay}
          onOpenDayView={p.onOpenDayView}
        />
      )}
    </aside>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd _remote/web && git add src/screens/agenda/leftPanel/AgendaDesktopLeftPanel.tsx && git commit -m "feat(agenda): container AgendaDesktopLeftPanel roteia Day/Week/Month"
```

---

## Task 9: Adicionar tabs de contexto no topbar (AgendaShell)

**Files:**
- Modify: `_remote/web/src/screens/agenda/AgendaShell.tsx`

- [ ] **Step 1: Adicionar props e renderizar tabs**

Editar `AgendaShell.tsx`:

1. Adicionar à interface `AgendaShellProps`:

```typescript
import type { AgendaContext } from './hooks/useAgendaFilters';

export interface AgendaShellProps {
  // ... props existentes
  currentContext: AgendaContext;
  contextCounts: { work: number; personal: number; delegated: number };
  onChangeContext: (ctx: AgendaContext) => void;
}
```

2. Renderizar entre o seg `Dia|Semana|Mês` e os ícones bell/theme/avatar:

```tsx
{/* ANTES de <div className="flex items-center gap-2 shrink-0"> */}
<div className="ml-auto inline-flex gap-1.5 mr-3">
  {([
    { id: 'work',      label: 'Trabalho',  count: p.contextCounts.work },
    { id: 'personal',  label: 'Pessoal',   count: p.contextCounts.personal },
    { id: 'delegated', label: 'Delegadas', count: p.contextCounts.delegated },
  ] as const).map(t => (
    <button
      key={t.id}
      type="button"
      onClick={() => p.onChangeContext(t.id)}
      className={[
        'h-8 px-3 rounded-full text-[12px] focus-ring border',
        p.currentContext === t.id
          ? 'bg-tom/15 text-tom border-tom/40 font-medium'
          : 'bg-bg-elevated text-fg-muted border-border hover:text-fg',
      ].join(' ')}
    >
      {t.label} · {t.count}
    </button>
  ))}
</div>
```

3. **Remover** o `<div className="flex-1 flex items-center justify-center gap-2">` central (com Hoje + label de data) e **mover** seu conteúdo pra logo após o seg `Dia|Semana|Mês` (sem `flex-1`, com `gap-2` simples). Isso libera o `ml-auto` das tabs.

- [ ] **Step 2: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

Erros esperados em AgendaDesktop.tsx (não passa as novas props ainda) — será resolvido em Task 10.

- [ ] **Step 3: Commit**

```bash
cd _remote/web && git add src/screens/agenda/AgendaShell.tsx && git commit -m "feat(agenda): tabs de contexto Trabalho/Pessoal/Delegadas no topbar

Tabs com count + active state em tom. Layout linear (sem flex-1 central)."
```

---

## Task 10: Integrar tudo no `AgendaDesktop`

**Files:**
- Modify: `_remote/web/src/screens/agenda/AgendaDesktop.tsx`

- [ ] **Step 1: Substituir leftRail + rightRail no JSX**

1. Importar:

```typescript
import { AgendaDesktopLeftPanel } from './leftPanel/AgendaDesktopLeftPanel';
```

2. Remover imports `TasksPanel`, `AgendaLeftRail`, `MonthDayDrawer`, `useAgendaEvents` extra pra mini-cal (`miniMonthEvents`).

3. Calcular `contextCounts` (perto de onde `events`/`tasks` são derivados):

```typescript
const contextCounts = useMemo(() => {
  const work = tasks.filter(t => t.context === 'work' && t.status !== 'done').length
             + events.filter(e => e.context === 'work').length;
  const personal = tasks.filter(t => t.context === 'personal' && t.status !== 'done').length
                 + events.filter(e => e.context === 'personal').length;
  const delegated = tasks.filter(t => t.delegated_to != null && t.status !== 'done').length;
  return { work, personal, delegated };
}, [tasks, events]);
```

4. Calcular `tasksFiltered` e `eventsFiltered` aplicando `currentContext`:

```typescript
const tasksFiltered = useMemo(() => {
  if (currentContext === 'delegated') return tasks.filter(t => t.delegated_to != null);
  return tasks.filter(t => t.context === currentContext);
}, [tasks, currentContext]);

const eventsFiltered = useMemo(() => {
  if (currentContext === 'delegated') return [];
  return events.filter(e => e.context === currentContext);
}, [events, currentContext]);
```

5. Passar pro `AgendaShell`:

```tsx
<AgendaShell
  /* ... props existentes */
  currentContext={currentContext}
  contextCounts={contextCounts}
  onChangeContext={changeContext}
  leftRail={
    <AgendaDesktopLeftPanel
      view={view}
      currentDate={currentDate}
      weekStart={startOfWeek(currentDate)}
      monthDate={miniMonth /* ou estado do mês atual */}
      selectedMonthDay={selectedMonthDay}
      tasks={tasksFiltered}
      events={eventsFiltered}
      habitsDay={habitsDay /* ver step 6 */}
      habitsWeek={habitsWeek /* ver step 6 */}
      onTaskClick={setEditingTask}
      onToggleTaskDone={t => toggleTaskDoneMutation.mutate(t)}
      onEventClick={setEditingEvent}
      onToggleHabit={h => toggleHabitMutation.mutate(h)}
      onPickDay={(d) => { setCurrentDate(d); setView('day'); navigate('/agenda?view=day', { replace: true }); }}
      onClearSelectedDay={() => setSelectedMonthDay(null)}
      onOpenDayView={(d) => { setCurrentDate(d); setView('day'); navigate('/agenda?view=day', { replace: true }); }}
    />
  }
  rightRail={null}
>
  {/* views centrais inalteradas */}
</AgendaShell>
```

6. **Hábitos**: se `useAgendaHabits` existe, importar e usar. Se não, criar query inline:

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';

const { data: habitsDay = [] } = useQuery({
  queryKey: ['habits-day', currentDate.toISOString().slice(0, 10), currentContext],
  queryFn: async () => {
    const iso = currentDate.toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('habits')
      .select('id, name, current_streak, daily_checkins!inner(done, date)')
      .eq('daily_checkins.date', iso)
      .eq('context', currentContext);
    if (error) throw error;
    return (data ?? []).map((h: any) => ({
      id: h.id, name: h.name, current_streak: h.current_streak ?? 0,
      done_today: !!h.daily_checkins?.[0]?.done,
    }));
  },
  enabled: view === 'day',
});
```

> **Nota:** o schema exato de habits precisa ser conferido. Se não houver tabela `habits` ainda, manter `habitsDay = []` e `habitsWeek = []` (DayPanel/WeekPanel já tratam empty graciosamente).

7. Remover MonthDayDrawer do JSX (substituído pelo MonthPanel state).

- [ ] **Step 2: TypeScript check**

```bash
cd _remote/web && npx tsc --noEmit
```

- [ ] **Step 3: Build**

```bash
cd _remote/web && npx vite build
```

Expected: build OK.

- [ ] **Step 4: Validação visual via Claude Preview**

```javascript
// preview_eval (cole na chamada do MCP)
location.replace('http://localhost:4173/agenda?view=day&_cb=' + Date.now());
```

Depois `preview_screenshot`. Validar:
- Painel esquerdo 400px visível
- Stats + Hábitos + Compromissos + Tarefas presentes
- Tabs Trabalho/Pessoal/Delegadas no topbar
- Sem mini-cal, sem coluna direita

Repetir pra `?view=week` e `?view=month`.

- [ ] **Step 5: Commit**

```bash
cd _remote/web && git add src/screens/agenda/AgendaDesktop.tsx && git commit -m "feat(agenda): AgendaDesktop usa AgendaDesktopLeftPanel + tabs contexto

Remove TasksPanel, AgendaLeftRail, MonthDayDrawer do JSX. Tabs contexto
filtram tasks+events. Painel esquerdo único 400px substitui dupla coluna."
```

---

## Task 11: Renderizar AllDayStrip dentro do TimeGrid

**Files:**
- Modify: `_remote/web/src/screens/agenda/components/TimeGrid.tsx`

- [ ] **Step 1: Adicionar prop opcional**

Editar a interface `TimeGridProps`:

```typescript
import { AllDayStrip } from './AllDayStrip';
import type { TaskForPanel } from '../hooks/useAgendaTasks';

export interface TimeGridProps {
  // ... props existentes
  allDayTasks?: TaskForPanel[];
  onAllDayTaskClick?: (t: TaskForPanel) => void;
}
```

- [ ] **Step 2: Renderizar AllDayStrip acima do scroller**

Logo após o header dos dias (e antes do `<div ref={scrollerRef}>`):

```tsx
{p.allDayTasks && p.allDayTasks.length > 0 && (
  <AllDayStrip
    tasks={p.allDayTasks}
    onTaskClick={p.onAllDayTaskClick ?? (() => {})}
  />
)}
```

- [ ] **Step 3: Modificar `DayView.tsx` e `WeekView.tsx` pra repassar a prop**

```bash
ls _remote/web/src/screens/agenda/views/
```

Em cada uma, adicionar `allDayTasks` e `onAllDayTaskClick` à interface e passar pro `<TimeGrid />`.

- [ ] **Step 4: Modificar `AgendaDesktop` pra computar e passar**

```typescript
const todayIso = currentDate.toISOString().slice(0, 10);
const allDayTasks = useMemo(() =>
  tasksFiltered.filter(t =>
    t.due_date && t.due_date.slice(0, 10) === todayIso && !t.remind_at
  ),
[tasksFiltered, todayIso]);
```

Passar `allDayTasks={allDayTasks}` e `onAllDayTaskClick={setEditingTask}` pro `<DayView>` e `<WeekView>` (no Week, recalcular pra range da semana).

- [ ] **Step 5: TypeScript + build**

```bash
cd _remote/web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 6: Visual check**

`preview_eval` em `?view=day` e validar all-day strip aparece acima do grid 06:00.

- [ ] **Step 7: Commit**

```bash
cd _remote/web && git add src/screens/agenda/components/TimeGrid.tsx src/screens/agenda/views/DayView.tsx src/screens/agenda/views/WeekView.tsx src/screens/agenda/AgendaDesktop.tsx && git commit -m "feat(agenda): all-day strip no topo do TimeGrid

Lista tarefas com due_date sem remind_at (vencimentos sem hora).
Aparece em Day e Week views. Click abre EditTaskSheet."
```

---

## Task 12: Cleanup — deletar arquivos obsoletos

**Files:**
- Delete: `_remote/web/src/screens/agenda/TasksPanel.tsx`
- Delete: `_remote/web/src/screens/agenda/AgendaLeftRail.tsx`

- [ ] **Step 1: Confirmar não há mais imports**

```bash
cd _remote/web && grep -rn "TasksPanel\|AgendaLeftRail" src/ --include="*.tsx" --include="*.ts"
```

Expected: zero matches (exceto o próprio arquivo a ser deletado).

- [ ] **Step 2: Atualizar `_AgendaPreviewDev.tsx` se ainda referencia**

```bash
grep -n "TasksPanel\|AgendaLeftRail" _remote/web/src/screens/_AgendaPreviewDev.tsx
```

Se houver, substituir pelo novo `AgendaDesktopLeftPanel` com mock data.

- [ ] **Step 3: Deletar arquivos**

```bash
rm _remote/web/src/screens/agenda/TasksPanel.tsx
rm _remote/web/src/screens/agenda/AgendaLeftRail.tsx
```

- [ ] **Step 4: Build**

```bash
cd _remote/web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 5: Commit**

```bash
cd _remote/web && git add -A src/screens/agenda/ src/screens/_AgendaPreviewDev.tsx && git commit -m "chore(agenda): remove TasksPanel e AgendaLeftRail obsoletos

Substituídos por AgendaDesktopLeftPanel em Tasks 5-10."
```

---

## Task 13: Validação visual completa

**Files:** nenhum (somente verificação)

- [ ] **Step 1: Build limpo**

```bash
cd _remote/web && rm -rf dist && npx vite build
```

- [ ] **Step 2: Preview ativo**

```bash
cd _remote/web && pkill -f "vite preview" 2>/dev/null; npx vite preview --port 4173 &
sleep 3
```

- [ ] **Step 3: Cache busting + screenshot Day**

Via `mcp__Claude_Preview__preview_eval`:

```javascript
(async () => {
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  }
  const names = await caches.keys();
  await Promise.all(names.map(n => caches.delete(n)));
  location.replace('http://localhost:4173/agenda?view=day&_cb=' + Date.now());
})();
```

Depois `mcp__Claude_Preview__preview_screenshot`. Validar contra mockup `layout-b-refined.html`:
- Topbar com seg + Hoje/data + 3 tabs contexto + ícones
- Painel esquerdo 400px com Stats / Hábitos colapsável / Compromissos / Tarefas com 4 subgrupos
- All-day strip acima do timegrid
- TimeGrid central ocupando o resto
- FAB bottom-right
- Sem mini-cal, sem coluna direita

- [ ] **Step 4: Screenshot Week**

```javascript
location.replace('http://localhost:4173/agenda?view=week&_cb=' + Date.now());
```

Validar painel esquerdo mostra heatmap de hábitos + lista por dia agrupada.

- [ ] **Step 5: Screenshot Month (sem dia)**

```javascript
location.replace('http://localhost:4173/agenda?view=month&_cb=' + Date.now());
```

Validar painel esquerdo mostra "resumo do mês" com top atrasos expandido + outras seções colapsadas.

- [ ] **Step 6: Screenshot Month (com dia clicado)**

Via `mcp__Claude_Preview__preview_click` em uma célula de dia (ou eval pra simular click). Validar painel esquerdo vira drawer do dia, com botão "← voltar" e "Abrir dia em Day view →".

- [ ] **Step 7: Smoke test mobile (não pode ter quebrado)**

```javascript
location.replace('http://localhost:4173/hoje?_cb=' + Date.now());
```

Validar tela mobile Hoje idêntica ao baseline (Stats + Tabs + Hábitos + Compromissos + Tarefas).

```javascript
location.replace('http://localhost:4173/semana?_cb=' + Date.now());
```

Validar semana mobile idêntica.

- [ ] **Step 8: Commit (se houver fixes)**

```bash
cd _remote/web && git add -A && git commit -m "fix(agenda): ajustes pós validação visual" || echo "no fixes needed"
```

---

## Task 14: Atualizar `_AgendaPreviewDev.tsx`

**Files:**
- Modify: `_remote/web/src/screens/_AgendaPreviewDev.tsx`

- [ ] **Step 1: Substituir composição antiga pela nova**

Trocar `<TasksPanel>` + `<AgendaLeftRail>` por `<AgendaDesktopLeftPanel>` com MOCK_TASKS, MOCK_EVENTS e habits mockados:

```typescript
const MOCK_HABITS_DAY = [
  { id: 'h1', name: 'Meditação + leitura', done_today: true, current_streak: 5 },
  { id: 'h2', name: 'Beber água', done_today: true, current_streak: 12 },
  { id: 'h3', name: 'Academia', done_today: false, current_streak: 0 },
];

const MOCK_HABITS_WEEK = [
  { id: 'h1', name: 'Meditação + leitura', week: [true,false,false,false,true,true,false], current_streak: 5 },
  { id: 'h2', name: 'Beber água', week: [true,true,true,true,true,true,false], current_streak: 12 },
  { id: 'h3', name: 'Academia', week: [false,true,true,false,true,false,false], current_streak: 0 },
];
```

Repassar tudo pro `<AgendaDesktopLeftPanel>` no `leftRail` da `AgendaShell`. Remover `<TasksPanel>`. Adicionar `currentContext={'work'} contextCounts={{work:3,personal:1,delegated:0}} onChangeContext={()=>{}}`.

- [ ] **Step 2: Build**

```bash
cd _remote/web && npx tsc --noEmit && npx vite build
```

- [ ] **Step 3: Visual check rota dev**

`preview_eval` em `http://localhost:4173/_dev/agenda-preview` (ou rota equivalente) — validar nova composição.

- [ ] **Step 4: Commit**

```bash
cd _remote/web && git add src/screens/_AgendaPreviewDev.tsx && git commit -m "chore(agenda): _AgendaPreviewDev usa novo AgendaDesktopLeftPanel"
```

---

## Self-Review

**Spec coverage:** revisei a spec contra o plano. Cobertura:

| Requisito da spec (seção) | Task que cobre |
|---|---|
| §4.1 Estrutura geral 400px + sem rightRail | Task 8, 10 |
| §4.2 Topbar com tabs contexto | Task 9, 10 |
| §4.3.1 Painel Dia | Task 5, 10 |
| §4.3.2 Painel Semana com heatmap | Task 3, 6, 10 |
| §4.3.3 Painel Mês sem dia | Task 7, 10 |
| §4.3.4 Painel Mês com dia | Task 7, 10 |
| §4.5 All-day strip | Task 4, 11 |
| §5 Reuso componentes mobile | Tasks 5, 6, 7 (imports StatCard/EventRow/TaskRow) |
| §6 Componentes novos | Tasks 2, 3, 4, 5, 6, 7, 8 |
| §8.1 Sync tabs ↔ filtros | Task 1, 10 |
| §8.2 Persistência localStorage colapsadas | Task 2 |
| §8.3 Click em item abre sheet | Task 10 (passa setEditingTask/setEditingEvent) |
| §8.4 Click em dia no Mês | Task 10 (selectedMonthDay) |
| §8.5 Click em label dia na Semana | Task 6, 10 (onPickDay) |
| §8.7 DnD preserva duração | herdado do TimeGrid existente; sem mudança |
| §9 Guardrail mobile intocado | Task 13 step 7 (smoke test) |
| §13 Estrutura arquivos | Tasks 2-8 (criação) + Task 12 (remoção) |

**Gaps endereçados inline:** spec mencionava que `_AgendaPreviewDev.tsx` precisa atualizar — adicionei Task 14 explícita.

**Placeholder scan:** nenhum TBD/TODO/"implement later" no plano. Casts `as never` são marcados como "placeholder a resolver" com nota explícita ao implementador.

**Type consistency:** `AgendaContext`, `TaskForPanel`, `EventForGrid`, `Habit`/`HabitWithWeek`, `CollapsibleSection.storageKey` consistentes entre tasks. Props de `AgendaDesktopLeftPanel` casam com o que `AgendaDesktop` passa em Task 10.

**Riscos conhecidos não bloqueantes:**
1. Schema de hábitos pode não existir no banco — Task 10 prevê fallback `[]`.
2. Tons de `StatCard` podem diferir de `'neutral'|'danger'|'success'` — implementador ajusta com base no arquivo real.
3. `TaskRow`/`EventRow` props exatas precisam ser conferidas — `as never` marca o ponto.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-24-agenda-desktop-redesign-v2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — eu despacho um subagente fresco por task, com revisão dupla (spec + qualidade) entre tasks, iteração rápida sem poluir meu contexto.

**2. Inline Execution** — executo as tasks aqui na sessão atual com checkpoints pra você revisar.

**Qual aprovar?**
