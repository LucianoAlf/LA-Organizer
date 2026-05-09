import { Video, MapPin, Link as LinkIcon, Building2 } from 'lucide-react';
import { Badge } from './Badge';
import { TaskCheckbox } from './TaskCheckbox';
import { RowMenu, type MenuItem } from './RowMenu';
import { MODALITY_LABELS, type CalendarEvent } from '../types';
import { formatEventTimeRange } from '../lib/events';

interface Props {
  event: CalendarEvent;
  onClick?: (e: CalendarEvent) => void;
  /** Sprint 22.34 — toggle done direto do card (igual task). */
  onToggleDone?: (e: CalendarEvent) => void;
  /** Sprint 22.34 — cancelar evento (status=cancelled, mantem historico). */
  onCancel?: (e: CalendarEvent) => void;
  /** Sprint 22.34 — excluir evento (delete fisico). */
  onDelete?: (e: CalendarEvent) => void;
  /** Hide time on /semana when day already provides context. */
  showDate?: boolean;
}

const categoryTone: Record<string, 'brand' | 'info' | 'project' | 'warning' | 'success' | 'neutral'> = {
  la_music: 'brand',
  mentoria: 'project',
  aula_particular: 'info',
  outra_escola: 'warning',
  estudio: 'success',
  pessoal: 'neutral',
};

const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
};

export function EventRow({ event, onClick, onToggleDone, onCancel, onDelete }: Props) {
  const range = formatEventTimeRange(event.start_at, event.end_at);
  const slug = event.category?.slug ?? '';
  const tone = categoryTone[slug] ?? 'neutral';
  const label = event.category?.label ?? '—';
  const isCancelled = event.status === 'cancelled';
  const isDone = event.status === 'done';
  const quadrantKey = event.eisenhower_quadrant ? String(event.eisenhower_quadrant) : null;
  const dotClass = quadrantKey && QUADRANT_DOT[quadrantKey] ? QUADRANT_DOT[quadrantKey] : null;

  const Icon = event.modality === 'online' ? Video : event.modality === 'hibrido' ? Building2 : MapPin;

  const menuItems: MenuItem[] = [];
  if (onClick && !isCancelled) menuItems.push({
    label: 'Editar compromisso',
    onClick: () => onClick(event),
  });
  if (onCancel && !isCancelled && !isDone) menuItems.push({
    label: 'Cancelar evento',
    confirm: 'Cancelar este compromisso? Fica como histórico, não some.',
    onClick: () => onCancel(event),
  });
  if (onDelete) menuItems.push({
    label: 'Excluir compromisso',
    danger: true,
    confirm: 'Excluir este compromisso? Some pra sempre.',
    onClick: () => onDelete(event),
  });

  return (
    <article
      className={[
        'flex items-start gap-md py-3 border-b border-border last:border-0 transition-opacity',
        isCancelled || isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      {/* Sprint 22.34 — checkbox toggle done direto da linha. */}
      {onToggleDone && (
        <span className="self-start mt-0.5" onClick={(e) => e.stopPropagation()}>
          <TaskCheckbox
            done={isDone}
            overdue={false}
            size="md"
            onClick={() => onToggleDone(event)}
          />
        </span>
      )}

      {/* Click area = abre EditEventSheet */}
      <button
        type="button"
        onClick={onClick ? () => onClick(event) : undefined}
        className={[
          'flex-1 min-w-0 flex items-start gap-md text-left',
          onClick ? 'hover:opacity-90 focus-ring rounded-sm' : '',
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
            {dotClass && !isCancelled && (
              <span
                aria-label={`Prioridade ${quadrantKey}`}
                title={`Prioridade ${quadrantKey}`}
                className={['inline-block h-2 w-2 rounded-full mr-2 align-middle', dotClass].join(' ')}
              />
            )}
            {(event.event_reminders ?? []).some(r => !r.sent_at) && (
              <span className="text-[11px] opacity-60 mr-1" aria-label="tem lembrete">🔔</span>
            )}
            {event.title}
          </div>
          {/* Sprint 22.34h — Badge da categoria movido pra linha de meta (debaixo do
              titulo) pra nao espremer o titulo na vertical. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-muted">
            <Badge tone={tone}>{label}</Badge>
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
      </button>

      {/* Sprint 22.34 — menu inline pra cancel/delete (sem precisar abrir sheet). */}
      {menuItems.length > 0 && (
        <span className="shrink-0 self-start" onClick={(e) => e.stopPropagation()}>
          <RowMenu items={menuItems} />
        </span>
      )}
    </article>
  );
}
