// Sprint 29.4 — Picker de recorrência para tasks e events.
// Usa RRULE iCalendar (RFC 5545) internamente. UI expõe 7 presets familiares
// + opção custom (string RRULE livre, pra power users).
// Mostra preview das próximas 3 ocorrências pro user confirmar antes de salvar.

import { useMemo, useState } from 'react';
import { RRule, rrulestr } from 'rrule';
import { CustomSelect } from './CustomSelect';
import { Field } from './Field';

type Preset =
  | 'none'
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'monthly_dow'   // primeira/última X-feira do mês
  | 'yearly'
  | 'custom';

interface Props {
  /** RRULE string atual, ou null/'' se não-recorrente. */
  value: string | null;
  /** Callback com nova RRULE (ou null se "não repetir"). */
  onChange: (rrule: string | null) => void;
  /** YYYY-MM-DD — usado pra calcular default de BYDAY/BYMONTHDAY. */
  startDate: string;
  /** Se omit, mostra preview das próximas 3 ocorrências. */
  hidePreview?: boolean;
}

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

const PRESETS: { value: Preset; label: string; sublabel?: string }[] = [
  { value: 'none',        label: 'Não repetir' },
  { value: 'daily',       label: 'Todo dia' },
  { value: 'weekdays',    label: 'Dias úteis (seg–sex)' },
  { value: 'weekly',      label: 'Toda semana', sublabel: 'mesmo dia da semana' },
  { value: 'biweekly',    label: 'A cada 2 semanas' },
  { value: 'monthly',     label: 'Todo mês', sublabel: 'no mesmo dia do mês' },
  { value: 'monthly_dow', label: 'Mês (mesma semana)', sublabel: 'ex: 2ª segunda' },
  { value: 'yearly',      label: 'Todo ano' },
  { value: 'custom',      label: 'Personalizado…', sublabel: 'RRULE livre' },
];

function presetToRrule(preset: Preset, startDate: string): string | null {
  const d = new Date(startDate + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  const dayCode = DAY_CODES[d.getUTCDay()];
  const dayOfMonth = d.getUTCDate();
  switch (preset) {
    case 'none':        return null;
    case 'daily':       return 'FREQ=DAILY';
    case 'weekdays':    return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'weekly':      return `FREQ=WEEKLY;BYDAY=${dayCode}`;
    case 'biweekly':    return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`;
    case 'monthly':     return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`;
    case 'monthly_dow': {
      const weekOfMonth = Math.ceil(dayOfMonth / 7);
      return `FREQ=MONTHLY;BYDAY=${weekOfMonth}${dayCode}`;
    }
    case 'yearly':      return `FREQ=YEARLY;BYMONTH=${d.getUTCMonth() + 1};BYMONTHDAY=${dayOfMonth}`;
    case 'custom':      return null;
    default:            return null;
  }
}

function rruleToPreset(rrule: string | null): Preset {
  if (!rrule) return 'none';
  const r = rrule.trim().toUpperCase();
  if (r === 'FREQ=DAILY') return 'daily';
  if (r === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(r)) return 'weekly';
  if (/^FREQ=WEEKLY;INTERVAL=2;BYDAY=[A-Z]{2}$/.test(r)) return 'biweekly';
  if (/^FREQ=MONTHLY;BYMONTHDAY=-?\d{1,2}$/.test(r)) return 'monthly';
  if (/^FREQ=MONTHLY;BYDAY=-?\d?[A-Z]{2}$/.test(r)) return 'monthly_dow';
  if (/^FREQ=YEARLY/.test(r)) return 'yearly';
  return 'custom';
}

function previewOccurrences(rrule: string | null, startDate: string, count: number = 3): string[] {
  if (!rrule || !startDate) return [];
  try {
    const dt = new Date(startDate + 'T12:00:00Z');
    if (isNaN(dt.getTime())) return [];
    const dtStr = dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const rule = rrulestr(`DTSTART:${dtStr}\nRRULE:${rrule.replace(/^RRULE:/i, '')}`);
    const occs = rule.all((_d, i) => i < count);
    return occs.map((d: Date) =>
      d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
    );
  } catch {
    return [];
  }
}

export function RecurrencePicker({ value, onChange, startDate, hidePreview }: Props) {
  const [preset, setPreset] = useState<Preset>(rruleToPreset(value));
  const [customRrule, setCustomRrule] = useState(
    rruleToPreset(value) === 'custom' ? (value ?? '') : ''
  );

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'custom') {
      onChange(customRrule || null);
    } else {
      onChange(presetToRrule(p, startDate));
    }
  }

  function applyCustom(input: string) {
    setCustomRrule(input);
    onChange(input.trim() || null);
  }

  const preview = useMemo(
    () => (hidePreview ? [] : previewOccurrences(value, startDate, 3)),
    [value, startDate, hidePreview]
  );

  return (
    <Field label="Repetição">
      <CustomSelect
        value={preset}
        options={PRESETS.map(p => ({ value: p.value, label: p.label, sublabel: p.sublabel }))}
        onChange={(v) => applyPreset(v as Preset)}
        size="md"
      />
      {preset === 'custom' && (
        <input
          className="mt-sm w-full bg-bg-surface border border-border rounded-md p-2 text-fg focus:outline-none focus:border-tom font-mono text-body-sm"
          placeholder="ex: FREQ=MONTHLY;BYDAY=-1FR"
          value={customRrule}
          onChange={(e) => applyCustom(e.target.value)}
        />
      )}
      {!hidePreview && value && preview.length > 0 && (
        <p className="mt-xs text-body-sm text-fg-muted">
          📅 Próximas: <span className="text-fg">{preview.join(' • ')}</span>
        </p>
      )}
      {!hidePreview && value && preview.length === 0 && (
        <p className="mt-xs text-body-sm text-red-500">
          ⚠ RRULE inválida — corrige antes de salvar.
        </p>
      )}
    </Field>
  );
}

// Helper exportado pra outras telas: traduz RRULE em string humana.
// Ex: "FREQ=WEEKLY;BYDAY=MO" → "Toda segunda"
export function humanizeRrule(rrule: string | null): string {
  if (!rrule) return '';
  try {
    const opts = RRule.parseString(rrule.replace(/^RRULE:/i, ''));
    return new RRule(opts).toText().replace(/^/, 'Repete ');
  } catch {
    return rrule;
  }
}
