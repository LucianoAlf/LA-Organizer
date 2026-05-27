// Sprint 23 v2 — RecurrencePicker simplificado.
// Removida exposição de RRULE crua. Mantém RRULE iCalendar (RFC 5545) por baixo —
// TOM continua consumindo via src/services/recurrence-engine.js sem mudanças.
//
// UI:
//   5 presets + Dias úteis + Personalizado (sub-form visual, nunca textual)
//   → Não repete · Diária · Semanal · Mensal · Anual · Dias úteis · Personalizado…
//
// Personalizado abre sub-form:
//   "A cada [N] [Dia/Semana/Mês/Ano]" + chips D S T Q Q S S (se Semana, multi-select)
//
// Preview das próximas 3 ocorrências continua disponível.

import { useEffect, useMemo, useState } from 'react';
import { RRule, rrulestr } from 'rrule';
import { CustomSelect } from './CustomSelect';
import { Field } from './Field';

type Preset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | 'custom';
type CustomUnit = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

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

const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const WEEK_CHIPS: Array<{ code: typeof DAY_CODES[number]; label: string }> = [
  { code: 'SU', label: 'D' },
  { code: 'MO', label: 'S' },
  { code: 'TU', label: 'T' },
  { code: 'WE', label: 'Q' },
  { code: 'TH', label: 'Q' },
  { code: 'FR', label: 'S' },
  { code: 'SA', label: 'S' },
];

const PRESETS: { value: Preset; label: string; sublabel?: string }[] = [
  { value: 'none',     label: 'Não repete' },
  { value: 'daily',    label: 'Diária' },
  { value: 'weekly',   label: 'Semanal',     sublabel: 'mesmo dia da semana' },
  { value: 'monthly',  label: 'Mensal',      sublabel: 'mesmo dia do mês' },
  { value: 'yearly',   label: 'Anual' },
  { value: 'weekdays', label: 'Dias úteis',  sublabel: 'seg–sex' },
  { value: 'custom',   label: 'Personalizado…' },
];

const UNIT_OPTIONS = [
  { value: 'DAILY',   label: 'Dia(s)' },
  { value: 'WEEKLY',  label: 'Semana(s)' },
  { value: 'MONTHLY', label: 'Mês(es)' },
  { value: 'YEARLY',  label: 'Ano(s)' },
];

function presetToRrule(preset: Preset, startDate: string): string | null {
  const d = new Date(startDate + 'T12:00:00Z');
  if (isNaN(d.getTime())) return null;
  const dayCode = DAY_CODES[d.getUTCDay()];
  const dayOfMonth = d.getUTCDate();
  switch (preset) {
    case 'none':     return null;
    case 'daily':    return 'FREQ=DAILY';
    case 'weekly':   return `FREQ=WEEKLY;BYDAY=${dayCode}`;
    case 'monthly':  return `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}`;
    case 'yearly':   return `FREQ=YEARLY;BYMONTH=${d.getUTCMonth() + 1};BYMONTHDAY=${dayOfMonth}`;
    case 'weekdays': return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    case 'custom':   return null;
    default:         return null;
  }
}

function rruleToPreset(rrule: string | null): Preset {
  if (!rrule) return 'none';
  const r = rrule.trim().toUpperCase();
  if (r === 'FREQ=DAILY') return 'daily';
  if (r === 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR') return 'weekdays';
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(r)) return 'weekly';
  if (/^FREQ=MONTHLY;BYMONTHDAY=-?\d{1,2}$/.test(r)) return 'monthly';
  if (/^FREQ=YEARLY;BYMONTH=\d{1,2};BYMONTHDAY=\d{1,2}$/.test(r)) return 'yearly';
  return 'custom';
}

/** Parse RRULE → estado do form custom (best-effort). */
function rruleToCustomState(rrule: string | null): {
  unit: CustomUnit;
  interval: number;
  byday: string[];
} {
  if (!rrule) return { unit: 'WEEKLY', interval: 1, byday: [] };
  const parts = Object.fromEntries(
    rrule
      .toUpperCase()
      .replace(/^RRULE:/i, '')
      .split(';')
      .map((p) => p.split('='))
  );
  const freq = (parts.FREQ || 'WEEKLY') as CustomUnit;
  const interval = Math.max(1, parseInt(parts.INTERVAL || '1', 10) || 1);
  const byday = (parts.BYDAY || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter(Boolean);
  return { unit: freq, interval, byday };
}

function customFormToRrule(unit: CustomUnit, interval: number, byday: string[]): string | null {
  if (interval < 1) return null;
  const parts: string[] = [`FREQ=${unit}`];
  if (interval > 1) parts.push(`INTERVAL=${interval}`);
  if (unit === 'WEEKLY' && byday.length > 0) parts.push(`BYDAY=${byday.join(',')}`);
  return parts.join(';');
}

function previewOccurrences(rrule: string | null, startDate: string, count = 3): string[] {
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
  const initialPreset = rruleToPreset(value);
  const [preset, setPreset] = useState<Preset>(initialPreset);

  // Estado do form custom (só usado quando preset === 'custom')
  const initCustom = rruleToCustomState(value);
  const [customUnit, setCustomUnit] = useState<CustomUnit>(initCustom.unit);
  const [customInterval, setCustomInterval] = useState<number>(initCustom.interval);
  const [customByday, setCustomByday] = useState<string[]>(initCustom.byday);

  // Quando o user mexe no form custom, emite RRULE
  useEffect(() => {
    if (preset !== 'custom') return;
    onChange(customFormToRrule(customUnit, customInterval, customByday));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, customUnit, customInterval, customByday]);

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p === 'custom') {
      // Quando entra em "custom", emite o estado atual do form (não null)
      onChange(customFormToRrule(customUnit, customInterval, customByday));
    } else {
      onChange(presetToRrule(p, startDate));
    }
  }

  function toggleByday(code: string) {
    setCustomByday((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  const preview = useMemo(
    () => (hidePreview ? [] : previewOccurrences(value, startDate, 3)),
    [value, startDate, hidePreview]
  );

  return (
    <Field label="Repetição">
      <CustomSelect
        value={preset}
        options={PRESETS.map((p) => ({ value: p.value, label: p.label, sublabel: p.sublabel }))}
        onChange={(v) => applyPreset(v as Preset)}
        size="md"
      />

      {preset === 'custom' && (
        <div className="mt-sm p-3 bg-bg-surface border border-border rounded-md space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-body-sm text-fg-muted">A cada</span>
            <input
              type="number"
              min={1}
              max={99}
              value={customInterval}
              onChange={(e) => setCustomInterval(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="w-16 bg-bg-app border border-border rounded-md p-2 text-fg text-center focus:outline-none focus:border-tom"
            />
            <div className="flex-1 min-w-0">
              <CustomSelect
                value={customUnit}
                options={UNIT_OPTIONS}
                onChange={(v) => setCustomUnit(v as CustomUnit)}
                size="md"
              />
            </div>
          </div>

          {customUnit === 'WEEKLY' && (
            <div className="flex gap-1 flex-wrap">
              {WEEK_CHIPS.map((d) => {
                const active = customByday.includes(d.code);
                return (
                  <button
                    key={d.code}
                    type="button"
                    onClick={() => toggleByday(d.code)}
                    className={`w-9 h-9 rounded-full text-body-sm font-medium transition-colors ${
                      active
                        ? 'bg-tom text-bg-app'
                        : 'bg-bg-app text-fg/60 border border-border hover:text-fg'
                    }`}
                    aria-pressed={active}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!hidePreview && value && preview.length > 0 && (
        <p className="mt-xs text-body-sm text-fg-muted">
          📅 Próximas: <span className="text-fg">{preview.join(' • ')}</span>
        </p>
      )}
      {!hidePreview && value && preview.length === 0 && (
        <p className="mt-xs text-body-sm text-red-500">
          ⚠ Configuração inválida — confere os campos.
        </p>
      )}
    </Field>
  );
}

// Helper exportado pra outras telas: traduz RRULE em string humana.
export function humanizeRrule(rrule: string | null): string {
  if (!rrule) return '';
  try {
    const opts = RRule.parseString(rrule.replace(/^RRULE:/i, ''));
    return new RRule(opts).toText().replace(/^/, 'Repete ');
  } catch {
    return rrule;
  }
}
