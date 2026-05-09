// Sprint 22.49 — header reutilizavel com chevrons + label clicavel + date picker.
// Usado por Hoje (step=1) e Semana (step=7). Label clicavel abre popover via DateInput.

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DateInput } from './DateInput';
import { ymdAddDays } from '../utils/date';

interface Props {
  /** YMD atualmente exibido. */
  value: string;
  /** Mudanca de data — chevron ou pick no calendario. */
  onChange: (ymd: string) => void;
  /** Quantos dias avanca/recua o chevron. 1 pra Hoje, 7 pra Semana. */
  step: number;
  /** Texto curto exibido entre os chevrons. */
  label: string;
  /** YMD de hoje real — quando value !== today, mostra botao "Voltar pra hoje". */
  today: string;
  /** Texto do botao "voltar pra hoje". Default: "Hoje". */
  todayLabel?: string;
}

export function DateNavHeader({ value, onChange, step, label, today, todayLabel = 'Hoje' }: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const isToday = value === today;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onChange(ymdAddDays(value, -step))}
        aria-label={step === 1 ? 'Dia anterior' : 'Semana anterior'}
        className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring"
      >
        <ChevronLeft size={18} />
      </button>

      <button
        type="button"
        onClick={() => setPickerOpen(o => !o)}
        className="flex-1 min-w-0 text-center text-body-md text-fg hover:bg-bg-elevated rounded-sm py-1 focus-ring truncate"
        aria-label="Escolher data"
      >
        {label}
      </button>

      <button
        type="button"
        onClick={() => onChange(ymdAddDays(value, step))}
        aria-label={step === 1 ? 'Próximo dia' : 'Próxima semana'}
        className="h-8 w-8 grid place-items-center rounded-full text-fg-muted hover:bg-bg-elevated focus-ring"
      >
        <ChevronRight size={18} />
      </button>

      {!isToday && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="ml-1 px-2 py-1 text-body-sm rounded-sm bg-bg-elevated text-fg-secondary hover:text-fg focus-ring"
        >
          {todayLabel}
        </button>
      )}

      {pickerOpen && (
        <div className="absolute z-50 mt-12">
          <div className="bg-bg-surface border border-border rounded-md shadow-soft p-2 w-[260px]">
            <DateInput
              value={value}
              onChange={(v) => { onChange(v); setPickerOpen(false); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
