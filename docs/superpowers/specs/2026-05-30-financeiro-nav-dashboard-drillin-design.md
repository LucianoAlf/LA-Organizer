# Design — Refatoração da nav do Finanças (Dashboard + drill-in)

> **Data:** 2026-05-30 · **Trigger:** smoke real no celular após a Fase C mostrou que a tab-bar horizontal (5 abas + scroll) some no mobile e fica feia.
> **Spec mãe:** `2026-05-30-financeiro-pwa-fase-c-design.md`. Esta spec **substitui** a decisão E3 sobre tabs internas.

---

## 1. Resumo

Remove a tab-bar horizontal (`FinanceTabs`) das 5 telas do módulo Finanças. `/financeiro` (Visão) vira a home e ganha 4 cards de drill-in logo abaixo dos StatCards (Transações · Contas · Metas · Carteiras). Cada card mostra **uma métrica viva** (sub-linha muted, não destaque) e leva pra sub-tela com `Link to=`. As 4 sub-telas mantêm o header com botão "← Finanças" (já existe) e ficam sem a barra de abas. Causa-raiz tratada: o sintoma era "abas demais pra largura"; a solução é não forçar nav horizontal.

## 2. Decisões travadas (brainstorm 2026-05-30)

| # | Tema | Decisão |
|---|---|---|
| F1 | Padrão de nav | **A: Visão = home, drill-in.** Tab-bar removida; 4 cards levam pras sub-telas via `Link to=` |
| F2 | Posição dos cards | **Quick links logo abaixo dos StatCards**, antes do bloco Orçamento |
| F3 | Formato | **Grid 2 col (mobile) / 4 col (desktop)**, cada card: ícone + label + **métrica viva como sub-linha muted** |

## 3. Realidade do código (verificada)

- **5 rotas reais** já existem em `web/src/App.tsx`: `path="financeiro"`, `financeiro/transacoes`, `financeiro/contas`, `financeiro/metas`, `financeiro/carteiras`. Drill-in funciona com `<Link to=>`; **zero refactor de roteamento**.
- **`deriveBillStatus(bill, today)`** já existe em `web/src/lib/financeiro.ts:127`, retornando `'paga' | 'a-vencer' | 'atrasada'` (lógica D6: derivado de `last_paid_at` + `due_day`). Card de Contas REUSA esta função — mesma fonte de verdade que a tela `ContasFixasPage`. **Sem inventar janela "a vencer"** — o derive já decide com a info da bill + hoje.
- **`FinanceTabs` importadores: exatamente as 5 páginas** alvo deste refactor (Transacoes/ContasFixas/Metas/Carteiras/Financeiro). Zero importador externo → deletar `FinanceTabs.tsx` é seguro.
- **`useAccounts` retorna `PfAccount.balance: number`** (campo derivado do trigger `pf_sync_account_balance`, sempre fresco). Soma simples no card de Carteiras.

## 4. Componentes

**Criar:**
- `web/src/screens/financeiro/components/FinanceQuickLinks.tsx` — 4 cards grid 2×2 (mobile) / 4×1 (desktop), consome `useSummary`, `useBills`, `useGoals`, `useAccounts` (todos já existem).

**Modificar:**
- `web/src/screens/financeiro/FinanceiroPage.tsx` — substituir `<FinanceTabs />` por `<FinanceQuickLinks />` (mesma posição: entre StatCards e bloco "Carteiras" / "Orçamento").
- `web/src/screens/financeiro/{TransacoesPage,ContasFixasPage,MetasPage,CarteirasPage}.tsx` — **remover** o `<FinanceTabs current="…" />` (a linha). O header com "← Finanças" + título "Finanças" já existe e fica.

**Deletar:**
- `web/src/screens/financeiro/components/FinanceTabs.tsx` — código morto após remoção dos 5 imports.

## 5. Métricas vivas por card (lógica)

| Card | Hook | Lógica | Sub-linha exibida |
|---|---|---|---|
| **Transações** | `useTransactions({ limit: undefined })` (mês corrente, default do hook) | `data.length` | `"3 esse mês"` · ou `"Nada esse mês"` se 0 |
| **Contas** | `useBills()` + `deriveBillStatus` | conta por status; prioriza atrasada > a-vencer > paga | `"🔴 1 atrasada"` (se >0) → senão `"⚠️ 2 a vencer"` (se >0) → senão `"🟢 Tudo em dia"` → senão (lista vazia) `"Nada cadastrado"` |
| **Metas** | `useGoals()` | meta com maior `current_amount/target_amount` (mais próxima do alvo); pega `name + %` | `"Carro · 5%"` · ou `"Sem metas"` se 0 |
| **Carteiras** | `useAccounts()` | soma `balance`, conta total de carteiras ativas | `"R$ 1.000 · 1 carteira"` · ou `"Sem carteiras"` se 0 |

**Realtime:** `useRealtimeFinance` já está montado no dashboard (Fase C) — qualquer mudança nas tabelas `pf_*` invalida `['financeiro']` e os cards re-renderizam sozinhos.

## 6. Visual

```
Finanças                                Mai/2026   ← header existente
┌──────────┬──────────┬──────────┐
│ Receitas │ Despesas │  Saldo   │              ← StatCards (já existe)
│  R$ 0    │  R$ 0    │  +R$ 0   │
└──────────┴──────────┴──────────┘
┌─────────────────────┬─────────────────────┐
│ 💸  Transações       │ 🧾  Contas           │  ← FinanceQuickLinks
│ 3 esse mês          │ 2 a vencer          │     (novo, grid 2x2 mobile)
├─────────────────────┼─────────────────────┤
│ 🎯  Metas            │ 🏦  Carteiras        │
│ Sem metas           │ R$ 1.000 · 1 cart.  │
└─────────────────────┴─────────────────────┘
[ Carteiras chip-list (se houver) ]              ← bloco existente
[ Orçamento · BudgetBars ]                       ← bloco existente
[ Pizza · Linha 6m ]                             ← bloco existente
[ Últimas transações ]                           ← bloco existente
[ Fab "+Registrar" ]                             ← bloco existente
```

**Regras de visual:**
- Card = `<Link>` clicável (Tailwind `rounded-lg border border-border bg-bg-surface p-md`, hover `hover:bg-bg-elevated`).
- Ícone grande (24px) à esquerda do label.
- Label `text-body-md text-fg font-medium`.
- Sub-linha `text-body-sm text-fg-muted` (≤ 30 chars; truncate se passar). **Não usa cor de destaque** (`tom`/`success`/`danger`) na métrica — mantém hierarquia visual: StatCards > QuickLinks > restante.
- Exceção: o ícone de status nas Contas (`🔴 / ⚠️ / 🟢`) já carrega a cor — texto continua `text-fg-muted`.
- Desktop (md+): grid de 4 colunas iguais (1×4 em vez de 2×2). Cards um pouco menores, mais densos.

## 7. Plano de testes

| Cenário | Esperado |
|---|---|
| Dashboard com dados zero | 4 cards mostram empty state ("Nada esse mês" · "Nada cadastrado" · "Sem metas" · "Sem carteiras"). Nenhum crash. |
| Tap em card "Transações" | Navega pra `/financeiro/transacoes`. Sub-tela NÃO mostra tab-bar. Mostra header "← Finanças". |
| Tap em "← Finanças" | Volta pra `/financeiro` (Visão). |
| Conta com 1 atrasada + 2 a vencer | Card mostra `"🔴 1 atrasada"` (prioridade alta). |
| Tudo pago este mês | Card mostra `"🟢 Tudo em dia"`. |
| TOM grava transação no zap (smoke realtime) | Card de Transações incrementa em ~1s (realtime já testado na Fase C). |
| 375px (mobile) | 2×2, sem scroll horizontal. Tab-bar inexistente. |
| 1440px (desktop) | 4 cards em fileira única. SidebarV2 intocada. |
| Build verde | `tsc --noEmit` + `vite build` sem regressão. |

## 8. Segurança / privacidade

Sem mudança. Cards consomem os mesmos hooks da Fase C; RLS owner-only já protege.

## 9. Out of scope

- Mexer no FAB do Dashboard (continua "+Registrar" navegando pra `/financeiro/transacoes?new=1`).
- Reordenar os blocos da Visão (Carteiras chips, Orçamento, gráficos, Últimas transações continuam onde estão).
- Sparklines / mini-gráficos dentro dos cards (YAGNI v1).
- Switcher "rápido" entre sub-telas (custo do drill-in: 2 toques pra trocar de seção; aceitamos no v1).
- Cards customizáveis (ordem/visibilidade) — fica fora; YAGNI.

## 10. Pontos a confirmar na execução (não bloqueiam design)

- **Ícones lucide-react** pros cards: `Receipt` (Transações), `FileText` ou `Banknote` (Contas), `Target` (Metas), `Wallet` (Carteiras). Confirmar quais já existem importados no projeto pra reusar; senão importar do `lucide-react`.
- **`useTransactions()` default** — confirmar que sem `monthYear` ele já filtra mês corrente (deveria, pela `monthBounds()` default). Se filtrar TUDO, ajustar a métrica de transações pra usar `useSummary().summary.receitas + despesas` count.

---

*Aprovado pelo Alf em 30/05/2026 (pendente revisão da spec).*
