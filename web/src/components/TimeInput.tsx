// Sprint 22.26c — TimeInput v2: campo unico HH:MM + popover lista (30min steps).
// Substitui versao split (HH : MM 2 inputs). Suporta typing manual no input do
// topo do popover (qualquer HH:MM 0-23 / 0-59) + lista de presets pra clicar.
//
// Aceita value/onChange em formato HH:MM. Emite HH:MM ao escolher preset OU ao
// confirmar valor digitado (Enter / blur).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  /** HH:MM ou string vazia. */
  value: string;
  /** Disparado com HH:MM valido (sempre completo). */
  onChange: (value: string) => void;
  invalid?: boolean;
}

/** 48 slots: 00:00, 00:30, 01:00, ..., 23:30. */
const SLOTS = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

function isValidHHMM(v: string): boolean {
  if (!/^\d{1,2}:\d{2}$/.test(v)) return false;
  const [h, m] = v.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function normalize(v: string): string {
  if (!isValidHHMM(v)) return '';
  const [h, m] = v.split(':');
  return `${h.padStart(2, '0')}:${m}`;
}

export function TimeInput({ value, onChange, invalid }: Props) {
  const [open, setOpen] = useState(false);
  // Sprint 22.34e — posicao via fixed (escapa overflow do BottomSheet).
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

  // Calcula posicao fixed do popover ao abrir.
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

  // Auto-scroll pra slot mais proximo do value atual ao abrir.
  useLayoutEffect(() => {
    if (!open || !listRef.current) return;
    const target = value || '09:00';
    // Acha indice do slot >= target.
    const targetMin = (() => {
      const [h, m] = target.split(':').map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })();
    let idx = SLOTS.findIndex(s => {
      const [h, m] = s.split(':').map(Number);
      return h * 60 + m >= targetMin;
    });
    if (idx < 0) idx = 0;
    const btn = listRef.current.children[idx] as HTMLElement | undefined;
    if (btn) {
      listRef.current.scrollTop = Math.max(0, btn.offsetTop - 80);
    }
  }, [open, value]);

  function pick(slot: string) {
    onChange(slot);
    setTyped(slot);
    setOpen(false);
  }

  function commitTyped() {
    const norm = normalize(typed);
    if (norm && norm !== value) {
      onChange(norm);
    } else if (!norm) {
      // Reverte pro value anterior se invalido.
      setTyped(value);
    }
  }

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
        <Clock size={14} className="text-fg-muted shrink-0" />
        <span>{value || 'HH:MM'}</span>
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
              onChange={(e) => {
                // Aceita digitos + ":" durante typing.
                let v = e.target.value.replace(/[^\d:]/g, '');
                // Auto-insere ":" depois de 2 digitos.
                if (v.length === 2 && !v.includes(':')) v = `${v}:`;
                setTyped(v.slice(0, 5));
              }}
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
              placeholder="HH:MM"
              className="w-full h-9 px-2 rounded-sm bg-bg-elevated border border-border text-body-md text-fg text-center tabular-nums focus-ring"
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {SLOTS.map((slot) => {
              const selected = slot === value;
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => pick(slot)}
                  className={[
                    'w-full px-3 py-1.5 text-body-md tabular-nums text-left transition-colors',
                    selected
                      ? 'bg-tom/15 text-tom font-semibold'
                      : 'text-fg hover:bg-bg-elevated',
                  ].join(' ')}
                >
                  {slot}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
