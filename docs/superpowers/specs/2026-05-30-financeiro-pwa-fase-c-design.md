# Design — Módulo Finanças Pessoais (Fase C: PWA)

> **Data:** 2026-05-30 · **Sprint:** 27 (Fase C) · **Status:** aprovado para escrever plano
> **Spec mãe (Fases A/B):** `2026-05-29-financeiro-pessoal-design.md`. Onde divergir, **este doc vence** (decisões mais recentes).

---

## 1. Resumo

Fase C entrega a camada PWA do módulo: 5 telas em `/financeiro` (Dashboard, Transações, Contas, Metas, Carteiras), com **realtime bilateral** com o TOM (TOM grava no WhatsApp → PWA reflete em ~1s na tela aberta) e CRUD completo (criar/editar pelos 2 caminhos). O PWA usa **JWT do colaborador autenticado** (RLS owner-only protege); o caminho service_role do TOM é tratado na Fase A. Out-of-scope: customização do bottom nav (sprint futura).

## 2. Decisões travadas (brainstorm 2026-05-30)

| # | Tema | Decisão |
|---|---|---|
| E1 | Escopo v1 | **5 telas no v1** (dashboard, transações, contas, metas, carteiras). Coerente com D5 (carteiras de 1ª classe) e evita "TOM grava mas PWA não mostra" pras 4 entidades vivas. |
| E2 | CRUD bilateral | **Pelos 2 caminhos.** FAB "+" em cada tela + BottomSheets (`TransactionSheet`, `BillSheet`, `GoalSheet`, `AccountSheet`). Regra de negócio mora no service compartilhado. |
| E3 | Realtime | **Subscribe ativo só na tela aberta.** Hook `useRealtimeFinance(table)` faz `postgres_changes` ao montar, unsubscribe ao desmontar. Padrão `useRealtimeSync` já existe. |
| E4 | Entrada no nav | **Card "Finanças" em `/mais → Para você`** (mobile); item "Finanças" na sidebar (desktop). Bottom nav (5 slots) **não muda**. Customização do bottom nav vira **sprint futura**. |
| E5 | Mobile vs Desktop | **Componentes responsivos únicos**, sem `XMobile/XDesktop` por tela. O `AppLayout` global já escolhe `AppShell` (mobile) vs `DesktopShell` (sidebar). Testar 375px e 1440px. |
| E6 | Segurança PWA | **JWT + RLS owner-only.** Diferente do TOM (service_role + filtro manual, Fase A §6.2). Teste cross-user no PWA é obrigatório. |
| E7 | Voz visual | **Tokens `tom`** (verde, identidade do app), nunca `brand` (rosa, marca LA Music). Recharts a instalar. |
| E8 | Números | **Do código, não do LLM** (lição do Bug 3). Gráficos consomem o que o service retorna; nenhum valor exibido é gerado por LLM. |

## 3. Arquitetura

```
PWA (React/TS)                       Supabase (RLS owner-only via JWT)
  ┌─────────────────────────┐         ┌────────────────────────┐
  │ /financeiro/* (5 telas) │ ──CRUD─▶│ pf_accounts            │
  │                         │ ◀realtime│ pf_transactions        │
  │ useFinanceiro (hook)    │         │ pf_bills               │
  │ financeiro-service.ts   │         │ pf_goals               │
  │ useRealtimeFinance      │         │ pf_budgets             │
  └─────────────────────────┘         └────────────────────────┘
                                              ▲
                                              │ INSERT/UPDATE/DELETE
                                              │ (service_role + filtro)
                                       ┌──────┴──────┐
                                       │ TOM engine  │  ← WhatsApp do usuário
                                       └─────────────┘
```

Quando o TOM grava (ex.: "gastei 45 no iFood"), o `INSERT` em `pf_transactions` propaga via `postgres_changes` → o subscribe da tela ativa recebe → o hook invalida cache → cards e gráficos atualizam **sem refresh**. Esse é o "vai entrando junto com os gráficos" da brief.

## 4. Estrutura de arquivos

**Criar (15):**
- `web/src/screens/financeiro/FinanceiroPage.tsx` — dashboard
- `web/src/screens/financeiro/TransacoesPage.tsx` — histórico
- `web/src/screens/financeiro/ContasFixasPage.tsx` — contas a pagar/receber
- `web/src/screens/financeiro/MetasPage.tsx` — metas + simulador
- `web/src/screens/financeiro/CarteirasPage.tsx` — gestão de carteiras (D5)
- `web/src/screens/financeiro/components/TransactionSheet.tsx`
- `web/src/screens/financeiro/components/BillSheet.tsx`
- `web/src/screens/financeiro/components/GoalSheet.tsx`
- `web/src/screens/financeiro/components/AccountSheet.tsx`
- `web/src/screens/financeiro/components/BudgetBar.tsx`
- `web/src/screens/financeiro/components/CompoundInterestSimulator.tsx`
- `web/src/hooks/useFinanceiro.ts` — queries + mutations + realtime
- `web/src/services/financeiro-service.ts` — CRUD via JWT (espelho TS do `_remote/src/services/financeiro-service.js`)
- `web/src/lib/finance-utils.ts` — port TS de `_remote/src/finance/projection.js` (futureValue/monthsToGoal/formatMonths)
- `web/src/hooks/useRealtimeFinance.ts` — wrapper de subscribe nas 4 tabelas `pf_*`

**Modificar:**
- `web/src/App.tsx` — 5 rotas `/financeiro/*` dentro do `AppLayout`
- `web/src/screens/Mais.tsx` — adicionar card "Finanças" em "Para você"
- `web/src/components/DesktopShell.tsx` (e/ou o componente de sidebar) — item "Finanças" no menu
- `web/src/components/BottomNav.tsx` — **NÃO mexer** (sprint futura)
- `web/package.json` — adicionar `recharts`

## 5. Telas (1 parágrafo cada)

**Dashboard (`/financeiro`).** No topo: 3 StatCards (Receitas/Despesas/Saldo do mês corrente), com chip de mês. Em seguida, chips de **saldos por carteira** (Nubank/Vale/etc.). Lista de `BudgetBar` por categoria (gasto/limite, cor por threshold). Pizza (Recharts) de gastos por categoria do mês. Linha de poupança acumulada nos últimos 6 meses (a partir de `monthlyReport(prev_n)` agregado). Últimas 5 transações. FAB "+" abre `TransactionSheet`. Tabs no topo (mobile) ou breadcrumbs (desktop) pra navegar entre as 5 sub-rotas.

**Transações (`/financeiro/transacoes`).** Scroll infinito (paginado), filtros: mês (`CustomSelect`), categoria (chips), tipo (income/expense). Cada item: emoji da categoria + descrição + valor (verde income, vermelho expense) + data. Tap abre o `TransactionSheet` em modo edição. FAB "+" abre o sheet em modo criação.

**Contas Fixas (`/financeiro/contas`).** Duas seções: "A pagar" e "A receber". Status **derivado** de `last_paid_at` (D6): paga este mês = verde; pendente vencendo nos próximos 5 dias = amarelo; atrasada = vermelho. Botão "Marcar paga" chama `payBill` (que grava `last_paid_at=hoje` e gera a transação correspondente). FAB "+" abre `BillSheet`.

**Metas (`/financeiro/metas`).** Cards por meta com barra de progresso (% + valores), projeção em meses **sem juros** e **com juros** (consumindo `finance-utils.ts` + a Selic via cache local). Botão "Adicionar contribuição" → atualiza `current_amount` (D7: **não** gera transação). Componente `CompoundInterestSimulator` (input mensal + prazo → resultado, mesma fórmula do handler). FAB "+" abre `GoalSheet`.

**Carteiras (`/financeiro/carteiras`).** Lista de carteiras ativas com ícone + nome + tipo + saldo (vem do trigger no banco). Botão "Desativar" (soft-delete). FAB "+" abre `AccountSheet`. Saldo nunca é editado à mão — é derivado das transações via trigger (Fase A §4.6.1).

## 6. Bilateralidade (realtime ↔ TOM)

`useRealtimeFinance(tables: string[])` faz, ao montar:

```ts
const channel = supabase.channel(`pf-${id}`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'pf_transactions', filter: `collaborator_id=eq.${cid}` }, refetch)
  // ... idem pf_bills, pf_goals, pf_accounts, pf_budgets
  .subscribe();
```

Ao desmontar: `supabase.removeChannel(channel)`. Cada tela passa só as tabelas que ela exibe (Dashboard subscribe nas 5; Contas só em `pf_bills`; etc.). O `filter` por `collaborator_id` reduz tráfego e respeita RLS.

## 7. Segurança (guard-rails PWA)

1. **RLS owner-only é a blindagem do PWA.** O cliente Supabase do web usa **JWT autenticado**, então RLS aplica. Teste cross-user obrigatório: User A logado **nunca** vê dado de B (queries retornam vazio).
2. **Não usar service_role no PWA.** Nem chave anônima sem JWT pra ler `pf_*`.
3. **Mutations passam `collaborator_id` EXPLÍCITO (resolvido do auth context), RLS valida via `WITH CHECK`.** Espelho do TOM, lado PWA: o service resolve o id do colaborador autenticado (`useAuth()` ou equivalente) e envia explícito no insert/update — o `WITH CHECK` da policy valida que bate com `current_collab_id()`. RLS NÃO preenche campo nenhum, só valida. Padrão real do projeto confirmado em `useEventCategories.ts:75` (`collaborator_id: collab.id` no insert). Sem isso, todo `INSERT` viola `NOT NULL` ou é rejeitado pelo `WITH CHECK`.
4. **Realtime respeita RLS:** Supabase Realtime, com filter por `collaborator_id`, ainda passa pela policy.

   ⚠️ **Pré-requisito crítico (must-verify-early):** habilitar a Replication das 5 tabelas `pf_*` na publication `supabase_realtime` (`ALTER PUBLICATION supabase_realtime ADD TABLE pf_transactions, pf_bills, pf_goals, pf_accounts, pf_budgets;`). Se isso não estiver feito, `postgres_changes` não dispara nada e a bilateralidade (o coração de "vai entrando junto com os gráficos") falha em silêncio — sem erro, sem evento, só refresh manual. **Isso vira a Task 1 do plano** com smoke real (TOM insere via SQL → tela ativa atualiza em ~1s) ANTES de qualquer tela.
5. **Trigger de checagem de dono (Fase A §6.1)** continua valendo — protege contra `account_id` forjado mesmo se cliente PWA fosse comprometido.

## 8. Plano de testes (smoke)

| Cenário | Como | Esperado |
|---|---|---|
| TOM grava transação | "gastei 45 no iFood" no WhatsApp | Dashboard aberto em outra aba mostra a transação e a barra/pizza atualizam em ~1s, sem refresh |
| Criar transação no PWA | FAB no Dashboard | Aparece no histórico; barra de orçamento atualiza |
| Marcar conta paga | botão na lista de contas | Status vira "paga este mês"; transação correspondente aparece no histórico |
| Atualizar meta no PWA | "Adicionar contribuição" | `current_amount` sobe; **nenhuma** transação criada (D7) |
| Cross-user (RLS) | Login do User A; força fetch de `pf_*` de B via DevTools | Retorna vazio |
| Mobile 375px | Cada tela | Sheets funcionam; FAB acessível; tabs navegam; sem overflow horizontal |
| Desktop 1440px | Cada tela | Sidebar mostra "Finanças"; layout não quebra |
| Carteira saldo | criar carteira → registrar income R$100 vinculado | Saldo da carteira = R$100 (trigger) |
| `account_id` cross-owner | Tentar via DevTools associar transação à carteira de outro dono | Trigger BEFORE rejeita (já provado Fase A) |

## 9. Pontos a confirmar no plano (não bloqueiam design)

- **Padrão de cliente Supabase no web:** já existe um cliente único exportado? Como o JWT do colaborador é injetado nas queries? (Confirmar antes de escrever o service.)
- **Componente de sidebar do desktop:** local exato onde adicionar o item "Finanças".
- **`StatCard` existe no DS?** Verificar `web/src/components/`. Se não, criar seguindo tokens.
- **Selic no PWA — coerência com o TOM:** hardcode `10.5` no app diverge do TOM, que cita o valor vivo do BCB (hoje 14,5%). Mesma meta = números diferentes nos 2 canais = mata credibilidade. **v1:** PWA rotula a taxa como **"estimativa ~10,5%/ano"** (não "a Selic é") nas projeções e no simulador — narrativa neutra que não conflita. **Melhoria (v1.1):** o `selic.js` do engine persiste o valor diário numa tabela `app_config` (ou `pf_config`) e o PWA lê dali — fonte única. Decidir e registrar no plano.
- **`finance-utils.ts` (port de `projection.js`) tem que bater BIT A BIT com o handler.** Se as fórmulas divergem, simulador do PWA vai dar número diferente do que o TOM falou no zap. No plano: porta literal (copiar fórmulas) + teste de paridade (mesmos inputs nos 2, mesmo output).
- **Mirror TS do service (decorrência de E2/E5).** Duas cópias do mesmo CRUD (`_remote/src/services/financeiro-service.js` e `web/src/services/financeiro-service.ts`) podem driftar nas regras de negócio (D6 status derivado, D7 sem-transação). Mantém o mirror **fino** (CRUD puro) e empurra invariantes pro banco — os triggers de saldo/dono (Fase A §6.1) e a derivação do status (D6) já fazem isso. Comentário literal no topo de cada cópia: "regra mudou aqui? muda na outra cópia também."
- **`recharts` lazy nas telas `/financeiro`:** as rotas são code-split; manter `import { ... } from 'recharts'` dentro dos componentes de gráfico (e/ou `React.lazy` nas telas) pra não inchar o bundle principal (que já passa de 1,2 MB).

## 10. Out of scope (futuro)

- Customização do bottom nav (o usuário escolher quais 5 slots aparecem).
- Importação de extrato bancário.
- OCR de comprovante.
- Integração com APIs de banco (Nubank etc.).
- PWA instalável / offline.

---

*Aprovado por Luciano Alf em 30/05/2026.*
