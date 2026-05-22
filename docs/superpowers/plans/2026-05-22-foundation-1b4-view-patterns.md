# Foundation 1b.4 — View Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Construir 6 view patterns presentacionais (KanbanBoard, TimelineGantt, DenseTable, MonthCalendar, WeekCalendar, PersonGrid) que servirão para todas as visualizações de dados do desktop.

**Architecture:** Componentes 100% presentacionais (props-in, JSX-out). Sem estado de dados, sem fetch. Vivem em `web/src/design/views/`. Usam primitivos do 1b.3 onde aplicável. Genéricos em TypeScript para reuso entre domínios.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3.4, Lucide React, date-fns (já no projeto).

---

## Mapa de arquivos

| Ação | Caminho |
|------|---------|
| Criar | `web/src/design/views/KanbanBoard.tsx` |
| Criar | `web/src/design/views/TimelineGantt.tsx` |
| Criar | `web/src/design/views/DenseTable.tsx` |
| Criar | `web/src/design/views/MonthCalendar.tsx` |
| Criar | `web/src/design/views/WeekCalendar.tsx` |
| Criar | `web/src/design/views/PersonGrid.tsx` |
| Modificar | `web/src/design/index.ts` |

---

### Task 1: KanbanBoard.tsx

Board de colunas com cards. Stateless — renderiza colunas e delega card render para callback.

```tsx
import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';

export interface KanbanColumn<T> {
  id: string;
  title: string;
  items: T[];
  accentColor?: string;
  count?: number;
}

interface KanbanBoardProps<T> {
  columns: KanbanColumn<T>[];
  renderCard: (item: T, columnId: string) => ReactNode;
  onAddToColumn?: (columnId: string) => void;
  getItemKey: (item: T) => string;
}

export function KanbanBoard<T>({
  columns,
  renderCard,
  onAddToColumn,
  getItemKey,
}: KanbanBoardProps<T>) {
  return (
    <div className="flex gap-3 h-full overflow-x-auto pb-2">
      {columns.map(col => (
        <div
          key={col.id}
          className="flex-shrink-0 w-72 flex flex-col bg-bg-surface border border-border rounded-lg overflow-hidden"
        >
          <header className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-border shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {col.accentColor && (
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: col.accentColor }}
                />
              )}
              <span className="text-[13px] font-semibold text-fg truncate">{col.title}</span>
              <span className="text-[11px] text-fg-muted font-medium tabular-nums">
                {col.count ?? col.items.length}
              </span>
            </div>
            {onAddToColumn && (
              <button
                type="button"
                onClick={() => onAddToColumn(col.id)}
                aria-label={`Adicionar em ${col.title}`}
                className="w-6 h-6 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors focus-ring"
              >
                <Plus size={13} />
              </button>
            )}
          </header>
          <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2 min-h-0">
            {col.items.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-fg-muted">Vazio</div>
            ) : (
              col.items.map(item => (
                <div key={getItemKey(item)}>{renderCard(item, col.id)}</div>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

Verificar: `cd D:\la-organizer\_remote\web; npx tsc --noEmit`

---

### Task 2: TimelineGantt.tsx

Timeline horizontal com barras por item. Usa proporção (start/end relativos ao range total).

```tsx
import type { ReactNode } from 'react';

export interface TimelineItem {
  id: string;
  label: string;
  /** Início em ms (Date.getTime()). */
  start: number;
  /** Fim em ms. */
  end: number;
  /** Lane (linha) — se omitido, usa 'default'. */
  lane?: string;
  /** Cor de destaque da barra (hex/rgb). Default: tom. */
  color?: string;
}

interface TimelineGanttProps {
  items: TimelineItem[];
  /** Início do range visível em ms. */
  rangeStart: number;
  /** Fim do range visível em ms. */
  rangeEnd: number;
  /** Ordem das lanes. */
  lanes: Array<{ id: string; label: string }>;
  /** Callback ao clicar em um item. */
  onItemClick?: (item: TimelineItem) => void;
  /** Renderiza markers do eixo X. Recebe array de timestamps. */
  renderAxis?: (ticks: number[]) => ReactNode;
}

function pct(value: number, min: number, max: number) {
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export function TimelineGantt({
  items,
  rangeStart,
  rangeEnd,
  lanes,
  onItemClick,
  renderAxis,
}: TimelineGanttProps) {
  const ticks: number[] = [];
  const step = (rangeEnd - rangeStart) / 6;
  for (let i = 0; i <= 6; i++) ticks.push(rangeStart + step * i);

  return (
    <div className="flex flex-col h-full border border-border rounded-lg overflow-hidden bg-bg-surface">
      {/* Axis header */}
      <div className="flex border-b border-border shrink-0">
        <div className="w-40 shrink-0 px-3 py-2 border-r border-border text-[11px] uppercase tracking-wider text-fg-muted font-semibold">
          Lane
        </div>
        <div className="flex-1 relative h-9">
          {renderAxis ? (
            renderAxis(ticks)
          ) : (
            ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 bottom-0 flex items-center text-[10px] text-fg-muted border-l border-border/50 pl-1"
                style={{ left: `${pct(t, rangeStart, rangeEnd)}%` }}
              >
                {new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
              </div>
            ))
          )}
        </div>
      </div>
      {/* Lanes */}
      <div className="flex-1 overflow-y-auto">
        {lanes.map(lane => {
          const laneItems = items.filter(it => (it.lane ?? 'default') === lane.id);
          return (
            <div key={lane.id} className="flex border-b border-border/50 last:border-b-0">
              <div className="w-40 shrink-0 px-3 py-3 border-r border-border text-[12px] font-medium text-fg-secondary truncate">
                {lane.label}
              </div>
              <div className="flex-1 relative h-12">
                {laneItems.map(item => {
                  const left = pct(item.start, rangeStart, rangeEnd);
                  const right = pct(item.end, rangeStart, rangeEnd);
                  const width = Math.max(2, right - left);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onItemClick?.(item)}
                      title={item.label}
                      className="absolute top-1/2 -translate-y-1/2 h-7 rounded-md px-2 text-[11px] font-medium text-white truncate text-left hover:opacity-90 transition-opacity focus-ring"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: item.color ?? '#A3BE50',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Verificar TypeScript.

---

### Task 3: DenseTable.tsx

Tabela densa com header sticky, hover, click row, render cell customizável.

```tsx
import type { ReactNode } from 'react';

export interface DenseTableColumn<T> {
  key: string;
  label: string;
  width?: number | string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
}

interface DenseTableProps<T> {
  columns: DenseTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyState?: ReactNode;
}

export function DenseTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  emptyState,
}: DenseTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 bg-bg-elevated z-10">
            <tr>
              {columns.map(col => (
                <th
                  key={col.key}
                  style={{ width: col.width, textAlign: col.align ?? 'left' }}
                  className="px-3 py-2 text-[10px] uppercase tracking-wider text-fg-muted font-semibold border-b border-border"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr
                key={getRowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={[
                  'border-b border-border/50 last:border-b-0 transition-colors',
                  onRowClick ? 'cursor-pointer hover:bg-bg-elevated' : '',
                ].join(' ')}
              >
                {columns.map(col => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align ?? 'left' }}
                    className="px-3 py-2 text-[13px] text-fg"
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

### Task 4: MonthCalendar.tsx

Grade 7×N (semanas) de dias do mês. Renderiza preview de items por dia.

```tsx
import type { ReactNode } from 'react';

export interface CalendarItem {
  id: string;
  /** Data em formato YYYY-MM-DD. */
  date: string;
  label: string;
  color?: string;
}

interface MonthCalendarProps {
  /** Ano. */
  year: number;
  /** Mês (1-12). */
  month: number;
  items: CalendarItem[];
  onDayClick?: (date: string) => void;
  renderItem?: (item: CalendarItem) => ReactNode;
}

const WEEK_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

function formatDate(year: number, month: number, day: number): string {
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}

export function MonthCalendar({
  year,
  month,
  items,
  onDayClick,
  renderItem,
}: MonthCalendarProps) {
  const firstOfMonth = new Date(year, month - 1, 1);
  const lastOfMonth = new Date(year, month, 0);
  const daysInMonth = lastOfMonth.getDate();

  // JS getDay: 0=Dom..6=Sáb. Convertemos para 0=Seg..6=Dom.
  const firstWeekday = (firstOfMonth.getDay() + 6) % 7;

  const cells: Array<{ date: string; day: number; inMonth: boolean }> = [];
  // Padding inicial
  for (let i = 0; i < firstWeekday; i++) {
    cells.push({ date: '', day: 0, inMonth: false });
  }
  // Dias do mês
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: formatDate(year, month, d), day: d, inMonth: true });
  }
  // Padding final pra completar última semana
  while (cells.length % 7 !== 0) {
    cells.push({ date: '', day: 0, inMonth: false });
  }

  const itemsByDate = new Map<string, CalendarItem[]>();
  items.forEach(it => {
    const list = itemsByDate.get(it.date) ?? [];
    list.push(it);
    itemsByDate.set(it.date, list);
  });

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-surface flex flex-col h-full">
      <div className="grid grid-cols-7 border-b border-border bg-bg-elevated shrink-0">
        {WEEK_LABELS.map(w => (
          <div
            key={w}
            className="px-2 py-2 text-[10px] uppercase tracking-wider text-fg-muted font-semibold text-center"
          >
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-[repeat(auto-fill,minmax(100px,1fr))] flex-1 min-h-0">
        {cells.map((cell, i) => (
          <div
            key={i}
            onClick={cell.inMonth && onDayClick ? () => onDayClick(cell.date) : undefined}
            className={[
              'border-r border-b border-border/50 p-2 min-h-[100px] flex flex-col gap-1',
              cell.inMonth ? '' : 'bg-bg-app/40',
              cell.inMonth && onDayClick ? 'cursor-pointer hover:bg-bg-elevated/50 transition-colors' : '',
            ].join(' ')}
          >
            {cell.inMonth && (
              <>
                <span className="text-[11px] font-semibold text-fg-muted tabular-nums">{cell.day}</span>
                <div className="flex-1 space-y-0.5 overflow-hidden">
                  {(itemsByDate.get(cell.date) ?? []).slice(0, 3).map(item => (
                    <div key={item.id}>
                      {renderItem ? (
                        renderItem(item)
                      ) : (
                        <div
                          className="text-[10px] px-1.5 py-0.5 rounded truncate text-white font-medium"
                          style={{ backgroundColor: item.color ?? '#A3BE50' }}
                        >
                          {item.label}
                        </div>
                      )}
                    </div>
                  ))}
                  {(itemsByDate.get(cell.date)?.length ?? 0) > 3 && (
                    <div className="text-[10px] text-fg-muted">
                      +{(itemsByDate.get(cell.date)?.length ?? 0) - 3} mais
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 5: WeekCalendar.tsx

Grade 7 colunas (dias) × 24 linhas (horas). Items posicionados por horário.

```tsx
export interface WeekItem {
  id: string;
  /** Início em ms (Date.getTime()). */
  start: number;
  /** Fim em ms. */
  end: number;
  label: string;
  color?: string;
}

interface WeekCalendarProps {
  /** Início da semana (segunda-feira) em ms. */
  weekStart: number;
  items: WeekItem[];
  onItemClick?: (item: WeekItem) => void;
  /** Hora inicial visível (0-23). Default: 6. */
  hourStart?: number;
  /** Hora final visível (0-23). Default: 22. */
  hourEnd?: number;
}

const DAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const MS_DAY = 24 * 60 * 60 * 1000;

export function WeekCalendar({
  weekStart,
  items,
  onItemClick,
  hourStart = 6,
  hourEnd = 22,
}: WeekCalendarProps) {
  const hours: number[] = [];
  for (let h = hourStart; h <= hourEnd; h++) hours.push(h);
  const totalHours = hourEnd - hourStart;

  const days = DAY_LABELS.map((label, i) => {
    const dayStart = weekStart + i * MS_DAY;
    const dayEnd = dayStart + MS_DAY;
    const date = new Date(dayStart);
    return {
      label,
      dayNumber: date.getDate(),
      dayStart,
      dayEnd,
      items: items.filter(it => it.start < dayEnd && it.end > dayStart),
    };
  });

  function itemPosition(item: WeekItem, dayStart: number): { top: number; height: number } {
    const itemStart = Math.max(item.start, dayStart);
    const itemEnd = Math.min(item.end, dayStart + MS_DAY);
    const dayStartMs = dayStart + hourStart * 60 * 60 * 1000;
    const dayTotalMs = totalHours * 60 * 60 * 1000;
    const top = Math.max(0, ((itemStart - dayStartMs) / dayTotalMs) * 100);
    const height = Math.max(2, ((itemEnd - itemStart) / dayTotalMs) * 100);
    return { top, height };
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-surface flex flex-col h-full">
      <div className="grid border-b border-border bg-bg-elevated shrink-0" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
        <div />
        {days.map((d, i) => (
          <div key={i} className="px-2 py-2 text-center border-l border-border/50">
            <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold">{d.label}</div>
            <div className="text-[14px] font-bold text-fg tabular-nums">{d.dayNumber}</div>
          </div>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="grid relative" style={{ gridTemplateColumns: '60px repeat(7, 1fr)', gridAutoRows: '48px' }}>
          {hours.map(h => (
            <div key={`label-${h}`} className="border-r border-b border-border/50 text-[10px] text-fg-muted px-2 py-1 tabular-nums" style={{ gridColumn: 1 }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
          {days.map((d, i) => (
            <div key={`col-${i}`} className="relative border-l border-border/50" style={{ gridColumn: i + 2, gridRow: `1 / span ${hours.length}` }}>
              {hours.map((_, hi) => (
                <div key={hi} className="border-b border-border/50" style={{ height: '48px' }} />
              ))}
              {d.items.map(item => {
                const { top, height } = itemPosition(item, d.dayStart);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onItemClick?.(item)}
                    title={item.label}
                    className="absolute left-1 right-1 rounded-md px-2 py-1 text-[10px] font-medium text-white text-left overflow-hidden hover:opacity-90 transition-opacity focus-ring"
                    style={{
                      top: `${top}%`,
                      height: `${height}%`,
                      backgroundColor: item.color ?? '#A3BE50',
                    }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

### Task 6: PersonGrid.tsx

Grade de cards de pessoas. Cada card mostra avatar + nome + meta opcional + badge de status.

```tsx
import type { ReactNode } from 'react';

export interface PersonGridItem {
  id: string;
  name: string;
  avatarUrl?: string;
  role?: string;
  status?: 'active' | 'idle' | 'offline';
  meta?: ReactNode;
}

interface PersonGridProps {
  people: PersonGridItem[];
  onPersonClick?: (person: PersonGridItem) => void;
  /** Tamanho dos cards. */
  size?: 'sm' | 'md';
}

const STATUS_COLORS = {
  active: 'bg-success',
  idle: 'bg-warning',
  offline: 'bg-fg-muted',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

export function PersonGrid({ people, onPersonClick, size = 'md' }: PersonGridProps) {
  const cardClass = size === 'sm'
    ? 'p-3 gap-2'
    : 'p-4 gap-3';
  const avatarSize = size === 'sm' ? 'w-10 h-10' : 'w-12 h-12';
  const initialsSize = size === 'sm' ? 'text-[12px]' : 'text-[14px]';

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
      {people.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={onPersonClick ? () => onPersonClick(p) : undefined}
          className={[
            'flex items-center rounded-lg border border-border bg-bg-surface transition-colors text-left',
            cardClass,
            onPersonClick ? 'hover:border-tom/40 hover:bg-bg-elevated focus-ring' : '',
          ].join(' ')}
        >
          <div className="relative shrink-0">
            <div className={`${avatarSize} rounded-full bg-bg-elevated overflow-hidden border border-border grid place-items-center`}>
              {p.avatarUrl ? (
                <img src={p.avatarUrl} alt={p.name} className="w-full h-full object-cover" />
              ) : (
                <span className={`${initialsSize} font-bold text-fg`}>{initials(p.name)}</span>
              )}
            </div>
            {p.status && (
              <span
                className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-bg-surface ${STATUS_COLORS[p.status]}`}
                aria-label={p.status}
              />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-fg truncate">{p.name}</div>
            {p.role && <div className="text-[11px] text-fg-muted truncate">{p.role}</div>}
            {p.meta && <div className="text-[11px] text-fg-muted truncate mt-0.5">{p.meta}</div>}
          </div>
        </button>
      ))}
    </div>
  );
}
```

---

### Task 7: Atualizar design/index.ts

Substituir o conteúdo COMPLETO por:

```ts
export { SidebarV2 } from './shell/SidebarV2';
export { TopbarV2 } from './shell/TopbarV2';
export { PageShell } from './primitives/PageShell';
export { Toolbar } from './primitives/Toolbar';
export { FilterPill } from './primitives/FilterPill';
export { ViewSwitcher } from './primitives/ViewSwitcher';
export type { ViewOption } from './primitives/ViewSwitcher';
export { DetailDrawer } from './primitives/DetailDrawer';
export { EmptyStateDesktop } from './primitives/EmptyStateDesktop';
export { Skeleton, SkeletonCard, SkeletonRow, SkeletonList } from './primitives/LoadingSkeleton';
export { KanbanBoard } from './views/KanbanBoard';
export type { KanbanColumn } from './views/KanbanBoard';
export { TimelineGantt } from './views/TimelineGantt';
export type { TimelineItem } from './views/TimelineGantt';
export { DenseTable } from './views/DenseTable';
export type { DenseTableColumn } from './views/DenseTable';
export { MonthCalendar } from './views/MonthCalendar';
export type { CalendarItem } from './views/MonthCalendar';
export { WeekCalendar } from './views/WeekCalendar';
export type { WeekItem } from './views/WeekCalendar';
export { PersonGrid } from './views/PersonGrid';
export type { PersonGridItem } from './views/PersonGrid';
```

---

### Final: TypeScript check + build

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit; npx vite build
```

Ambos devem passar.

---

## Self-Review

- ✅ 6 views criadas, todas presentational, todas genéricas onde aplicável (`<T>`)
- ✅ Tokens corretos: `bg-bg-surface`, `border-border`, `text-fg-*`, `bg-tom`, sem `bg-bg-elevated-2` (uso `bg-bg-elevated` ou `bg-bg-elevated2` quando preciso)
- ✅ Sem placeholders, todo código completo
- ✅ Tipos coerentes — `KanbanColumn<T>`, `DenseTableColumn<T>`, `TimelineItem`, `CalendarItem`, `WeekItem`, `PersonGridItem`
- ✅ Barrel atualizado com tipos exportados
