# CRUD Completo — Finanças Pessoais (PWA + TOM) — Design

**Data:** 2026-05-31
**Status:** Aprovado (design via diálogo; decisões Q1–Q3 travadas)

## Problema (com auditoria)

O módulo financeiro hoje sabe **criar** e (em parte) **excluir**, mas **não sabe
editar** — e o TOM não exclui nada. A galera (22 usuários) vai lançar errado,
querer corrigir valor/categoria e apagar duplicado. Sem isso, o saldo vira
ficção e a confiança no app cai.

### Estado atual (auditoria 2026-05-31) — C=criar E=editar X=excluir

| Entidade | PWA | TOM |
|---|---|---|
| Transações | C · ~~E~~ · X (hard, trigger reverte) | C · ~~E~~ · ~~X~~ |
| Contas fixas (bills) | C · ~~E~~ · ~~X~~ (só pagar) | C · ~~E~~ · ~~X~~ |
| Metas | C · ~~E~~ · ~~X~~ (só aportar) | C · ~~E~~(`update_goal`=só aporta) · ~~X~~ |
| Carteiras | C · ~~E~~ · X soft (desativar) · ⭐ | C · ~~E~~ · ~~X~~ |
| Cartões | C · ~~E~~ · X soft (**hook sem botão = morto**) | C · ~~E~~ · ~~X~~ |
| Orçamento | C/E (upsert) · ~~X~~ | C (upsert) · ~~X~~ |

**3 achados críticos:**
1. **Editar não existe** em lugar nenhum (exceto orçamento via upsert).
2. **TOM não exclui nada**, e o rodapé `Quer ajustar? "era 2.900" · "exclui essa"`
   (emitido por `txnRegistered` em `finance-format.js`) é **promessa morta** — nenhum
   handler processa "era X"/"exclui essa".
3. **`useDeactivateCard`** existe no hook mas **nenhuma tela chama** (código morto).

### Regras de segurança do schema (auditoria do DB) — dirigem o design

- **Transação UPDATE/DELETE é trigger-safe:** `trg_pf_sync_balance` (`pf_sync_account_balance`)
  reverte o saldo do OLD e aplica o NEW no UPDATE; reverte no DELETE. Pode mudar
  amount/type/account_id num único UPDATE. Hard-delete seguro quando `account_id` não é nulo
  (compra de cartão com `account_id NULL` não mexe em saldo — correto).
- **Hard-delete de carteira/cartão é PERIGOSO:** FKs cascateiam (`pf_transfers` CASCADE,
  `pf_card_payments` CASCADE) e podem corromper saldo de contas relacionadas. → **soft-delete
  (`is_active=false`)** é obrigatório pra carteira/cartão/conta-fixa/meta.
- **`pf_transfers` NÃO tem trigger de UPDATE** → editar transferência = **DELETE + INSERT**.
- **Parcelas** compartilham `purchase_group` → editar/excluir age no **grupo inteiro**
  (não há cascade de grupo no schema; o serviço resolve).
- **`pf_goals.current_amount` é manual** (sem trigger) → editar meta não mexe em aporte.
- **`pf_transactions` não tem `updated_at` nem `is_active`** (delete é hard). Bills/goals/
  accounts/cards têm `is_active`.

## Decisões (travadas)

- **Q1 — Escopo por superfície:** **PWA = CRUD completo** (fonte de verdade). **TOM = corrigir/
  excluir o lançamento recente** (faz a promessa "era X / exclui essa" virar real) **+ ler
  transações** ("últimas", "quanto gastei em X"). Sem edição de campo arbitrária de qualquer
  registro pelo TOM (YAGNI).
- **Q2 — Excluir carteira/cartão com movimento:** **soft-deactivate inteligente** — some dos
  seletores, histórico intacto, saldo congelado, **reversível**. Saldo≠0 / fatura aberta →
  **avisa, não bloqueia**.
- **Q3 — Correção pelo TOM:** alvo = **última transação registrada** (janela ~2h; "a do mercado"
  → casa por descrição; ambíguo → pending-intent). Corrige **valor, categoria, descrição e
  fonte**. "exclui essa" deleta (parcela → grupo). Fora da janela → manda pro app.

## Arquitetura

### A. PWA — editar + excluir tudo (fonte de verdade)

**Camada de dados (`web/src/lib/financeiro.ts` + lib de cartões):** adicionar
- `updateTransaction(cid, id, patch)` — UPDATE direto (trigger reajusta saldo). Parcela:
  patch de categoria/descrição aplica ao `purchase_group`; mudança de **valor/parcelas** de
  compra parcelada = deletar grupo + recriar (não editar in-place).
- `updateBill(cid, id, patch)` · `deactivateBill(cid, id)` (soft).
- `updateGoal(cid, id, patch)` (name/target/deadline/monthly_contribution/icon) · `deleteGoal`
  (soft). `current_amount` não muda aqui.
- `updateAccount(cid, id, patch)` (name/type/icon/goal_monthly). `deactivateAccount`/`setPrimaryAccount`
  já existem.
- `updateCard(cid, id, patch)` (limite/fechamento/vencimento/bandeira/cor). `deactivateCard` já
  existe (ligar na UI).
- `deleteBudget(cid, id)`.
- `deleteTransaction` já existe → estender pra apagar `purchase_group` quando parcela.

**Hooks (`useFinanceiro.ts`):** um `useFinMutation` por fn nova (invalida a KEY `['financeiro']`).

**Telas/sheets:** habilitar **modo edição** via prop `initial`:
- `TransactionSheet` — hoje só deleta; tornar campos editáveis (valor, categoria, descrição,
  data, fonte). Parcela: avisar que edição de valor recria o grupo.
- `BillSheet` — `initial` + editar + excluir; `ContasFixasPage` fia os botões.
- `GoalSheet` — `initial` + editar + excluir.
- `AccountSheet` — `initial` + editar; `CarteirasPage` já tem desativar + ⭐ → adicionar editar +
  **aviso saldo≠0**.
- `CartoesPage`/`CartaoSheet` — editar + **ligar o `deactivateCard` (botão hoje inexistente)** +
  **aviso fatura aberta**.
- Orçamento — reabrir pra editar (upsert) + excluir.
- **UX de delete:** confirmação clara; soft-deactivate reversível; avisos (saldo/fatura) não
  bloqueiam (Q2-A).

### B. TOM — corrigir/excluir recente + ler

**Ponteiro do "recente":** o engine grava o **id da última transação** registrada por usuário
(após `register_transaction`/`card_purchase`). Janela de correção ~2h. Persistência leve
(reusar `pending_intents`/`marker_logs` ou coluna dedicada — decidir no plano).

**Novas FINANCE_ACTIONS:**
- `edit_transaction` — params: `which`(opcional: "essa"/descrição/valor de referência),
  `patch`{amount?, category?, description?, account_name?}. Engine resolve o alvo → `updateTransaction`
  → trigger reajusta → confirma com `buildTxnConfirmation`.
- `delete_transaction` — params: `which`. Confirma curto → `deleteTransaction` (parcela → grupo)
  → trigger reverte saldo → confirma.
- `query_transactions` — params: `period?`, `category?`, `limit?`. Lista recentes / por categoria
  (builder novo em `finance-format.js`).

**Resolução de alvo (lógica pura, testável tipo `source-match.js`):** "essa/última" → último id;
descrição → casa entre recentes; valor → casa por valor; ambíguo → **pending-intent** lista
candidatos (mesmo padrão da fonte obrigatória).

**Mata a promessa morta:** "era 2.900", "muda categoria pra lazer", "era no Itaú", "exclui essa"
passam a ter handler real. Fora da janela → "isso é mais antigo, edita lá no app 🙂".

**Skill (`financeiro-pessoal.md`):** documenta `edit_transaction`/`delete_transaction`/
`query_transactions` + frases de correção; deixa explícito que edição profunda de outros
registros é no app.

### C. DB (migration leve)

- `ALTER TABLE pf_transactions ADD COLUMN updated_at timestamptz DEFAULT now()` (rastreia edição;
  setar no `updateTransaction`).
- Sem mudança de trigger (UPDATE/DELETE já reajustam saldo). Transferência continua delete+insert.

## Decomposição — 4 fases (cada uma com spec→plano→execução próprios)

1. **Fase 1 — Transações** (maior valor): PWA editar/excluir + TOM `edit/delete/query_transactions`
   + matar promessa morta + migration `updated_at`.
2. **Fase 2 — Carteiras + Cartões:** PWA editar + soft-deactivate com UI/avisos (ligar o botão morto
   do cartão).
3. **Fase 3 — Metas + Contas fixas:** PWA editar/excluir (soft).
4. **Fase 4 — Orçamento:** excluir (menor).

Cada fase produz software funcional e testável por si. **Fase 1 primeiro.**

### Fase 5 — Robustez da rota de registro multi-elemento (achado de smoke 2026-05-31)

**Sintoma observado:** "comprei remédio no ifood **no cartão Nubank**" → o LLM se confundiu
com a frase de 3 elementos (produto + estabelecimento + fonte), perguntou de boca pelo valor,
e na rodada do "100" ainda perguntou se era "no **Itaú**", terminando por gravar como **gasto
de caixa no Itaú** em vez de **compra na fatura do cartão Nubank**. Corrigido manualmente
(transação `405c8c18` movida pra fatura do Nubank; Itau estornado −160→−135).

**Classe do bug:** mesma família "LLM não-confiável no registro" que já blindamos com consumers
determinísticos (fonte obrigatória, txn_pick, correção). NÃO é bug de CRUD — edit/delete/correção
estão validados (saldo nunca fura). É a **rota de registro** que vacila quando a frase tem cartão
+ estabelecimento + produto juntos.

**Direção (não-gambiarra, mesma linha dos outros consumers):** detector determinístico pré-LLM
que reconhece "no cartão X" / "pelo cartão X" / "no crédito do X" na frase de registro e fixa
`card_id` antes de cair no LLM — espelhando `source-match.js`/`detect-correction.js`. Casa o nome
do cartão entre os cartões ativos do usuário; só dispara com âncora financeira clara (verbo de
compra + valor) pra zero falso-positivo. Quando casa cartão → vira `card_purchase` direto.

Fora de escopo desta fase (1–4); produz spec/plano próprios quando priorizada.

## Fora de escopo
- Edição de campo arbitrária de qualquer registro pelo TOM (só corrige o recente).
- Histórico/auditoria de edições (além do `updated_at`).
- Transferências como entidade de 1ª classe no TOM (PWA: delete ok; edit = delete+insert).
- Undo/lixeira com retenção (soft-deactivate já é reversível por reativação).

## Testes
- **Lógica pura (node:test):** resolvedor de alvo do TOM (referência/janela/descrição/valor) —
  espelha `source-match.js`; zero falso-positivo em msg não relacionada.
- **Serviço:** saldo correto após editar (mudar valor/conta) e após excluir (reverte) — validado
  por query no DB; parcela → grupo; transferência delete+insert.
- **PWA:** `tsc --noEmit` + `vite build` + preview (editar/excluir cada entidade; saldo bate).
- **Smoke WhatsApp:** "era 2900" / "muda categoria" / "exclui essa" / "últimas" / "quanto gastei
  em X"; conferir saldo reverte e nada vira órfã.
