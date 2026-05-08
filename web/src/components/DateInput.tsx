// Sprint 22.25 (audit Hoje, Mega-fatia A) — input de data custom DD/MM/AAAA.
// Substitui <input type="date"> nativo (picker do OS feio em Windows/Linux).
// Espelha padrao do Runbook (split inputs com auto-tab).
//
// Aceita value/onChange em formato YYYY-MM-DD (ISO date sem tempo). Emite
// onChange("") quando incompleto/invalido — caller faz a validacao final.

import { useEffect, useRef, useState } from 'react';

interface Props {
  /** YYYY-MM-DD ou string vazia. */
  value: string;
  /** Disparado com YYYY-MM-DD valido OU "" quando incompleto/invalido. */
  onChange: (value: string) => void;
  /** Auto-foca o primeiro campo (DD) ao montar. */
  autoFocus?: boolean;
  /** Apenas visual — pra estilizar erro do form do parent. */
  invalid?: boolean;
}

function splitISO(value: string): [string, string, string] {
  if (!value) return ['', '', ''];
  const [y, m, d] = value.split('-');
  return [d ?? '', m ?? '', y ?? ''];
}

function joinISO(d: string, m: string, y: string): string {
  if (d.length !== 2 || m.length !== 2 || y.length !== 4) return '';
  const dn = Number(d);
  const mn = Number(m);
  const yn = Number(y);
  if (!Number.isFinite(dn) || !Number.isFinite(mn) || !Number.isFinite(yn)) return '';
  if (dn < 1 || dn > 31 || mn < 1 || mn > 12 || yn < 1900 || yn > 2100) return '';
  // Valida data real (pega Fev 30, Abr 31, etc).
  const dt = new Date(yn, mn - 1, dn);
  if (dt.getFullYear() !== yn || dt.getMonth() !== mn - 1 || dt.getDate() !== dn) return '';
  return `${y}-${m}-${d}`;
}

const FIELD_CLASS =
  'h-12 px-2 rounded-md bg-bg-elevated border text-fg focus-ring text-center tabular-nums placeholder:text-fg-muted';

export function DateInput({ value, onChange, autoFocus, invalid }: Props) {
  const [iD, iM, iY] = splitISO(value);
  const [d, setD] = useState(iD);
  const [m, setM] = useState(iM);
  const [y, setY] = useState(iY);

  const refD = useRef<HTMLInputElement>(null);
  const refM = useRef<HTMLInputElement>(null);
  const refY = useRef<HTMLInputElement>(null);

  // Sincroniza com mudancas externas de value (ex: form reset). Se value="",
  // NAO reseta — preserva typing parcial (usuario apagando digito a digito
  // emite "" pra cima sem perder o que ele digitou).
  useEffect(() => {
    if (!value) return;
    const [pd, pm, py] = splitISO(value);
    if (pd !== d || pm !== m || py !== y) {
      setD(pd); setM(pm); setY(py);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function emit(nd: string, nm: string, ny: string) {
    const joined = joinISO(nd, nm, ny);
    if (joined !== value) onChange(joined);
  }

  function handleD(v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 2);
    setD(cleaned);
    emit(cleaned, m, y);
    if (cleaned.length === 2) refM.current?.focus();
  }
  function handleM(v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 2);
    setM(cleaned);
    emit(d, cleaned, y);
    if (cleaned.length === 2) refY.current?.focus();
  }
  function handleY(v: string) {
    const cleaned = v.replace(/\D/g, '').slice(0, 4);
    setY(cleaned);
    emit(d, m, cleaned);
  }

  // Backspace em campo vazio volta pro anterior.
  function backspaceJump(
    e: React.KeyboardEvent<HTMLInputElement>,
    current: string,
    prevRef: React.RefObject<HTMLInputElement>,
  ) {
    if (e.key === 'Backspace' && current === '' && prevRef.current) {
      prevRef.current.focus();
    }
  }

  const borderClass = invalid ? 'border-danger' : 'border-border';

  return (
    <div className="flex items-center gap-1">
      <input
        ref={refD}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        placeholder="DD"
        value={d}
        onChange={(e) => handleD(e.target.value)}
        autoFocus={autoFocus}
        aria-label="dia"
        className={`${FIELD_CLASS} ${borderClass} w-14`}
      />
      <span className="text-fg-muted" aria-hidden>/</span>
      <input
        ref={refM}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={2}
        placeholder="MM"
        value={m}
        onChange={(e) => handleM(e.target.value)}
        onKeyDown={(e) => backspaceJump(e, m, refD)}
        aria-label="mês"
        className={`${FIELD_CLASS} ${borderClass} w-14`}
      />
      <span className="text-fg-muted" aria-hidden>/</span>
      <input
        ref={refY}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        placeholder="AAAA"
        value={y}
        onChange={(e) => handleY(e.target.value)}
        onKeyDown={(e) => backspaceJump(e, y, refM)}
        aria-label="ano"
        className={`${FIELD_CLASS} ${borderClass} w-20`}
      />
    </div>
  );
}
