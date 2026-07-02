import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { computeLanes, timeToY, yToTime, type GridConfig } from '../lib/timeGrid';
import { EventBlock } from './EventBlock';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import type { TaskForPanel } from '../hooks/useAgendaTasks';
import { taskChipTone, CHIP_TONE_CLASS } from '../../../lib/monthChips';
import { localYmd, todaySP } from '../../../utils/date';

const HOUR_HEIGHT = 64;
const START_HOUR = 6;
const END_HOUR = 23;
const SLOT_MIN = 30;
const SNAP_MIN = 15;
const GUTTER_W = 60;
const CFG: GridConfig = { startHour: START_HOUR, hourHeight: HOUR_HEIGHT, snapMinutes: SNAP_MIN };

export interface TimeGridProps {
  days: Date[];
  events: EventForGrid[];
  /** Tarefas do range — renderizadas na faixa "dia todo" no topo (não têm bloco de horário).
   *  Paridade com o Mês: a grade por horário mostrava só compromissos (caso Yuri). */
  tasks?: TaskForPanel[];
  onSlotClick: (date: Date) => void;
  onEventClick: (event: EventForGrid) => void;
  onEventDrop: (event: EventForGrid, newStart: Date) => void;
  onEventResize: (event: EventForGrid, newDurationMs: number) => void;
  onTaskClick?: (task: TaskForPanel) => void;
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

  const todayYmd = todaySP();
  // Tarefas por dia (YYYY-MM-DD local) — a faixa "dia todo". Tarefa sem due_date fica de fora
  // (ela aparece na fonte "sem prazo" do painel, não na grade datada).
  const tasksByDay = useMemo(() => {
    const m = new Map<string, TaskForPanel[]>();
    for (const t of p.tasks ?? []) {
      const ymd = (t.due_date ?? '').slice(0, 10);
      if (!ymd) continue;
      const list = m.get(ymd);
      if (list) list.push(t); else m.set(ymd, [t]);
    }
    return m;
  }, [p.tasks]);
  const anyTasks = useMemo(
    () => p.days.some(d => (tasksByDay.get(localYmd(d))?.length ?? 0) > 0),
    [p.days, tasksByDay],
  );

  useEffect(() => {
    if (!scrollerRef.current) return;
    const hasToday = p.days.some(d => isSameDay(d, new Date()));
    const target = hasToday ? Math.max(START_HOUR, new Date().getHours() - 1) : 7;
    scrollerRef.current.scrollTop = (target - START_HOUR) * HOUR_HEIGHT;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.days.map(d => d.toISOString().slice(0, 10)).join('|')]);

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
    const dyPx = (e.delta?.y ?? 0);
    const oldStart = new Date(ev.start_at);
    const oldY = timeToY(oldStart, CFG);
    const newY = oldY + dyPx;
    const newStart = yToTime(newY, overData.date, CFG);
    p.onEventDrop(ev, newStart);
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      {/* Header dos dias — renderiza só na vista Semana (>1 dia). Na vista Dia
          a data já aparece no topbar central (evita duplicação). */}
      {p.days.length > 1 && (
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
              {`${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase()} · ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
            </div>
          ))}
        </div>
      )}

      {/* Faixa "dia todo" — TAREFAS datadas (a grade por horário é só de compromissos).
          Alinhada com as colunas: gutter + 1 célula flex-1 por dia. */}
      {anyTasks && (
        <div className="flex shrink-0 border-b border-border bg-bg-surface">
          <div style={{ width: GUTTER_W }} className="shrink-0 text-[9px] uppercase tracking-wider text-fg-muted text-right pr-2 pt-1 select-none">tarefas</div>
          {p.days.map((day) => {
            const ymd = localYmd(day);
            const dayTasks = tasksByDay.get(ymd) ?? [];
            const cap = 3;
            const vis = dayTasks.slice(0, cap);
            const overflow = dayTasks.length - vis.length;
            return (
              <div key={ymd} className="flex-1 min-w-0 border-l border-border/30 p-1 flex flex-col gap-0.5">
                {vis.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.title}
                    className={['text-[10px] leading-tight rounded px-1 truncate text-left focus-ring', CHIP_TONE_CLASS[taskChipTone(t, todayYmd)]].join(' ')}
                    onClick={() => p.onTaskClick?.(t)}
                  >
                    {t.due_time ? `${t.due_time.slice(0, 5)} ` : ''}{t.title}
                  </button>
                ))}
                {overflow > 0 && <span className="text-[9px] text-fg-muted pl-0.5">+{overflow} tarefa{overflow > 1 ? 's' : ''}</span>}
              </div>
            );
          })}
        </div>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto relative">
        <div className="flex" style={{ height: totalHeight }}>
          <div style={{ width: GUTTER_W }} className="shrink-0 relative border-r border-border/30">
            {Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => (
              <div key={i} style={{ height: HOUR_HEIGHT }}
                className={`text-[10px] text-fg-muted text-right pr-2${i > 0 ? ' -translate-y-1.5' : ' pt-2'}`}>
                {String(START_HOUR + i).padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {p.days.map((day) => {
            const dayEvents = p.events.filter(e => isSameDay(new Date(e.start_at), day));
            const laned = computeLanes(dayEvents);
            return (
              <DroppableDay key={day.toISOString()} day={day}>
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

                {isSameDay(day, now) && (
                  <div className="absolute inset-x-0 h-px bg-danger z-10 pointer-events-none"
                    style={{ top: timeToY(now, CFG) }} />
                )}

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
