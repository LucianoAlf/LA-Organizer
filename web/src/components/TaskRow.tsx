import { Check } from 'lucide-react';
import { Badge } from './Badge';
import type { Task } from '../types';

interface Props {
  task: Task;
  onToggle?: (task: Task) => void;
  /** Quando true, esconde o checkbox e bloqueia interação. Para visões coord/director em PessoaDetalhe. */
  readOnly?: boolean;
}

// Sprint 11 Bloco B: formatadores de horário e data relativa em America/Sao_Paulo.
// Coerência com WhatsApp do TOM ("amanhã 10h", não "29/04/2026 10:00:00").
function todaySaoPauloISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function fmtTimeBR(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const hh = parts.find(p => p.type === 'hour')?.value || '00';
  const mm = parts.find(p => p.type === 'minute')?.value || '00';
  return mm === '00' ? `${parseInt(hh, 10)}h` : `${parseInt(hh, 10)}h${mm}`;
}
function dayISOFromAny(s: string | null): string {
  if (!s) return '';
  if (s.includes('T')) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(s));
  }
  return s.slice(0, 10);
}
function fmtRelDate(iso: string | null): string {
  if (!iso) return '';
  const day = dayISOFromAny(iso);
  const today = todaySaoPauloISO();
  // amanhã/hoje/ontem
  const todayD = new Date(today + 'T03:00:00.000Z');
  const tmrw = new Date(today + 'T03:00:00.000Z'); tmrw.setUTCDate(tmrw.getUTCDate() + 1);
  const yest = new Date(today + 'T03:00:00.000Z'); yest.setUTCDate(yest.getUTCDate() - 1);
  if (day === today) return 'hoje';
  if (day === tmrw.toISOString().slice(0, 10)) return 'amanhã';
  if (day === yest.toISOString().slice(0, 10)) return 'ontem';
  // DD/MM
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})/);
  void todayD;
  return m ? `${m[3]}/${m[2]}` : '';
}

function statusOf(task: Task): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string | null } {
  if (task.status === 'done') return { tone: 'success', label: 'Concluída' };
  if (task.status === 'overdue') return { tone: 'danger', label: 'Atrasada' };
  const today = todaySaoPauloISO();
  // Prioriza remind_at se houver
  const refDay = task.remind_at ? dayISOFromAny(task.remind_at) : task.due_date;
  if (refDay) {
    if (refDay < today) return { tone: 'danger', label: 'Atrasada desde ' + fmtRelDate(refDay) };
    if (refDay === today) return { tone: 'warning', label: 'Hoje' };
  }
  return { tone: 'neutral', label: null };
}

export function TaskRow({ task, onToggle, readOnly }: Props) {
  const { tone, label } = statusOf(task);
  const isDone = task.status === 'done';
  return (
    <div
      className={[
        'flex items-start gap-md py-3 border-b border-border last:border-0',
        isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      {!readOnly && (
        <button
          type="button"
          onClick={() => onToggle?.(task)}
          aria-label={isDone ? 'Reabrir tarefa' : 'Concluir tarefa'}
          className={[
            'mt-0.5 h-6 w-6 shrink-0 rounded-md border grid place-items-center transition-colors focus-ring',
            isDone
              ? 'bg-success border-success text-white'
              : 'border-border hover:border-brand text-transparent hover:text-brand',
          ].join(' ')}
        >
          <Check size={14} strokeWidth={3} />
        </button>
      )}

      <div className="min-w-0 flex-1">
        <div className={['text-body-md', isDone ? 'line-through' : ''].join(' ')}>
          {task.title}
        </div>
        {/* Sprint 11 Bloco B: linha de horário/data prominente — visível em
            todos os contextos (lista, detalhe, semana). Coerente com WA TOM. */}
        {(task.remind_at || task.due_date) && (
          <div className="mt-1 flex items-baseline gap-1.5 text-body-sm text-fg">
            {task.remind_at ? (
              <>
                <span aria-hidden>⏰</span>
                <span className="font-semibold tabular-nums">{fmtTimeBR(task.remind_at)}</span>
                <span className="text-fg-muted">·</span>
                <span className="text-fg-muted">{fmtRelDate(task.remind_at)}</span>
                <span className="text-fg-muted tabular-nums">({dayISOFromAny(task.remind_at).slice(8, 10)}/{dayISOFromAny(task.remind_at).slice(5, 7)})</span>
              </>
            ) : (
              <>
                <span aria-hidden>📅</span>
                <span className="text-fg-muted">{fmtRelDate(task.due_date)}</span>
                <span className="text-fg-muted tabular-nums">({task.due_date!.slice(8, 10)}/{task.due_date!.slice(5, 7)})</span>
              </>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          {task.projects?.name && <span>• {task.projects.name}</span>}
          {task.context === 'personal' && <span>• pessoal</span>}
        </div>
      </div>

      {label && <Badge tone={tone}>{label}</Badge>}
    </div>
  );
}
