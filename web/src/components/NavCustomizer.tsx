import { useState } from 'react';
import { ArrowDown, ArrowUp, Check, RotateCcw } from 'lucide-react';
import { AdaptiveSheet } from './AdaptiveSheet';
import { Button } from './Button';
import { useNavPreferences } from '../hooks/useNavPreferences';
import { DEFAULT_NAV_SLUGS, type NavCatalogItem } from '../lib/navItems';

export function NavCustomizer() {
  const { items, available, setSlugs, saving, loading } = useNavPreferences();
  const [pickerOpenIdx, setPickerOpenIdx] = useState<number | null>(null);

  if (loading) {
    return <p className="text-body-sm text-fg-muted">Carregando…</p>;
  }

  const currentSlugs = items.map((i) => i.slug);

  function move(idx: number, dir: -1 | 1) {
    const next = [...currentSlugs];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setSlugs(next).catch((e) => console.error('[NavCustomizer] move:', e));
  }

  function replace(idx: number, slug: string) {
    const next = [...currentSlugs];
    // Se o slug já existe em outro slot, troca de posição (swap).
    const existing = next.indexOf(slug);
    if (existing >= 0 && existing !== idx) {
      next[existing] = next[idx];
    }
    next[idx] = slug;
    setSlugs(next).catch((e) => console.error('[NavCustomizer] replace:', e));
    setPickerOpenIdx(null);
  }

  function restore() {
    setSlugs([...DEFAULT_NAV_SLUGS]).catch((e) => console.error('[NavCustomizer] restore:', e));
  }

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-fg-muted">
        Escolhe os 4 atalhos que aparecem no nav inferior no celular.{' '}
        <strong className="text-fg">Mais</strong> sempre fica como 5º slot.
      </p>

      <ul className="space-y-2">
        {items.map((it, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === items.length - 1;
          return (
            <li key={`${it.slug}-${idx}`}>
              <SlotRow
                idx={idx}
                item={it}
                disabledUp={isFirst}
                disabledDown={isLast}
                onUp={() => move(idx, -1)}
                onDown={() => move(idx, 1)}
                onSwap={() => setPickerOpenIdx(idx)}
              />
            </li>
          );
        })}
        <li>
          <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-bg-elevated px-3 py-2 opacity-70">
            <span className="font-mono text-fg-muted text-[11px] w-4 text-center">5</span>
            <span aria-hidden className="text-base">☰</span>
            <span className="text-body-md text-fg">Mais</span>
            <span className="ml-auto text-[11px] uppercase tracking-wide text-fg-muted">fixo</span>
          </div>
        </li>
      </ul>

      <div className="flex items-center justify-between pt-1">
        <Button size="sm" variant="ghost" onClick={restore} disabled={saving}>
          <RotateCcw size={14} className="mr-1.5" /> Restaurar padrão
        </Button>
        {saving && <span className="text-body-sm text-fg-muted">Salvando…</span>}
      </div>

      <AdaptiveSheet
        open={pickerOpenIdx !== null}
        onClose={() => setPickerOpenIdx(null)}
        title="Escolher atalho"
        size="sm"
      >
        <ul className="divide-y divide-border max-h-[60vh] overflow-y-auto">
          {available.map((opt) => {
            const inUse = currentSlugs.includes(opt.slug);
            const inThisSlot = pickerOpenIdx !== null && currentSlugs[pickerOpenIdx] === opt.slug;
            return (
              <li key={opt.slug}>
                <button
                  type="button"
                  onClick={() => pickerOpenIdx !== null && replace(pickerOpenIdx, opt.slug)}
                  className={[
                    'w-full flex items-center gap-3 px-md py-2.5 text-left focus-ring transition-colors',
                    inThisSlot ? 'bg-tom/10' : 'hover:bg-bg-elevated',
                  ].join(' ')}
                >
                  <opt.Icon size={18} className={inThisSlot ? 'text-tom' : 'text-fg-muted'} />
                  <span className={`text-body-md ${inThisSlot ? 'text-tom font-semibold' : 'text-fg'}`}>
                    {opt.label}
                  </span>
                  {inUse && !inThisSlot && (
                    <span className="ml-auto text-[11px] uppercase tracking-wide text-fg-muted">em outro slot</span>
                  )}
                  {inThisSlot && <Check size={16} className="ml-auto text-tom" />}
                </button>
              </li>
            );
          })}
        </ul>
      </AdaptiveSheet>
    </div>
  );
}

function SlotRow({
  idx,
  item,
  disabledUp,
  disabledDown,
  onUp,
  onDown,
  onSwap,
}: {
  idx: number;
  item: NavCatalogItem;
  disabledUp: boolean;
  disabledDown: boolean;
  onUp: () => void;
  onDown: () => void;
  onSwap: () => void;
}) {
  const { Icon, label } = item;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-surface px-2.5 py-2">
      <span className="font-mono text-fg-muted text-[11px] w-4 text-center">{idx + 1}</span>
      <Icon size={18} className="text-fg-muted" />
      <span className="text-body-md text-fg truncate">{label}</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          aria-label="Subir"
          onClick={onUp}
          disabled={disabledUp}
          className="h-7 w-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-bg-elevated disabled:opacity-30 focus-ring"
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button"
          aria-label="Descer"
          onClick={onDown}
          disabled={disabledDown}
          className="h-7 w-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-bg-elevated disabled:opacity-30 focus-ring"
        >
          <ArrowDown size={14} />
        </button>
        <Button size="sm" variant="ghost" onClick={onSwap}>
          Trocar
        </Button>
      </div>
    </div>
  );
}
