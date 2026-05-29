# Finanças Pessoais — Fase A (Núcleo Backend) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o colaborador registre e consulte suas finanças pessoais pelo WhatsApp (transações, contas, metas, orçamento, carteiras) com isolamento total por colaborador.

**Architecture:** Migration no Supabase cria 5 tabelas `pf_*` com RLS owner-only e dois triggers (sync de saldo + checagem de dono). Lógica pura (categorização, alerta de cruzamento de orçamento, projeção de juros) fica em `src/finance/` testável com `node:test`. Um service `financeiro-service.js` faz CRUD filtrando SEMPRE por `collaborator_id` (caminho service_role ignora RLS). O engine ganha o marker `<<FINANCE_ACTION>>` e um dispatcher de handlers; a skill `financeiro-pessoal.md` ensina o TOM a emitir o marker.

**Tech Stack:** Node.js (CommonJS), Supabase (`@supabase/supabase-js`, service_role), `node:test` + `node:assert` (embutidos, zero dependência nova), PostgreSQL/plpgsql.

---

## Convenções deste projeto (LEIA antes de executar)

- **NÃO commitar entre tasks.** O CLAUDE.md manda trabalhar tudo local em `_remote/` e fazer 1 commit-bundle no fim. O Stop hook (`auto-deploy.ps1`) commita+pusha `_remote/` no fim do turno automaticamente. **Os passos abaixo NÃO têm "git commit"** — o passo de fechamento de cada task é uma **validação** (`node --check`, `node --test`, ou SQL assert). Exceção: migrations podem ser commitadas à parte, mas aqui são aplicadas via MCP.
- **Migration via MCP:** aplicar com `mcp__...supabase...__apply_migration` no projeto `cesnbnrynvxvgdhfmaua`. O arquivo `.sql` em `migrations/` é só histórico.
- **Código é CommonJS** (`require`/`module.exports`), apesar do CLAUDE.md dizer "ES modules". Siga o código real: o modelo de service correto é **`src/services/collaborator.js`** (`const supabase = require('../supabase/client')` — client service_role do projeto principal `cesnbnrynvxvgdhfmaua`). **NÃO use `inventario-service.js` como modelo** — ele importa `laReportClient` (`./la-report-client`), que aponta pra OUTRO projeto Supabase (LA_REPORT). As tabelas `pf_*` ficam no projeto principal, então o client tem que ser `../supabase/client`.
- **Segurança inegociável (spec §6):** `collaborator_id` SEMPRE vem do remetente resolvido em `engine.js` (`collaborator.id`), NUNCA do JSON do marker. Todo handler passa `collaborator.id` para o service; o service filtra explicitamente por ele.
- **Atualizar o TOM pra smoke test:** `scp` do arquivo pra `tom:/opt/LA-Organizer/<caminho>` + `ssh tom "pm2 restart tom"` (CLAUDE.md). Validação local de sintaxe: `node --check src/<arquivo>.js`.
- **Spec de referência:** `docs/superpowers/specs/2026-05-29-financeiro-pessoal-design.md`. Decisões D1–D7 e guard-rails §6 são fonte de verdade.

---

## File Structure (Fase A)

**Criar:**
- `migrations/20260529_financeiro_pessoal_schema.sql` — schema + RLS + indexes + 2 triggers (histórico do que foi aplicado via MCP).
- `src/finance/categorize.js` — normalizer de aliases + mapeamento de categoria por palavra-chave (puro).
- `src/finance/categorize.test.js`
- `src/finance/budget-alert.js` — detecção de cruzamento de threshold + sugestões (puro).
- `src/finance/budget-alert.test.js`
- `src/finance/projection.js` — projeção de meta e juros compostos (puro).
- `src/finance/projection.test.js`
- `src/services/financeiro-service.js` — CRUD/queries `pf_*`, filtrado por `collaborator_id`.
- `skills/financeiro-pessoal.md` — skill do TOM.
- `scripts/pf-security-check.sql` — script de asserts de segurança (trigger de dono + RLS), rodado via MCP `execute_sql`.

**Modificar:**
- `src/engine.js` — `parseFinanceMarker()` + `handleFinanceAction()` + wiring no `processMessage()`.
- `src/prompts/system.js` — gatilho da skill `financeiro-pessoal` no `pickSkill()`.

---

## Task 0: Pré-flight (ambiente e dependências do banco)

**Files:** nenhum (verificação).

- [ ] **Step 1: Confirmar versão do Node suporta `node:test`**

Run: `node --version`
Expected: `v18.x` ou superior (o `node --test` exige Node ≥ 18).

- [ ] **Step 2: Confirmar que `current_collab_id()` existe no banco**

Usar MCP `execute_sql` no projeto `cesnbnrynvxvgdhfmaua`:
```sql
SELECT proname FROM pg_proc WHERE proname = 'current_collab_id';
```
Expected: 1 linha (`current_collab_id`). Se vazio, PARAR e reportar — as policies RLS dependem dessa função (usada pelas tabelas existentes tipo `habits`).

- [ ] **Step 3: Confirmar tabela `collaborators` e pegar 2 ids de teste**

```sql
SELECT id, name FROM collaborators ORDER BY created_at LIMIT 2;
```
Expected: ≥ 2 linhas. Anotar os 2 `id` (chamados de `COLLAB_A` e `COLLAB_B` nos asserts de segurança da Task 2).

---

## Task 1: Migration — schema, RLS e indexes (sem triggers ainda)

**Files:**
- Create: `migrations/20260529_financeiro_pessoal_schema.sql`

- [ ] **Step 1: Escrever o arquivo de migration (schema + RLS + indexes)**

Criar `migrations/20260529_financeiro_pessoal_schema.sql` com o conteúdo do schema do PRD §4 (cole exatamente):

```sql
-- pf_accounts
CREATE TABLE pf_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'checking'
    CHECK (type IN ('checking','savings','wallet','investment')),
  balance numeric(12,2) NOT NULL DEFAULT 0,
  goal_monthly numeric(12,2),
  icon text DEFAULT '🏦',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pf_transactions
CREATE TABLE pf_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  account_id uuid REFERENCES pf_accounts(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('income','expense')),
  category text NOT NULL CHECK (category IN (
    'salario','comissao','extra',
    'moradia','alimentacao','transporte',
    'saude','educacao','lazer','outros'
  )),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  description text,
  transaction_date date NOT NULL DEFAULT CURRENT_DATE,
  via text DEFAULT 'tom',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pf_transactions_collab_date
  ON pf_transactions(collaborator_id, transaction_date DESC);
-- cast ::timestamp torna date_trunc IMMUTABLE (exigido em indice; date_trunc(text,date) e STABLE)
CREATE INDEX idx_pf_transactions_collab_month
  ON pf_transactions(collaborator_id, (date_trunc('month', transaction_date::timestamp)));

-- pf_bills
CREATE TABLE pf_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL,
  amount numeric(12,2) NOT NULL,
  due_day int NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  category text NOT NULL,
  type text NOT NULL DEFAULT 'expense' CHECK (type IN ('expense','income')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue')),
  remind_days_before int NOT NULL DEFAULT 2,
  last_paid_at date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- pf_goals
CREATE TABLE pf_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL,
  target_amount numeric(12,2) NOT NULL,
  current_amount numeric(12,2) NOT NULL DEFAULT 0,
  monthly_contribution numeric(12,2),
  deadline date,
  icon text DEFAULT '🎯',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- pf_budgets
CREATE TABLE pf_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  category text NOT NULL,
  monthly_limit numeric(12,2) NOT NULL,
  month_year text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collaborator_id, category, month_year)
);

-- RLS owner-only (caminho PWA/JWT)
ALTER TABLE pf_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE pf_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY pf_accounts_owner ON pf_accounts FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_transactions_owner ON pf_transactions FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_bills_owner ON pf_bills FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_goals_owner ON pf_goals FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
CREATE POLICY pf_budgets_owner ON pf_budgets FOR ALL TO authenticated
  USING (collaborator_id = current_collab_id()) WITH CHECK (collaborator_id = current_collab_id());
```

- [ ] **Step 2: Aplicar a migration via MCP**

Usar `mcp__...supabase...__apply_migration` (projeto `cesnbnrynvxvgdhfmaua`, name `financeiro_pessoal_schema`) com o SQL acima.
Expected: sucesso, sem erro.

- [ ] **Step 3: Verificar que as 5 tabelas existem**

`execute_sql`:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_name LIKE 'pf_%' ORDER BY table_name;
```
Expected: `pf_accounts, pf_bills, pf_budgets, pf_goals, pf_transactions` (5 linhas).

---

## Task 2: Triggers — sync de saldo + checagem de dono (endurecimento de segurança)

**Files:**
- Modify: `migrations/20260529_financeiro_pessoal_schema.sql` (anexar os triggers ao histórico)
- Create: `scripts/pf-security-check.sql`

- [ ] **Step 1: Anexar os triggers ao arquivo de migration**

Acrescentar ao fim de `migrations/20260529_financeiro_pessoal_schema.sql`:

```sql
-- Trigger 1: checagem de dono (BEFORE) — rejeita account_id de outro colaborador (spec §6.1, opção a)
CREATE OR REPLACE FUNCTION pf_check_account_owner() RETURNS trigger AS $$
DECLARE acct_owner uuid;
BEGIN
  IF NEW.account_id IS NOT NULL THEN
    SELECT collaborator_id INTO acct_owner FROM pf_accounts WHERE id = NEW.account_id;
    IF acct_owner IS NULL THEN
      RAISE EXCEPTION 'pf_transactions.account_id % nao existe', NEW.account_id;
    END IF;
    IF acct_owner <> NEW.collaborator_id THEN
      RAISE EXCEPTION 'pf_transactions.account_id % pertence a outro colaborador', NEW.account_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pf_check_account_owner
  BEFORE INSERT OR UPDATE ON pf_transactions
  FOR EACH ROW EXECUTE FUNCTION pf_check_account_owner();

-- Trigger 2: sync de saldo (AFTER) — mantem pf_accounts.balance (PRD §4.6.1)
CREATE OR REPLACE FUNCTION pf_sync_account_balance() RETURNS trigger AS $$
BEGIN
  IF (TG_OP = 'DELETE' OR TG_OP = 'UPDATE') AND OLD.account_id IS NOT NULL THEN
    UPDATE pf_accounts
       SET balance = balance - (CASE WHEN OLD.type = 'income' THEN OLD.amount ELSE -OLD.amount END),
           updated_at = now()
     WHERE id = OLD.account_id;
  END IF;
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') AND NEW.account_id IS NOT NULL THEN
    UPDATE pf_accounts
       SET balance = balance + (CASE WHEN NEW.type = 'income' THEN NEW.amount ELSE -NEW.amount END),
           updated_at = now()
     WHERE id = NEW.account_id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_pf_sync_balance
  AFTER INSERT OR UPDATE OR DELETE ON pf_transactions
  FOR EACH ROW EXECUTE FUNCTION pf_sync_account_balance();
```

- [ ] **Step 2: Aplicar os triggers via MCP**

`apply_migration` (name `financeiro_pessoal_triggers`) com o SQL dos 2 triggers.
Expected: sucesso.

- [ ] **Step 3: Escrever o script de asserts de segurança**

Criar `scripts/pf-security-check.sql` (substituir `COLLAB_A`/`COLLAB_B` pelos ids da Task 0 Step 3 ao rodar):

```sql
-- Asserts de seguranca dos triggers (rodar via MCP execute_sql, dentro de uma transacao descartavel)
BEGIN;
-- carteira do A e do B
INSERT INTO pf_accounts (id, collaborator_id, name) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','COLLAB_A','Conta A'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','COLLAB_B','Conta B');

-- 1) transacao legitima do A na conta do A: saldo deve virar -50 (expense)
INSERT INTO pf_transactions (collaborator_id, account_id, type, category, amount)
  VALUES ('COLLAB_A','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','expense','alimentacao',50);
DO $$ DECLARE b numeric; BEGIN
  SELECT balance INTO b FROM pf_accounts WHERE id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  ASSERT b = -50, 'saldo do A deveria ser -50, veio '||b;
END $$;

-- 2) transacao do A apontando pra conta do B (account_id forjado): DEVE falhar
DO $$ BEGIN
  BEGIN
    INSERT INTO pf_transactions (collaborator_id, account_id, type, category, amount)
      VALUES ('COLLAB_A','bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','expense','alimentacao',999);
    RAISE EXCEPTION 'FALHA DE SEGURANCA: insert cross-owner foi aceito';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE '%pertence a outro colaborador%' THEN
      RAISE NOTICE 'OK: insert cross-owner rejeitado';
    ELSE RAISE; END IF;
  END;
END $$;

-- 3) saldo da conta do B intacto (0)
DO $$ DECLARE b numeric; BEGIN
  SELECT balance INTO b FROM pf_accounts WHERE id='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT b = 0, 'saldo do B deveria ser 0, veio '||b;
END $$;
ROLLBACK;  -- descarta tudo, nao suja producao
```

- [ ] **Step 4: Rodar os asserts via MCP**

Executar o conteúdo de `scripts/pf-security-check.sql` (com os ids reais) via `execute_sql`.
Expected: sem erro; NOTICE "OK: insert cross-owner rejeitado". Se o passo 2 não levantar exceção, é falha de segurança → PARAR.

---

## Task 3: Lógica pura — categorização e normalizer de aliases

**Files:**
- Create: `src/finance/categorize.js`
- Test: `src/finance/categorize.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/finance/categorize.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapCategory, normalizeParams } = require('./categorize');

test('mapCategory: palavra-chave de alimentacao', () => {
  assert.strictEqual(mapCategory('iFood'), 'alimentacao');
  assert.strictEqual(mapCategory('paguei o mercado'), 'alimentacao');
});
test('mapCategory: transporte e moradia', () => {
  assert.strictEqual(mapCategory('uber pro trampo'), 'transporte');
  assert.strictEqual(mapCategory('aluguel'), 'moradia');
});
test('mapCategory: fallback outros', () => {
  assert.strictEqual(mapCategory('comprei um negocio aleatorio'), 'outros');
});
test('normalizeParams: aliases valor/tipo/categoria', () => {
  const out = normalizeParams({ valor: 45, gasto: true, cat: 'alimentacao', nota: 'iFood' });
  assert.strictEqual(out.amount, 45);
  assert.strictEqual(out.type, 'expense');
  assert.strictEqual(out.category, 'alimentacao');
  assert.strictEqual(out.description, 'iFood');
});
test('normalizeParams: receita/ganho vira income', () => {
  const out = normalizeParams({ value: 2800, receita: true });
  assert.strictEqual(out.type, 'income');
  assert.strictEqual(out.amount, 2800);
});
```

- [ ] **Step 2: Rodar o teste pra ver falhar**

Run: `node --test src/finance/categorize.test.js`
Expected: FAIL — `Cannot find module './categorize'`.

- [ ] **Step 3: Implementar `categorize.js`**

Criar `src/finance/categorize.js`:
```js
// Mapeamento de categoria por palavra-chave + normalizer de aliases (PRD §5.3). Puro, sem I/O.

const CATEGORY_KEYWORDS = [
  ['salario',    ['salario', 'salário', 'pagamento la']],
  ['comissao',   ['comissao', 'comissão', 'venda loja']],
  ['extra',      ['freelance', 'extra', 'bico', 'renda extra']],
  ['moradia',    ['aluguel', 'condominio', 'condomínio', 'luz', 'agua', 'água', 'internet', 'gas', 'gás', 'iptu']],
  ['alimentacao',['ifood', 'mercado', 'almoco', 'almoço', 'lanche', 'restaurante', 'padaria', 'cafe', 'café']],
  ['transporte', ['uber', 'gasolina', 'onibus', 'ônibus', 'estacionamento', 'manutencao carro', 'manutenção carro']],
  ['saude',      ['farmacia', 'farmácia', 'remedio', 'remédio', 'medico', 'médico', 'dentista', 'plano saude', 'plano saúde', 'consulta']],
  ['educacao',   ['curso', 'livro', 'material', 'escola', 'faculdade']],
  ['lazer',      ['cinema', 'bar', 'cerveja', 'streaming', 'netflix', 'jogo', 'viagem']],
];

function mapCategory(text) {
  const t = String(text || '').toLowerCase();
  for (const [cat, words] of CATEGORY_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return cat;
  }
  return 'outros';
}

function normalizeParams(raw = {}) {
  const out = { ...raw };
  const pick = (...keys) => keys.map((k) => raw[k]).find((v) => v !== undefined);

  const amount = pick('amount', 'valor', 'value', 'price');
  if (amount !== undefined) out.amount = Number(amount);

  let type = pick('type', 'tipo', 'kind');
  if (raw.gasto || raw.despesa) type = 'expense';
  if (raw.receita || raw.ganho || raw.renda) type = 'income';
  if (type) out.type = type;

  const category = pick('category', 'categoria', 'cat');
  if (category) out.category = category;

  const description = pick('description', 'desc', 'nota', 'note');
  if (description !== undefined) out.description = description;

  return out;
}

module.exports = { mapCategory, normalizeParams, CATEGORY_KEYWORDS };
```

- [ ] **Step 4: Rodar o teste pra ver passar**

Run: `node --test src/finance/categorize.test.js`
Expected: PASS (5 testes).

---

## Task 4: Lógica pura — detecção de cruzamento de orçamento (D3)

**Files:**
- Create: `src/finance/budget-alert.js`
- Test: `src/finance/budget-alert.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/finance/budget-alert.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { crossedThreshold, buildBudgetAlert } = require('./budget-alert');

test('crossedThreshold: cruza 70 quando vai de 60% pra 72%', () => {
  // limite 500: prev 300 (60%) -> novo 360 (72%)
  assert.strictEqual(crossedThreshold(300, 360, 500), 70);
});
test('crossedThreshold: nao re-alerta dentro da mesma faixa', () => {
  // 72% -> 78%: nao cruza 80
  assert.strictEqual(crossedThreshold(360, 390, 500), null);
});
test('crossedThreshold: cruza 80 ao ir de 78% pra 85%', () => {
  assert.strictEqual(crossedThreshold(390, 425, 500), 80);
});
test('crossedThreshold: salto grande mostra so a faixa mais alta', () => {
  // 60% -> 105%: cruza 70, 80 e 100; retorna 100
  assert.strictEqual(crossedThreshold(300, 525, 500), 100);
});
test('crossedThreshold: limite zero/ausente nao alerta', () => {
  assert.strictEqual(crossedThreshold(0, 100, 0), null);
  assert.strictEqual(crossedThreshold(0, 100, null), null);
});
test('buildBudgetAlert: 80% inclui sugestao da categoria', () => {
  const msg = buildBudgetAlert('alimentacao', 425, 500, 80);
  assert.match(msg, /80%/);
  assert.match(msg, /marmita/i);
});
test('buildBudgetAlert: threshold null retorna string vazia', () => {
  assert.strictEqual(buildBudgetAlert('lazer', 100, 500, null), '');
});
```

- [ ] **Step 2: Rodar o teste pra ver falhar**

Run: `node --test src/finance/budget-alert.test.js`
Expected: FAIL — `Cannot find module './budget-alert'`.

- [ ] **Step 3: Implementar `budget-alert.js`**

Criar `src/finance/budget-alert.js`:
```js
// Deteccao de cruzamento de threshold de orcamento (spec D3) + mensagens (PRD §6.3). Puro, stateless.

const THRESHOLDS = [
  { pct: 100, emoji: '☠️' },
  { pct: 80,  emoji: '🔴' },
  { pct: 70,  emoji: '⚠️' },
]; // ordem decrescente: retornamos a faixa mais alta cruzada

const SUGGESTIONS = {
  alimentacao: 'Já pensou em levar marmita essa semana?',
  transporte:  'Dá pra ir de ônibus ou carona nos próximos dias?',
  lazer:       'Calma aí — deixa um pouco pro final do mês.',
  outros:      'Tá gastando bastante com coisas diversas — revisa se precisa mesmo.',
};

// Retorna o maior threshold (70/80/100) cruzado por esta transacao, ou null.
function crossedThreshold(prevTotal, newTotal, limit) {
  if (!limit || limit <= 0) return null;
  const prevPct = (prevTotal / limit) * 100;
  const newPct = (newTotal / limit) * 100;
  for (const t of THRESHOLDS) {
    if (prevPct < t.pct && newPct >= t.pct) return t.pct;
  }
  return null;
}

function buildBudgetAlert(category, newTotal, limit, threshold) {
  if (!threshold) return '';
  const t = THRESHOLDS.find((x) => x.pct === threshold);
  const emoji = t ? t.emoji : '⚠️';
  const head = `${emoji} ${threshold}% do orçamento de ${category} (R$${newTotal}/R$${limit}).`;
  if (threshold >= 80 && SUGGESTIONS[category]) return `${head} ${SUGGESTIONS[category]}`;
  return head;
}

module.exports = { crossedThreshold, buildBudgetAlert, THRESHOLDS, SUGGESTIONS };
```

- [ ] **Step 4: Rodar o teste pra ver passar**

Run: `node --test src/finance/budget-alert.test.js`
Expected: PASS (7 testes).

---

## Task 5: Lógica pura — projeção de meta e juros compostos (D4-base)

**Files:**
- Create: `src/finance/projection.js`
- Test: `src/finance/projection.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/finance/projection.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { futureValue, monthsToGoalSimple, monthsToGoalWithInterest, formatMonths } = require('./projection');

test('futureValue: aporte com juros (M = P*((1+i)^n -1)/i)', () => {
  // R$300/mes, 0.83%/mes, 12 meses ~ 3766.x
  const fv = futureValue(300, 0.0083, 12);
  assert.ok(fv > 3750 && fv < 3790, `fv inesperado: ${fv}`);
});
test('futureValue: taxa zero = soma simples', () => {
  assert.strictEqual(futureValue(300, 0, 12), 3600);
});
test('monthsToGoalSimple: 20000 guardando 500/mes = 40 meses', () => {
  assert.strictEqual(monthsToGoalSimple(20000, 0, 500), 40);
});
test('monthsToGoalSimple: ja tem current_amount', () => {
  assert.strictEqual(monthsToGoalSimple(20000, 5000, 500), 30);
});
test('monthsToGoalWithInterest: com juros leva menos meses que o simples', () => {
  const simple = monthsToGoalSimple(20000, 0, 500);
  const comJuros = monthsToGoalWithInterest(20000, 0, 500, 0.0083);
  assert.ok(comJuros < simple, `com juros (${comJuros}) deveria ser < simples (${simple})`);
});
test('formatMonths: 40 meses vira "3 anos e 4 meses"', () => {
  assert.strictEqual(formatMonths(40), '3 anos e 4 meses');
});
test('formatMonths: 12 meses vira "1 ano"', () => {
  assert.strictEqual(formatMonths(12), '1 ano');
});
```

- [ ] **Step 2: Rodar o teste pra ver falhar**

Run: `node --test src/finance/projection.test.js`
Expected: FAIL — `Cannot find module './projection'`.

- [ ] **Step 3: Implementar `projection.js`**

Criar `src/finance/projection.js`:
```js
// Projecao de meta e juros compostos (PRD §7.2). Puro. Taxas mensais (i decimal, ex 0.0083 = 0.83%/mes).

// Valor futuro de aportes mensais: M = P * ((1+i)^n - 1) / i
function futureValue(monthly, monthlyRate, months) {
  if (monthlyRate === 0) return monthly * months;
  return monthly * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

// Meses pra atingir a meta sem juros (arredonda pra cima).
function monthsToGoalSimple(target, current, monthly) {
  const faltam = target - current;
  if (faltam <= 0) return 0;
  if (!monthly || monthly <= 0) return Infinity;
  return Math.ceil(faltam / monthly);
}

// Meses pra atingir a meta com juros compostos (busca o menor n tal que current*(1+i)^n + FV(aporte) >= target).
function monthsToGoalWithInterest(target, current, monthly, monthlyRate) {
  if (target - current <= 0) return 0;
  if ((!monthly || monthly <= 0) && (!current || monthlyRate === 0)) return Infinity;
  for (let n = 1; n <= 1200; n++) {
    const acc = current * Math.pow(1 + monthlyRate, n) + futureValue(monthly, monthlyRate, n);
    if (acc >= target) return n;
  }
  return Infinity;
}

function formatMonths(n) {
  if (!isFinite(n)) return 'tempo indefinido';
  const anos = Math.floor(n / 12);
  const meses = n % 12;
  const partes = [];
  if (anos > 0) partes.push(anos === 1 ? '1 ano' : `${anos} anos`);
  if (meses > 0) partes.push(meses === 1 ? '1 mês' : `${meses} meses`);
  if (partes.length === 0) return 'menos de 1 mês';
  return partes.join(' e ');
}

module.exports = { futureValue, monthsToGoalSimple, monthsToGoalWithInterest, formatMonths };
```

- [ ] **Step 4: Rodar o teste pra ver passar**

Run: `node --test src/finance/projection.test.js`
Expected: PASS (7 testes).

- [ ] **Step 5: Rodar a suíte de finance inteira**

Run: `node --test src/finance/`
Expected: PASS (19 testes no total).

---

## Task 6: Service `financeiro-service.js` (CRUD/queries filtrados por collaborator_id)

**Files:**
- Create: `src/services/financeiro-service.js`

> Padrão seguido: `const supabase = require('../supabase/client')` (cliente service_role do projeto principal `cesnbnrynvxvgdhfmaua`, como em **`src/services/collaborator.js`**) + filtro manual por `collaborator_id` em TODA query. NÃO copiar `inventario-service.js` (usa `laReportClient` → outro projeto). `collaboratorId` é SEMPRE o 1º parâmetro.
>
> ⚠️ Nota local: `src/supabase/client.js` pode não existir no mirror local `_remote/` (só na VPS) — isso é esperado. `node --check` valida sintaxe sem resolver `require`, e os testes `node:test` só tocam os módulos puros (`finance/`), que não importam o service. O service só executa de fato na VPS.

- [ ] **Step 1: Implementar o service**

Criar `src/services/financeiro-service.js`:
```js
const supabase = require('../supabase/client');

// Helpers de janela do mes corrente (YYYY-MM-01 .. proximo mes).
function monthBounds(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 1)).toISOString().slice(0, 10);
  const monthYear = start.slice(0, 7); // 'YYYY-MM'
  return { start, end, monthYear };
}

// ---- Carteiras ----
async function createAccount(collaboratorId, { name, type = 'checking', icon, goal_monthly }) {
  const { data, error } = await supabase.from('pf_accounts')
    .insert({ collaborator_id: collaboratorId, name, type, icon, goal_monthly })
    .select().single();
  if (error) throw error;
  return data;
}
async function listAccounts(collaboratorId) {
  const { data, error } = await supabase.from('pf_accounts')
    .select('id, name, type, balance, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('name');
  if (error) throw error;
  return data || [];
}

// ---- Transacoes ----
async function insertTransaction(collaboratorId, { type, category, amount, description, transaction_date, account_id }) {
  const row = { collaborator_id: collaboratorId, type, category, amount, description: description || null, account_id: account_id || null };
  if (transaction_date) row.transaction_date = transaction_date;
  const { data, error } = await supabase.from('pf_transactions').insert(row).select().single();
  if (error) throw error;
  return data;
}
// Total gasto da categoria no mes corrente, EXCLUINDO uma transacao (pra calcular o "antes").
async function monthCategoryTotal(collaboratorId, category, { excludeId } = {}) {
  const { start, end } = monthBounds();
  let q = supabase.from('pf_transactions')
    .select('amount, id')
    .eq('collaborator_id', collaboratorId).eq('type', 'expense').eq('category', category)
    .gte('transaction_date', start).lt('transaction_date', end);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []).filter((r) => r.id !== excludeId).reduce((s, r) => s + Number(r.amount), 0);
}
async function querySummary(collaboratorId) {
  const { start, end } = monthBounds();
  const { data, error } = await supabase.from('pf_transactions')
    .select('type, category, amount')
    .eq('collaborator_id', collaboratorId).gte('transaction_date', start).lt('transaction_date', end);
  if (error) throw error;
  const rows = data || [];
  const receitas = rows.filter((r) => r.type === 'income').reduce((s, r) => s + Number(r.amount), 0);
  const despesas = rows.filter((r) => r.type === 'expense').reduce((s, r) => s + Number(r.amount), 0);
  const porCategoria = {};
  for (const r of rows) if (r.type === 'expense') porCategoria[r.category] = (porCategoria[r.category] || 0) + Number(r.amount);
  const top = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return { receitas, despesas, saldo: receitas - despesas, top };
}

// ---- Orcamento ----
async function setBudget(collaboratorId, { category, monthly_limit }) {
  const { monthYear } = monthBounds();
  const { data, error } = await supabase.from('pf_budgets')
    .upsert({ collaborator_id: collaboratorId, category, monthly_limit, month_year: monthYear },
            { onConflict: 'collaborator_id,category,month_year' })
    .select().single();
  if (error) throw error;
  return data;
}
async function getBudget(collaboratorId, category) {
  const { monthYear } = monthBounds();
  const { data, error } = await supabase.from('pf_budgets')
    .select('monthly_limit')
    .eq('collaborator_id', collaboratorId).eq('category', category).eq('month_year', monthYear)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.monthly_limit) : null;
}
async function queryBudget(collaboratorId) {
  const { monthYear } = monthBounds();
  const { data: budgets, error } = await supabase.from('pf_budgets')
    .select('category, monthly_limit').eq('collaborator_id', collaboratorId).eq('month_year', monthYear);
  if (error) throw error;
  const out = [];
  for (const b of budgets || []) {
    const gasto = await monthCategoryTotal(collaboratorId, b.category);
    out.push({ category: b.category, limit: Number(b.monthly_limit), spent: gasto });
  }
  return out;
}

// ---- Contas fixas (status derivado de last_paid_at, D6) ----
async function createBill(collaboratorId, { name, amount, due_day, category, type = 'expense', remind_days_before = 2 }) {
  const { data, error } = await supabase.from('pf_bills')
    .insert({ collaborator_id: collaboratorId, name, amount, due_day, category, type, remind_days_before })
    .select().single();
  if (error) throw error;
  return data;
}
// Fuzzy match por nome (ILIKE). Retorna array de candidatos.
async function findBills(collaboratorId, billName) {
  const { data, error } = await supabase.from('pf_bills')
    .select('id, name, amount, category, type')
    .eq('collaborator_id', collaboratorId).eq('is_active', true)
    .ilike('name', `%${billName}%`);
  if (error) throw error;
  return data || [];
}
// Marca paga: grava last_paid_at=hoje e registra a transacao correspondente.
async function payBill(collaboratorId, bill) {
  const today = new Date().toISOString().slice(0, 10);
  const { error: e1 } = await supabase.from('pf_bills')
    .update({ last_paid_at: today, status: 'paid' })
    .eq('id', bill.id).eq('collaborator_id', collaboratorId);
  if (e1) throw e1;
  await insertTransaction(collaboratorId, {
    type: bill.type, category: bill.category, amount: bill.amount, description: bill.name, transaction_date: today,
  });
  return { ...bill, last_paid_at: today };
}

// ---- Metas (contribuicao NAO vira transacao, D7) ----
async function createGoal(collaboratorId, { name, target_amount, monthly_contribution, deadline, icon }) {
  const { data, error } = await supabase.from('pf_goals')
    .insert({ collaborator_id: collaboratorId, name, target_amount, monthly_contribution, deadline, icon })
    .select().single();
  if (error) throw error;
  return data;
}
async function findGoal(collaboratorId, goalName) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).ilike('name', `%${goalName}%`);
  if (error) throw error;
  return data || [];
}
async function addToGoal(collaboratorId, goal, addAmount) {
  const novo = Number(goal.current_amount) + Number(addAmount);
  const { data, error } = await supabase.from('pf_goals')
    .update({ current_amount: novo, updated_at: new Date().toISOString() })
    .eq('id', goal.id).eq('collaborator_id', collaboratorId).select().single();
  if (error) throw error;
  return data;
}
async function listGoals(collaboratorId) {
  const { data, error } = await supabase.from('pf_goals')
    .select('id, name, target_amount, current_amount, monthly_contribution, deadline, icon')
    .eq('collaborator_id', collaboratorId).eq('is_active', true).order('created_at');
  if (error) throw error;
  return data || [];
}

module.exports = {
  monthBounds,
  createAccount, listAccounts,
  insertTransaction, monthCategoryTotal, querySummary,
  setBudget, getBudget, queryBudget,
  createBill, findBills, payBill,
  createGoal, findGoal, addToGoal, listGoals,
};
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check src/services/financeiro-service.js`
Expected: sem saída (exit 0).

---

## Task 7: Engine — parser `<<FINANCE_ACTION>>` + dispatcher de handlers

**Files:**
- Modify: `src/engine.js`

> Seguir o padrão de `parseOnboardingMarker` (engine.js:135) para parsing. **Segurança:** o handler usa `collaborator.id` (resolvido por `collaboratorService.findByPhone` em `processMessage`), e IGNORA qualquer `collaborator_id`/`account_id` que venha no params se não pertencer ao colaborador (o trigger BEFORE já barra account_id alheio; o service filtra por collaborator_id).

- [ ] **Step 1: Adicionar os imports no topo de `src/engine.js`**

Localizar o bloco de `require(...)` no topo e acrescentar:
```js
const financeService = require('./services/financeiro-service');
const { mapCategory, normalizeParams } = require('./finance/categorize');
const { crossedThreshold, buildBudgetAlert } = require('./finance/budget-alert');
const { monthsToGoalSimple, monthsToGoalWithInterest, formatMonths } = require('./finance/projection');
```

- [ ] **Step 2: Adicionar o parser do marker (perto dos outros `parse*Marker`)**

Acrescentar em `src/engine.js`:
```js
const FINANCE_ACTIONS = [
  'register_transaction', 'register_bill', 'pay_bill', 'create_goal',
  'update_goal', 'set_budget', 'query_summary', 'query_budget', 'query_goal', 'create_account',
];

function parseFinanceMarker(text) {
  if (!text) return null;
  const re = /<<FINANCE_ACTION>>\s*([\s\S]*?)\s*<<END>>/i;
  const m = text.match(re);
  if (!m) return null;
  const cleanText = text.replace(re, '').trim();
  let json;
  try {
    json = JSON.parse(m[1].trim());
  } catch (err) {
    logSchemaErr('FINANCE_ACTION', ['invalid_json: ' + err.message], m[1]);
    return { malformed: true, cleanText };
  }
  if (!json || !FINANCE_ACTIONS.includes(json.action)) {
    logSchemaErr('FINANCE_ACTION', ['action_invalida: ' + (json && json.action)], m[1]);
    return { malformed: true, cleanText };
  }
  return { action: json.action, params: json.params || {}, cleanText, malformed: false };
}
```

- [ ] **Step 3: Adicionar o dispatcher de handlers**

Acrescentar em `src/engine.js` (o `MONTH_TAXA` é a taxa mensal de referência usada na projeção; Fase B troca pela Selic viva):
```js
const MONTH_TAXA = 0.0083; // ~10,5%/ano (referencia; Fase B usa Selic viva)

// SEGURANCA: cid SEMPRE = collaborator.id (remetente resolvido server-side). Nunca params.collaborator_id.
async function handleFinanceAction(collaborator, action, params) {
  const cid = collaborator.id;
  const p = normalizeParams(params || {});

  switch (action) {
    case 'register_transaction': {
      if (!p.amount || p.amount <= 0) return '❓ Qual foi o valor?';
      const type = p.type || 'expense';
      const category = p.category || mapCategory(p.description || '');
      const account_id = p.account_id || null; // trigger BEFORE barra conta de outro dono
      const prev = type === 'expense' ? await financeService.monthCategoryTotal(cid, category) : 0;
      await financeService.insertTransaction(cid, { type, category, amount: p.amount, description: p.description, transaction_date: p.date, account_id });
      let reply = `✅ R$${p.amount} em ${category}.`;
      if (type === 'expense') {
        const novo = prev + Number(p.amount);
        const limit = await financeService.getBudget(cid, category);
        if (limit) {
          const pct = Math.round((novo / limit) * 100);
          reply += ` Total do mês: R$${novo}/R$${limit} (${pct}%)`;
          const cruzou = crossedThreshold(prev, novo, limit);
          if (cruzou) reply += `\n${buildBudgetAlert(category, novo, limit, cruzou)}`;
        }
      }
      return reply;
    }
    case 'register_bill': {
      const b = await financeService.createBill(cid, {
        name: params.name, amount: params.amount, due_day: params.due_day,
        category: params.category || mapCategory(params.name || ''),
        type: params.type || 'expense', remind_days_before: params.remind_days_before,
      });
      return `✅ Conta cadastrada: ${b.name} (R$${b.amount}, dia ${b.due_day}).`;
    }
    case 'pay_bill': {
      const cands = await financeService.findBills(cid, params.bill_name || params.name || '');
      if (cands.length === 0) return 'Não achei conta com esse nome.';
      if (cands.length > 1) return 'Achei mais de uma: ' + cands.map((c, i) => `${i + 1}) ${c.name}`).join(', ') + '. Qual delas?';
      const paid = await financeService.payBill(cid, cands[0]);
      return `✅ ${paid.name} marcada como paga (R$${paid.amount}).`;
    }
    case 'create_goal': {
      const g = await financeService.createGoal(cid, {
        name: params.name, target_amount: params.target_amount,
        monthly_contribution: params.monthly_contribution, deadline: params.deadline, icon: params.icon,
      });
      let reply = `${g.icon || '🎯'} Meta criada: ${g.name} (R$${g.target_amount}).`;
      if (g.monthly_contribution) {
        const ms = monthsToGoalSimple(g.target_amount, g.current_amount, g.monthly_contribution);
        const mj = monthsToGoalWithInterest(g.target_amount, g.current_amount, g.monthly_contribution, MONTH_TAXA);
        reply += `\n💰 Guardando R$${g.monthly_contribution}/mês, você chega em ${formatMonths(ms)}.`;
        reply += `\nInvestindo a ~10,5%/ano: ${formatMonths(mj)}. Bora!`;
      }
      return reply;
    }
    case 'update_goal': {
      const cands = await financeService.findGoal(cid, params.goal_name || params.name || '');
      if (cands.length === 0) return 'Não achei essa meta.';
      const g = await financeService.addToGoal(cid, cands[0], params.add_amount || 0);
      const pct = Math.round((g.current_amount / g.target_amount) * 100);
      return `✅ Guardou R$${params.add_amount} em ${g.name}. Progresso: ${pct}% (R$${g.current_amount}/R$${g.target_amount}).`;
    }
    case 'set_budget': {
      const b = await financeService.setBudget(cid, { category: params.category, monthly_limit: params.monthly_limit });
      return `✅ Orçamento de ${b.category}: R$${b.monthly_limit}/mês.`;
    }
    case 'create_account': {
      const a = await financeService.createAccount(cid, { name: params.name, type: params.type, icon: params.icon, goal_monthly: params.goal_monthly });
      return `✅ Carteira criada: ${a.icon || '🏦'} ${a.name}.`;
    }
    case 'query_summary': {
      const s = await financeService.querySummary(cid);
      const top = s.top.map(([c, v]) => `• ${c}: R$${v}`).join('\n');
      return `💰 Mês atual:\n📈 Receitas: R$${s.receitas}\n📉 Despesas: R$${s.despesas}\n💵 Saldo: ${s.saldo >= 0 ? '+' : ''}R$${s.saldo}` + (top ? `\n\nTop gastos:\n${top}` : '');
    }
    case 'query_budget': {
      const rows = await financeService.queryBudget(cid);
      if (rows.length === 0) return 'Você ainda não definiu orçamento por categoria.';
      const linhas = rows.map((r) => `${r.category}: ${Math.round((r.spent / r.limit) * 100)}% (R$${r.spent}/R$${r.limit})`).join('\n');
      return `📊 Orçamento:\n${linhas}`;
    }
    case 'query_goal': {
      const gs = await financeService.listGoals(cid);
      if (gs.length === 0) return 'Você ainda não tem metas. Bora criar uma?';
      const linhas = gs.map((g) => {
        const pct = Math.round((g.current_amount / g.target_amount) * 100);
        return `${g.icon || '🎯'} ${g.name}: ${pct}% (R$${g.current_amount}/R$${g.target_amount})`;
      }).join('\n');
      return `🎯 Suas metas:\n${linhas}`;
    }
    default:
      return null;
  }
}
```

- [ ] **Step 4: Wire no `processMessage` (após receber a resposta do LLM)** ⚠️ PONTO FRÁGIL

**Antes de colar nada:** abra `src/engine.js`, vá até `processMessage`, e ache a **variável real** que guarda o texto da resposta do LLM após `ai.chat(...)` e onde os outros `parse*Marker` operam. Pode ser `responseText`, `response.text`, ou outro nome. **NÃO assuma** — se o nome estiver errado, o marker nunca é processado e falha em silêncio (sem erro). Use o nome real no bloco abaixo (aqui escrito como `responseText`):
```js
const fin = parseFinanceMarker(responseText);
if (fin && !fin.malformed) {
  try {
    const finReply = await handleFinanceAction(collaborator, fin.action, fin.params);
    responseText = (fin.cleanText ? fin.cleanText + '\n' : '') + (finReply || '');
  } catch (err) {
    console.error('[FINANCE_ACTION] erro:', err.message);
    responseText = (fin.cleanText || '') + '\nDeu ruim ao registrar isso aqui — tenta de novo?';
  }
} else if (fin && fin.malformed) {
  responseText = fin.cleanText || responseText;
}
```
> Use o nome real da variável de texto da resposta no `processMessage` (ex. `responseText`/`response.text`) — ajuste se diferir. O `collaborator` já está no escopo (resolvido no início de `processMessage`).

- [ ] **Step 5: Validar sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída (exit 0).

- [ ] **Step 6: Verificar a garantia de segurança (handler nunca confia no id do marker)**

Confirmar que `handleFinanceAction` NUNCA lê `collaborator_id` do `params` — `cid` vem só de `collaborator.id`. Usar Grep no `src/engine.js`:
Padrão: `params.collaborator_id` ou `p.collaborator_id`
Expected: ZERO ocorrências dentro de `handleFinanceAction`. Se aparecer, é violação da spec §6.2 → remover e usar `cid` (= `collaborator.id`).

---

## Task 8: Skill `financeiro-pessoal.md`

**Files:**
- Create: `skills/financeiro-pessoal.md`

> Voz herda do SOUL.md (D2) — a skill NÃO redefine tom, só adiciona regras do domínio. Estrutura segue o molde de `skills/habitos-pessoais.md` (frontmatter + seções).

- [ ] **Step 1: Escrever a skill**

Criar `skills/financeiro-pessoal.md`:
```markdown
---
name: financeiro-pessoal
description: Skill para registrar e consultar finanças pessoais do colaborador pelo WhatsApp — gastos, receitas, contas a pagar/receber, metas, orçamento e carteiras. Use quando o colaborador falar de dinheiro, gasto, salário, conta, meta, poupança, orçamento, investimento ou Selic.
---

# Finanças Pessoais

## Quando ativar
Ative quando o colaborador mencionar: gastei, recebi, paguei, salário, comissão, conta, aluguel, iFood, mercado, uber, gasolina, farmácia, quanto gastei, como tá meu orçamento, meta, guardar dinheiro, poupança, caixinha, investir, Selic, juros — ou quando o dispatcher enviar `[RITUAL: financeiro_mensal]` / `[RITUAL: lembrete_conta]`.

## Regra de privacidade (inegociável)
Dado financeiro é 100% privado. NUNCA mencione finanças de um colaborador para outro, nem para o Alf, nem em relatório de time. Esses dados só aparecem pra própria pessoa.

## Como agir
A voz é a do TOM (ver SOUL.md): parceiro, humano, curto, sem jargão. Aqui valem ainda:
- **Pague-se primeiro:** antes de pagar conta, reforce a ideia de separar pro futuro/sonho.
- **Sugiro, nunca mando:** "já pensou em..." em vez de "você deveria".
- **Regra de ouro:** se a mensagem já tem tudo ("gastei R$45 no iFood"), registra e confirma SEM perguntar. Só pergunte o essencial faltante (o valor), uma coisa por vez.

## Como registrar uma ação
Para cada ação financeira, emita o marker `<<FINANCE_ACTION>>` com um JSON e feche com `<<END>>` (NUNCA `<</FINANCE_ACTION>>`):

\`\`\`
<<FINANCE_ACTION>>
{ "action": "register_transaction", "params": { "type": "expense", "category": "alimentacao", "amount": 45, "description": "iFood" } }
<<END>>
\`\`\`

Ações disponíveis (campo `action`):
- `register_transaction` — params: type (income|expense), category, amount, description, date(opcional), account_id(opcional)
- `register_bill` — params: name, amount, due_day, category, type, remind_days_before
- `pay_bill` — params: bill_name
- `create_goal` — params: name, target_amount, monthly_contribution, deadline, icon
- `update_goal` — params: goal_name, add_amount
- `set_budget` — params: category, monthly_limit
- `create_account` — params: name, type (checking|savings|wallet|investment), icon
- `query_summary` — sem params (resumo do mês)
- `query_budget` — sem params (barras de orçamento)
- `query_goal` — sem params (progresso das metas)

## Categorias válidas
Receitas: salario, comissao, extra.
Despesas: moradia, alimentacao, transporte, saude, educacao, lazer, outros.
Se não bater em nenhuma, use `outros`. O engine também infere a categoria pela descrição quando você não manda.

## NUNCA
- Não invente o valor. Se faltar, pergunte.
- Não escolha por qual pessoa é o dado — o sistema resolve isso pelo remetente.
- Não exponha dado financeiro de ninguém pra outra pessoa.
```

- [ ] **Step 2: Validar que o frontmatter e o marker estão corretos**

Conferir manualmente: o bloco do marker usa `<<FINANCE_ACTION>>` ... `<<END>>` (fecha com `<<END>>`, nunca `<</...>>`), e o frontmatter tem `name: financeiro-pessoal`.
Expected: ambos corretos.

---

## Task 9: Gatilho da skill no system prompt

**Files:**
- Modify: `src/prompts/system.js`

> Seguir o padrão de `pickSkill()` (system.js:773): regex de gatilho → `loadSkill(name)`. Posicionar o gatilho financeiro junto aos triggers por palavra-chave (depois de onboarding/recorrência, antes do fallback genérico).

- [ ] **Step 1: Adicionar o gatilho financeiro em `pickSkill()`**

Localizar `pickSkill(collab, lastUserMessage, recentHistory)` e adicionar, no bloco de triggers por palavra-chave:
```js
  // Financeiro pessoal
  const FINANCE_RE = /\b(gastei|recebi|paguei|sal[áa]rio|comiss[ãa]o|aluguel|ifood|mercado|uber|gasolina|farm[áa]cia|or[çc]amento|meta|guardar|poupan[çc]a|caixinha|investir|selic|juros|quanto\s+gastei|conta\s+(?:a\s+pagar|vencendo))\b/i;
  if (FINANCE_RE.test(String(lastUserMessage || ''))) {
    return { name: 'financeiro-pessoal', body: loadSkill('financeiro-pessoal') };
  }
```

- [ ] **Step 2: Validar sintaxe**

Run: `node --check src/prompts/system.js`
Expected: sem saída (exit 0).

- [ ] **Step 3: Confirmar que `loadSkill('financeiro-pessoal')` resolve o arquivo**

Run: `node -e "const {loadSkill}=require('./src/prompts/system.js'); console.log(loadSkill ? 'ok' : 'no-export')"`
> Se `loadSkill` não for exportado, basta confirmar que `skills/financeiro-pessoal.md` existe no mesmo diretório que as outras skills carregadas por `loadSkill` (mesma pasta de `skills/habitos-pessoais.md`).
Expected: a skill é encontrada (mesmo path das demais).

---

## Task 10: Smoke test ponta a ponta + re-rodar asserts de segurança

**Files:** nenhum (validação).

- [ ] **Step 1: Subir as mudanças pro TOM (deploy de teste)**

```bash
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp -r D:/la-organizer/_remote/src/finance tom:/opt/LA-Organizer/src/
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "pm2 restart tom"
```
Expected: pm2 restart OK.

- [ ] **Step 2: Smoke via WhatsApp (PRD §10, subset da Fase A)**

Mandar pro TOM, um por vez, e conferir a resposta:
- "gastei 45 no iFood" → ✅ registra expense alimentacao R$45 (+ total se houver orçamento).
- "recebi 2800 de salário" → ✅ registra income salario R$2.800.
- "quero comprar um carro de 20 mil em 2 anos guardando 500 por mês" → cria meta + projeção (meses simples e com juros).
- "guardei 500 pro carro" → atualiza meta, mostra progresso, e NÃO cria transação.
- "quanto gastei esse mês?" → resumo receitas/despesas/saldo + top categorias.
- "como tá meu orçamento?" → barras por categoria (ou aviso de que não há orçamento).
- "paguei a conta X" (após cadastrar uma) → marca paga + registra transação.

Expected: respostas coerentes; nenhuma menção a dado de outro colaborador.

- [ ] **Step 3: Verificar persistência e isolamento no banco**

`execute_sql` (use o id do colaborador de teste):
```sql
SELECT type, category, amount, description FROM pf_transactions
WHERE collaborator_id = 'COLLAB_A' ORDER BY created_at DESC LIMIT 5;
```
Expected: as transações do smoke aparecem; nenhuma de outro colaborador.

- [ ] **Step 4: Re-rodar os asserts de segurança (Task 2 Step 4)**

Rodar `scripts/pf-security-check.sql` de novo via `execute_sql`.
Expected: insert cross-owner rejeitado; saldos corretos. Confirma que a blindagem segue de pé após o código novo.

---

## Notas de fechamento

- **Commit:** não commitar manualmente — o Stop hook faz o bundle de `_remote/` no fim do turno.
- **Fora de escopo desta fase (vão pros planos B e C):** rituais cron (`financeiro_mensal`, `lembrete_conta`, `relatorio_financeiro_mensal`), briefing pessoal, skill `educacao-financeira` + Selic viva + simulador, e TODO o PWA (recharts, 5 telas, componentes, hook/service, navegação).
- **Dependência pra Fase B:** a constante `MONTH_TAXA` em `engine.js` deve ser substituída pelo serviço de Selic viva (D4) quando a Fase B chegar.
```
