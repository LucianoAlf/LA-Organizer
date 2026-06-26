# Override de valor mensal nas Contas Fixas — Design

**Goal:** Permitir ajustar o valor previsto de cada conta fixa (`pf_bills`) para um mês específico, sem alterar o valor-base, valendo para projeção + pagamento + lembrete do TOM, editável pela tela e pelo WhatsApp.

**Origem:** pedido do Matheus (áudio 25/06) — editar valores de contas em meses futuros pra montar uma projeção realista de gastos. Hoje os meses futuros na `ContasFixasPage` são só-leitura (`PrevisaoSection`) e repetem o `amount` base.

**Arquitetura:** tabela aditiva `pf_bill_overrides` + helper puro `resolveBillAmount` (fonte de verdade ÚNICA, TS no PWA + JS no backend) consumido por todas as superfícies. **Zero-regressão por construção:** 0 overrides ⇒ todo helper retorna o valor base ⇒ comportamento idêntico ao de hoje.

**Tech Stack:** Supabase (Postgres + RLS `current_collab_id()`), backend Node CommonJS (`src/services/financeiro-service.js`, `src/engine.js`), PWA React/TS (`web/src/...`), testes `node:test` (backend) + Vitest (web).

---

## Decisões (fechadas no brainstorm)

- **Semântica:** override PONTUAL por `(conta, mês)`. NÃO propaga pros meses seguintes.
- **Alcance:** valor REAL — projeção na tela + valor sugerido no pagamento + valor que o TOM avisa no lembrete.
- **Edição:** pela tela E pelo WhatsApp (TOM).
- **Fora de escopo (YAGNI):** faturas de cartão (são derivadas das compras, não têm valor "ajustável"); ajustar mês passado (só corrente + futuros); semântica "daqui em diante" (versão B).

---

## Modelo de dados — `pf_bill_overrides` (tabela nova, isolada)

| coluna | tipo | nota |
|---|---|---|
| `id` | uuid pk | `gen_random_uuid()` |
| `collaborator_id` | uuid NOT NULL | RLS via `current_collab_id()`, espelha `pf_transactions` |
| `bill_id` | uuid NOT NULL | FK → `pf_bills(id)` `ON DELETE CASCADE` |
| `competencia` | date NOT NULL | `YYYY-MM-01` (mesmo padrão de `pf_transactions`) |
| `amount` | numeric NOT NULL | `CHECK (amount > 0)` |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | `now()` |

- `UNIQUE (bill_id, competencia)` — 1 ajuste por conta/mês (upsert por essa chave).
- Índice `(collaborator_id, competencia)` — carregar o mês inteiro de uma vez.
- RLS: `SELECT/INSERT/UPDATE/DELETE` onde `collaborator_id = current_collab_id()` (espelha as outras `pf_*`). Service_role (engine) ignora RLS e filtra por `collaborator_id` explícito — **[[feedback_sensitive_data_service_role]]**.
- **`pf_bills` NÃO é alterada.**

---

## Helper central — a fonte de verdade única

```
resolveBillAmount(bill, override?) → override?.amount ?? Number(bill.amount)
```

Puro, sem efeito colateral. **Existe nos dois lados** com paridade testada (igual a `finance-utils`):
- Web: `web/src/lib/financeiro.ts` (TS).
- Backend: `src/utils/bill-amount.js` (JS) — novo módulo puro.

Variante batch para a tela: `resolveBillsForMonth(bills, overridesByBillId) → bills com amount resolvido`. É o ÚNICO lugar que decide "quanto vale a conta nesse mês" — as 4 superfícies chamam ele, então não divergem.

---

## As 4 superfícies (todas leem pelo helper)

1. **Previsão (meses futuros)** — `ContasFixasPage` `PrevisaoSection`: total e itens via helper; itens passam a ser clicáveis (→ edição).
2. **Mês corrente** — a exibição (`BillRow` + grupos) também resolve via helper, usando o override da competência corrente quando existe.
3. **Pagamento** — `PagarContaSheet` default = `resolveBillAmount(bill, overrideMêsCorrente)`. `payBill` (backend, via TOM `pay_bill`) idem como valor previsto default.
4. **Lembrete do TOM** — `billsDueWithin` resolve o valor avisado pela competência corrente.

---

## Edição

- **Tela:** clicar na conta no mês abre um sheet novo e isolado **`AjustarValorMesSheet`** — campo de valor + botão "voltar ao padrão" (deleta o override). NÃO altera o `BillSheet` que edita o valor-base.
- **WhatsApp:** ação nova no `FINANCE_ACTION` → `set_bill_amount { bill_name, month, amount }`. Handler resolve a conta por nome (`findBills`), faz upsert no override da competência. "tira o ajuste de agosto" → delete. Prosa honesta: "ajustei só agosto (R$ 350); os outros meses seguem no valor padrão". Skill `financeiro-pessoal.md` documenta + veta confabular.

---

## Zero-regressão (por construção)

- `pf_bills` intocada; tabela + módulos novos = aditivo.
- **0 overrides ⇒ helper retorna o base em toda superfície ⇒ idêntico a hoje.**
- Cada superfície tem fallback explícito pro `bill.amount`.
- Migration reversível (`DROP TABLE pf_bill_overrides`).
- Rollout fatiado; cada fatia provada antes da próxima (catraca confere no banco/VPS).

---

## Testes

- **Helper** (TDD, os dois lados): com override → override; sem → base; `amount` inválido/≤0 → base (ignora override ruim); paridade TS↔JS.
- **CRUD service** — smoke na VPS (set/get/delete override, descartável).
- **E2E:** ajusta Ago → previsão muda e Set fica intacto; pagamento sugere o ajuste; `billsDueWithin` lê o override do mês corrente; edição via zap (`set_bill_amount` → upsert) + "tira o ajuste" (delete).

---

## Rollout — 4 fatias (cada uma provada, catraca confere)

### Fatia 1 — Fundação + leitura (ZERO escrita de override)
- **Migration:** `pf_bill_overrides` (tabela + RLS + UNIQUE + índice).
- **Helper puro** `resolveBillAmount` + `resolveBillsForMonth` em `src/utils/bill-amount.js` (JS) e `web/src/lib/financeiro.ts` (TS) — TDD nos dois.
- **Service/lib CRUD:** `listBillOverrides(cid, competencia)` (backend + web) — só leitura nesta fatia.
- **Hook:** `useBillOverrides(competencia)` no `useFinanceiro.ts`.
- **Tela:** `PrevisaoSection` e o mês corrente EXIBEM via helper (ainda sem editar).
- **Prova:** com 0 overrides no banco, a tela mostra exatamente os valores de hoje (diff visual nulo). Helper TDD verde. Suíte/tsc verdes.

### Fatia 2 — Edição na UI
- `AjustarValorMesSheet` (campo valor + "voltar ao padrão").
- `setBillOverride`/`deleteBillOverride` (web lib + service).
- Itens da previsão e do mês corrente viram clicáveis → abrem o sheet.
- `useRealtimeFinance` passa a assinar `pf_bill_overrides`.
- **Prova:** ajusta Ago → total do mês muda, Set intacto; "voltar ao padrão" remove; preview no Simple Browser (ficha descartável — **[[feedback_preview_autosave_mutates_real_data]]**).

### Fatia 3 — Valor real (pagamento + lembrete do TOM)
- `PagarContaSheet` default = override do mês corrente.
- `payBill` (backend) + `billsDueWithin` resolvem via helper na competência corrente.
- **Prova:** E2E VPS — ajusta o mês corrente → pagamento sugere o ajuste; `billsDueWithin` retorna o override.

### Fatia 4 — Edição via WhatsApp
- `FINANCE_ACTION` action `set_bill_amount` (+ alias) no `engine.js`: parser + handler (resolve bill por nome + upsert/delete override) + prosa honesta.
- Skill `financeiro-pessoal.md` documenta a capacidade + veta confabulação.
- **Prova:** E2E VPS — "muda o condomínio de agosto pra 350" → override gravado; "tira o ajuste de agosto" → removido.

---

## Known issue a registrar no fim

`FIN-BILL-MONTHLY-OVERRIDE` (feature, não bug) — ou registrar só se surgir bug no caminho. Protocolo: consultar `tom_known_issues` antes de cada fatia tocar superfície existente.
