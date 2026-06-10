// DayOfMonthInput — seletor de DIA DO MÊS (1-31), irmão semântico do TimeInput
// (pedido Alf 10/06: "tem que ser basicamente o mesmo pros dois — digitar OU
// escolher na lista, igual o diálogo de horário"). Mesma mecânica do TimeInput
// v2: trigger pill + popover fixed (escapa overflow do BottomSheet) com input
// digitável no topo + lista rolável de presets. value = '' ou '1'..'31'.
// Em mês curto o motor de grupos clampa sozinho (31 → último dia do mês).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';

interface Props {
  /** '1'..'31' ou string vazia (sem dia). */
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** Texto do trigger quando vazio. Default: "dia". */
  placeholder?: string;
}

const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

function normalizeDay(v: string): string {
  if (!/^\d{1,2}$/.test(v)) return '';
  const n = Number(v);
  return n >= 1 && n <= 31 ? String(n) : '';
}

export function DayOfMonthInput({ value, onChange, invalid, placeholder = 'dia' }: Props) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const [typed, setTyped] = useState(value);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Sincroniza typed com value externo.
  useEffect(() => {
    setTyped(value);
  }, [value]);

  // Fecha ao clicar fora.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      const inWrapper = wrapperRef.current?.contains(t);
      const inPopover = popoverRef.current?.contains(t);
      if (!inWrapper && !inPopover) {
        commitTyped();
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, typed]);

  // Calcula posicao fixed do popover ao abrir (flip pra cima se nao couber).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPopoverPos(null);
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const need = 280;
    const upward = window.innerHeight - rect.bottom < need && rect.top > need;
    const top = upward ? rect.top - need - 4 : rect.bottom + 4;
    const popoverWidth = 140;
    let left = rect.left;
    if (left + popoverWidth > window.innerWidth - 8) {
      left = window.innerWidth - popoverWidth - 8;
    }
    if (left < 8) left = 8;
    setPopoverPos({ top: Math.max(8, top), left });
  }, [open]);

  // Auto-scroll: ao abrir vai pro dia atual; enquanto digita, puxa pro dia digitado.
  // popoverPos nas deps: a lista so existe DEPOIS do popover ganhar posicao.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const target = normalizeDay(typed) || value || '1';
    const idx = DAYS.indexOf(target);
    if (idx < 0) return;
    const btn = listRef.current.children[idx] as HTMLElement | undefined;
    if (btn) {
      listRef.current.scrollTop = Math.max(0, btn.offsetTop - 80);
    }
  }, [open, popoverPos, value, typed]);

  function pick(day: string) {
    onChange(day);
    setTyped(day);
    setOpen(false);
  }

  function commitTyped() {
    const norm = normalizeDay(typed);
    if (norm && norm !== value) {
      onChange(norm);
    } else if (!norm) {
      // Campo esvaziado de proposito limpa o dia; lixo invalido reverte.
      if (typed.trim() === '' && value) onChange('');
      else setTyped(value);
    }
  }

  return (
    <div ref={wrapperRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'h-9 px-3 rounded-md bg-bg-elevated border focus-ring inline-flex items-center gap-2 tabular-nums',
          invalid ? 'border-danger' : 'border-border',
          value ? 'text-fg' : 'text-fg-muted',
        ].join(' ')}
      >
        <Calendar size={14} className="text-fg-muted shrink-0" />
        <span>{value ? `dia ${value}` : placeholder}</span>
      </button>
      {open && popoverPos && (
        <div
          ref={popoverRef}
          style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, width: 140, zIndex: 1000 }}
          className="rounded-md border border-border bg-bg-surface shadow-soft overflow-hidden"
        >
          <div className="p-2 border-b border-border">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value.replace(/\D/g, '').slice(0, 2))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTyped();
                  setOpen(false);
                }
                if (e.key === 'Escape') {
                  setTyped(value);
                  setOpen(false);
                }
              }}
              placeholder="1-31"
              className="w-full h-9 px-2 rounded-sm bg-bg-elevated border border-border text-body-md text-fg text-center tabular-nums focus-ring"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {DAYS.map((day) => {
              const selected = day === value;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  className={[
                    'w-full px-3 py-1.5 text-body-md tabular-nums text-left transition-colors',
                    selected
                      ? 'bg-tom/15 text-tom font-semibold'
                      : 'text-fg hover:bg-bg-elevated',
                  ].join(' ')}
                >
                  dia {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
