# Carteiras — CRUD + Detalhe/Extrato + Transferência + Identidade do Banco (PWA + TOM) — Design

**Data:** 2026-05-31
**Status:** Design aprovado visualmente pelo Alf (Visual Companion 2026-05-31, mockups `carteiras-detalhe.html` + `carteiras-v2-banco.html` — opção A com tudo: editar/personalizar, detalhe+extrato, transferência, cor, logomarca do banco).

## Problema (auditoria 2026-05-31)
Carteiras hoje só **cria / desativa / marca principal (⭐)**. Faltam:
- **Editar/personalizar** (nome, tipo, ícone, **meta mensal `goal_monthly`**) — `updateAccount` não existe em nenhuma camada (lib/serviço/engine/PWA).
- **"Entrar na carteira"** — não há tela de detalhe nem extrato da conta.
- **Transferir entre carteiras** no PWA — `createTransfer` existe no backend (`financeiro-service.js`), sem UI.
- **Identidade visual** — carteira é "🏦 + nome" genérico; o Alf quer **logo + cor da marca do banco**.
- TOM: só `create_account`/`query_accounts`; não edita.

`pf_accounts` já tem `goal_monthly`, `icon`, `type`, `is_active`, `is_primary` — então quase tudo cabe **sem migration**; só **cor + banco** exigem 2 colunas novas.

## Decisões (travadas)
- **D1 — Identidade do banco:** ao escolher um banco, vêm **logo + cor** automáticos. Logos são SVGs em `web/public/banks/<slug>.svg` (servidos em `/banks/<slug>.svg`); o catálogo `web/src/lib/banks.ts` mapeia `slug → { name, color }`. Carteira sem banco (ex.: Dinheiro) usa **emoji + cor escolhida**.
- **D2 — Migration leve:** `pf_accounts` ganha `bank_slug text` (nullable) e `color text` (nullable). `icon` (emoji) permanece como fallback.
- **D3 — Fallback de logo:** componente `BankLogo` renderiza `/banks/<slug>.svg`; se o arquivo não existir/erro de load, cai pra **inicial do nome sobre a cor da marca** (mockup). Assim a feature funciona ANTES de os SVGs chegarem.
- **D4 — Detalhe `/financeiro/carteiras/:id`:** herói (faixa na cor do banco + logo + nome + tipo + saldo + ⭐ + meta mensal), botões **Transferir** e **Lançar aqui** (abre o LancamentoSheet já existente, pré-selecionando esta carteira), e **extrato** da conta. Ações: editar / desativar / tornar principal.
- **D5 — Transferência no PWA:** `TransferSheet` (de → para + valor + data) usando o `createTransfer` do backend (espelhado no PWA). Saldos ajustados pelo mecanismo já existente (trigger/serviço — confirmar no plano).
- **D6 — Bilateralidade TOM:** nova action `edit_account` (nome/tipo/ícone/goal_monthly/banco/cor); `create_account` passa a **auto-casar `bank_slug`** pelo nome (ex.: "cria carteira Nubank" → bank_slug nubank); `transfer` já existe. Skill documenta.

## Arquitetura

### A. Modelo de dados (migration)
```sql
ALTER TABLE pf_accounts
  ADD COLUMN IF NOT EXISTS bank_slug text,
  ADD COLUMN IF NOT EXISTS color text;
```
Sem trigger. `bank_slug` referencia o catálogo (não FK — é dado estático em código). `color` guarda hex (ex.: `#820ad1`); default vem do banco escolhido, editável.

### B. Catálogo de bancos (código)
- **`web/src/lib/banks.ts`:** `export const BANKS: Record<string, { name: string; color: string }>` com os slugs do `web/public/banks/README.md` (nubank #820ad1, itau #ec7000, bradesco #cc092f, santander #ec0000, bb #fbe122, caixa #0070af, c6 #242424, inter #ff7a00, …). Helper `logoUrl(slug) => '/banks/' + slug + '.svg'` e `matchBankSlug(name)` (normaliza o nome → slug do catálogo, pra criação no PWA e no TOM).
- **`web/public/banks/<slug>.svg`** — os SVGs (símbolo quadrado, fundo transparente). README já criado.

### C. PWA
**Dados (`web/src/lib/financeiro.ts`):**
- `PfAccount` ganha `bank_slug: string | null`, `color: string | null`, `goal_monthly: number | null`, `is_active?: boolean`; `listAccounts` select inclui esses campos.
- `updateAccount(cid, id, patch)` — whitelist (name, type, icon, goal_monthly, bank_slug, color).
- `createTransfer(cid, { from_account_id, to_account_id, amount, date?, description? })` — espelha o backend (insere transferência; saldos ajustados conforme mecanismo existente — confirmar no plano).
- `listAccountTransactions(cid, accountId, monthYear?)` — extrato: `pf_transactions` por `account_id` (card_id null), ordem desc.

**Hooks (`useFinanceiro.ts`):** `useUpdateAccount`, `useCreateTransfer`, `useAccountTransactions(accountId, monthYear?)`. (Já existem `useCreateAccount`, `useDeactivateAccount`, `useSetPrimaryAccount`.)

**Componentes/telas:**
- **`BankLogo.tsx` (novo):** props `{ slug, name, color, size }` → `<img src={logoUrl(slug)} onError=fallback>`; fallback = inicial do nome sobre `color` (círculo/quadrado arredondado). Reusado em lista, detalhe, sheet.
- **`AccountSheet.tsx`:** modo edição (`initial?: PfAccount`) + **seletor de banco** (grid de `BankLogo`, escolher → seta bank_slug + color do catálogo) + Tipo + **Cor** (paleta, default do banco, editável) + Meta mensal (`goal_monthly`) + "💵 outro" (emoji, sem banco). Footer: Desativar (danger) + Cancelar + Salvar. Mantém criação.
- **`CarteiraDetalhePage.tsx` (novo)** rota `/financeiro/carteiras/:id`: herói com `BankLogo` + faixa de cor + saldo + ⭐ + meta mensal; botões **Transferir** (abre `TransferSheet`) e **Lançar aqui** (abre `LancamentoSheet` com a carteira pré-selecionada); **extrato** (`useAccountTransactions`); ações editar/desativar/principal no topo.
- **`TransferSheet.tsx` (novo):** De (CustomSelect carteiras) → Para (CustomSelect carteiras, ≠ origem) + Valor + Data + descrição opcional → `useCreateTransfer`. Valida origem≠destino e saldo.
- **`CarteirasPage.tsx`:** cada card usa `BankLogo` + acento na cor do banco (borda lateral) e fica **clicável → detalhe**. Mantém ⭐/desativar.
- **Rota** em `App.tsx`: `financeiro/carteiras/:id`. **Realtime:** detalhe assina `pf_transactions, pf_accounts, pf_transfers`.

### D. TOM (bilateralidade)
- **`create_account`** passa a chamar `matchBankSlug(name)` no serviço → grava `bank_slug` (+ cor do catálogo) quando casar.
- **`edit_account` (nova action):** params account_name + os que mudam (name/type/icon/goal_monthly/bank/color) → `updateAccount`. Ex.: "renomeia a carteira Itaú pra Itaú PJ", "põe meta de 500 na carteira Nubank".
- **`transfer`** já existe no serviço/engine — confirmar e documentar.
- Serviço backend ganha `updateAccount(cid, id, patch)` (whitelist) + `matchBankSlug` (compartilhar a mesma lista do catálogo — duplicar o mapa no backend ou um JSON comum; decidir no plano).
- **Skill `financeiro-pessoal.md`:** documenta `edit_account` + auto-banco.

## Fora de escopo (anti-gold-plating)
- Editar valor de saldo direto (saldo vem dos lançamentos/transferências, não se digita).
- Transferência recorrente/agendada (só pontual).
- Logos hospedados/CDN ou upload pela UI (SVGs entram via pasta `public/banks/`).
- Reordenar carteiras / agrupar por banco.
- Hard-delete de carteira (mantém soft-deactivate).

## Testes
- **Lógica pura (Vitest):** `matchBankSlug` (Nubank→nubank, "C6 Bank"→c6, "Itaú"→itau, desconhecido→null); `logoUrl`.
- **Serviço/DB:** `updateAccount` whitelist + collaborator_id; `createTransfer` ajusta saldos das duas contas corretamente (validar por query: soma bate, sem furo); `matchBankSlug` no create_account grava bank_slug.
- **PWA:** `tsc --noEmit` + `vite build` + preview — editar/personalizar carteira (banco→logo+cor), abrir detalhe + extrato, transferir entre carteiras (saldos batem), BankLogo com fallback (slug sem svg). 375 + 1440.
- **Smoke WhatsApp (bilateral):** "cria carteira Nubank" (vem bank_slug), "põe meta de 500 na carteira Itaú" (edit_account), "transfere 100 do Itaú pro Nubank" (transfer); conferir reflexo no app e saldos.
