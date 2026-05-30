# Finanças nav — Dashboard + drill-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development ou superpowers:executing-plans pra implementar task-a-task. Steps usam checkbox (`- [ ]`).
> ⚠️ **Modelo:** executar com Opus.

**Goal:** Remover a tab-bar horizontal das 5 telas de Finanças. Visão (`/financeiro`) ganha 4 cards de drill-in (Transações · Contas · Metas · Carteiras) com métrica viva. Sub-telas mantêm header "← Finanças".

**Architecture:** Causa-raiz: o sintoma "abas demais pra largura" é tratado removendo nav horizontal, não consertando overflow. Componente novo `FinanceQuickLinks` consome os hooks que já existem (`useSummary`, `useBills`, `useGoals`, `useAccounts`), calcula 1 métrica por card e renderiza 4 `<Link>` em grid 2×2 (mobile) / 4×1 (desktop). Sub-telas removem o `<FinanceTabs />` (o botão "← Finanças" já existe e fica). Arquivo `FinanceTabs.tsx` vira código morto e é deletado.

**Tech Stack:** React + TypeScript (PWA), react-router-dom (Link), Tailwind tokens (`tom`, `text-fg-muted`), `lucide-react` (Receipt/Banknote/Target/Wallet).

---

## Convenções
- **Sem commit entre tasks** — Stop hook commita `_remote/` no fim do turno.
- **Modelo:** Opus.
- **Voz visual** (spec §6): cards têm sub-linha em `text-fg-muted` — **não** vira número grande colorido. Hierarquia: StatCards (destaque) > QuickLinks (atalho) > restante.
- **Spec:** `_remote/docs/superpowers/specs/2026-05-30-financeiro-nav-dashboard-drillin-design.md` (decisões F1-F3, métricas vivas em §5, plano de testes em §7).

## Anchors verificados (não chutar)

| Item | Onde |
|---|---|
| 5 rotas reais | `web/src/App.tsx` — `path="financeiro"`, `financeiro/transacoes`, `financeiro/contas`, `financeiro/metas`, `financeiro/carteiras` |
| `deriveBillStatus(bill, today)` | `web/src/lib/financeiro.ts:127` — retorna `'paga' \| 'a-vencer' \| 'atrasada'` |
| Hooks já existem | `web/src/hooks/useFinanceiro.ts` — `useSummary`, `useBills`, `useGoals`, `useAccounts`, `useTransactions` |
| `useTransactions()` sem `monthYear` | `financeiro.ts:69` cai em `monthBounds()` default = mês corrente. `data.length` = contagem do mês ✓ |
| `useAccounts` retorna `balance: number` + filtra `is_active=true` | `financeiro.ts:48-50` |
| `is_active` em `pf_accounts` | Coluna existe (boolean). `useAccounts.data.length` = ativas. |
| `FinanceTabs` importadores | Exatamente as 5 páginas alvo. Deletar é seguro. |
| FAB do dashboard | Continua "+Registrar" → `/financeiro/transacoes?new=1`. NÃO mexer. |
| Padrão card-link no Mais | `web/src/screens/Mais.tsx:52` — `<Link to={it.to} className="flex items-center justify-between gap-md p-md hover:bg-bg-elevated focus-ring">` |

## File Structure

**Criar (1):**
- `web/src/screens/financeiro/components/FinanceQuickLinks.tsx` — 4 cards grid, consome hooks, render puro.

**Modificar (5):**
- `web/src/screens/financeiro/FinanceiroPage.tsx` — substitui `<FinanceTabs current="dashboard" />` por `<FinanceQuickLinks />`.
- `web/src/screens/financeiro/TransacoesPage.tsx` — remove `<FinanceTabs current="transacoes" />` + import.
- `web/src/screens/financeiro/ContasFixasPage.tsx` — remove `<FinanceTabs current="contas" />` + import.
- `web/src/screens/financeiro/MetasPage.tsx` — remove `<FinanceTabs current="metas" />` + import.
- `web/src/screens/financeiro/CarteirasPage.tsx` — remove `<FinanceTabs current="carteiras" />` + import.

**Deletar (1):**
- `web/src/screens/financeiro/components/FinanceTabs.tsx`

---

## Task 1: `FinanceQuickLinks.tsx` — componente novo

**Files:**
- Create: `web/src/screens/financeiro/components/FinanceQuickLinks.tsx`

> Implementação completa em 1 passo (componente puro de UI, consome hooks que já existem). Sem TDD aqui — o projeto não testa React renderizado, e o resto se prova por `tsc` + smoke real. Lógica delicada (prioridade de status, ÷0 em metas) está cravada inline com comentários.

- [ ] **Step 1: Implementar**

```tsx
import { Link } from 'react-router-dom';
import { Banknote, Receipt, Target, Wallet, type LucideIcon } from 'lucide-react';
import { useAccounts, useBills, useGoals, useTransactions } from '../../../hooks/useFinanceiro';
import { deriveBillStatus, type PfBill } from '../../../lib/financeiro';

function brl(n: number) {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

// Card de Contas — prioridade: atrasada > a-vencer > paga > vazio.
// Reusa deriveBillStatus (mesma fonte de verdade que ContasFixasPage).
function summarizeBills(bills: PfBill[] | undefined): string {
  if (!bills || bills.length === 0) return 'Nada cadastrado';
  const today = new Date();
  const status = bills.map((b) => deriveBillStatus(b, today));
  const atrasadas = status.filter((s) => s === 'atrasada').length;
  const aVencer = status.filter((s) => s === 'a-vencer').length;
  if (atrasadas > 0) return `🔴 ${atrasadas} atrasada${atrasadas > 1 ? 's' : ''}`;
  if (aVencer > 0) return `⚠️ ${aVencer} a vencer`;
  return '🟢 Tudo em dia';
}

// Card de Metas — meta com maior % de progresso (mais próxima do alvo).
// Guarda contra ÷0: ignora metas com target_amount inválido.
function summarizeGoals(goals: Array<{ name: string; target_amount: number; current_amount: number }> | undefined): string {
  if (!goals || goals.length === 0) return 'Sem metas';
  const valid = goals.filter((g) => Number(g.target_amount) > 0);
  if (valid.length === 0) return `${goals.length} meta${goals.length > 1 ? 's' : ''}`;
  const top = valid.reduce((best, g) => {
    const pct = Number(g.current_amount) / Number(g.target_amount);
    const bestPct = Number(best.current_amount) / Number(best.target_amount);
    return pct > bestPct ? g : best;
  });
  const pct = Math.round((Number(top.current_amount) / Number(top.target_amount)) * 100);
  return `${top.name} · ${pct}%`;
}

interface QuickLinkProps {
  to: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
}

function QuickLinkCard({ to, label, hint, Icon }: QuickLinkProps) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border border-border bg-bg-surface p-md hover:bg-bg-elevated focus-ring transition-colors"
    >
      <span className="shrink-0 w-10 h-10 rounded-full bg-bg-elevated grid place-items-center" aria-hidden>
        <Icon size={20} className="text-tom" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-md font-medium text-fg truncate">{label}</span>
        <span className="block text-body-sm text-fg-muted truncate">{hint}</span>
      </span>
    </Link>
  );
}

export function FinanceQuickLinks() {
  // Hooks já cobertos pelo useRealtimeFinance no FinanceiroPage (invalida ['financeiro']).
  const txQ = useTransactions(); // SEM monthYear → financeiro.ts default = mês corrente
  const billsQ = useBills();
  const goalsQ = useGoals();
  const accountsQ = useAccounts(); // já filtra is_active=true

  const txCount = txQ.data?.length ?? 0;
  const txHint = txCount === 0 ? 'Nada esse mês' : `${txCount} esse mês`;

  const billsHint = summarizeBills(billsQ.data);

  const goalsHint = summarizeGoals(goalsQ.data);

  const accountsCount = accountsQ.data?.length ?? 0;
  const accountsTotal = (accountsQ.data ?? []).reduce((s, a) => s + Number(a.balance), 0);
  const accountsHint = accountsCount === 0
    ? 'Sem carteiras'
    : `R$ ${brl(accountsTotal)} · ${accountsCount} carteira${accountsCount > 1 ? 's' : ''}`;

  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-md" aria-label="Atalhos do módulo financeiro">
      <QuickLinkCard to="/financeiro/transacoes" label="Transações" hint={txHint}       Icon={Receipt} />
      <QuickLinkCard to="/financeiro/contas"     label="Contas"     hint={billsHint}     Icon={Banknote} />
      <QuickLinkCard to="/financeiro/metas"      label="Metas"      hint={goalsHint}     Icon={Target} />
      <QuickLinkCard to="/financeiro/carteiras"  label="Carteiras"  hint={accountsHint}  Icon={Wallet} />
    </section>
  );
}
```

- [ ] **Step 2: Validar TS**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

---

## Task 2: Trocar `FinanceTabs` por `FinanceQuickLinks` no Dashboard

**Files:**
- Modify: `web/src/screens/financeiro/FinanceiroPage.tsx`

- [ ] **Step 1: Trocar o import**

No topo do arquivo, localizar:
```tsx
import { FinanceTabs } from './components/FinanceTabs';
```
Substituir por:
```tsx
import { FinanceQuickLinks } from './components/FinanceQuickLinks';
```

- [ ] **Step 2: Trocar a renderização**

Localizar a linha (~76):
```tsx
<FinanceTabs current="dashboard" />
```
Substituir por:
```tsx
<FinanceQuickLinks />
```

- [ ] **Step 3: Validar TS**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

---

## Task 3: Remover `FinanceTabs` das 4 sub-páginas

**Files (4):**
- Modify: `web/src/screens/financeiro/TransacoesPage.tsx`
- Modify: `web/src/screens/financeiro/ContasFixasPage.tsx`
- Modify: `web/src/screens/financeiro/MetasPage.tsx`
- Modify: `web/src/screens/financeiro/CarteirasPage.tsx`

> Em cada arquivo: deletar o import + a tag JSX. O header com `← Finanças` que já existe fica intacto.

- [ ] **Step 1: `TransacoesPage.tsx`**

Remover linha de import:
```tsx
import { FinanceTabs } from './components/FinanceTabs';
```
Remover a tag JSX (procurar e apagar):
```tsx
<FinanceTabs current="transacoes" />
```

- [ ] **Step 2: `ContasFixasPage.tsx`**

Remover linha de import:
```tsx
import { FinanceTabs } from './components/FinanceTabs';
```
Remover a tag JSX:
```tsx
<FinanceTabs current="contas" />
```

- [ ] **Step 3: `MetasPage.tsx`**

Remover linha de import:
```tsx
import { FinanceTabs } from './components/FinanceTabs';
```
Remover a tag JSX:
```tsx
<FinanceTabs current="metas" />
```

- [ ] **Step 4: `CarteirasPage.tsx`**

Remover linha de import:
```tsx
import { FinanceTabs } from './components/FinanceTabs';
```
Remover a tag JSX:
```tsx
<FinanceTabs current="carteiras" />
```

- [ ] **Step 5: Validar TS**

```bash
cd web && npx tsc --noEmit
```
Expected: zero erros.

---

## Task 4: Deletar `FinanceTabs.tsx`

**Files:**
- Delete: `web/src/screens/financeiro/components/FinanceTabs.tsx`

> Confirmado: importadores eram exatamente as 5 páginas alteradas nas Tasks 2 e 3. Após elas, zero referência ao arquivo. Safe to delete.

- [ ] **Step 1: Re-confirmar zero importadores**

```bash
cd web && grep -rnE "FinanceTabs" src/ --include="*.ts" --include="*.tsx"
```
Expected: zero linhas (ou apenas a definição em `components/FinanceTabs.tsx` que vai ser deletada agora).

- [ ] **Step 2: Deletar o arquivo**

```bash
rm web/src/screens/financeiro/components/FinanceTabs.tsx
```

- [ ] **Step 3: Validar TS + build**

```bash
cd web && npx tsc --noEmit && npx vite build
```
Expected: zero erros.

---

## Task 5: Smoke E2E + screenshots

**Files:** nenhum (validação).

- [ ] **Step 1: Reload no preview com cache bust + viewport mobile**

```js
// preview_eval — mobile 375
(async () => {
  if (navigator.serviceWorker) { const r = await navigator.serviceWorker.getRegistrations(); await Promise.all(r.map(x => x.unregister())); }
  if (window.caches) { const k = await caches.keys(); await Promise.all(k.map(x => caches.delete(x))); }
  window.stop();
  window.location.replace('/financeiro?bust=' + Date.now());
})();
```
Resize: `preview_resize preset="mobile"` (375x812).
Expected: página carrega em /financeiro.

- [ ] **Step 2: Tab-bar zerada + Quick links presentes (375)**

```js
// preview_eval
(async () => {
  await new Promise(r => setTimeout(r, 3500));
  // Tab-bar antiga não existe mais
  const hasTabs = !!document.querySelector('nav[aria-label="Seções de finanças"]');
  // QuickLinks (4 cards)
  const quickLinks = document.querySelector('section[aria-label="Atalhos do módulo financeiro"]');
  const links = quickLinks ? [...quickLinks.querySelectorAll('a')].map(a => ({
    label: a.querySelector('span.font-medium')?.textContent?.trim(),
    hint:  a.querySelector('span.text-fg-muted')?.textContent?.trim(),
    href:  a.getAttribute('href'),
  })) : [];
  // Sem scroll horizontal no body
  const overflowX = document.body.scrollWidth > document.body.clientWidth;
  return { path: location.pathname, hasOldTabs: hasTabs, quickLinksCount: links.length, links, scrollX: overflowX };
})();
```
Expected:
- `hasOldTabs: false`
- `quickLinksCount: 4`
- 4 hrefs corretos: `/financeiro/transacoes`, `/financeiro/contas`, `/financeiro/metas`, `/financeiro/carteiras`
- `scrollX: false` (zero scroll horizontal — sintoma original resolvido)

- [ ] **Step 3: Drill-in funciona**

Clicar no card "Contas" via eval:
```js
(async () => {
  const link = [...document.querySelectorAll('section[aria-label="Atalhos do módulo financeiro"] a')]
    .find(a => a.getAttribute('href') === '/financeiro/contas');
  link.click();
  await new Promise(r => setTimeout(r, 1500));
  const hasTabs = !!document.querySelector('nav[aria-label="Seções de finanças"]');
  const backBtn = [...document.querySelectorAll('button')].find(b => /Voltar/.test(b.textContent || ''));
  return { path: location.pathname, hasOldTabs: hasTabs, hasBackBtn: !!backBtn };
})();
```
Expected: `path: '/financeiro/contas'`, `hasOldTabs: false`, `hasBackBtn: true`.

- [ ] **Step 4: Voltar funciona**

```js
(async () => {
  const back = [...document.querySelectorAll('button')].find(b => /Voltar/.test(b.textContent || ''));
  back.click();
  await new Promise(r => setTimeout(r, 1000));
  return { path: location.pathname };
})();
```
Expected: `path: '/financeiro'`.

- [ ] **Step 5: Desktop intacto (1440)**

```bash
preview_resize width=1440 height=900
```
```js
(async () => {
  await new Promise(r => setTimeout(r, 2000));
  const hasAside = !!document.querySelector('aside');
  const quickLinks = document.querySelector('section[aria-label="Atalhos do módulo financeiro"]');
  const isGrid4 = quickLinks ? getComputedStyle(quickLinks).gridTemplateColumns.split(' ').length === 4 : false;
  return { viewport: { w: innerWidth }, hasAside, quickLinksColCount: isGrid4 ? 4 : 2 };
})();
```
Expected: `viewport.w: 1440`, `hasAside: true` (SidebarV2 intocada), `quickLinksColCount: 4`.

- [ ] **Step 6: Empty states (sem dados)**

Pré-condição: conta limpa (sem transações/contas/metas/carteiras — já é o caso da conta do Luciano).
Expected (recolocar viewport mobile 375 e visitar `/financeiro`):
- Card Transações: `"Nada esse mês"`
- Card Contas: `"Nada cadastrado"`
- Card Metas: `"Sem metas"`
- Card Carteiras: `"Sem carteiras"`

- [ ] **Step 7: Build verde + cleanup**

```bash
cd web && npx tsc --noEmit && npx vite build 2>&1 | grep -E "built in|error" | tail -3
```
Expected: build OK, sem erros, bundle não regrediu (chunks de FinanceiroPage ~12kB, sem o FinanceCharts).

---

## Pontos a confirmar na execução (não bloqueiam)

- **Ícones lucide-react**: `Receipt`, `Banknote`, `Target`, `Wallet` — confirmar todos disponíveis. `Wallet` já é usado pelo SidebarV2/Mais (Fase C); resto é padrão.

## Out of scope

- FAB do dashboard (continua "+Registrar" → `/financeiro/transacoes?new=1`).
- Sparklines / mini-gráficos dentro dos cards.
- Switcher "rápido" entre sub-telas.
- Métricas mais elaboradas (top categoria, etc.).
- Cards customizáveis.
