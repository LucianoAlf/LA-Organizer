// Componente compartilhado de lembretes (multi-select).
// Usado em EditEventSheet (mobile), EditTaskSheet (mobile),
// EventEditDrawer (desktop), TaskEditDrawer (desktop).
//
// API uniforme:
//   - `referenceDateTime`: datetime de referência (start_at do evento OU
//     09:00 da due_date pra task). Formato datetime-local "YYYY-MM-DDTHH:MM".
//   - `value`: array de datetime-local strings (cada um = 1 lembrete).
//   - `onChange(next)`: callback ao alterar a lista.
//
// Persistência: o consumidor é responsável por sincronizar `value` com a
// tabela correta (event_reminders ou task_reminders) no save.
//
// TOM dispatcher já lê AMBAS as tabelas (event_reminders + task_reminders)
// e envia WhatsApp marcando sent_at quando entrega.

import { DateTimeInput } from './DateTimeInput';

const PRESETS = [
  { label: 'Na hora',      minutes: 0    },
  { label: '15min antes',  minutes: 15   },
  { label: '30min antes',  minutes: 30   },
  { label: '1h antes',     minutes: 60   },
  { label: '2h antes',     minutes: 120  },
  { label: '1 dia antes',  minutes: 1440 },
] as const;

interface Props {
  /** Datetime de referência (datetime-local "YYYY-MM-DDTHH:MM"). */
  referenceDateTime: string;
  /** Array de datetime-local strings (1 por lembrete). */
  value: string[];
  /** Callback ao alterar a lista. */
  onChange: (next: string[]) => void;
  /** Desabilita interação. */
  disabled?: boolean;
}

/** Converte datetime-local → Date (assume timezone SP -03:00). */
function localToDate(local: string): Date {
  return new Date(`${local}:00-03:00`);
}

/** Converte Date → datetime-local "YYYY-MM-DDTHH:MM" no fuso SP. */
function dateToLocal(d: Date): string {
  // toISOString é UTC. Pra exibir local SP, descontamos 3h e cortamos.
  const sp = new Date(d.getTime() - 3 * 3600_000);
  return sp.toISOString().slice(0, 16);
}

export function RemindersField({ referenceDateTime, value, onChange, disabled }: Props) {
  const hasRef = Boolean(referenceDateTime);
  const refMs = hasRef ? localToDate(referenceDateTime).getTime() : 0;

  function computePresetLocal(minutes: number): string {
    if (!hasRef) return '';
    return dateToLocal(new Date(refMs - minutes * 60_000));
  }

  function togglePreset(minutes: number) {
    const presetLocal = computePresetLocal(minutes);
    if (!presetLocal) return;
    const active = value.includes(presetLocal);
    onChange(active
      ? value.filter(t => t !== presetLocal)
      : [...value, presetLocal].sort());
  }

  function updateCustom(idx: number, next: string) {
    const arr = [...value];
    arr[idx] = next;
    onChange(arr);
  }

  function removeAt(idx: number) {
    onChange(value.filter((_, i) => i !== idx));
  }

  function clearAll() {
    onChange([]);
  }

  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-fg-muted font-semibold mb-1.5 flex items-baseline gap-2">
        <span>Lembretes</span>
        <span className="text-[10px] normal-case tracking-normal text-fg-muted/70">
          selecione quantos quiser
        </span>
      </div>

      {/* Preset chips — multi-select */}
      <div className="flex flex-wrap gap-2 mb-2">
        {PRESETS.map(p => {
          const presetLocal = computePresetLocal(p.minutes);
          const active = presetLocal && value.includes(presetLocal);
          return (
            <button
              key={p.minutes}
              type="button"
              onClick={() => togglePreset(p.minutes)}
              disabled={disabled || !hasRef}
              className={[
                'px-3 py-1 rounded-full text-[12px] border transition-colors focus-ring',
                active
                  ? 'bg-tom text-black border-tom font-semibold'
                  : 'bg-bg-elevated text-fg-muted border-border hover:text-fg disabled:opacity-40 disabled:cursor-not-allowed',
              ].join(' ')}
            >
              {p.label}
            </button>
          );
        })}
        {value.length > 0 && !disabled && (
          <button
            type="button"
            onClick={clearAll}
            className="px-3 py-1 rounded-full text-[12px] border border-border bg-bg-elevated text-danger hover:opacity-80 focus-ring"
          >
            Limpar
          </button>
        )}
      </div>

      {/* Lista de lembretes (customizáveis) */}
      {value.length > 0 ? (
        <ul className="space-y-2">
          {value.map((t, idx) => (
            <li key={`${t}-${idx}`} className="flex items-center gap-2">
              <DateTimeInput
                value={t}
                onChange={(v) => updateCustom(idx, v)}
              />
              <button
                type="button"
                onClick={() => removeAt(idx)}
                disabled={disabled}
                className="px-2 py-1 text-[12px] rounded-sm bg-bg-elevated text-danger hover:opacity-80 focus-ring whitespace-nowrap disabled:opacity-40"
              >
                Remover
              </button>
            </li>
          ))}
        </ul>
      ) : hasRef ? (
        <p className="text-[12px] text-fg-muted">
          Sem lembretes. Toque num preset acima pra adicionar.
        </p>
      ) : (
        <p className="text-[12px] text-fg-muted">
          Defina a data primeiro pra escolher lembretes.
        </p>
      )}

      {value.length > 0 && (
        <p className="text-[10px] text-fg-muted mt-1.5">
          {value.length} lembrete{value.length > 1 ? 's' : ''} · TOM vai avisar pelo WhatsApp.
        </p>
      )}
    </div>
  );
}
