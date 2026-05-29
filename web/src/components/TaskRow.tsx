// Sprint 22.29 (audit Hoje, Mega-fatia C/Bucket 1) — TaskRow vira CARD individual.
// Antes: row dentro de container com divide-y. Agora: cada task eh um surface
// proprio com hierarquia tipografica clara (igual padrao Projetos / ProjectCard).
//
// Compat: continua usado em Hoje, Semana, PessoaDetalhe. As outras telas
// herdam o mesmo padrao de card sem mudar API publica.

import { Bot, GripVertical, Repeat } from 'lucide-react';
import { Badge } from './Badge';
import { ActionTypeBadge } from './ActionTypeBadge';
import { CategoryTag } from './CategoryTag';
import { TaskCheckbox } from './TaskCheckbox';
import { RowMenu, type MenuItem } from './RowMenu';
import { dragLiftStyle } from '../lib/sortableStyle';
import type { Task } from '../types';

// Eisenhower como dot inline. Q1 vermelho, Q2 âmbar, Q3 azul, Q4 sem dot.
// Sprint 22.32 — match com EventRow + nome generico (sem vazar "Eisenhower" pro user).
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
  /** Sprint 22.30 — Editar tarefa completo (titulo + contexto + datetime + Eisenhower). */
  onEdit?: (task: Task) => void;
  /** Sprint 22.28 — Reagendar tarefa (abre RescheduleSheet no parent). */
  onReschedule?: (task: Task) => void;
  /** Sprint 22.28 — Excluir tarefa (RowMenu confirm inline cuida do "tem certeza"). */
  onDelete?: (task: Task) => void;
  /** Sprint 22.29 — Sortable props (passadas pelo wrapper SortableTaskItem). */
  sortableRef?: (node: HTMLElement | null) => void;
  sortableStyle?: React.CSSProperties;
  sortableAttributes?: React.HTMLAttributes<HTMLElement>;
  sortableListeners?: React.DOMAttributes<HTMLElement>;
  isDragging?: boolean;
}

// Sprint 22.5 — fonte que NÃO seja manual indica que veio do TOM.
function fromTom(source?: string | null): boolean {
  if (!source) return false;
  return source !== 'manual';
}

// Sprint 11 Bloco B: formatadores de horário e data relativa em America/Sao_Paulo.
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
  const tmrw = new Date(today + 'T03:00:00.000Z'); tmrw.setUTCDate(tmrw.getUTCDate() + 1);
  const yest = new Date(today + 'T03:00:00.000Z'); yest.setUTCDate(yest.getUTCDate() - 1);
  if (day === today) return 'hoje';
  if (day === tmrw.toISOString().slice(0, 10)) return 'amanhã';
  if (day === yest.toISOString().slice(0, 10)) return 'ontem';
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : '';
}

function statusOf(task: Task): { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string | null } {
  if (task.status === 'done') return { tone: 'success', label: null };
  const today = todaySaoPauloISO();
  // Considera task_reminders multi (Sprint 23) como fallback do remind_at legado.
  const reminders = (task as Task & { task_reminders?: Array<{ remind_at: string; sent_at: string | null }> }).task_reminders;
  const earliestPending = (reminders ?? []).filter(r => !r.sent_at).map(r => r.remind_at).sort()[0];
  const effective = task.remind_at ?? earliestPending ?? null;
  const refDay = effective ? dayISOFromAny(effective) : task.due_date;
  if (refDay && refDay < today) {
    return { tone: 'danger', label: 'atrasada ' + fmtRelDate(refDay) };
  }
  if (task.status === 'overdue') return { tone: 'danger', label: 'atrasada' };
  return { tone: 'neutral', label: null };
}

const RELATIVE_DATES = new Set(['hoje', 'amanhã', 'ontem']);
function fmtSuffix(rel: string, dayIso: string): string {
  if (RELATIVE_DATES.has(rel)) return '';
  return ` (${dayIso.slice(8, 10)}/${dayIso.slice(5, 7)})`;
}

export function TaskRow({
  task, onToggle, readOnly, onEdit, onReschedule, onDelete,
  sortableRef, sortableStyle, sortableAttributes, sortableListeners, isDragging,
}: Props) {
  const { tone, label } = statusOf(task);
  const isDone = task.status === 'done';
  const isOverdue = tone === 'danger' && !isDone;
  const quadrantKey = task.eisenhower_quadrant ? String(task.eisenhower_quadrant) : null;
  const dotClass = quadrantKey && QUADRANT_DOT[quadrantKey] ? QUADRANT_DOT[quadrantKey] : null;
  // Sprint 23 — fallback de remind_at (legado single) pra task_reminders (multi).
  // Quando user usa o componente RemindersField novo, remind_at fica null e os
  // lembretes vão pra task_reminders. Aqui pegamos o primeiro pendente como display.
  const taskReminders = (task as Task & { task_reminders?: Array<{ remind_at: string; sent_at: string | null }> }).task_reminders;
  const earliestPendingReminder = (taskReminders ?? [])
    .filter(r => !r.sent_at)
    .map(r => r.remind_at)
    .sort()[0];
  const effectiveRemindAt = task.remind_at ?? earliestPendingReminder ?? null;
  const remindDay = effectiveRemindAt ? dayISOFromAny(effectiveRemindAt) : '';
  const dueDay = task.due_date || '';
  const remindRel = effectiveRemindAt ? fmtRelDate(effectiveRemindAt) : '';
  const dueRel = task.due_date ? fmtRelDate(task.due_date) : '';
  const showAssignee = task.assignee?.full_name;
  // Sprint 30 — tarefa recorrente: template (tem recurrence_rule) ou instância
  // gerada (tem recurrence_parent_id). Mostra ícone de repeat pra sinalizar UX.
  const taskRec = task as Task & { recurrence_rule?: string | null; recurrence_parent_id?: string | null };
  const isRecurring = Boolean(taskRec.recurrence_rule || taskRec.recurrence_parent_id);
  // Sprint 30 — horário-alvo da tarefa (due_time "HH:MM:SS" → "HH:MM").
  const dueHM = task.due_time ? task.due_time.slice(0, 5) : null;

  return (
    <article
      ref={sortableRef as ((node: HTMLElement | null) => void) | undefined}
      style={dragLiftStyle(isDragging, sortableStyle)}
      className={[
        'surface p-md flex items-start gap-md transition-opacity',
        isOverdue ? 'border-l-4 border-l-danger' : '',
        isDone ? 'opacity-60' : '',
        '',
      ].join(' ')}
      {...(sortableAttributes ?? {})}
    >
      {sortableListeners && (
        <span
          aria-label="Mover"
          className="mt-1 text-fg-muted/40 cursor-grab shrink-0 self-start"
          style={{ touchAction: 'none' }}
          {...sortableListeners}
        >
          <GripVertical size={16} />
        </span>
      )}
      {/* Sprint 22.30 — checkbox aparece sempre que onToggle for passado, mesmo
          em delegadas (creator pode dar baixa se assignee esqueceu). */}
      {onToggle && (
        <TaskCheckbox
          done={isDone}
          overdue={isOverdue}
          size="md"
          onClick={() => onToggle(task)}
        />
      )}

      <div className="min-w-0 flex-1">
        {/* Linha 1 — titulo (card-title pra hierarquia) */}
        <div className={['flex items-start gap-2', isDone ? 'line-through' : ''].join(' ')}>
          <span className="text-body-md font-medium min-w-0 flex-1 break-words leading-snug">
            {dotClass && !isDone && (
              <span
                aria-label={`Prioridade ${quadrantKey}`}
                title={`Prioridade ${quadrantKey}`}
                className={['inline-block h-2 w-2 rounded-full mr-2 align-middle', dotClass].join(' ')}
              />
            )}
            {task.title}
          </span>
          {isRecurring && (
            <span className="mt-1 shrink-0 text-fg-muted" title="Tarefa recorrente" aria-label="Tarefa recorrente">
              <Repeat size={14} />
            </span>
          )}
          {fromTom(task.source) && (
            <span className="mt-1 shrink-0 text-tom" title="Criada via TOM" aria-label="Criada via TOM">
              <Bot size={14} />
            </span>
          )}
        </div>

        {/* Linha 2 — data/lembrete */}
        {(effectiveRemindAt || task.due_date) && (
          <div className="mt-1.5 flex items-baseline gap-1.5 text-body-sm">
            {dueHM && (
              <span className="text-fg-muted tabular-nums" title={`Horário da tarefa: ${dueHM}`}>🕐 {dueHM}</span>
            )}
            {effectiveRemindAt ? (
              <>
                <span aria-hidden>⏰</span>
                <span className="font-semibold tabular-nums text-fg">{fmtTimeBR(effectiveRemindAt)}</span>
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

        {/* Linha 3 — meta secundaria (action type, categoria, contexto, assignee, status).
            Sprint 22.31: status badge ("atrasada") agora vai INLINE aqui em vez de
            lateral pra nao espremer titulo (cards estavam ficando vertical demais). */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-body-sm text-fg-muted">
          {label && <Badge tone={tone}>{label}</Badge>}
          <ActionTypeBadge type={task.action_type} />
          <CategoryTag project={task.projects as { name: string; category?: string } | null | undefined} />
          {task.context === 'personal' && <span>· pessoal</span>}
          {showAssignee && (
            <span>→ <span className="text-fg">{task.assignee!.full_name.split(' ')[0]}</span></span>
          )}
        </div>
      </div>

      {/* Sprint 22.29 (Bucket 4) — menu independente de readOnly: em delegadas
          o checkbox some (readOnly) mas reagendar/excluir continuam disponiveis
          pra quem delegou (created_by). */}
      {(onEdit || onReschedule || onDelete) && (() => {
        const items: MenuItem[] = [];
        if (onEdit) items.push({ label: 'Editar', onClick: () => onEdit(task) });
        if (onReschedule) items.push({ label: 'Reagendar', onClick: () => onReschedule(task) });
        if (onDelete) items.push({
          label: 'Excluir tarefa',
          danger: true,
          confirm: 'Excluir essa tarefa?',
          onClick: () => onDelete(task),
        });
        return items.length > 0 ? <div className="shrink-0 self-start"><RowMenu items={items} /></div> : null;
      })()}
    </article>
  );
}
