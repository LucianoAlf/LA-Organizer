// Combobox do DS: input + lista filtrada + criar-inline opcional + teclado.
// Irmão do CustomSelect (que continua pros selects simples). Mesmos tokens.
// Spec: docs/superpowers/specs/2026-06-08-combobox-categoria-meio-design.md
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { filterOptions, shouldOfferCreate, type ComboOpt } from './comboboxFilter';

interface Props {
  value: string;
  options: ComboOpt[];
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'sm' | 'md';
  prefer?: 'up' | 'down' | 'auto';
  /** Se definido, oferece "criar" quando o texto não casa nenhuma opção. Retorna o value novo. */
  onCreate?: (text: string) => Promise<string>;
  createLabel?: (text: string) => string;
  /** Ação fixa no rodapé (ex: abrir sheet completo com emoji). */
  footerAction?: { label: string; onClick: () => void };
}

export function ComboBox({ value, options, onChange, placeholder, size = 'md', prefer = 'auto', onCreate, createLabel, footerAction }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [openUpward, setOpenUpward] = useState(prefer === 'up');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = options.find((o) => o.value === value);
  const filtered = useMemo(() => (open ? filterOptions(options, query) : options), [open, options, query]);
  const offerCreate = !!onCreate && open && shouldOfferCreate(options, query);
  const navLen = filtered.length + (offerCreate ? 1 : 0);

  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    if (prefer === 'up') { setOpenUpward(true); return; }
    if (prefer === 'down') { setOpenUpward(false); return; }
    const rect = rootRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    setOpenUpward(spaceBelow < 280 && rect.top > spaceBelow);
  }, [open, navLen, prefer]);

  function openIt() { setOpen(true); setQuery(''); setActive(0); setError(null); setTimeout(() => inputRef.current?.focus(), 0); }
  function close() { setOpen(false); setQuery(''); setError(null); }
  function pick(v: string) { onChange(v); close(); }

  async function doCreate() {
    if (!onCreate || creating) return;
    const text = query.trim();
    if (!text) return;
    setCreating(true); setError(null);
    try { onChange(await onCreate(text)); close(); }
    catch (e) { setError((e as Error).message); }
    finally { setCreating(false); }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) { if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); openIt(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, navLen - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (offerCreate && active === 0) { doCreate(); return; }
      const idx = offerCreate ? active - 1 : active;
      const opt = filtered[idx];
      if (opt) pick(opt.value);
      else if (offerCreate) doCreate();
    } else if (e.key === 'Escape') { e.preventDefault(); close(); }
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setTimeout(() => close(), 120);
  }

  const sizeCls = size === 'md' ? 'h-12 text-body-md' : 'h-9 text-body-sm';

  return (
    <div ref={rootRef} className="relative" onBlur={handleBlur} onKeyDown={onKeyDown}>
      <div className={['w-full px-3 rounded-md bg-bg-elevated border border-border focus-within:border-tom flex items-center justify-between gap-2', sizeCls].join(' ')}>
        <input
          ref={inputRef}
          type="text"
          value={open ? query : (current?.label ?? '')}
          placeholder={placeholder ?? 'Selecionar'}
          onFocus={() => { if (!open) openIt(); }}
          onChange={(e) => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
          className="w-full bg-transparent outline-none text-fg placeholder:text-fg-muted truncate"
        />
        <ChevronDown
          size={14}
          className={['shrink-0 text-fg-muted transition-transform cursor-pointer', open ? 'rotate-180' : ''].join(' ')}
          onMouseDown={(e) => { e.preventDefault(); if (open) close(); else openIt(); }}
        />
      </div>
      {open && (
        <div className={['absolute left-0 right-0 z-50 max-h-60 overflow-y-auto rounded-md border border-border bg-bg-surface shadow-soft', openUpward ? 'bottom-full mb-1' : 'top-full mt-1'].join(' ')}>
          {offerCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={doCreate}
              disabled={creating}
              className={['w-full px-3 py-2 text-left text-body-sm text-tom border-b border-border', active === 0 ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'].join(' ')}
            >
              {creating ? 'Criando…' : (createLabel ? createLabel(query.trim()) : `➕ Criar "${query.trim()}"`)}
            </button>
          )}
          {filtered.length === 0 && !offerCreate ? (
            <div className="px-3 py-2 text-body-sm text-fg-muted">Nenhuma opção</div>
          ) : (
            filtered.map((opt, i) => {
              const navIdx = offerCreate ? i + 1 : i;
              const selected = opt.value === value;
              const hl = navIdx === active || selected;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(opt.value)}
                  className={['w-full px-3 py-2 text-left text-body-sm flex items-center justify-between gap-2', hl ? 'bg-bg-elevated text-fg' : 'text-fg hover:bg-bg-elevated'].join(' ')}
                >
                  <span className="min-w-0 truncate">
                    {opt.label}
                    {opt.sublabel && <span className="text-fg-muted ml-1.5 text-[11px]">({opt.sublabel})</span>}
                  </span>
                  {selected && <span className="text-tom shrink-0">✓</span>}
                </button>
              );
            })
          )}
          {error && <div className="px-3 py-2 text-body-sm text-danger border-t border-border">{error}</div>}
          {footerAction && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { close(); footerAction.onClick(); }}
              className="w-full px-3 py-2 text-left text-body-sm text-tom border-t border-border hover:bg-bg-elevated"
            >
              {footerAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
