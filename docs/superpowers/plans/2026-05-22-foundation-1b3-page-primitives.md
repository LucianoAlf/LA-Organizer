# Foundation 1b.3 — Page Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir 7 primitivos React (PageShell, Toolbar, FilterPill, ViewSwitcher, DetailDrawer, EmptyStateDesktop, LoadingSkeleton) que servirão de base para todas as telas do desktop redesign.

**Architecture:** Cada primitivo é um componente React stateless ou com mínimo estado interno, focado em UI. Vivem em `web/src/design/primitives/`. Usam tokens Tailwind do projeto (tom, bg-bg-*, text-fg-*, border-border). Mobile (AppShell) não é tocado.

**Tech Stack:** React 18, TypeScript, Tailwind CSS 3.4, Lucide React.

---

## Mapa de arquivos

| Ação | Caminho | Responsabilidade |
|------|---------|------------------|
| Criar | `web/src/design/primitives/PageShell.tsx` | Wrapper de página com header (título + subtítulo + toolbar slot) |
| Criar | `web/src/design/primitives/Toolbar.tsx` | Flex row para filtros/ações; suporta grupo esquerdo e direito |
| Criar | `web/src/design/primitives/FilterPill.tsx` | Pill button com label, count opcional, estado active |
| Criar | `web/src/design/primitives/ViewSwitcher.tsx` | Segmented control para alternar views (Kanban/Lista/Timeline) |
| Criar | `web/src/design/primitives/DetailDrawer.tsx` | Painel deslizante da direita (450px) com header + body + footer |
| Criar | `web/src/design/primitives/EmptyStateDesktop.tsx` | Estado vazio centralizado com ícone + título + descrição + CTA |
| Criar | `web/src/design/primitives/LoadingSkeleton.tsx` | Placeholder animado (variantes card/row/text) |
| Modificar | `web/src/design/index.ts` | Adicionar exports dos 7 primitivos |

---

### Task 1: PageShell.tsx

Wrapper estrutural de página. Recebe `title`, `subtitle?`, `toolbar?` (slot React), `children`. Renderiza header padrão e área de conteúdo com padding consistente.

**Files:**
- Create: `web/src/design/primitives/PageShell.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import type { ReactNode } from 'react';

interface PageShellProps {
  /** Título principal da página (renderizado como h1). */
  title: string;
  /** Subtítulo opcional abaixo do título. */
  subtitle?: string;
  /** Slot opcional à direita do header (botões de ação). */
  toolbar?: ReactNode;
  /** Conteúdo principal da página. */
  children: ReactNode;
  /** Conteúdo opcional ANTES do header (ex: tabs, breadcrumb extra). */
  preHeader?: ReactNode;
}

/**
 * PageShell — wrapper padrão para qualquer tela do desktop.
 *
 * Layout: preHeader? > header (title + subtitle | toolbar) > children
 *
 * O DesktopShell já provê padding lateral global (px-4 md:px-6 lg:px-10) e
 * padding vertical (py-6). PageShell adiciona apenas o espaçamento interno
 * entre header e conteúdo (gap-6).
 */
export function PageShell({ title, subtitle, toolbar, children, preHeader }: PageShellProps) {
  return (
    <div className="flex flex-col gap-6 min-h-full">
      {preHeader}
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-fg leading-tight truncate">{title}</h1>
          {subtitle && (
            <p className="text-[13px] text-fg-muted mt-0.5 truncate">{subtitle}</p>
          )}
        </div>
        {toolbar && <div className="shrink-0">{toolbar}</div>}
      </header>
      <div className="flex-1 min-h-0">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```
Expected: zero erros.

---

### Task 2: Toolbar.tsx

Flex row com grupos esquerdo e direito. Usado dentro de PageShell (ou solto).

**Files:**
- Create: `web/src/design/primitives/Toolbar.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import type { ReactNode } from 'react';

interface ToolbarProps {
  /** Conteúdo da esquerda (filtros, view switcher). */
  left?: ReactNode;
  /** Conteúdo da direita (busca, botões de ação). */
  right?: ReactNode;
  /** Conteúdo único; ignora left/right se passado. */
  children?: ReactNode;
  className?: string;
}

/**
 * Toolbar — linha horizontal de controles.
 *
 * Modo 1 (left + right): justify-between, gap-3.
 * Modo 2 (children): renderiza children como container flex direto.
 */
export function Toolbar({ left, right, children, className = '' }: ToolbarProps) {
  if (children) {
    return (
      <div className={`flex items-center gap-3 ${className}`}>{children}</div>
    );
  }
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <div className="flex items-center gap-2 flex-wrap min-w-0">{left}</div>
      <div className="flex items-center gap-2 shrink-0">{right}</div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 3: FilterPill.tsx

Pill button com label + count opcional + estado active. Pode ser clicável (botão) ou link.

**Files:**
- Create: `web/src/design/primitives/FilterPill.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface FilterPillProps {
  /** Texto do filtro (ex: "Status", "Owner"). */
  label: string;
  /** Conteúdo extra do pill (ex: badge com valor). */
  value?: ReactNode;
  /** Quantidade — renderizada como badge à direita. */
  count?: number;
  /** Estado ativo (filtro aplicado). */
  active?: boolean;
  /** Mostra chevron indicando que abre dropdown. */
  hasDropdown?: boolean;
  /** Callback de clique. */
  onClick?: () => void;
  /** Desabilitado (cinza, sem hover). */
  disabled?: boolean;
}

/**
 * FilterPill — pill button para filtros e segmentações.
 *
 * Estados:
 * - default: bg-bg-elevated, border-border
 * - active: bg-tom/10, border-tom, text-tom
 * - disabled: opacity 50%, cursor not-allowed
 */
export function FilterPill({
  label,
  value,
  count,
  active = false,
  hasDropdown = false,
  onClick,
  disabled = false,
}: FilterPillProps) {
  const base = 'inline-flex items-center gap-1.5 h-8 px-3 rounded-full border text-[12px] font-medium transition-colors focus-ring';
  const state = disabled
    ? 'bg-bg-elevated border-border text-fg-muted opacity-50 cursor-not-allowed'
    : active
      ? 'bg-tom/10 border-tom/40 text-tom hover:bg-tom/15'
      : 'bg-bg-elevated border-border text-fg-secondary hover:border-border/80 hover:text-fg';

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`${base} ${state}`}>
      <span>{label}</span>
      {value !== undefined && (
        <>
          <span className="text-fg-muted">·</span>
          <span className={active ? 'text-tom font-semibold' : 'text-fg font-semibold'}>{value}</span>
        </>
      )}
      {count !== undefined && count > 0 && (
        <span className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold grid place-items-center ${active ? 'bg-tom text-white' : 'bg-bg-elevated-2 text-fg'}`}>
          {count}
        </span>
      )}
      {hasDropdown && <ChevronDown size={12} className="opacity-60" />}
    </button>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 4: ViewSwitcher.tsx

Segmented control para alternar views (Kanban / Lista / Timeline / Calendário).

**Files:**
- Create: `web/src/design/primitives/ViewSwitcher.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import type { LucideIcon } from 'lucide-react';

export interface ViewOption<T extends string = string> {
  /** Identificador único da view. */
  id: T;
  /** Label exibido (mobile: tooltip; desktop: visível). */
  label: string;
  /** Ícone Lucide. */
  Icon: LucideIcon;
}

interface ViewSwitcherProps<T extends string = string> {
  /** Lista de opções de view. */
  options: ViewOption<T>[];
  /** View ativa. */
  value: T;
  /** Callback ao trocar de view. */
  onChange: (id: T) => void;
  /** Esconder labels (só ícones) em qualquer tamanho. */
  iconOnly?: boolean;
}

/**
 * ViewSwitcher — segmented control de views.
 *
 * Estados:
 * - default: bg-bg-elevated, text-fg-muted
 * - active: bg-bg-surface, text-fg, shadow-sm
 */
export function ViewSwitcher<T extends string = string>({
  options,
  value,
  onChange,
  iconOnly = false,
}: ViewSwitcherProps<T>) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-md bg-bg-elevated border border-border">
      {options.map(({ id, label, Icon }) => {
        const active = id === value;
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-label={label}
            aria-pressed={active}
            title={label}
            className={[
              'inline-flex items-center gap-1.5 h-7 px-2.5 rounded text-[12px] font-medium transition-colors focus-ring',
              active
                ? 'bg-bg-surface text-fg shadow-sm'
                : 'text-fg-muted hover:text-fg',
            ].join(' ')}
          >
            <Icon size={13} />
            {!iconOnly && <span className="hidden md:inline">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 5: DetailDrawer.tsx

Painel deslizante da direita (450px). Header sticky com close, body scrollable, footer opcional.

**Files:**
- Create: `web/src/design/primitives/DetailDrawer.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

interface DetailDrawerProps {
  /** Drawer está aberto. */
  open: boolean;
  /** Callback ao fechar (clique no X, Escape, ou backdrop). */
  onClose: () => void;
  /** Título no header. */
  title: ReactNode;
  /** Subtítulo opcional. */
  subtitle?: ReactNode;
  /** Conteúdo principal (rola). */
  children: ReactNode;
  /** Footer opcional (sticky no rodapé). */
  footer?: ReactNode;
  /** Largura em px (default 450). */
  width?: number;
}

/**
 * DetailDrawer — painel lateral direito.
 *
 * Padrões:
 * - Backdrop bg-black/40 cobre o resto da tela
 * - Drawer entra da direita com slide
 * - Escape fecha
 * - Click fora (no backdrop) fecha
 */
export function DetailDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 450,
}: DetailDrawerProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Drawer */}
      <aside
        className="relative h-full bg-bg-surface border-l border-border shadow-2xl flex flex-col animate-[slideInRight_180ms_ease-out]"
        style={{ width }}
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold text-fg truncate">{title}</div>
            {subtitle && <div className="text-[12px] text-fg-muted truncate mt-0.5">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="shrink-0 w-7 h-7 grid place-items-center rounded-md text-fg-muted hover:text-fg hover:bg-bg-elevated transition-colors focus-ring"
          >
            <X size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="px-5 py-3 border-t border-border bg-bg-surface shrink-0">{footer}</footer>
        )}
      </aside>
    </div>
  );
}
```

- [ ] **Step 2: Adicionar keyframe `slideInRight` em `web/tailwind.config.js`**

Encontrar a seção `theme.extend.keyframes` (ou criar se não existir) e adicionar:

```js
keyframes: {
  slideInRight: {
    '0%': { transform: 'translateX(100%)' },
    '100%': { transform: 'translateX(0)' },
  },
},
```

Se já existir `keyframes`, adicionar apenas `slideInRight` dentro do objeto.

- [ ] **Step 3: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 6: EmptyStateDesktop.tsx

Estado vazio centralizado com ícone, título, descrição e CTA opcional.

**Files:**
- Create: `web/src/design/primitives/EmptyStateDesktop.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateDesktopProps {
  /** Ícone Lucide grande no topo. */
  Icon: LucideIcon;
  /** Título principal. */
  title: string;
  /** Descrição/explicação. */
  description?: string;
  /** CTA principal (botão ou link). */
  action?: ReactNode;
  /** Tamanho — sm para drawers, md para páginas inteiras. */
  size?: 'sm' | 'md';
}

/**
 * EmptyStateDesktop — estado vazio padrão para listas/grades sem dados.
 *
 * Centralizado vertical + horizontal no container pai.
 * Use dentro de PageShell ou de uma view que tenha altura definida.
 */
export function EmptyStateDesktop({
  Icon,
  title,
  description,
  action,
  size = 'md',
}: EmptyStateDesktopProps) {
  const iconSize = size === 'sm' ? 32 : 48;
  const titleClass = size === 'sm' ? 'text-[14px]' : 'text-[16px]';
  const padding = size === 'sm' ? 'py-8' : 'py-16';

  return (
    <div className={`flex flex-col items-center justify-center text-center ${padding} px-6`}>
      <div className="w-16 h-16 rounded-full bg-bg-elevated grid place-items-center mb-4">
        <Icon size={iconSize} className="text-fg-muted" strokeWidth={1.5} />
      </div>
      <h3 className={`${titleClass} font-semibold text-fg mb-1`}>{title}</h3>
      {description && (
        <p className="text-[13px] text-fg-muted max-w-sm mb-4">{description}</p>
      )}
      {action && <div>{action}</div>}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 7: LoadingSkeleton.tsx

Placeholders animados (pulse). Variantes: card, row, text, circle.

**Files:**
- Create: `web/src/design/primitives/LoadingSkeleton.tsx`

- [ ] **Step 1: Criar o arquivo**

```tsx
interface SkeletonProps {
  /** Largura: número (px) ou string CSS (ex: "100%"). */
  width?: number | string;
  /** Altura. */
  height?: number | string;
  /** Border radius — sm | md | lg | full. */
  rounded?: 'sm' | 'md' | 'lg' | 'full';
  /** Classes Tailwind extras. */
  className?: string;
}

/**
 * Skeleton — placeholder animado (pulse).
 * Base para os variants abaixo. Usa cor bg-bg-elevated-2 do design system.
 */
export function Skeleton({ width, height = 12, rounded = 'sm', className = '' }: SkeletonProps) {
  const radius = {
    sm: 'rounded',
    md: 'rounded-md',
    lg: 'rounded-lg',
    full: 'rounded-full',
  }[rounded];
  return (
    <div
      className={`bg-bg-elevated-2 animate-pulse ${radius} ${className}`}
      style={{ width, height }}
    />
  );
}

interface SkeletonCardProps {
  /** Quantidade de linhas de texto dentro do card. */
  lines?: number;
}

/** Skeleton de card (header + N linhas + footer com barra de progresso). */
export function SkeletonCard({ lines = 2 }: SkeletonCardProps) {
  return (
    <div className="p-4 rounded-lg border border-border bg-bg-surface space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Skeleton width="60%" height={14} />
        <Skeleton width={56} height={18} rounded="md" />
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '40%' : '100%'} height={10} />
      ))}
      <Skeleton width="100%" height={4} rounded="full" />
    </div>
  );
}

interface SkeletonRowProps {
  /** Quantidade de colunas. */
  cols?: number;
}

/** Skeleton de linha de tabela. */
export function SkeletonRow({ cols = 4 }: SkeletonRowProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} width={`${100 / cols}%`} height={12} />
      ))}
    </div>
  );
}

interface SkeletonListProps {
  /** Quantidade de items na lista. */
  count?: number;
  /** Variant — row ou card. */
  variant?: 'row' | 'card';
}

/** Skeleton de lista (N rows ou N cards). */
export function SkeletonList({ count = 5, variant = 'row' }: SkeletonListProps) {
  if (variant === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: count }).map((_, i) => <SkeletonCard key={i} />)}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-border bg-bg-surface overflow-hidden">
      {Array.from({ length: count }).map((_, i) => <SkeletonRow key={i} />)}
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit
```

---

### Task 8: Atualizar design/index.ts

Adicionar exports dos 7 primitivos no barrel.

**Files:**
- Modify: `web/src/design/index.ts`

- [ ] **Step 1: Substituir o conteúdo**

```ts
export { SidebarV2 } from './shell/SidebarV2';
export { TopbarV2 } from './shell/TopbarV2';
export { PageShell } from './primitives/PageShell';
export { Toolbar } from './primitives/Toolbar';
export { FilterPill } from './primitives/FilterPill';
export { ViewSwitcher } from './primitives/ViewSwitcher';
export type { ViewOption } from './primitives/ViewSwitcher';
export { DetailDrawer } from './primitives/DetailDrawer';
export { EmptyStateDesktop } from './primitives/EmptyStateDesktop';
export { Skeleton, SkeletonCard, SkeletonRow, SkeletonList } from './primitives/LoadingSkeleton';
```

- [ ] **Step 2: TypeScript check + build**

```powershell
cd D:\la-organizer\_remote\web; npx tsc --noEmit; npx vite build
```
Expected: zero erros TypeScript, build conclui em ~4s.

---

## Self-Review

**1. Spec coverage:**
- ✅ PageShell (Task 1) — header com title/subtitle/toolbar slot
- ✅ Toolbar (Task 2) — flex row com left/right slots ou children
- ✅ FilterPill (Task 3) — pill com label, value, count, active, hasDropdown
- ✅ ViewSwitcher (Task 4) — segmented control genérico tipado `<T>`
- ✅ DetailDrawer (Task 5) — slide-in da direita, Escape, backdrop click, footer opcional
- ✅ EmptyStateDesktop (Task 6) — ícone + título + desc + CTA opcional, sm/md
- ✅ LoadingSkeleton (Task 7) — Skeleton base + SkeletonCard + SkeletonRow + SkeletonList
- ✅ Barrel exports (Task 8)

**2. Placeholder scan:** Nenhum TBD/TODO. Todo código completo e direto.

**3. Type consistency:**
- `ViewSwitcher` usa generic `<T extends string>` em `id`, `value`, `onChange` — consistente.
- Todos os primitivos importam tipos React via `import type { ReactNode }`.
- Tokens Tailwind usados (`bg-bg-surface`, `text-fg`, `bg-tom/10`, `border-tom/40`, `bg-bg-elevated-2`) existem no `tailwind.config.js`.
- `focus-ring` é utility definida em `index.css`.
- Animação `animate-[slideInRight_180ms_ease-out]` no DetailDrawer requer keyframe adicionado no Task 5 step 2.
