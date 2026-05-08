import { Bot } from 'lucide-react';
import { Badge } from './Badge';
import { ActionTypeBadge } from './ActionTypeBadge';
import { CategoryTag } from './CategoryTag';
import { TaskCheckbox } from './TaskCheckbox';
import { RowMenu, type MenuItem } from './RowMenu';
import type { Task } from '../types';

// Sprint 22 Phase A — palette + checkbox migrados (docs/design-system.md §1.2/§4.2).

// Eisenhower como dot inline. Q1 vermelho, Q2 âmbar, Q3 azul, Q4 sem dot.
const QUADRANT_DOT: Record<string, string> = {
  '1': 'bg-danger',
  '2': 'bg-warning',
  '3': 'bg-info',
};

interface Props {
  task: Task;
  onToggle?: (task: Task) => void;
  /** Quando true, esconde o checkbox e bloqueia interação. Para visões coord/director em PessoaDetalhe. */
  readOnly?: boolean;
  /** Sprint 22.28 — Reagendar tarefa (abre RescheduleSheet no parent). */
  onReschedule?: (task: Task) => void;
  /** Sprint 22.28 — Excluir tarefa (RowMenu confirm inline cuida do "tem certeza"). */
  onDelete?: (task: Task) => void;
}

// Sprint 22.5 — fonte que NÃO seja manual indica que veio do TOM (mental_dump, agent_*, coordinator_assignment).
function fromTom(source?: string | null): boolean {
  if (!source) return false;
  return source !== 'manual';
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

// Sprint 22.5 — só mantém badge pra "atrasada desde X" (info útil). "Hoje"/"Concluída"
// viraram redundantes com o agrupamento visual + line-through em done.
function statusOf(task: Task): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string | null } {
  if (task.status === 'done') return { tone: 'success', label: null };
  const today = todaySaoPauloISO();
  const refDay = task.remind_at ? dayISOFromAny(task.remind_at) : task.due_date;
  if (refDay && refDay < today) {
    return { tone: 'danger', label: 'atrasada ' + fmtRelDate(refDay) };
  }
  if (task.status === 'overdue') return { tone: 'danger', label: 'atrasada' };
  return { tone: 'neutral', label: null };
}

// Sprint 22.5 — mostra "(DD/MM)" só quando a data NÃO é hoje/amanhã/ontem
// (data relativa já cobre o curto prazo, suffix vira ruído).
const RELATIVE_DATES = new Set(['hoje', 'amanhã', 'ontem']);
function fmtSuffix(rel: string, dayIso: string): string {
  if (RELATIVE_DATES.has(rel)) return '';
  return ` (${dayIso.slice(8, 10)}/${dayIso.slice(5, 7)})`;
}

export function TaskRow({ task, onToggle, readOnly, onReschedule, onDelete }: Props) {
  const { tone, label } = statusOf(task);
  const isDone = task.status === 'done';
  const quadrantKey = task.eisenhower_quadrant ? String(task.eisenhower_quadrant) : null;
  const dotClass = quadrantKey && QUADRANT_DOT[quadrantKey] ? QUADRANT_DOT[quadrantKey] : null;
  const remindDay = task.remind_at ? dayISOFromAny(task.remind_at) : '';
  const dueDay = task.due_date || '';
  const remindRel = task.remind_at ? fmtRelDate(task.remind_at) : '';
  const dueRel = task.due_date ? fmtRelDate(task.due_date) : '';
  const showAssignee = readOnly && task.assignee?.full_name;
  const isOverdue = tone === 'danger';

  return (
    <div
      className={[
        'flex items-start gap-md py-3 transition-opacity',
        isDone ? 'opacity-50' : '',
      ].join(' ')}
    >
      {!readOnly && (
        <TaskCheckbox
          done={isDone}
          overdue={isOverdue}
          size="md"
          onClick={() => onToggle?.(task)}
        />
      )}

      <div className="min-w-0 flex-1">
        <div className={['flex items-start gap-2 text-body-md', isDone ? 'line-through' : ''].join(' ')}>
          <span className="min-w-0 flex-1 break-words">
            {dotClass && !isDone && (
              <span
                aria-label={`Eisenhower Q${quadrantKey}`}
                title={`Q${quadrantKey}`}
                className={['inline-block h-1.5 w-1.5 rounded-full mr-1.5 align-middle', dotClass].join(' ')}
              />
            )}
            {task.title}
          </span>
          {fromTom(task.source) && (
            <span className="mt-1 shrink-0 text-tom" title="Criada via TOM" aria-label="Criada via TOM">
              <Bot size={14} />
            </span>
          )}
        </div>
        {(task.remind_at || task.due_date) && (
          <div className="mt-1 flex items-baseline gap-1.5 text-body-sm text-fg">
            {task.remind_at ? (
              <>
                <span aria-hidden>⏰</span>
                <span className="font-semibold tabular-nums">{fmtTimeBR(task.remind_at)}</span>
                <span className="text-fg-muted">·</span>
                <span className="text-fg-muted">{remindRel}{fmtSuffix(remindRel, remindDay)}</span>
              </>
            ) : (
              <>
                <span aria-hidden>📅</span>
                <span className="text-fg-muted">{dueRel}{fmtSuffix(dueRel, dueDay)}</span>
              </>
            )}
          </div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          <ActionTypeBadge type={task.action_type} />
          <CategoryTag project={task.projects as { name: string; category?: string } | null | undefined} />
          {task.context === 'personal' && <span>• pessoal</span>}
          {showAssignee && (
            <span>→ <span className="text-fg">{task.assignee!.full_name.split(' ')[0]}</span></span>
          )}
        </div>
      </div>

      {label && <Badge tone={tone}>{label}</Badge>}

      {!readOnly && (onReschedule || onDelete) && (() => {
        const items: MenuItem[] = [];
        if (onReschedule) items.push({ label: 'Reagendar', onClick: () => onReschedule(task) });
        if (onDelete) items.push({
          label: 'Excluir tarefa',
          danger: true,
          confirm: 'Excluir essa tarefa?',
          onClick: () => onDelete(task),
        });
        return items.length > 0 ? <RowMenu items={items} /> : null;
      })()}
    </div>
  );
}
