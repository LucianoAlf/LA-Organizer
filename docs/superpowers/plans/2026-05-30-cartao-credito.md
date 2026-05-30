# Cartão de Crédito + Linguagem de Mensagens do TOM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para implementar task-a-task. Steps usam checkbox (`- [ ]`).

**Goal:** Adicionar cartão de crédito (cadastro, compras à vista/parcelada, fatura derivada, pagamento parcial/total, alertas de limite) + transferência entre contas + linguagem de mensagens hierárquica do TOM, ao módulo `pf_*` existente.

**Architecture:** Cartão é tabela própria (`pf_cards`); compras são `pf_transactions` com `card_id` (não tocam saldo — o trigger `trg_pf_sync_balance` já guarda `account_id IS NOT NULL`); fatura é derivada por competência; pagamento (`pf_card_payments`) e transferência (`pf_transfers`) ajustam saldo via triggers próprios. TOM estende o marker `<<FINANCE_ACTION>>`. Alertas reusam o padrão do dispatcher de contas a vencer.

**Tech Stack:** Postgres/Supabase (migrations via MCP `apply_migration`, projeto `cesnbnrynvxvgdhfmaua`), Node engine (`src/`, deploy scp + `pm2 restart tom`), PWA React+Vite+TS+Tailwind (`web/`, auto-deploy Vercel).

**Validação (padrão do repo, não unit tests):** SQL — checar via `execute_sql`; engine — `node --check src/<f>.js` + smoke WhatsApp; PWA — `cd web && npx tsc --noEmit && npx vite build` + Preview localhost:4173 (375 e 1440).

**Spec:** `docs/superpowers/specs/2026-05-30-cartao-credito-design.md`

---

## Fatos do código (confirmados na auditoria — não re-investigar)

- Marker financeiro: `<<FINANCE_ACTION>>...<<END>>`. `engine.js:24` `const financeService = require('./services/financeiro-service')`. Array `FINANCE_ACTIONS` em `engine.js:5887`; regex de parse `:5896`; `insertTransaction` chamado `:5926`; `querySummary` `:5985`; dispatch/log `:7776-7787`.
- Trigger `trg_pf_sync_balance` (AFTER INS/UPD/DEL em `pf_transactions`): ajusta `pf_accounts.balance` **só quando `account_id IS NOT NULL`** e por `type` (income +, expense −). → compra de cartão (`account_id=NULL`, `card_id` setado) **não** mexe no saldo. **Não alterar este trigger.**
- Trigger `trg_pf_check_account_owner` (BEFORE INS/UPD em `pf_transactions`): valida que `account_id` pertence ao `collaborator_id`.
- `pf_transactions`: `type` CHECK {income,expense}; `category` CHECK {salario,comissao,extra,moradia,alimentacao,transporte,saude,educacao,lazer,outros}; `amount > 0`; `transaction_date` default CURRENT_DATE; `via` default 'tom'.
- Service `src/services/financeiro-service.js`: `monthBounds()`, `insertTransaction`, `listAccounts`, `querySummary`, `billsDueWithin`, `collaboratorsWithActiveBills`, etc. Usa `new Date()` cru (UTC) — manter consistência.
- PWA: `web/src/screens/financeiro/{FinanceiroPage,CarteirasPage,ContasFixasPage,TransacoesPage}.tsx`, `web/src/lib/financeiro.ts`, `web/src/hooks/useRealtimeFinance.ts`. DS: `web/src/components/` (BottomSheet, CustomSelect, DateInput, Button, Field, Fab).

---

## Mapa de arquivos

**Criar:**
- `supabase/migrations/20260530120000_pf_cards.sql` — tabelas + triggers + RLS + realtime
- `src/services/finance-format.js` — helper de formatação de mensagens (bar/money/templates)
- `web/src/screens/financeiro/CartoesPage.tsx` — lista de cartões (tile leve)
- `web/src/screens/financeiro/CartaoDetalhe.tsx` — detalhe (cartão herói + fatura + pagar)
- `web/src/screens/financeiro/components/LancamentoSheet.tsx` — modal Única/Recorrente/Parcelada
- `web/src/lib/cartoes.ts` — fetch/mutation helpers de cartão (PWA)

**Modificar:**
- `src/services/financeiro-service.js` — funções de cartão/fatura/pagamento/transferência/alerta
- `src/engine.js` — novas actions no `FINANCE_ACTION` + fluxo "como pagou?"
- `src/rituals/dispatcher.js` — ritual de alerta de limite + lembrete de fatura
- `src/prompts/system.js` (ou skill) — ensinar TOM cartão + linguagem
- `web/src/lib/financeiro.ts` — tipos + helpers compartilhados
- `web/src/hooks/useRealtimeFinance.ts` — assinar novas tabelas
- `web/src/screens/financeiro/FinanceiroPage.tsx` — seção "Cartões" + entrada do modal

---

## SPRINT 1 — Migrations (fundação no banco)

### Task 1: Migration completa (tabelas + triggers + RLS + realtime)

**Files:**
- Create: `supabase/migrations/20260530120000_pf_cards.sql`

- [ ] **Step 1: Escrever a migration**

```sql
-- ============ pf_cards ============
create table if not exists pf_cards (
  id              uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id) on delete cascade,
  name            text not null,
  brand           text,
  color           text,
  credit_limit    numeric not null check (credit_limit > 0),
  closing_day     int not null check (closing_day between 1 and 31),
  due_day         int not null check (due_day between 1 and 31),
  icon            text default '💳',
  is_active       boolean not null default true,
  alert_cycle     date,
  alert_threshold int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_pf_cards_collab on pf_cards(collaborator_id) where is_active;

-- ============ pf_transactions: cartão + parcelas + competência ============
alter table pf_transactions
  add column if not exists card_id            uuid references pf_cards(id) on delete set null,
  add column if not exists installment_no     int,
  add column if not exists installments_total int,
  add column if not exists purchase_group     uuid,
  add column if not exists competencia        date;
create index if not exists idx_pf_tx_card_comp on pf_transactions(card_id, competencia) where card_id is not null;

-- valida que card_id pertence ao mesmo colaborador
create or replace function pf_check_card_owner() returns trigger as $$
declare card_owner uuid;
begin
  if NEW.card_id is not null then
    select collaborator_id into card_owner from pf_cards where id = NEW.card_id;
    if card_owner is null then raise exception 'pf_transactions.card_id % nao existe', NEW.card_id; end if;
    if card_owner <> NEW.collaborator_id then raise exception 'pf_transactions.card_id % pertence a outro colaborador', NEW.card_id; end if;
  end if;
  return NEW;
end; $$ language plpgsql;
drop trigger if exists trg_pf_check_card_owner on pf_transactions;
create trigger trg_pf_check_card_owner before insert or update on pf_transactions
  for each row execute function pf_check_card_owner();

-- ============ pf_card_payments ============
create table if not exists pf_card_payments (
  id                uuid primary key default gen_random_uuid(),
  collaborator_id   uuid not null references collaborators(id) on delete cascade,
  card_id           uuid not null references pf_cards(id) on delete cascade,
  paid_from_account uuid references pf_accounts(id) on delete set null,
  competencia       date not null,
  amount            numeric not null check (amount > 0),
  paid_at           date not null default current_date,
  created_at        timestamptz not null default now()
);
create index if not exists idx_pf_cardpay_card on pf_card_payments(card_id, competencia);

create or replace function pf_sync_balance_on_card_payment() returns trigger as $$
begin
  if (TG_OP='DELETE' or TG_OP='UPDATE') and OLD.paid_from_account is not null then
    update pf_accounts set balance = balance + OLD.amount, updated_at=now() where id = OLD.paid_from_account;
  end if;
  if (TG_OP='INSERT' or TG_OP='UPDATE') and NEW.paid_from_account is not null then
    update pf_accounts set balance = balance - NEW.amount, updated_at=now() where id = NEW.paid_from_account;
  end if;
  return null;
end; $$ language plpgsql;
drop trigger if exists trg_pf_cardpay_balance on pf_card_payments;
create trigger trg_pf_cardpay_balance after insert or update or delete on pf_card_payments
  for each row execute function pf_sync_balance_on_card_payment();

-- ============ pf_transfers ============
create table if not exists pf_transfers (
  id              uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id) on delete cascade,
  from_account    uuid not null references pf_accounts(id) on delete cascade,
  to_account      uuid not null references pf_accounts(id) on delete cascade,
  amount          numeric not null check (amount > 0),
  transfer_date   date not null default current_date,
  description     text,
  created_at      timestamptz not null default now(),
  check (from_account <> to_account)
);
create index if not exists idx_pf_transfers_collab on pf_transfers(collaborator_id);

create or replace function pf_sync_balance_on_transfer() returns trigger as $$
begin
  if TG_OP='INSERT' then
    update pf_accounts set balance = balance - NEW.amount, updated_at=now() where id = NEW.from_account;
    update pf_accounts set balance = balance + NEW.amount, updated_at=now() where id = NEW.to_account;
  elsif TG_OP='DELETE' then
    update pf_accounts set balance = balance + OLD.amount, updated_at=now() where id = OLD.from_account;
    update pf_accounts set balance = balance - OLD.amount, updated_at=now() where id = OLD.to_account;
  end if;
  return null;
end; $$ language plpgsql;
drop trigger if exists trg_pf_transfer_balance on pf_transfers;
create trigger trg_pf_transfer_balance after insert or delete on pf_transfers
  for each row execute function pf_sync_balance_on_transfer();
-- NOTA v1: UPDATE de transferência não suportado (fazer delete+insert).

-- ============ RLS owner-only ============
alter table pf_cards enable row level security;
alter table pf_card_payments enable row level security;
alter table pf_transfers enable row level security;

create policy pf_cards_owner on pf_cards for all
  using (collaborator_id = current_collab_id()) with check (collaborator_id = current_collab_id());
create policy pf_cardpay_owner on pf_card_payments for all
  using (collaborator_id = current_collab_id()) with check (collaborator_id = current_collab_id());
create policy pf_transfers_owner on pf_transfers for all
  using (collaborator_id = current_collab_id()) with check (collaborator_id = current_collab_id());

-- ============ Realtime ============
alter publication supabase_realtime add table pf_cards;
alter publication supabase_realtime add table pf_card_payments;
alter publication supabase_realtime add table pf_transfers;
```

- [ ] **Step 2: Aplicar via MCP** — `apply_migration(project_id='cesnbnrynvxvgdhfmaua', name='pf_cards', query=<conteúdo>)`. Se `alter publication ... add table` falhar por já existir, é idempotente-safe ignorar o erro específico; reaplicar sem essas 3 linhas.

- [ ] **Step 3: Verificar** — `execute_sql`:
```sql
select count(*) from pf_cards; select count(*) from pf_card_payments; select count(*) from pf_transfers;
select column_name from information_schema.columns where table_name='pf_transactions' and column_name in ('card_id','installment_no','installments_total','purchase_group','competencia');
```
Esperado: 3 tabelas com 0 linhas + 5 colunas novas.

- [ ] **Step 4: Verificar `current_collab_id()` existe** — `select current_collab_id();` deve resolver (função usada por outras RLS pf_*). Se as policies derem erro de função inexistente, conferir nome real em migration anterior de RLS pf_* e usar o mesmo.

---

## SPRINT 2 — Service layer (backend, lógica pura)

### Task 2: Helpers de competência, cartão e fatura em `financeiro-service.js`

**Files:** Modify: `src/services/financeiro-service.js`

- [ ] **Step 1: Adicionar helper de competência (antes dos exports)**

```js
// Competência (1º dia do mês YYYY-MM-01) da fatura de uma compra.
// day <= closing → fatura que fecha neste mês; senão, próxima.
function competenciaFor(baseDate, closingDay) {
  const y = baseDate.getUTCFullYear(), m = baseDate.getUTCMonth(), day = baseDate.getUTCDate();
  const off = day <= closingDay ? 0 : 1;
  return new Date(Date.UTC(y, m + off, 1)).toISOString().slice(0, 10);
}
function addMonthsToCompetencia(compStr, n) {
  const d = new Date(compStr + 'T00:00:00Z');
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Cartão CRUD**

```js
async function createCard(collaboratorId, { name, brand, color, credit_limit, closing_day, due_day, icon }) {
  const { data, error } = await supabase.from('pf_cards')
    .insert({ collaborator_id: collaboratorId, name, brand: brand || null, color: color || null,
              credit_limit, closing_day, due_day, icon: icon || '💳' })
    .select().single();
  if (error) throw error; return data;
}
async function listCards(collaboratorId) {
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, brand, color, credit_limit, closing_day, due_day, icon, alert_cycle, alert_threshold')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error; return data || [];
}
async function findCard(collaboratorId, cardName) {
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, brand, color, credit_limit, closing_day, due_day, icon, alert_cycle, alert_threshold')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).ilike('name', `%${cardName}%`);
  if (error) throw error; return data || [];
}
```

- [ ] **Step 3: Compra no cartão (à vista e parcelada)**

```js
// Lança compra no cartão. installments>=2 → cria N parcelas agrupadas por purchase_group.
// NÃO mexe no saldo (card_id setado, account_id null → trigger ignora).
async function insertCardPurchase(collaboratorId, card, { category, amount, description, transaction_date, installments }) {
  const baseDate = transaction_date ? new Date(transaction_date + 'T00:00:00Z') : new Date();
  const n = Math.max(1, parseInt(installments || 1, 10));
  const baseComp = competenciaFor(baseDate, card.closing_day);
  const dateStr = baseDate.toISOString().slice(0, 10);
  if (n === 1) {
    const { data, error } = await supabase.from('pf_transactions').insert({
      collaborator_id: collaboratorId, card_id: card.id, type: 'expense', category,
      amount, description: description || null, transaction_date: dateStr, competencia: baseComp, via: 'tom',
    }).select().single();
    if (error) throw error; return [data];
  }
  const cents = Math.round(Number(amount) * 100);
  const per = Math.floor(cents / n);
  const rows = Array.from({ length: n }, (_, i) => ({
    collaborator_id: collaboratorId, card_id: card.id, type: 'expense', category,
    description: description || null, transaction_date: dateStr, via: 'tom',
    installment_no: i + 1, installments_total: n,
    competencia: addMonthsToCompetencia(baseComp, i),
    amount: ((i === n - 1 ? per + (cents - per * n) : per) / 100),
  }));
  const purchase_group = (await supabase.rpc('gen_random_uuid')).data || null; // fallback abaixo
  // gen_random_uuid via rpc pode não existir; gerar no insert com mesmo valor:
  const groupRes = await supabase.from('pf_transactions').insert(
    rows.map(r => ({ ...r, purchase_group: undefined }))
  ).select();
  if (groupRes.error) throw groupRes.error;
  // Amarra o grupo: usa o id da 1ª parcela como purchase_group de todas.
  const ids = groupRes.data.map(d => d.id);
  const groupId = groupRes.data.find(d => d.installment_no === 1)?.id || ids[0];
  const upd = await supabase.from('pf_transactions').update({ purchase_group: groupId }).in('id', ids);
  if (upd.error) throw upd.error;
  return groupRes.data;
}
```
> Nota: `purchase_group` recebe o id da 1ª parcela (sem precisar de RPC de uuid). Remover a linha `supabase.rpc('gen_random_uuid')` se causar erro — não é usada.

- [ ] **Step 4: Fatura derivada + limite**

```js
async function cardInvoice(collaboratorId, cardId, competencia) {
  const { data: items, error } = await supabase.from('pf_transactions')
    .select('id, description, category, amount, transaction_date, installment_no, installments_total')
    .eq('collaborator_id', collaboratorId).eq('card_id', cardId).eq('competencia', competencia)
    .order('transaction_date', { ascending: false });
  if (error) throw error;
  const total = (items || []).reduce((s, r) => s + Number(r.amount), 0);
  const { data: pays, error: e2 } = await supabase.from('pf_card_payments')
    .select('amount').eq('card_id', cardId).eq('competencia', competencia);
  if (e2) throw e2;
  const paid = (pays || []).reduce((s, r) => s + Number(r.amount), 0);
  return { competencia, items: items || [], total, paid, isPaid: paid >= total && total > 0, remaining: Math.max(total - paid, 0) };
}
// Limite usado = total lançado no cartão − total já pago (todas as competências não pagas).
async function cardUsage(collaboratorId, card) {
  const { data: tx, error } = await supabase.from('pf_transactions')
    .select('amount').eq('collaborator_id', collaboratorId).eq('card_id', card.id);
  if (error) throw error;
  const charged = (tx || []).reduce((s, r) => s + Number(r.amount), 0);
  const { data: pays, error: e2 } = await supabase.from('pf_card_payments')
    .select('amount').eq('card_id', card.id);
  if (e2) throw e2;
  const paid = (pays || []).reduce((s, r) => s + Number(r.amount), 0);
  const used = Math.max(charged - paid, 0);
  const limit = Number(card.credit_limit);
  return { used, available: limit - used, pct: limit > 0 ? used / limit : 0, limit };
}
// Competência da fatura corrente (a que está aberta hoje).
function currentCompetencia(card) { return competenciaFor(new Date(), card.closing_day); }
```

- [ ] **Step 5: Pagar fatura (parcial/total) + transferência**

```js
async function payCardInvoice(collaboratorId, card, { competencia, amount, paid_from_account }) {
  const { data, error } = await supabase.from('pf_card_payments').insert({
    collaborator_id: collaboratorId, card_id: card.id, competencia,
    amount, paid_from_account: paid_from_account || null,
  }).select().single();
  if (error) throw error;            // trigger debita o saldo da conta de origem
  return data;
}
async function createTransfer(collaboratorId, { from_account, to_account, amount, description, transfer_date }) {
  const row = { collaborator_id: collaboratorId, from_account, to_account, amount, description: description || null };
  if (transfer_date) row.transfer_date = transfer_date;
  const { data, error } = await supabase.from('pf_transfers').insert(row).select().single();
  if (error) throw error;            // trigger ajusta os dois saldos
  return data;
}
```

- [ ] **Step 6: Lógica de alerta de limite (faixa cruzada, idempotente por ciclo)**

```js
const ALERT_BANDS = [50, 70, 80, 90];
// Retorna a faixa a alertar (ou null). Atualiza alert_cycle/alert_threshold no cartão.
async function checkAndMarkLimitAlert(collaboratorId, card) {
  const usage = await cardUsage(collaboratorId, card);
  const pctInt = Math.floor(usage.pct * 100);
  const cycle = currentCompetencia(card);
  let threshold = card.alert_cycle === cycle ? (card.alert_threshold || 0) : 0;
  // maior faixa cruzada acima do já alertado
  const crossed = ALERT_BANDS.filter(b => pctInt >= b && b > threshold);
  if (!crossed.length) {
    if (card.alert_cycle !== cycle) {
      await supabase.from('pf_cards').update({ alert_cycle: cycle, alert_threshold: 0 }).eq('id', card.id);
    }
    return null;
  }
  const band = Math.max(...crossed);
  await supabase.from('pf_cards').update({ alert_cycle: cycle, alert_threshold: band }).eq('id', card.id);
  return { band, usage };
}
async function cardsForAlerts() {                 // todos cartões ativos + phone/nome do dono
  const { data, error } = await supabase.from('pf_cards')
    .select('id, name, credit_limit, closing_day, due_day, alert_cycle, alert_threshold, collaborator_id')
    .eq('is_active', true);
  if (error) throw error;
  const ids = [...new Set((data || []).map(c => c.collaborator_id))];
  const collabs = await _enrichCollabs(ids);
  const byId = Object.fromEntries(collabs.map(c => [c.id, c]));
  return (data || []).map(c => ({ ...c, collab: byId[c.collaborator_id] })).filter(c => c.collab);
}
```

- [ ] **Step 7: Exportar tudo** — adicionar ao `module.exports`: `competenciaFor, addMonthsToCompetencia, createCard, listCards, findCard, insertCardPurchase, cardInvoice, cardUsage, currentCompetencia, payCardInvoice, createTransfer, checkAndMarkLimitAlert, cardsForAlerts, ALERT_BANDS`.

- [ ] **Step 8: Verificar** — `node --check src/services/financeiro-service.js` → sem erro.

### Task 3: Helper de formatação de mensagens

**Files:** Create: `src/services/finance-format.js`

- [ ] **Step 1: Escrever o módulo**

```js
// Formatação de mensagens financeiras do TOM (linguagem hierárquica/semântica).
// Texto puro do WhatsApp: *negrito*, _itálico_, barra em blocos.
const SEP = '━━━━━━━━━━━━━━━';
function money(v) {
  return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function bar(pct) {                       // pct 0..1 → [████░░░░░░] 37%
  const filled = Math.max(0, Math.min(10, Math.round(pct * 10)));
  return `[${'█'.repeat(filled)}${'░'.repeat(10 - filled)}] ${Math.round(pct * 100)}%`;
}
const MES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
function mesDaComp(comp) { return MES[parseInt(comp.slice(5, 7), 10) - 1]; }

function txnRegistered(card, p, usage) {
  const parc = p.installments > 1 ? ` em *${p.installments}x de ${money(p.amount / p.installments)}*` : '';
  return [
    '👽 *Lançado na fatura!*', SEP,
    `📺 *${p.description}*`,
    `💰 *${money(p.amount)}*${parc}`,
    `💳 Cartão: *${card.name}*`,
    `🗂️ Categoria: ${p.category}`,
    `🧾 Vai na fatura de: *${mesDaComp(p.competencia)}*`, SEP,
    `📊 Limite: ${bar(usage.pct)}`,
    `✅ Disponível: *${money(usage.available)}*`,
    '', '💡 _Quer ajustar? "era 2.900" · "exclui essa"_',
  ].join('\n');
}
function invoiceSummary(card, inv, usage) {
  return [
    `${card.icon || '💳'} *${card.name} · fatura de ${mesDaComp(inv.competencia)}*`, SEP,
    `💰 Fatura atual: *${money(inv.total)}*` + (inv.paid > 0 && !inv.isPaid ? ` _(pago parcial ${money(inv.paid)})_` : ''),
    `📊 Limite: ${bar(usage.pct)}`,
    `   _${money(usage.used)} de ${money(usage.limit)} · livre ${money(usage.available)}_`,
    `📅 Vence dia ${card.due_day}`, SEP,
    '⚡ _"extrato ' + card.name.toLowerCase() + '" · "pagar fatura"_',
  ].join('\n');
}
function limitAlert(card, band, usage) {
  const hot = band >= 90;
  const head = hot ? `🚨 *Opa — segura o freio!*` : `⚠️ *Atenção no ${card.name}*`;
  return [
    head,
    `Você passou de *${band}%* do limite do *${card.name}*.`,
    bar(usage.pct),
    `💰 ${money(usage.used)} de ${money(usage.limit)} · restam *${money(usage.available)}*`,
  ].join('\n');
}
function dueReminder(card, inv, days) {
  return [
    `🔔 *Fatura ${card.name}*`, SEP,
    `💰 ${money(inv.remaining)} vence em *${days} ${days === 1 ? 'dia' : 'dias'}* (dia ${card.due_day}).`,
    '💡 _Diga "paguei a fatura do ' + card.name.toLowerCase() + '" quando quitar._',
  ].join('\n');
}
module.exports = { money, bar, mesDaComp, txnRegistered, invoiceSummary, limitAlert, dueReminder, SEP };
```

- [ ] **Step 2: Verificar** — `node --check src/services/finance-format.js`.

- [ ] **Step 3: Commit** (migrations já commitam separado; aqui o auto-deploy do turno cuida do push).

---

## SPRINT 3 — Engine (TOM): actions de cartão no `<<FINANCE_ACTION>>`

### Task 4: Novas actions + handlers

**Files:** Modify: `src/engine.js` (bloco `:5886`+), `src/prompts/system.js`

- [ ] **Step 1: Ler o bloco atual** `engine.js:5886-6010` pra ver o shape dos handlers existentes (`create_account`, `transaction`, `summary`…) e o array `FINANCE_ACTIONS`. Espelhar o padrão exato (validação → `financeService.<fn>` → `reply`).

- [ ] **Step 2: Estender `FINANCE_ACTIONS`** (linha ~5887) adicionando: `'create_card','card_purchase','query_invoice','pay_invoice','transfer'`.

- [ ] **Step 3: Adicionar handlers** no switch/if-chain de ações (após os existentes, antes do fechamento do parser ~5985+). Usar `const fmt = require('./services/finance-format');` no topo do arquivo junto aos requires (`:24`).

```js
// create_card: {action:'create_card', name, credit_limit, closing_day, due_day, brand?, color?}
if (json.action === 'create_card') {
  const c = await financeService.createCard(cid, {
    name: json.name, brand: json.brand, color: json.color,
    credit_limit: json.credit_limit, closing_day: json.closing_day, due_day: json.due_day, icon: json.icon,
  });
  reply = `👽 Cartão *${c.name}* cadastrado! Limite ${fmt.money(c.credit_limit)}, fecha dia ${c.closing_day}, vence dia ${c.due_day}.`;
}
// card_purchase: {action:'card_purchase', card, category, amount, description, installments?, date?}
else if (json.action === 'card_purchase') {
  const cards = await financeService.findCard(cid, json.card || '');
  if (cards.length !== 1) { reply = cards.length === 0
      ? `Não achei o cartão "${json.card}". Seus cartões: ${(await financeService.listCards(cid)).map(c=>c.name).join(', ') || 'nenhum'}.`
      : `Tenho mais de um cartão parecido com "${json.card}": ${cards.map(c=>c.name).join(', ')}. Qual?`; }
  else {
    const card = cards[0];
    const rows = await financeService.insertCardPurchase(cid, card, {
      category: json.category, amount: json.amount, description: json.description,
      transaction_date: json.date, installments: json.installments || 1,
    });
    const usage = await financeService.cardUsage(cid, card);
    reply = fmt.txnRegistered(card, {
      description: json.description, amount: json.amount, category: json.category,
      installments: json.installments || 1, competencia: rows[0].competencia,
    }, usage);
    // alerta imediato se cruzou faixa
    const al = await financeService.checkAndMarkLimitAlert(cid, card);
    if (al) reply += '\n\n' + fmt.limitAlert(card, al.band, al.usage);
  }
}
// query_invoice: {action:'query_invoice', card, competencia?}
else if (json.action === 'query_invoice') {
  const cards = await financeService.findCard(cid, json.card || '');
  if (cards.length !== 1) { reply = `Qual cartão? Tenho: ${(await financeService.listCards(cid)).map(c=>c.name).join(', ') || 'nenhum'}.`; }
  else {
    const card = cards[0];
    const comp = json.competencia || financeService.currentCompetencia(card);
    const inv = await financeService.cardInvoice(cid, card.id, comp);
    const usage = await financeService.cardUsage(cid, card);
    reply = fmt.invoiceSummary(card, inv, usage);
  }
}
// pay_invoice: {action:'pay_invoice', card, amount?, competencia?, from_account?}
else if (json.action === 'pay_invoice') {
  const cards = await financeService.findCard(cid, json.card || '');
  if (cards.length !== 1) { reply = `Qual cartão você pagou? Tenho: ${(await financeService.listCards(cid)).map(c=>c.name).join(', ') || 'nenhum'}.`; }
  else {
    const card = cards[0];
    const comp = json.competencia || financeService.currentCompetencia(card);
    const inv = await financeService.cardInvoice(cid, card.id, comp);
    const amount = json.amount || inv.remaining;
    let fromId = null;
    if (json.from_account) {
      const accs = (await financeService.listAccounts(cid)).filter(a => a.name.toLowerCase().includes(String(json.from_account).toLowerCase()));
      if (accs.length === 1) fromId = accs[0].id;
    }
    await financeService.payCardInvoice(cid, card, { competencia: comp, amount, paid_from_account: fromId });
    const after = await financeService.cardInvoice(cid, card.id, comp);
    reply = `✅ Pagamento de *${fmt.money(amount)}* na fatura do *${card.name}* registrado.\n` +
            (after.isPaid ? '🎉 Fatura quitada!' : `Ainda faltam *${fmt.money(after.remaining)}*.`);
  }
}
// transfer: {action:'transfer', from, to, amount, description?}
else if (json.action === 'transfer') {
  const accs = await financeService.listAccounts(cid);
  const from = accs.find(a => a.name.toLowerCase().includes(String(json.from||'').toLowerCase()));
  const to = accs.find(a => a.name.toLowerCase().includes(String(json.to||'').toLowerCase()));
  if (!from || !to || from.id === to.id) { reply = `Não consegui identificar as contas. Tenho: ${accs.map(a=>a.name).join(', ')}.`; }
  else {
    await financeService.createTransfer(cid, { from_account: from.id, to_account: to.id, amount: json.amount, description: json.description });
    reply = `🔁 Transferi *${fmt.money(json.amount)}* de *${from.name}* → *${to.name}*. Saldo total inalterado.`;
  }
}
```
> `cid`, `reply`, `json` seguem os nomes já usados no bloco existente — **conferir no Step 1 e ajustar** se forem outros (ex. `collab.id`).

- [ ] **Step 4: System prompt** — em `src/prompts/system.js` (ou skill de finanças), documentar as 5 actions novas com exemplos: "comprei TV 3.200 em 10x no nubank" → `card_purchase` installments=10; "quanto tá minha fatura?" → `query_invoice`; "paguei a fatura do nubank" → `pay_invoice`; "transferi 500 do itaú pro nubank" → `transfer`; "cadastra cartão nubank limite 5000 fecha dia 6 vence dia 10" → `create_card`. Reforçar: número de parcelas e datas o ENGINE calcula; LLM só extrai. `collaborator_id` nunca vem do LLM.

- [ ] **Step 5: Verificar** — `node --check src/engine.js`.

- [ ] **Step 6: Deploy imediato** — `scp src/engine.js src/services/financeiro-service.js src/services/finance-format.js tom:/opt/LA-Organizer/src/...` + `ssh tom "pm2 restart tom"`.

---

## SPRINT 4 — Dispatcher (alertas proativos)

### Task 5: Ritual de alerta de limite + lembrete de fatura

**Files:** Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Ler** o job `lembrete_conta` existente (usa `billsDueWithin`/`collaboratorsWithActiveBills` + `quiet-hours`) pra espelhar envио WhatsApp + checagem de silêncio.

- [ ] **Step 2: Adicionar função de alerta de limite** (roda no mesmo cron periódico dos lembretes financeiros):

```js
async function dispatchCardLimitAlerts() {
  const fmt = require('../services/finance-format');
  const cards = await financeService.cardsForAlerts();
  for (const card of cards) {
    if (isQuietNow('personal')) continue;       // respeita silêncio (mesmo helper do lembrete_conta)
    const al = await financeService.checkAndMarkLimitAlert(card.collaborator_id, card);
    if (al) await sendWhatsApp(card.collab.phone, fmt.limitAlert(card, al.band, al.usage));
  }
}
```
> Ajustar `isQuietNow`, `sendWhatsApp` aos nomes reais usados no dispatcher (conferir no Step 1).

- [ ] **Step 3: Adicionar lembrete de vencimento de fatura**:

```js
async function dispatchCardDueReminders(daysBefore = 2) {
  const fmt = require('../services/finance-format');
  const today = new Date(); const dom = today.getUTCDate();
  const cards = await financeService.cardsForAlerts();
  for (const card of cards) {
    if (card.due_day < dom || card.due_day > dom + daysBefore) continue;
    const comp = financeService.currentCompetencia(card);
    const inv = await financeService.cardInvoice(card.collaborator_id, card.id, comp);
    if (inv.isPaid || inv.total <= 0) continue;
    if (isQuietNow('personal')) continue;
    await sendWhatsApp(card.collab.phone, fmt.dueReminder(card, inv, card.due_day - dom));
  }
}
```

- [ ] **Step 4: Registrar no cron** — chamar `dispatchCardLimitAlerts()` e `dispatchCardDueReminders()` no mesmo agendamento dos rituais financeiros existentes (achar onde `billsDueWithin`/`lembrete_conta` é agendado e adicionar ao lado).

- [ ] **Step 5: Verificar** — `node --check src/rituals/dispatcher.js` + deploy scp + `pm2 restart tom`.

---

## SPRINT 5 — PWA (UI)

### Task 6: Tipos + lib de cartões

**Files:** Modify `web/src/lib/financeiro.ts`; Create `web/src/lib/cartoes.ts`

- [ ] **Step 1: Tipos** em `financeiro.ts` (ou em `cartoes.ts`):
```ts
export interface Card { id: string; name: string; brand: string|null; color: string|null;
  credit_limit: number; closing_day: number; due_day: number; icon: string|null; }
export interface CardInvoiceItem { id: string; description: string|null; category: string; amount: number;
  transaction_date: string; installment_no: number|null; installments_total: number|null; }
```

- [ ] **Step 2: `cartoes.ts`** com (espelhar o cliente user-jwt de `personalChecklists.ts`/`financeiro.ts`):
  `listCards(ownerId)`, `createCard(input)`, `cardUsage(card, ownerId)` (mesma fórmula do backend: charged−paid), `cardInvoice(cardId, competencia, ownerId)`, `payCardInvoice(...)`, `currentCompetencia(card)`, `competenciaFor(date, closing)` (portar de finance-service para TS). DRY: a fórmula de competência/uso deve bater 1:1 com o backend.

- [ ] **Step 3: Verificar** — `cd web && npx tsc --noEmit`.

### Task 7: Lista de cartões (tile leve "B")

**Files:** Create `web/src/screens/financeiro/CartoesPage.tsx`; Modify `FinanceiroPage.tsx`

- [ ] **Step 1:** Criar `CartoesPage` renderizando tiles (DS, token `tom`): ícone/cor, nome, "vence dia N · fecha em Xd", fatura atual (destaque), chip %, barra de limite verde, "limite / disponível". Tocar → navega pra `/financeiro/cartao/:id`. Layout validado no Companion (tile B). Mobile 375 + desktop (guardrail: se `FinanceiroPage` já tem split desktop/mobile, seguir o mesmo padrão).

- [ ] **Step 2:** Em `FinanceiroPage.tsx`, adicionar seção "Cartões" (lista dos tiles) **abaixo** dos StatCards e dos quick-links, e um atalho pra criar cartão.

- [ ] **Step 3:** Rota `/financeiro/cartao/:id` no router (achar onde as rotas de financeiro são definidas e adicionar).

- [ ] **Step 4:** Verificar — `npx tsc --noEmit && npx vite build`; Preview 375/1440.

### Task 8: Detalhe do cartão (herói + fatura + pagar)

**Files:** Create `web/src/screens/financeiro/CartaoDetalhe.tsx`

- [ ] **Step 1:** Topo: cartão skeuomórfico (gradiente da `color`/bandeira), barra de limite, usado/disponível. Dois mini-cards Fecha/Vence. Lista da fatura corrente (itens com ícone de categoria, descrição + `2/10`, valor, data). Total + botão "Pagar fatura" → `BottomSheet` com `CustomSelect` da carteira de origem + input de valor (default = restante; permitir parcial) → `payCardInvoice`. Navegação por competência (mês anterior/próximo) opcional v1 (mostrar só a corrente é suficiente).

- [ ] **Step 2:** Verificar — `npx tsc --noEmit && npx vite build`; Preview 375/1440 (validar contra o mock `cartao-detalhe.html`).

### Task 9: Modal de lançamento (Única/Recorrente/Parcelada)

**Files:** Create `web/src/screens/financeiro/components/LancamentoSheet.tsx`

- [ ] **Step 1:** `BottomSheet` com campos comuns (Descrição, Valor, Meio de pagamento = `CustomSelect` unificado carteiras+cartões, Categoria) + segmented "Tipo":
  - Única → `DateInput` Vencimento → cria `pf_bills` recurrence='once' (ou transação agendada — usar o fluxo de conta fixa existente em `ContasFixasPage`).
  - Recorrente → dia do mês → fluxo de conta fixa atual.
  - Parcelada → Nº parcelas + 1ª data → se meio=cartão, `insertCardPurchase` com installments; mostra "R$ X/mês".
- [ ] **Step 2:** Abrir o modal a partir do FAB/atalho do `FinanceiroPage`.
- [ ] **Step 3:** Verificar — `npx tsc --noEmit && npx vite build`; Preview (validar contra `lancamento-modal.html`).

### Task 10: Realtime

**Files:** Modify `web/src/hooks/useRealtimeFinance.ts`

- [ ] **Step 1:** Assinar `pf_cards`, `pf_card_payments`, `pf_transfers` (e garantir `pf_transactions` já assinado) invalidando as queries de cartão. Espelhar o padrão das assinaturas existentes.
- [ ] **Step 2:** Verificar — `npx tsc --noEmit && npx vite build`.

---

## SPRINT 6 — Smoke + fecho

### Task 11: Smoke ponta-a-ponta

- [ ] **Step 1: WhatsApp** (engine já deployado): "cadastra cartão nubank limite 5000 fecha dia 6 vence dia 10" → "comprei TV 3200 em 10x no nubank" → conferir 10 parcelas (competências sequenciais) + msg com "vai na fatura de" + barra → "quanto tá minha fatura do nubank?" → gerar gastos até cruzar 70% e 90% (cada alerta 1×) → "paguei 1000 da fatura do nubank" (parcial) → "paguei a fatura do nubank" (total) → "transferi 500 do itau pro nubank" (saldos ajustam, total igual).
- [ ] **Step 2: Verificar no banco** — `execute_sql`: parcelas com `purchase_group` igual e competências +1 mês; `pf_card_payments` com 2 linhas; saldos das contas batendo; `alert_threshold`/`alert_cycle` corretos.
- [ ] **Step 3: PWA Preview** (375 e 1440): lista → detalhe → pagar fatura → lançamento. Bate com os mocks do Companion.
- [ ] **Step 4: Deploy final** — engine via scp + `pm2 restart tom`; PWA pelo auto-deploy do turno (Vercel).

---

## Self-Review (writing-plans)

**Cobertura da spec:** §4 modelo→Task 1; §5 fatura/parcelas/limite→Tasks 2,6; §6 PWA→Tasks 7-9; §7 linguagem→Task 3; §8 TOM→Task 4; §9 alertas→Task 5; transferência (§8)→Tasks 1,2,4; realtime (§4.6)→Task 10; smoke (§11)→Task 11. Sem gaps.

**Decisões do Alf cravadas:** limite=todas não pagas (Task 2 `cardUsage` charged−paid); pagamento parcial+total (Task 2 `payCardInvoice` + isPaid por soma); transferência só origem−/destino+ sem tocar total (Task 1 trigger `pf_sync_balance_on_transfer`).

**Consistência de nomes:** `competenciaFor/cardUsage/cardInvoice/payCardInvoice/createTransfer/checkAndMarkLimitAlert/cardsForAlerts` usados igual no service (Task 2) e chamados no engine (Task 4) e dispatcher (Task 5). `fmt.*` (Task 3) usado em Tasks 4-5.

**Riscos a confirmar em runtime:** nomes de variáveis no bloco `FINANCE_ACTION` (`cid`/`collab.id`, `reply`) — Step 1 da Task 4 confirma antes; nome real de `isQuietNow`/`sendWhatsApp` no dispatcher — Step 1 da Task 5; `current_collab_id()` — Step 4 da Task 1.
