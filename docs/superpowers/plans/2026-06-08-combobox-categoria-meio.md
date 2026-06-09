# ComboBox de Categoria e Meio de Pagamento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os `CustomSelect` de Categoria e Meio de pagamento (no `LancamentoSheet` e `TransactionSheet`) por um `ComboBox` com busca (digitar→filtrar), criar-inline na Categoria, e teclado fluido.

**Architecture:** Componente novo `ComboBox` no DS (input + lista filtrada + opção "criar" + teclado), apoiado em helpers puros testáveis (`comboboxFilter.ts`). Aplicado nos 2 sheets. `CustomSelect` permanece intacto pros demais usos.

**Tech Stack:** React + TS + Tailwind (tokens do DS), Vitest (lógica pura), preview localhost:4173.

> **Convenção do repo:** sem commit por task; web deploya via Vercel no push (Stop hook do fim do turno). Validação: `cd _remote/web && npx tsc --noEmit && npx vite build`. Testes: `npx vitest run <arquivo>` (rodar de dentro de `_remote/web`).

---

### Task 1: Helpers puros de filtro + Vitest (TDD)

**Files:**
- Create: `web/src/components/comboboxFilter.ts`
- Test: `web/src/components/comboboxFilter.test.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// web/src/components/comboboxFilter.test.ts
import { describe, it, expect } from 'vitest';
import { normalize, filterOptions, shouldOfferCreate } from './comboboxFilter';

describe('normalize', () => {
  it('tira acento, caixa e emoji/símbolo inicial', () => {
    expect(normalize('Água')).toBe('agua');
    expect(normalize('🎤  Shows')).toBe('shows');
    expect(normalize('  Café ')).toBe('cafe');
  });
});

describe('filterOptions', () => {
  const opts = [{ value: 'shows', label: '🎤  Shows' }, { value: 'agua', label: '💧  Água' }];
  it('filtra acento-insensível e ignora emoji', () => {
    expect(filterOptions(opts, 'sho').map(o => o.value)).toEqual(['shows']);
    expect(filterOptions(opts, 'agua').map(o => o.value)).toEqual(['agua']);
  });
  it('query vazio devolve tudo', () => {
    expect(filterOptions(opts, '').length).toBe(2);
  });
});

describe('shouldOfferCreate', () => {
  const opts = [{ value: 'shows', label: '🎤  Shows' }];
  it('match exato (ignorando emoji) NÃO oferece criar', () => {
    expect(shouldOfferCreate(opts, 'Shows')).toBe(false);
    expect(shouldOfferCreate(opts, 'shows')).toBe(false);
  });
  it('texto novo oferece criar', () => {
    expect(shouldOfferCreate(opts, 'Aula')).toBe(true);
    expect(shouldOfferCreate(opts, 'sho')).toBe(true);
  });
  it('query vazio não oferece criar', () => {
    expect(shouldOfferCreate(opts, '   ')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run (em `_remote/web`): `npx vitest run src/components/comboboxFilter.test.ts`
Expected: FAIL — `Failed to resolve import './comboboxFilter'`.

- [ ] **Step 3: Implementar os helpers**

```ts
// web/src/components/comboboxFilter.ts
export interface ComboOpt { value: string; label: string; sublabel?: string; }

// lowercase + sem acento + sem emoji/símbolo/espaço inicial (labels são "EMOJI  Nome").
export function normalize(s: string): string {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^[^a-z0-9]+/i, '')
    .trim();
}

export function filterOptions<T extends ComboOpt>(options: T[], query: string): T[] {
  const q = normalize(query);
  if (!q) return options;
  return options.filter((o) => normalize(o.label).includes(q));
}

export function shouldOfferCreate(options: ComboOpt[], query: string): boolean {
  const q = normalize(query);
  if (!q) return false;
  return !options.some((o) => normalize(o.label) === q);
}
```

- [ ] **Step 4: Rodar e confirmar PASS**

Run: `npx vitest run src/components/comboboxFilter.test.ts`
Expected: PASS (todos verdes).

---

### Task 2: Componente `ComboBox`

**Files:**
- Create: `web/src/components/ComboBox.tsx`

- [ ] **Step 1: Criar o componente** (código completo)

```tsx
// web/src/components/ComboBox.tsx
// Combobox do DS: input + lista filtrada + criar-inline opcional + teclado.
// Irmão do CustomSelect (que continua pros selects simples). Mesmos tokens.
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
        <ChevronDown size={14} className={['shrink-0 text-fg-muted transition-transform cursor-pointer', open ? 'rotate-180' : ''].join(' ')}
          onMouseDown={(e) => { e.preventDefault(); open ? close() : openIt(); }} />
      </div>
      {open && (
        <div className={['absolute left-0 right-0 z-50 max-h-60 overflow-y-auto rounded-md border border-border bg-bg-surface shadow-soft', openUpward ? 'bottom-full mb-1' : 'top-full mt-1'].join(' ')}>
          {offerCreate && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={doCreate} disabled={creating}
              className={['w-full px-3 py-2 text-left text-body-sm text-tom border-b border-border', active === 0 ? 'bg-bg-elevated' : 'hover:bg-bg-elevated'].join(' ')}>
              {creating ? 'Criando…' : (createLabel ? createLabel(query.trim()) : `➕ Criar "${query.trim()}"`)}
            </button>
          )}
          {filtered.length === 0 && !offerCreate ? (
            <div className="px-3 py-2 text-body-sm text-fg-muted">Nenhuma opção</div>
          ) : filtered.map((opt, i) => {
            const navIdx = offerCreate ? i + 1 : i;
            const selected = opt.value === value;
            const hl = navIdx === active || selected;
            return (
              <button key={opt.value} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(opt.value)}
                className={['w-full px-3 py-2 text-left text-body-sm flex items-center justify-between gap-2', hl ? 'bg-bg-elevated text-fg' : 'text-fg hover:bg-bg-elevated'].join(' ')}>
                <span className="min-w-0 truncate">{opt.label}{opt.sublabel && <span className="text-fg-muted ml-1.5 text-[11px]">({opt.sublabel})</span>}</span>
                {selected && <span className="text-tom shrink-0">✓</span>}
              </button>
            );
          })}
          {error && <div className="px-3 py-2 text-body-sm text-danger border-t border-border">{error}</div>}
          {footerAction && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { close(); footerAction.onClick(); }}
              className="w-full px-3 py-2 text-left text-body-sm text-tom border-t border-border hover:bg-bg-elevated">
              {footerAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: tsc**

Run (em `_remote/web`): `npx tsc --noEmit`
Expected: sem erros relacionados a ComboBox.

---

### Task 3: Aplicar no `LancamentoSheet`

**Files:**
- Modify: `web/src/screens/financeiro/components/LancamentoSheet.tsx`

- [ ] **Step 1: Imports** — adicionar `ComboBox` e `useCreateCategory`. Trocar:

```tsx
import { CustomSelect } from '../../../components/CustomSelect';
```
por:
```tsx
import { CustomSelect } from '../../../components/CustomSelect';
import { ComboBox } from '../../../components/ComboBox';
```
E no import de hooks, adicionar `useCreateCategory`:
```tsx
import {
  useAccounts, useCategories, useCards,
  useCreateTransaction, useCreateCardPurchase, useCreateBill, useCreateCategory,
} from '../../../hooks/useFinanceiro';
```

- [ ] **Step 2: Instanciar o hook** — após `const createBill = useCreateBill();` adicionar:

```tsx
  const createCategory = useCreateCategory();
```

- [ ] **Step 3: Categoria → ComboBox creatable** — trocar:

```tsx
        <Field label="Categoria">
          <CustomSelect value={category} options={categoryOptions} onChange={(v) => setCategory(v as PfCategory)}
            footerAction={{ label: '➕ Incluir categoria', onClick: () => setNovaCat(true) }} />
        </Field>
```
por:
```tsx
        <Field label="Categoria">
          <ComboBox
            value={category}
            options={categoryOptions}
            onChange={(v) => setCategory(v as PfCategory)}
            placeholder="Buscar ou criar…"
            onCreate={async (text) => {
              const r = await createCategory.mutateAsync({ label: text, emoji: '🏷️', type });
              return (r as { slug: string }).slug;
            }}
            footerAction={{ label: '➕ Criar com emoji…', onClick: () => setNovaCat(true) }}
          />
        </Field>
```

- [ ] **Step 4: Meio de pagamento → ComboBox (só busca)** — trocar:

```tsx
            <CustomSelect value={medio} options={medioOptions} onChange={setMedio} />
```
por:
```tsx
            <ComboBox value={medio} options={medioOptions} onChange={setMedio} placeholder="Buscar carteira/cartão…" />
```

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: sem erros.

---

### Task 4: Aplicar no `TransactionSheet`

**Files:**
- Modify: `web/src/screens/financeiro/components/TransactionSheet.tsx`

- [ ] **Step 1: Imports** — adicionar `ComboBox` + `useCreateCategory`. Trocar:

```tsx
import { CustomSelect } from '../../../components/CustomSelect';
```
por:
```tsx
import { CustomSelect } from '../../../components/CustomSelect';
import { ComboBox } from '../../../components/ComboBox';
```
E na linha de hooks, adicionar `useCreateCategory`:
```tsx
import { useAccounts, useCategories, useCreateTransaction, useDeleteTransaction, useUpdateTransaction, useCreateCategory } from '../../../hooks/useFinanceiro';
```

- [ ] **Step 2: Instanciar o hook** — após `const updateMut = useUpdateTransaction();` adicionar:

```tsx
  const createCategory = useCreateCategory();
```

- [ ] **Step 3: Categoria → ComboBox creatable** — trocar:

```tsx
        <Field label="Categoria">
          <CustomSelect value={category} options={categoryOptions} onChange={(v) => setCategory(v as PfCategory)} />
        </Field>
```
por:
```tsx
        <Field label="Categoria">
          <ComboBox
            value={category}
            options={categoryOptions}
            onChange={(v) => setCategory(v as PfCategory)}
            placeholder="Buscar ou criar…"
            onCreate={async (text) => {
              const r = await createCategory.mutateAsync({ label: text, emoji: '🏷️', type });
              return (r as { slug: string }).slug;
            }}
          />
        </Field>
```

- [ ] **Step 4: Carteira → ComboBox (só busca)** — trocar:

```tsx
              <CustomSelect value={accountId} options={accountOptions} onChange={setAccountId} />
```
por:
```tsx
              <ComboBox value={accountId} options={accountOptions} onChange={setAccountId} placeholder="Buscar carteira…" />
```

- [ ] **Step 5: tsc**

Run: `npx tsc --noEmit`
Expected: sem erros.

---

### Task 5: Validação + build + preview

**Files:** nenhum

- [ ] **Step 1: Testes + tsc + build**

Run (em `_remote/web`): `npx vitest run src/components/comboboxFilter.test.ts && npx tsc --noEmit && npx vite build`
Expected: testes PASS, tsc limpo, build OK.

- [ ] **Step 2: Preview (localhost:4173) — limpar SW cache, abrir LancamentoSheet**
  - Validar: digitar em Categoria filtra; digitar nome novo mostra "➕ Criar 'X'"; criar inline seleciona a nova categoria sem abrir modal; "➕ Criar com emoji…" ainda abre o sheet.
  - Teclado: `↑/↓` navega, `Enter` seleciona/cria, `Esc` fecha, `Tab` Valor→Categoria→Meio→Descrição.
  - Meio de pagamento: digitar filtra carteiras/cartões.
  - Testar 375px (mobile) e 1440px (desktop). Erro de validação (valor vazio) não quebra layout.

- [ ] **Step 3: Deploy** — web sobe via Vercel no push (Stop hook do fim do turno). Sem scp (isso é só pro TOM engine).

---

## Self-Review

**1. Spec coverage:**
- Combobox busca + criar-inline na Categoria → Task 2 + Task 3/4. ✅
- Meio/Carteira só busca → Task 3 Step 4 / Task 4 Step 4. ✅
- Componente novo no DS (não Radix/Shadcn) → Task 2. ✅
- Criar inline com emoji 🏷️ + manter sheet completo (footerAction) → Task 3 Step 3. ✅
- Teclado ↑/↓/Enter/Esc/Tab + autofocus Valor (já existe) → Task 2 onKeyDown + Task 5 preview. ✅
- Lógica pura testada (filtro acento/emoji-insensível, match exato não cria) → Task 1. ✅
- Fora de escopo (outros selects, criar carteira inline) → não tocados. ✅

**2. Placeholder scan:** sem TBD; código completo em cada step (componente inteiro na Task 2). ✅

**3. Type consistency:** `ComboOpt {value,label,sublabel?}` em comboboxFilter.ts; `ComboBox` importa `ComboOpt` e usa `Props.options: ComboOpt[]`; `onCreate` retorna `string` (slug) e `onChange(string)`; `useCreateCategory().mutateAsync({label,emoji,type})` → `{slug}`. Consistente entre Tasks 1→2→3→4. ✅
