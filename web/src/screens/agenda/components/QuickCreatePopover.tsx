import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const CATEGORY_KEY = 'agenda.lastCategory';
const DURATIONS_MIN = [15, 30, 45, 60, 90, 120];

export type CreateEventPayload = {
  title: string; start_at: string; end_at: string;
  category: string; context: 'work' | 'personal';
};
export type CreateTaskPayload = {
  title: string; due_date: string; context: 'work' | 'personal';
};

export interface QuickCreatePopoverProps {
  mode: 'event' | 'task';
  anchor: { x: number; y: number; date: Date; time?: Date };
  onClose: () => void;
  onCreate: (payload: CreateEventPayload | CreateTaskPayload) => Promise<void> | void;
  onMoreOptions?: (draft: Partial<CreateEventPayload>) => void;
}

const CATEGORIES = [
  { value: 'la_music', label: 'LA Music' },
  { value: 'mentoria', label: 'Mentoria' },
  { value: 'estudio',  label: 'Estúdio' },
  { value: 'show',     label: 'Show' },
  { value: 'pessoal',  label: 'Pessoal' },
];

export function QuickCreatePopover(p: QuickCreatePopoverProps) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>(() =>
    (typeof window !== 'undefined' && localStorage.getItem(CATEGORY_KEY)) || 'la_music');
  const [durationMin, setDurationMin] = useState(60);
  const [time, setTime] = useState<string>(() =>
    p.anchor.time ? p.anchor.time.toTimeString().slice(0, 5) : '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') p.onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [p]);

  const context: 'work' | 'personal' = category === 'pessoal' ? 'personal' : 'work';

  const submit = async () => {
    if (!title.trim()) return;
    if (p.mode === 'event') {
      if (!time) { alert('Defina o horário'); return; }
      const [hh, mm] = time.split(':').map(Number);
      const start = new Date(p.anchor.date); start.setHours(hh, mm, 0, 0);
      const end = new Date(start.getTime() + durationMin * 60_000);
      try { localStorage.setItem(CATEGORY_KEY, category); } catch {}
      await p.onCreate({
        title: title.trim(),
        start_at: start.toISOString(),
        end_at: end.toISOString(),
        category, context,
      });
    } else {
      await p.onCreate({
        title: title.trim(),
        due_date: p.anchor.date.toISOString().slice(0, 10),
        context,
      });
    }
    p.onClose();
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9998]" onClick={p.onClose} />
      <div
        role="dialog"
        className="fixed z-[9999] w-[340px] rounded-lg border border-border bg-bg-elevated2 shadow-2xl p-3"
        style={{ left: Math.min(p.anchor.x, window.innerWidth - 360), top: Math.max(8, p.anchor.y - 80) }}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] font-semibold text-fg">
            {p.mode === 'event' ? '📅 Novo evento' : '✓ Nova tarefa'}
          </div>
          <button onClick={p.onClose} className="text-fg-muted hover:text-fg focus-ring rounded">
            <X size={14} />
          </button>
        </div>
        <input
          ref={inputRef} type="text" value={title} maxLength={200}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={p.mode === 'event' ? 'Título do evento' : 'Título da tarefa'}
          className="w-full h-9 px-2 rounded-md bg-bg-surface border border-border text-fg text-[13px] focus:outline-none focus:border-tom"
        />
        {p.mode === 'event' && (
          <div className="mt-2 flex items-center gap-2 text-[12px] text-fg-muted">
            <span>{p.anchor.date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)}
              className="h-7 px-1 rounded bg-bg-surface border border-border text-fg tabular-nums focus:outline-none focus:border-tom" />
            <select value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}
              className="h-7 px-1 rounded bg-bg-surface border border-border text-fg focus:outline-none focus:border-tom">
              {DURATIONS_MIN.map(m => <option key={m} value={m}>{m < 60 ? `${m}min` : `${m/60}h`}</option>)}
            </select>
          </div>
        )}
        <div className="mt-2 flex items-center gap-2">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className="h-7 px-2 text-[11px] rounded-full bg-bg-surface border border-border text-fg">
            {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          <span className="text-[10px] text-fg-muted">→ {context === 'work' ? 'Trabalho' : 'Pessoal'}</span>
        </div>
        <div className="mt-3 flex items-center justify-between">
          {p.mode === 'event' && p.onMoreOptions ? (
            <button
              type="button"
              onClick={() => p.onMoreOptions!({
                title, category, context,
                start_at: time ? buildIso(p.anchor.date, time) : undefined,
                end_at: time ? buildIso(p.anchor.date, time, durationMin) : undefined,
              })}
              className="text-[11px] text-fg-muted hover:text-fg focus-ring rounded">
              + Mais opções
            </button>
          ) : <span />}
          <button
            type="button" onClick={submit}
            className="h-8 px-3 rounded-md bg-tom text-black text-[12px] font-semibold hover:opacity-90 focus-ring">
            Salvar (↵)
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

function buildIso(date: Date, time: string, addMin = 0): string {
  const [hh, mm] = time.split(':').map(Number);
  const d = new Date(date); d.setHours(hh, mm + addMin, 0, 0);
  return d.toISOString();
}
