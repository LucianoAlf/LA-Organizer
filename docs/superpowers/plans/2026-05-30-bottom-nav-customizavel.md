# Bottom Nav customizável — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans pra implementar task-a-task. Steps usam checkbox (`- [ ]`).
> ⚠️ **Modelo:** executar com Opus (decisão do Alf — frontend exige).

**Goal:** Permitir que cada colaborador escolha **4 dos 5 slots** do bottom nav mobile (o 5º é "Mais", fixo), via uma seção em `/configuracoes`. Persistência em `user_preferences.bottom_nav_items text[]`.

**Architecture:** Migration cria a coluna com default que backfilla linhas existentes. `web/src/lib/navItems.ts` espelha verbatim o array `sections` do `SidebarV2:60-110` (slug + label + Icon + matchPaths + `when()`) — única fonte da verdade pra catálogo de módulos. Hook `useNavPreferences` lê via Supabase (RLS owner-only) e expõe `items` sempre com 4 itens válidos (drop inválido + recomplete com defaults). `BottomNav.tsx` consome a pref SÓ no bloco `md:hidden`; bloco `hidden md:flex` (código morto no shell atual) fica intocado como defesa preventiva. `NavCustomizer.tsx` é componente standalone montado em `Configuracoes.tsx` como uma `<section className="surface">`.

**Tech Stack:** Supabase JS (JWT/RLS), TanStack Query v5, Tailwind tokens (`tom`, `bg-bg-surface`), AdaptiveSheet/CustomSelect/Button/Field do DS, Vitest pros puros.

---

## Convenções
- **Sem commit entre tasks** — Stop hook commita `_remote/`. Migration via MCP `apply_migration` (projeto `cesnbnrynvxvgdhfmaua`).
- **Modelo:** Opus em todas as tasks.
- **REGRA INEGOCIÁVEL (spec §4):** o catálogo de `navItems.ts` é **transcrição literal** do array `sections` em `web/src/design/shell/SidebarV2.tsx:60-110`. Mesmo `to/label/Icon/matchPaths/condições`. Mesma query `isMentor` com mesmo `queryKey: ['is-mentor', collaborator?.id]` (cache compartilhado).
- **Escopo só mobile:** só o bloco `<ul className="grid grid-cols-5 ... md:hidden">` do BottomNav consome a pref. Bloco `hidden md:flex` fica hardcoded como está.
- **Spec:** `_remote/docs/superpowers/specs/2026-05-30-bottom-nav-customizavel-design.md` (N1-N8).

## Anchors verificados (não chutar)

| Item | Local |
|---|---|
| BottomNav atual | `web/src/components/BottomNav.tsx` — bloco mobile `md:hidden` (~linha 46) e bloco desktop morto `hidden md:flex` (~linha 70), ambos consomem `items` |
| SidebarV2 (fonte do catálogo) | `web/src/design/shell/SidebarV2.tsx:60-110` — array `sections` |
| Configuracoes.tsx | `web/src/screens/Configuracoes.tsx:635` — padrão `<section className="surface p-md space-y-md"><h3 className="text-card-title">…</h3></section>` |
| Auth | `web/src/contexts/AuthContext.tsx:218-222` — `useAuth()` retorna `{ collaborator, role, … }`; tolerante a `undefined` no boot (pattern do `useFinanceiroAuth`) |
| `useAccess` | `web/src/hooks/useAccess.ts:6` — `(dataType: string) => { allowed: boolean, … }` |
| `hasCoordLevel` | `web/src/lib/permissions.ts:22` — **util do projeto, NÃO é ícone lucide** |
| AdaptiveSheet | `web/src/components/AdaptiveSheet.tsx` — `{ open, onClose, title, children, size? }` |
| Constraint UNIQUE | `user_preferences.collaborator_id` é UNIQUE → `upsert({onConflict:'collaborator_id'})` funciona |

## File Structure

**Criar (3):**
- `web/src/lib/navItems.ts` — catálogo + helpers (`availableNavItems`, `resolveSlugs`).
- `web/src/lib/navItems.test.ts` — Vitest pros helpers puros.
- `web/src/hooks/useNavPreferences.ts` — TanStack Query: lê `user_preferences.bottom_nav_items`, expõe `items` (sempre 4 válidos), `available`, `setSlugs`.
- `web/src/components/NavCustomizer.tsx` — UI: 4 slots editáveis + Mais (fixo) + picker via AdaptiveSheet + "Restaurar padrão".

**Modificar:**
- `web/src/components/BottomNav.tsx` — bloco `md:hidden` consome `useNavPreferences().items` + "Mais" como 5º fixo. Bloco `hidden md:flex` NÃO toca.
- `web/src/screens/Configuracoes.tsx` — adicionar `<section>` "Navegação rápida" com `<NavCustomizer />`.

**Migration (1):**
- Aplicada via MCP `apply_migration`. Arquivo `.sql` em `_remote/migrations/` é histórico.

---

## Task 1: Migration — coluna `bottom_nav_items`

**Files:** Create `migrations/20260530_bottom_nav_items.sql` (histórico).

- [ ] **Step 1: Confirmar UNIQUE de `collaborator_id`**

MCP `execute_sql`:
```sql
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.user_preferences'::regclass
  AND contype = 'u';
```
Expected: 1+ linha incluindo um nome de constraint UNIQUE em `collaborator_id`. (Já confirmado pela revisão do Alf — refazer pra travar.)

- [ ] **Step 2: Aplicar migration**

MCP `apply_migration` (name: `bottom_nav_items_pref`):
```sql
ALTER TABLE user_preferences
  ADD COLUMN bottom_nav_items text[]
  NOT NULL
  DEFAULT ARRAY['/hoje','/projetos','/checklists','/habitos']::text[];
```
Expected: sucesso. `DEFAULT` backfilla linhas existentes; `NOT NULL` evita ambiguidade no client.

- [ ] **Step 3: Verificar**

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='user_preferences' AND column_name='bottom_nav_items';
```
Expected: 1 linha, `data_type=ARRAY`, default = `'{/hoje,/projetos,/checklists,/habitos}'::text[]`, `is_nullable=NO`.

- [ ] **Step 4: Histórico do arquivo SQL**

Criar `migrations/20260530_bottom_nav_items.sql` com o mesmo conteúdo do Step 2 (referência histórica; aplicação real foi via MCP).

---

## Task 2: `lib/navItems.ts` — catálogo (transcrição literal do SidebarV2)

**Files:**
- Create: `web/src/lib/navItems.ts`, `web/src/lib/navItems.test.ts`

> **REGRA:** abrir `web/src/design/shell/SidebarV2.tsx:60-110` LADO A LADO e copiar verbatim cada item do array `sections`. Imports de lucide-react seguem os mesmos da SidebarV2 (sem duplicar `Wallet`). `hasCoordLevel` vem de `../lib/permissions` (util do projeto). NÃO inventar gating: replica `role === 'coordinator' || role === 'director'`, `hasCoordLevel(collab)`, `useAccess('inventario')`, etc.

- [ ] **Step 1: Escrever o teste primeiro**

> ⚠️ **Cuidado TDD (aviso explícito do Alf):** os testes travam **apenas invariantes estruturais** (sempre 4, dedup, drop-inválido-recompleta, label "Agenda", defaults disponíveis). Os testes NÃO assertam o gating de nuance (LA Journey ≠ manager, LA Educa mentor, etc.) — esse gating tem que vir VERBATIM do SidebarV2:60-110, não de palpite no teste. Os 2 únicos testes "óbvios e seguros" sobre gating são: (a) director (cobre todos os gated → catálogo inteiro disponível); (b) collaborator pelado (cobre nenhum gated → só os 4 sem `when`). Isso prova que o gating funciona sem codificar regras específicas.

Criar `web/src/lib/navItems.test.ts`:
```ts
import { test, expect } from 'vitest';
import { NAV_CATALOG, availableNavItems, resolveSlugs, DEFAULT_NAV_SLUGS, type NavGateContext } from './navItems';

const fullCtx: NavGateContext = {
  role: 'director',
  collaborator: { id: 'x', role: 'director' } as never,
  access: { inventario: true, loja_produtos: true },
  isMentor: true,
};
const minCtx: NavGateContext = {
  role: 'collaborator',
  collaborator: { id: 'x', role: 'collaborator' } as never,
  access: { inventario: false, loja_produtos: false },
  isMentor: false,
};

// ============ INVARIANTES ESTRUTURAIS ============

test('catálogo inclui exatamente os 4 slugs default (sem when)', () => {
  for (const slug of DEFAULT_NAV_SLUGS) {
    const item = NAV_CATALOG.find((i) => i.slug === slug);
    expect(item).toBeDefined();
    expect(item!.when).toBeUndefined(); // defaults NUNCA têm gating
  }
});

test('/hoje preserva label "Agenda" + matchPaths corretos', () => {
  const hoje = NAV_CATALOG.find((i) => i.slug === '/hoje')!;
  expect(hoje.label).toBe('Agenda');
  expect(hoje.matchPaths).toEqual(['/hoje', '/semana']);
});

test('director vê TODO o catálogo (limite máximo do gating)', () => {
  const avail = availableNavItems(fullCtx);
  expect(avail).toHaveLength(NAV_CATALOG.length);
});

test('collaborator sem permissões só vê os itens SEM when (limite mínimo)', () => {
  const avail = availableNavItems(minCtx);
  const slugsSemWhen = NAV_CATALOG.filter((i) => !i.when).map((i) => i.slug);
  expect(avail.map((i) => i.slug).sort()).toEqual(slugsSemWhen.sort());
});

// ============ resolveSlugs — sempre 4 válidos ============

test('resolveSlugs sempre devolve EXATAMENTE 4 itens', () => {
  expect(resolveSlugs([], fullCtx)).toHaveLength(4);
  expect(resolveSlugs(['/hoje'], fullCtx)).toHaveLength(4);
  expect(resolveSlugs(['/hoje','/projetos','/checklists','/habitos','/financeiro'], fullCtx)).toHaveLength(4);
});

test('resolveSlugs([], minCtx) também devolve 4 (defaults bastam)', () => {
  // mesmo collaborator pelado consegue 4 itens — porque DEFAULT_NAV_SLUGS são todos sem when.
  expect(resolveSlugs([], minCtx)).toHaveLength(4);
});

test('resolveSlugs drop slug inválido e recompleta com default', () => {
  const out = resolveSlugs(['/lixo', '/projetos'], fullCtx).map((i) => i.slug);
  expect(out).not.toContain('/lixo');
  expect(out).toContain('/projetos');
  expect(out).toHaveLength(4);
});

test('resolveSlugs drop slug sem permissão (genérico, sem assumir qual)', () => {
  // pega o primeiro item com when do catálogo (independe de qual seja)
  const gatedSlug = NAV_CATALOG.find((i) => i.when)!.slug;
  const out = resolveSlugs([gatedSlug, '/projetos'], minCtx).map((i) => i.slug);
  expect(out).not.toContain(gatedSlug); // collaborator pelado nunca passa em when
  expect(out).toContain('/projetos');
  expect(out).toHaveLength(4);
});

test('resolveSlugs dedup', () => {
  const out = resolveSlugs(['/hoje','/hoje','/projetos'], fullCtx).map((i) => i.slug);
  expect(out.filter((s) => s === '/hoje')).toHaveLength(1);
  expect(out).toHaveLength(4);
});

test('resolveSlugs preserva ordem do array de entrada', () => {
  const out = resolveSlugs(['/projetos','/habitos','/hoje','/checklists'], fullCtx).map((i) => i.slug);
  expect(out).toEqual(['/projetos','/habitos','/hoje','/checklists']);
});
```

- [ ] **Step 2: Rodar (falha)**

```bash
cd web && npx vitest run src/lib/navItems.test.ts
```
Expected: FAIL — módulo `./navItems` não existe.

- [ ] **Step 3: Implementar `navItems.ts` (transcrição literal)**

> **Antes de escrever**, abrir `web/src/design/shell/SidebarV2.tsx` e localizar o array `sections` (linha ~60). Copiar item por item nas seções `principal`, `gestao`, `educacao`, `operacoes`, `sistema`. Para items com gating condicional (`...(role === 'director' ? [{...}] : [])`), o gating vira o `when()`.

Criar `web/src/lib/navItems.ts`:
```ts
// Catálogo único de módulos disponíveis no nav. Espelha verbatim o array `sections`
// de web/src/design/shell/SidebarV2.tsx:60-110. Mudou item lá? Espelha aqui.
import {
  CalendarDays, Rocket, ClipboardCheck, Sparkles, Wallet,
  Users, BarChart3, Target, Megaphone, Eye, UserCog, ShieldCheck,
  GraduationCap, Music, Package, ShoppingBag,
  CalendarRange, History, Settings,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { hasCoordLevel } from './permissions';

// Tipo do collaborator é o que useAuth() expõe — usamos `unknown` aqui pra evitar
// import circular; o caller passa o objeto direto do useAuth.
export interface NavGateContext {
  role: string | null;
  collaborator: Parameters<typeof hasCoordLevel>[0];
  access: { inventario: boolean; loja_produtos: boolean };
  isMentor: boolean;
}

export interface NavCatalogItem {
  slug: string;
  label: string;
  Icon: LucideIcon;
  matchPaths?: string[];
  when?: (ctx: NavGateContext) => boolean;
}

// ⚠️ Transcrição literal do SidebarV2:60-110. Não inventar paths nem gating.
// SidebarV2 usa '/agenda?view=day' como slug do item Agenda no desktop, mas
// o BottomNav mobile sempre usou '/hoje'. Mantemos '/hoje' aqui — é o slug
// do nav mobile (default do banco também usa '/hoje').
export const NAV_CATALOG: NavCatalogItem[] = [
  // Principal — sempre disponível
  { slug: '/hoje',          label: 'Agenda',          Icon: CalendarDays,    matchPaths: ['/hoje','/semana'] },
  { slug: '/projetos',      label: 'Projetos',        Icon: Rocket },
  { slug: '/checklists',    label: 'Checklists',      Icon: ClipboardCheck },
  { slug: '/habitos',       label: 'Hábitos',         Icon: Sparkles },
  { slug: '/financeiro',    label: 'Finanças',        Icon: Wallet,           matchPaths: ['/financeiro'] },

  // Gestão (gated por role/coord)
  { slug: '/time',                      label: 'Dashboard time', Icon: Users,
    when: (c) => c.role === 'coordinator' || c.role === 'director' },
  { slug: '/mais/aderencia-checklists', label: 'Aderência',      Icon: BarChart3,
    when: (c) => c.role === 'director' || c.role === 'manager' },
  { slug: '/mais/operacoes',            label: 'Operações',      Icon: Target,
    when: (c) => !!c.role && ['director','coordinator','manager'].includes(c.role) },
  { slug: '/mais/comunicados',          label: 'Comunicados',    Icon: Megaphone,
    when: (c) => hasCoordLevel(c.collaborator) },
  { slug: '/mais/observabilidade',      label: 'Observabilidade', Icon: Eye,
    when: (c) => c.role === 'director' || c.role === 'coordinator' },
  { slug: '/mais/gestao-equipe',        label: 'Gestão equipe',  Icon: UserCog,
    when: (c) => !!c.role && ['director','coordinator','manager'].includes(c.role) },
  { slug: '/mais/governanca',           label: 'Credenciais',    Icon: ShieldCheck,
    when: (c) => c.role === 'director' },

  // Educação (gated)
  { slug: '/la-educa',   label: 'LA Educa',  Icon: GraduationCap,
    when: (c) => !!c.role && (['coordinator','director'].includes(c.role) || c.isMentor) },
  { slug: '/la-journey', label: 'LA Journey', Icon: Music,
    when: (c) => c.role !== 'manager' },

  // Operações (access)
  { slug: '/inventario',      label: 'Inventário', Icon: Package,     when: (c) => c.access.inventario },
  { slug: '/inventario/loja', label: 'Lojinha',    Icon: ShoppingBag, when: (c) => c.access.loja_produtos },

  // Sistema — sempre disponível
  { slug: '/mais/agenda-escolar', label: 'Agenda LA Music', Icon: CalendarRange },
  { slug: '/historico',           label: 'Histórico',       Icon: History },
  { slug: '/configuracoes',       label: 'Configurações',   Icon: Settings },
];

export const DEFAULT_NAV_SLUGS = ['/hoje','/projetos','/checklists','/habitos'] as const;

export function availableNavItems(ctx: NavGateContext): NavCatalogItem[] {
  return NAV_CATALOG.filter((it) => !it.when || it.when(ctx));
}

// Resolve uma lista de slugs em itens válidos. SEMPRE devolve EXATAMENTE 4 itens:
// - dedup (sem duplicar)
// - filtra slugs sem permissão / inválidos
// - recompleta com DEFAULT_NAV_SLUGS na ordem (sem repetir o que já entrou)
export function resolveSlugs(slugs: string[], ctx: NavGateContext): NavCatalogItem[] {
  const avail = availableNavItems(ctx);
  const bySlug = new Map(avail.map((i) => [i.slug, i] as const));
  const out: NavCatalogItem[] = [];
  const seen = new Set<string>();
  for (const s of slugs) {
    if (out.length === 4) break;
    if (seen.has(s)) continue;
    const it = bySlug.get(s);
    if (!it) continue;
    out.push(it);
    seen.add(s);
  }
  for (const s of DEFAULT_NAV_SLUGS) {
    if (out.length === 4) break;
    if (seen.has(s)) continue;
    const it = bySlug.get(s);
    if (!it) continue;
    out.push(it);
    seen.add(s);
  }
  return out;
}
```

- [ ] **Step 4: Rodar (passa)**

```bash
cd web && npx vitest run src/lib/navItems.test.ts
```
Expected: PASS (8 testes).

- [ ] **Step 5: Validar TS**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros (em particular: confirmar que `hasCoordLevel` é importado de `./permissions`, não de `lucide-react`; e que `Wallet` aparece 1x no import).

---

## Task 3: Hook `useNavPreferences`

**Files:** Create `web/src/hooks/useNavPreferences.ts`

> Tolerante a `collaborator` undefined no boot (mesmo padrão de `useFinanceiroAuth`: `enabled: !!collaborator`).
>
> ⚠️ **isMentor — CORPO VERBATIM (não só queryKey).** QueryKey compartilhado com queryFn divergente é armadilha de cache: se as duas montarem com bodies diferentes, retorno fica inconsistente. Tem que ser BYTE-A-BYTE igual ao SidebarV2:43-55. Cópia exata abaixo, confirmada na execução:
>
> ```ts
> const { data: isMentor = false } = useQuery({
>   queryKey: ['is-mentor', collaborator?.id],
>   queryFn: async () => {
>     if (!collaborator) return false;
>     const { count } = await supabase
>       .from('la_educa_estagiarios')
>       .select('id', { count: 'exact', head: true })
>       .eq('mentor_id', collaborator.id);
>     return (count ?? 0) > 0;
>   },
>   enabled: !!collaborator,
> });
> ```
>
> Se SidebarV2 mudar essa query no futuro, **as DUAS têm que mudar juntas** (ou cache mente).

- [ ] **Step 1: Implementar**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useAccess } from './useAccess';
import { supabase } from '../lib/supabase';
import {
  availableNavItems, resolveSlugs, DEFAULT_NAV_SLUGS,
  type NavGateContext, type NavCatalogItem,
} from '../lib/navItems';

const KEY = ['nav-prefs'] as const;

export function useNavPreferences() {
  const { collaborator, role } = useAuth();
  const { allowed: inventario }    = useAccess('inventario');
  const { allowed: loja_produtos } = useAccess('loja_produtos');

  // Cache compartilhado com SidebarV2 (mesmo queryKey).
  const isMentorQ = useQuery({
    queryKey: ['is-mentor', collaborator?.id],
    queryFn: async () => {
      if (!collaborator) return false;
      const { count } = await supabase
        .from('la_educa_estagiarios')
        .select('id', { count: 'exact', head: true })
        .eq('mentor_id', collaborator.id);
      return (count ?? 0) > 0;
    },
    enabled: !!collaborator,
  });

  const ctx: NavGateContext = {
    role: role ?? null,
    collaborator,
    access: { inventario, loja_produtos },
    isMentor: !!isMentorQ.data,
  };

  const prefsQ = useQuery({
    queryKey: [...KEY, collaborator?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_preferences')
        .select('bottom_nav_items')
        .eq('collaborator_id', collaborator!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.bottom_nav_items ?? [...DEFAULT_NAV_SLUGS];
    },
    enabled: !!collaborator,
  });

  // SEMPRE 4 itens válidos (drop inválido + recomplete + dedup).
  const items: NavCatalogItem[] = resolveSlugs(prefsQ.data ?? [], ctx);
  const available: NavCatalogItem[] = availableNavItems(ctx);

  const qc = useQueryClient();
  const setMut = useMutation({
    mutationFn: async (slugs: string[]) => {
      if (!collaborator) throw new Error('sem sessão');
      // upsert por collaborator_id (UNIQUE confirmado na Task 1).
      const { error } = await supabase
        .from('user_preferences')
        .upsert(
          { collaborator_id: collaborator.id, bottom_nav_items: slugs },
          { onConflict: 'collaborator_id' },
        );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [...KEY, collaborator?.id] }),
  });

  return {
    items,
    available,
    rawSlugs: prefsQ.data ?? [...DEFAULT_NAV_SLUGS],
    setSlugs: setMut.mutateAsync,
    saving: setMut.isPending,
    loading: prefsQ.isLoading,
  };
}
```

- [ ] **Step 2: Validar TS**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

---

## Task 4: `BottomNav.tsx` — bloco `md:hidden` consome a pref

**Files:** Modify `web/src/components/BottomNav.tsx`

> **CRÍTICO:** mexer APENAS no bloco `<ul ... md:hidden>` (linha ~46). Bloco `hidden md:flex` (linha ~70) fica intocado como defesa preventiva (vide spec §3).

- [ ] **Step 1: Adicionar imports + chamar hook + montar 5 slots**

Localizar no `BottomNav.tsx` a `function BottomNav()` e modificar:

```tsx
import { NavLink, useLocation } from 'react-router-dom';
import { CalendarDays, Rocket, ClipboardCheck, Sparkles, Menu } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavPreferences } from '../hooks/useNavPreferences';
import type { LucideIcon } from 'lucide-react';
```
(Apenas o último `import` é novo — os outros já existem.)

Dentro do componente, ANTES do `return`:
```tsx
const { items: customItems } = useNavPreferences();
const moreItem = { to: '/mais', label: 'Mais', Icon: Menu as LucideIcon, matchPaths: undefined as string[] | undefined };
const mobileItems = [
  ...customItems.map((i) => ({ to: i.slug, label: i.label, Icon: i.Icon, matchPaths: i.matchPaths })),
  moreItem,
];
```

E o bloco `md:hidden` renderiza `mobileItems` em vez de `items`:
```tsx
<ul className="grid grid-cols-5 max-w-content mx-auto md:hidden">
  {mobileItems.map(item => {
    const { to, label, Icon } = item;
    return (
      <li key={to}>
        <NavLink
          to={to}
          className={({ isActive }) => {
            const active = isItemActive(item, isActive);
            return [
              'flex flex-col items-center justify-center gap-1 py-2.5 focus-ring',
              active ? 'text-tom' : 'text-fg-muted',
            ].join(' ');
          }}
        >
          {({ isActive }) => {
            const _active = isItemActive(item, isActive);
            void _active;
            return (
              <>
                <Icon size={22} />
                <span className="text-[11px] font-semibold tracking-wide">{label}</span>
              </>
            );
          }}
        </NavLink>
      </li>
    );
  })}
</ul>
```

- [ ] **Step 2: Bloco `hidden md:flex` — INTACTO + comentário**

Acima do bloco desktop (linha ~70), adicionar comentário:
```tsx
{/* Sprint X — Bottom nav customizado aplica APENAS ao bloco mobile acima.
    Este bloco desktop é código MORTO no shell atual (DesktopShell renderiza
    SidebarV2, não BottomNav). Mantemos a lista fixa como defesa preventiva
    caso BottomNav volte ao desktop em refactor futuro. */}
<ul className="hidden md:flex items-center gap-md max-w-content mx-auto px-md py-2">
  {/* ... continua usando o array `items` original sem alteração ... */}
```

- [ ] **Step 3: Validar TS + build**

```bash
cd web && npx tsc --noEmit && npx vite build
```
Expected: zero erros.

- [ ] **Step 4: Smoke visual no preview**

Reload com cache bust em `localhost:4173/hoje` viewport mobile (375). Bottom nav deve continuar mostrando os 5 itens defaults (Agenda/Projetos/Checklists/Hábitos/Mais) — porque ainda não mudamos nada nas prefs.

---

## Task 5: Componente `NavCustomizer.tsx`

**Files:** Create `web/src/components/NavCustomizer.tsx`

> UX (spec §4):
> - 4 slots editáveis (cada um: ícone + label, botões ↑/↓ habilitados conforme posição, botão "Trocar").
> - 5º slot "Mais" read-only (sem controles, label "fixo").
> - "Trocar" abre `AdaptiveSheet` com lista `available` (check ✓ nos já usados, desabilitado pra trocar pro slug que está em outro slot).
> - Botão "Restaurar padrão" no rodapé.
> - Salva otimista no `onChange` (toda interação chama `setSlugs`).

- [ ] **Step 1: Implementar**

```tsx
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
    setSlugs(next).catch((e) => console.error(e));
  }
  function replace(idx: number, slug: string) {
    const next = [...currentSlugs];
    // se o slug já existe em outro slot, troca de posição (swap)
    const existing = next.indexOf(slug);
    if (existing >= 0 && existing !== idx) {
      next[existing] = next[idx];
    }
    next[idx] = slug;
    setSlugs(next).catch((e) => console.error(e));
    setPickerOpenIdx(null);
  }
  function restore() {
    setSlugs([...DEFAULT_NAV_SLUGS]).catch((e) => console.error(e));
  }

  return (
    <div className="space-y-3">
      <p className="text-body-sm text-fg-muted">
        Escolhe os 4 atalhos que aparecem no nav inferior no celular. <strong className="text-fg">Mais</strong> sempre fica como 5º.
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

      {/* Picker — substituir o slot selecionado */}
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
  idx, item, disabledUp, disabledDown, onUp, onDown, onSwap,
}: {
  idx: number;
  item: NavCatalogItem;
  disabledUp: boolean; disabledDown: boolean;
  onUp: () => void; onDown: () => void; onSwap: () => void;
}) {
  const { Icon, label } = item;
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-surface px-2.5 py-2">
      <span className="font-mono text-fg-muted text-[11px] w-4 text-center">{idx + 1}</span>
      <Icon size={18} className="text-fg-muted" />
      <span className="text-body-md text-fg truncate">{label}</span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button" aria-label="Subir"
          onClick={onUp} disabled={disabledUp}
          className="h-7 w-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-bg-elevated disabled:opacity-30 focus-ring"
        >
          <ArrowUp size={14} />
        </button>
        <button
          type="button" aria-label="Descer"
          onClick={onDown} disabled={disabledDown}
          className="h-7 w-7 grid place-items-center rounded text-fg-muted hover:text-fg hover:bg-bg-elevated disabled:opacity-30 focus-ring"
        >
          <ArrowDown size={14} />
        </button>
        <Button size="sm" variant="ghost" onClick={onSwap}>Trocar</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Validar TS**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

---

## Task 6: Integrar em `Configuracoes.tsx`

**Files:** Modify `web/src/screens/Configuracoes.tsx`

> Adicionar uma `<section>` "Navegação rápida" usando o padrão do projeto (`surface p-md space-y-md` + `<h3 className="text-card-title">`). Importar e montar `<NavCustomizer />`.

- [ ] **Step 1: Adicionar o import**

No topo do arquivo (junto dos outros imports):
```tsx
import { NavCustomizer } from '../components/NavCustomizer';
```

- [ ] **Step 2: Localizar onde inserir a section**

Procurar a primeira ocorrência de `<section className="surface p-md space-y-md">` (~linha 635) e inserir a section nova **logo antes dela** (fica como primeira seção, acima das prefs de briefing/quiet hours):

```tsx
<section className="surface p-md space-y-md">
  <h3 className="text-card-title">Navegação rápida</h3>
  <NavCustomizer />
</section>
```

- [ ] **Step 3: Validar TS + build + preview**

```bash
cd web && npx tsc --noEmit && npx vite build
```
Expected: zero erros. Reload no preview em `/configuracoes`, conferir que a section "Navegação rápida" aparece no topo com os 4 slots + Mais (fixo).

---

## Task 7: Smoke E2E + regressão + cleanup

**Files:** nenhum (validação).

- [ ] **Step 1: Caso default**

Estado inicial: pessoa nunca mexeu → bottom nav mobile mostra Agenda/Projetos/Checklists/Hábitos/Mais (defaults).

`preview_eval` em viewport mobile (375):
```js
[...document.querySelector('nav[aria-label="Navegação principal"] ul.md\\:hidden').querySelectorAll('a')].map(a => a.textContent?.trim())
```
Expected: `['Agenda','Projetos','Checklists','Hábitos','Mais']`.

- [ ] **Step 2: Trocar slot 4 (Hábitos → Finanças)**

Abrir `/configuracoes`, achar a section "Navegação rápida", clicar "Trocar" no slot 4, selecionar "Finanças". Voltar pra `/hoje` (mobile 375). Conferir que o slot 4 agora é Finanças.

`preview_eval`:
```js
[...document.querySelector('nav[aria-label="Navegação principal"] ul.md\\:hidden').querySelectorAll('a')].map(a => a.textContent?.trim())
```
Expected: `['Agenda','Projetos','Checklists','Finanças','Mais']`.

Verificar persistência no banco:
```sql
SELECT bottom_nav_items FROM user_preferences
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
```
Expected: `{'/hoje','/projetos','/checklists','/financeiro'}` (sem `/mais` — ele é sempre adicionado no client; o array salvo só tem os 4 customizáveis).

- [ ] **Step 3: Reorder ↑↓**

Em `/configuracoes`, clicar ↑ no slot 4 (Finanças sobe pra 3). Voltar pra `/hoje`. Conferir nav.
Expected: `['Agenda','Projetos','Finanças','Checklists','Mais']`. Banco persistiu nova ordem.

- [ ] **Step 4: Slug inválido recompleta**

Simulando "perdeu acesso" — UPDATE direto no banco com slug inexistente:
```sql
UPDATE user_preferences
SET bottom_nav_items = ARRAY['/lixo','/projetos','/checklists','/habitos']
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
```
Reload do preview. Conferir que `/lixo` foi dropado e `resolveSlugs` recompletou com `/hoje` (default).
Expected nav: `['Projetos','Checklists','Hábitos','Agenda','Mais']` — `/lixo` saiu, `/hoje` entrou ao final.

> Esse teste prova: `resolveSlugs` mantém o nav sempre com 4 itens válidos mesmo se a pref no banco tem lixo.

- [ ] **Step 5: "Mais" intocável**

No `/configuracoes`, conferir visualmente que o slot 5 ("Mais") aparece marcado como "fixo", sem botões ↑↓ nem "Trocar".

- [ ] **Step 6: Bloco desktop intacto**

`preview_eval` em viewport 1440:
```js
// O DesktopShell renderiza SidebarV2, BottomNav nem aparece no DOM.
({
  hasAside: !!document.querySelector('aside'),
  hasBottomNav: !!document.querySelector('nav[aria-label="Navegação principal"]'),
})
```
Expected: `{ hasAside: true, hasBottomNav: false }`. Confirma que o desktop continua usando SidebarV2 e não é afetado pela customização.

- [ ] **Step 7: Cross-user (RLS owner-only)**

Logado como Luciano, tentar ler `bottom_nav_items` de outro collaborator (Quintela):
```js
// preview_eval — usa o supabase já carregado pelo app
const { data } = await window.__sb__?.from('user_preferences').select('collaborator_id, bottom_nav_items').neq('collaborator_id', '0576f4b6-183d-4cf1-980e-5c8d5da0177f');
return data;
```
Expected: `null` ou `[]` — RLS bloqueia.

> Se `window.__sb__` não estiver exposto, fazer via SQL `SET LOCAL request.jwt.claims` (mesmo padrão da Fase C / Task 11).

- [ ] **Step 8: Restaurar padrão e cleanup**

Em `/configuracoes` clicar "Restaurar padrão". Conferir que volta pros defaults.
Verificar banco:
```sql
SELECT bottom_nav_items FROM user_preferences
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f';
```
Expected: `{'/hoje','/projetos','/checklists','/habitos'}`.

---

## Pontos a confirmar na execução (não bloqueiam)

- **Estrutura do `Configuracoes.tsx`**: confirmar na Task 6 Step 2 o ponto exato onde inserir a section (acima de qual `<section>` existente).
- **`useAccess` retorno completo**: spec assume `{ allowed: boolean }`; o tipo real (`AccessResult & { isCollab: boolean }`) só precisa do `allowed` — confirma destructuring na Task 3.

## Out of scope (registrado na spec §7)

- Customização do top-rail desktop / SidebarV2.
- "Mais" customizável.
- Sugestão automática baseada em uso.
- Sincronização realtime entre abas.
- Refatorar SidebarV2 pra consumir `NAV_CATALOG` (DRY total — sprint futura com OK explícito).
