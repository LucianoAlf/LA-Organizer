// Sprint 22.26c — DateTimeInput v2: composicao de DateInput (calendario popover)
// + TimeInput (lista 30min com input typing). Substitui versao split-fields antiga.
//
// Aceita value/onChange em formato YYYY-MM-DDTHH:MM. Emite o formato completo
// quando AMBAS partes (data + hora) estao validas.

import { DateInput } from './DateInput';
import { TimeInput } from './TimeInput';

interface Props {
  /** YYYY-MM-DDTHH:MM ou string vazia. */
  value: string;
  /** Disparado com YYYY-MM-DDTHH:MM completo OU "" se incompleto. */
  onChange: (value: string) => void;
  invalid?: boolean;
}

function splitDT(value: string): { date: string; time: string } {
  if (!value) return { date: '', time: '' };
  const [date, time] = value.split('T');
  return { date: date ?? '', time: time ?? '' };
}

function combineDT(date: string, time: string): string {
  if (!date || !time) return '';
  return `${date}T${time}`;
}

export function DateTimeInput({ value, onChange, invalid }: Props) {
  const { date, time } = splitDT(value);

  function handleDate(d: string) {
    onChange(combineDT(d, time));
  }
  function handleTime(t: string) {
    onChange(combineDT(date, t));
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <DateInput value={date} onChange={handleDate} invalid={invalid} />
      <TimeInput value={time} onChange={handleTime} invalid={invalid} />
    </div>
  );
}
