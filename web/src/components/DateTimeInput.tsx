// Sprint 22.25 (audit Hoje, Mega-fatia A) — input de data+hora custom DD/MM/AAAA HH:MM.
// Substitui <input type="datetime-local"> nativo. Composicao: DateInput + 2
// inputs HH:MM com auto-tab.
//
// Aceita value/onChange em formato YYYY-MM-DDTHH:MM (datetime-local sem TZ).

import { useEffect, useRef, useState } from 'react';
import { DateInput } from './DateInput';

interface Props {
  /** YYYY-MM-DDTHH:MM ou string vazia. */
  value: string;
  /** Disparado com YYYY-MM-DDTHH:MM valido OU "" quando incompleto. */
  onChange: (value: string) => void;
  invalid?: boolean;
}

function splitDT(value: string): { date: string; hh: string; mm: string } {
  if (!value) return { date: '', hh: '', mm: '' };
  const [date, time] = value.split('T');
  const [hh, mm] = (time ?? '').split(':');
  return { date: date ?? '', hh: hh ?? '', mm: mm ?? '' };
}

function combineDT(date: string, hh: string, mm: string): string {
  if (!date) return '';
  if (hh.length !== 2 || mm.length !== 2) return '';
  const hn = Number(hh);
  const mn = Number(mm);
  if (!Number.isFinite(hn) || !Number.isFinite(mn)) return '';
  if (hn < 0 || hn > 23 || mn < 0 || mn > 59) return '';
  return `${date}T${hh}:${mm}`;
}

const FIELD_CLASS =
  'h-12 px-2 rounded-md bg-bg-elevated border text-fg focus-ring text-center tabular-nums placeholder:text-fg-muted';

export function DateTimeInput({ value, onChange, invalid }: Props) {
  const init = splitDT(value);
  const [date, setDate] = useState(init.date);
  const [hh, setHH] = useState(init.hh);
  const [mm, setMM] = useState(init.mm);

  const refHH = useRef<HTMLInputElement>(null);
  const refMM = useRef<HTMLInputElement>(null);

  // Sincroniza com mudancas externas. Preserva typing parcial (idem DateInput).
  useEffect(() => {
    if (!value) return;
    const p = splitDT(value);
    if (p.date !== date || p.hh !== hh || p.mm !== mm) {
      setDate(p.date);
      setHH(p.hh);
      setMM(p.mm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nDate: string, nHH: string, nMM: string) {
    const joined = combineDT(nDate, nHH, nMM);
    if (joined !== value) onChange(joined);
  }

  function handleDate(d: string) {
    setDate(d);
    emit(d, hh, mm);
  }
  function handleHH(v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 2);
    setHH(cleaned);
    emit(date, cleaned, mm);
    if (cleaned.length === 2) refMM.current?.focus();
  }
  function handleMM(v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 2);
    setMM(cleaned);
    emit(date, hh, cleaned);
  }

  function backspaceHHJump(e: React.KeyboardEvent<HTMLInputElement>) {
    // Em HH vazio, backspace volta foco pro ano (DateInput se encarrega).
    // Aqui so deixa default.
    void e;
  }
  function backspaceMMJump(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && mm === '' && refHH.current) {
      refHH.current.focus();
    }
  }

  const borderClass = invalid ? 'border-danger' : 'border-border';

  return (
    <div className="flex items-center gap-2">
      <DateInput value={date} onChange={handleDate} invalid={invalid} />
      <span className="text-fg-muted text-body-sm" aria-hidden>·</span>
      <div className="flex items-center gap-1">
        <input
          ref={refHH}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          placeholder="HH"
          value={hh}
          onChange={(e) => handleHH(e.target.value)}
          onKeyDown={backspaceHHJump}
          aria-label="hora"
          className={`${FIELD_CLASS} ${borderClass} w-12`}
        />
        <span className="text-fg-muted" aria-hidden>:</span>
        <input
          ref={refMM}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          placeholder="MM"
          value={mm}
          onChange={(e) => handleMM(e.target.value)}
          onKeyDown={backspaceMMJump}
          aria-label="minuto"
          className={`${FIELD_CLASS} ${borderClass} w-12`}
        />
      </div>
    </div>
  );
}
