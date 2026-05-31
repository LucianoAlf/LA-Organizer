# Lançamento Unificado no PWA (À vista / Parcelar / Recorrente / Agendar) — Design

**Data:** 2026-05-31
**Status:** Design aprovado visualmente pelo Alf (Visual Companion, 2026-05-31, mockup `lancamento-sheet.html` — opção A). Reaproveita o design já aprovado em 2026-05-30 (`2026-05-30-cartao-credito-design.md` §6.3) que **nunca foi executado** (Task 9 do plano `2026-05-30-cartao-credito.md` ficou 0%).

## Problema (auditoria 2026-05-31)

O plano do cartão foi executado ~80% — DB, backend, TOM `card_purchase`, e no PWA a **lista de cartões** (`CartoesPage`), **detalhe + fatura + pagar** (`CartaoDetalhePage`) existem. Mas a **Task 9 (`LancamentoSheet`)** — o coração do registro no PWA — **nunca foi construída**. Consequência visível: o `+` do PWA abre o `TransactionSheet` simples, que só lança **despesa/receita à vista numa carteira**. Não há como, pelo PWA:

- Criar **compra no cartão** (à vista ou parcelada) — só via TOM.
- Criar **conta única com vencimento** (boleto avulso) — o modelo nem suporta.
- **Editar/excluir conta fixa** (`BillSheet` é create-only).
- A home (`FinanceiroPage`) **nem expõe** a seção de Cartões.

Resultado: a premissa "PWA = fonte de verdade" é falsa hoje — o registro cobre 1 de 5 casos.

## Decisões (travadas)

- **D1 — Um só "+":** o FAB abre **um** `LancamentoSheet` que se adapta ao tipo (mockup aprovado, opção A). Sem menu de tipos separados.
- **D2 — Taxonomia (segmented "Tipo"):** **À vista · Parcelar · Recorrente · Agendar**. Combinado com toggle **Despesa/Receita** no topo (Receita só faz sentido em À vista; os demais tipos forçam Despesa).
- **D3 — Meio de pagamento unificado:** um `CustomSelect` único lista **carteiras + cartões** (cumpre a fonte obrigatória). "Parcelar" trava em cartão.
- **D4 — Modelo "Única":** estender `pf_bills` com `recurrence` ('monthly' default | 'once') + `due_date` (date, null). Recorrente usa `due_day`; Única usa `due_date`. Sem competência manual / centro de custo (decisão do spec do cartão mantida).
- **D5 — Edição:** `LancamentoSheet` é **create** (todos os tipos). **Edição** reusa a superfície já existente por tipo: transação/parcela → `TransactionSheet` (modo edição da Fase 1, já feito); conta fixa → `BillSheet` ganha modo edição + exclusão (esta fase). Sem componente "faz-tudo" gigante.
- **D6 — Reconciliação:** alinhado ao que mudou desde 30/05 — fonte obrigatória (D3), categorias data-driven (CustomSelect data-driven), e o CRUD de transações da Fase 1 (não duplicar; reusar `createTransaction`/`updateTransaction`).

## Arquitetura

### A. Modelo de dados (migration leve)

```sql
ALTER TABLE pf_bills
  ADD COLUMN recurrence text NOT NULL DEFAULT 'monthly'
    CHECK (recurrence IN ('monthly','once')),
  ADD COLUMN due_date date;  -- preenchido só quando recurrence='once'
```

- Recorrente: `recurrence='monthly'`, `due_day` setado, `due_date` null (comportamento atual, intacto).
- Única: `recurrence='once'`, `due_date` setado (data cheia), `due_day` = `EXTRACT(day FROM due_date)` por compat com queries existentes.
- **Cron/lembrete** (`dispatcher.js` `billsDueWithin`): bills `once` lembram por `due_date` e **não** recorrem; ao pagar (`pay_bill`) → `is_active=false` (não reabrem ciclo). Bills `monthly` mantêm o reset de ciclo atual.
- **Parcelar** reusa o que já existe em `pf_transactions` (`card_id`, `installments_total`, `installment_no`, `purchase_group`, `competencia`) — sem migration.

### B. PWA (a maior parte do trabalho)

**Dados (`web/src/lib/`):**
- `cartoes.ts` — **`createCardPurchase(cid, { cardId, amount, category, description, installments, firstDate })`**: à vista → 1 row; parcelada → N rows com `installment_no`/`installments_total`/`purchase_group`/`competencia` (via helpers `competenciaFor`/`addMonthsToCompetencia` que já existem no backend; portar puro p/ o PWA com testes).
- `financeiro.ts` — `createBill` estende p/ aceitar `recurrence` + `due_date`; novos `updateBill(cid,id,patch)` (whitelist) e `deactivateBill(cid,id)` (soft); `deleteTransactionGroup(cid, purchaseGroup)` exposto p/ apagar parcela inteira.

**Hooks (`useFinanceiro.ts`):** `useCreateCardPurchase`, `useUpdateBill`, `useDeactivateBill` (cada um `useFinMutation`, invalida `['financeiro']`).

**Componentes:**
- **`LancamentoSheet.tsx` (novo, núcleo):** `BottomSheet` com toggle Despesa/Receita + segmented Tipo (D2). Campos comuns: Valor, Categoria (CustomSelect data-driven), Meio de pagamento (CustomSelect unificado carteiras+cartões), Descrição, Data. Condicionais:
  - **À vista** → nada extra; grava via `createTransaction` (carteira) ou `createCardPurchase` 1× (cartão).
  - **Parcelar** → Nº parcelas + data da 1ª + preview "≈ R$ X/mês"; força cartão; `createCardPurchase` N×.
  - **Recorrente** → dia do mês; `createBill` (`recurrence='monthly'`).
  - **Agendar (Única)** → `DateInput` de vencimento; `createBill` (`recurrence='once'`, `due_date`).
  - DS obrigatório: `BottomSheet`, `CustomSelect`, `DateInput`, `Button`, `Field`. Token `tom`. Mobile 375 + desktop 1440.
- **`BillSheet.tsx`** → ganha prop `initial` (modo edição) + botão excluir (soft via `deactivateBill`). `ContasFixasPage` fia editar/excluir nas linhas.
- **`FinanceiroPage.tsx`** → expõe seção/atalho **Cartões** (hoje ausente) e troca o FAB para abrir `LancamentoSheet`. `TransacoesPage` idem no seu `+`.
- **`useRealtimeFinance`** → incluir `pf_transfers` (hoje não assinado).

### C. TOM (mínimo — backend já cobre)

O `card_purchase` (à vista/parcelado) e `register_bill` já existem. Ajuste pequeno: `register_bill` aceitar **vencimento em data** → grava `recurrence='once'`+`due_date` quando o usuário diz "conta única que vence dia 15/06" (vs "todo mês dia 10" → monthly). Skill `financeiro-pessoal.md` documenta a distinção. Sem novas actions.

## Fora de escopo
- Competência manual / centro de custo (mantido fora, decisão do spec do cartão).
- Edição profunda de compra parcelada (mudar nº de parcelas/valor) → continua "apague e relance" (Fase 1).
- Transferência entre carteiras pelo PWA (sheet próprio) — só realtime aqui; criação fica p/ depois.
- Componente único de create+edit (D5 mantém edição nas sheets por tipo).

## Testes
- **Lógica pura (node:test/Vitest):** port de `competenciaFor`/`addMonthsToCompetencia` no PWA com paridade ao backend; cálculo "R$ X/mês" do preview.
- **Serviço/DB:** criar compra parcelada (N rows, mesmo `purchase_group`, competências sequenciais); criar bill `once` (due_date setado, não recorre); editar/desativar bill; saldo da carteira/fatura bate.
- **PWA:** `tsc --noEmit` + `vite build` + preview — criar cada um dos 4 tipos pelo `+`; editar/excluir conta fixa; 375 e 1440; SW cache limpo.
- **Smoke WhatsApp:** "comprei TV 3200 em 10x no nubank" (parcela), "conta de luz todo dia 10" (recorrente), "boleto do IPVA 800 vence 15/06" (única); conferir nada vira órfã e a fatura/lembrete batem.
