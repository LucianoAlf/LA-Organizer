// Sprint 22.26c — DateInput v2: campo unico DD/MM/AAAA + popover de calendario.
// Substitui versao split (3 inputs DD/MM/AAAA) que era hostil pra editar.
//
// Aceita value/onChange em formato YYYY-MM-DD. Emite YYYY-MM-DD ao escolher
// dia no calendario. Popover fecha ao escolher ou ao clicar fora.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  /** YYYY-MM-DD ou string vazia. */
  value: string;
  /** Disparado com YYYY-MM-DD valido (sempre completo apos pick). */
  onChange: (value: string) => void;
  /** Marca borda como danger pra estados de erro. */
  invalid?: boolean;
  /** Apenas pra compat com chamadas antigas; nao tem efeito (popover usa click). */
  autoFocus?: boolean;
}

const PT_MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const PT_WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function parseYmd(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function todayYmd(): string {
  return toYmd(new Date());
}

function formatBR(value: string): string {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  return `${d}/${m}/${y}`;
}

function addMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  return r;
}

/** Retorna 42 datas (6 semanas) centradas no `month`, comecando no domingo. */
function getCalendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(start.getDate() - first.getDay());  // back to Sunday
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function DateInput({ value, onChange, invalid }: Props) {
  const [open, setOpen] = useState(false);
  // Sprint 22.34e — posicionamento via fixed (escapa do overflow do BottomSheet).
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const initialView = parseYmd(value) ?? new Date();
  const [viewMonth, setViewMonth] = useState<Date>(initialView);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sincroniza viewMonth quando value muda externamente.
  useEffect(() => {
    const v = parseYmd(value);
    if (v) setViewMonth(new Date(v.getFullYear(), v.getMonth(), 1));
  }, [value]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      const inWrapper = wrapperRef.current?.contains(t);
      const inPopover = popoverRef.current?.contains(t);
      if (!inWrapper && !inPopover) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Calcula posicao fixed do popover ao abrir (relativa ao viewport).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const need = 360;
    const upward = window.innerHeight - rect.bottom < need && rect.top > need;
    const top = upward ? rect.top - need - 4 : rect.bottom + 4;
    const popoverWidth = 280;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 8) {
      left = window.innerWidth - popoverWidth - 8;
    }
    if (left < 8) left = 8;
    setPopoverPos({ top: Math.max(8, top), left });
  }, [open]);

  function pick(d: Date) {
    onChange(toYmd(d));
    setOpen(false);
  }

  const selectedYmd = value;
  const today = todayYmd();
  const days = getCalendarDays(viewMonth);
  const monthLabel = `${PT_MONTHS[viewMonth.getMonth()]} ${viewMonth.getFullYear()}`;

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'h-12 px-3 rounded-md bg-bg-elevated border focus-ring inline-flex items-center gap-2 tabular-nums',
          invalid ? 'border-danger' : 'border-border',
          value ? 'text-fg' : 'text-fg-muted',
        ].join(' ')}
      >
        <Calendar size={14} className="text-fg-muted shrink-0" />
        <span>{value ? formatBR(value) : 'DD/MM/AAAA'}</span>
      </button>
      {open && popoverPos && (
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, width: 280, zIndex: 1000 }}
          className="p-3 rounded-md border border-border bg-bg-surface shadow-soft"
        >
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewMonth(addMonths(viewMonth, -1))}
              aria-label="Mês anterior"
              className="p-1 text-fg-muted hover:text-fg focus-ring rounded-sm"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="text-body-md font-semibold capitalize">{monthLabel}</div>
            <button
              type="button"
              onClick={() => setViewMonth(addMonths(viewMonth, 1))}
              aria-label="Próximo mês"
              className="p-1 text-fg-muted hover:text-fg focus-ring rounded-sm"
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-[10px] text-fg-muted text-center mb-1 uppercase tracking-wide">
            {PT_WEEKDAYS.map((d, i) => <div key={i}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d, i) => {
              const ymd = toYmd(d);
              const isSelected = ymd === selectedYmd;
              const isToday = ymd === today;
              const isOtherMonth = d.getMonth() !== viewMonth.getMonth();
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => pick(d)}
                  className={[
                    'h-8 rounded-sm focus-ring tabular-nums text-body-sm transition-colors',
                    isSelected
                      ? 'bg-tom text-white font-semibold hover:bg-tom-shade'
                      : isToday
                        ? 'ring-1 ring-tom/50 text-fg hover:bg-bg-elevated'
                        : 'hover:bg-bg-elevated text-fg',
                    isOtherMonth && !isSelected ? 'text-fg-muted/40' : '',
                  ].join(' ')}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => pick(new Date())}
              className="text-body-sm text-tom hover:text-tom-shade focus-ring rounded-sm px-1"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-body-sm text-fg-muted hover:text-fg focus-ring rounded-sm px-1"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
