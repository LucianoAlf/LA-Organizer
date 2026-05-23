import { useDraggable } from '@dnd-kit/core';
import type { EventForGrid } from '../hooks/useAgendaEvents';
import { useResize } from '../hooks/useResize';

const CONTEXT_FALLBACK_COLOR = { work: '#A3BE50', personal: '#64748B' } as const;

export interface EventBlockProps {
  event: EventForGrid;
  top: number;
  height: number;
  width: number;
  left: number;
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
