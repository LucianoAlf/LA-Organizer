import { Video, MapPin, Link as LinkIcon, Building2 } from 'lucide-react';
import { Badge } from './Badge';
import { MODALITY_LABELS, type CalendarEvent } from '../types';
import { formatEventTimeRange } from '../lib/events';

interface Props {
  event: CalendarEvent;
  onClick?: (e: CalendarEvent) => void;
  /** Hide time on /semana when day already provides context. */
  showDate?: boolean;
}

// Sprint 22.26 — categoria virou objeto (FK em event_categories). Mapeio por
// slug. Categorias pessoais criadas pelo user caem em "neutral" como default.
const categoryTone: Record<string, 'brand' | 'info' | 'project' | 'warning' | 'success' | 'neutral'> = {
  la_music: 'brand',
  mentoria: 'project',
  aula_particular: 'info',
  outra_escola: 'warning',
  estudio: 'success',
  pessoal: 'neutral',
};

export function EventRow({ event, onClick, showDate }: Props) {
  const range = formatEventTimeRange(event.start_at, event.end_at);
  const slug = event.category?.slug ?? '';
  const tone = categoryTone[slug] ?? 'neutral';
  const label = event.category?.label ?? '—';
  const isCancelled = event.status === 'cancelled';
  const isDone = event.status === 'done';

  const Icon = event.modality === 'online' ? Video : event.modality === 'hibrido' ? Building2 : MapPin;

  return (
    <button
      type="button"
      onClick={onClick ? () => onClick(event) : undefined}
      className={[
        'w-full text-left flex items-start gap-md py-3 border-b border-border last:border-0',
        onClick ? 'hover:bg-bg-elevated focus-ring rounded-sm' : '',
        isCancelled || isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="shrink-0 w-16 text-right tabular-nums">
        <div className={['text-body-sm font-semibold leading-tight', isCancelled ? 'line-through text-fg-muted' : 'text-fg'].join(' ')}>
          {range.split('–')[0]}
        </div>
        <div className="text-body-sm text-fg-muted leading-tight">{range.split('–')[1]}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className={['text-body-md font-medium', isCancelled ? 'line-through text-fg-muted' : ''].join(' ')}>
          {event.title}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-muted">
          <span className="inline-flex items-center gap-1">
            <Icon size={13} />
            {MODALITY_LABELS[event.modality]}
          </span>
          {event.location_text && <span>· {event.location_text}</span>}
          {event.meeting_url && (
            <a
              href={event.meeting_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-info hover:underline"
            >
              <LinkIcon size={12} /> entrar
            </a>
          )}
          {event.projects?.name && <span>· {event.projects.name}</span>}
        </div>
      </div>

      <Badge tone={tone}>{label}</Badge>
    </button>
  );
}
