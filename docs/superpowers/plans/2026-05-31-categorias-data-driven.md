# Categorias Data-Driven Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir as 10 categorias hardcoded por 43 data-driven (30 despesas + 13 receitas) com ícone/cor/keywords/tipo, fonte única (módulo no engine + tabela `pf_categories`), classificação type-aware e regra plataforma≠categoria.

**Architecture:** Um módulo `categories.data.js` é a fonte das 43 defaults no engine; `mapCategory`/`safeCategory`/`CAT_META` derivam dele. Migration cria/seed `pf_categories` (PWA lê via `useCategories`). `category` continua slug em texto; o CHECK restritivo sai, validação vira app-level type-aware.

**Tech Stack:** Node.js CommonJS (engine), Supabase Postgres, node:test, React+TS+Tailwind (PWA), deploy `scp tom:` + `pm2 restart` (engine) + auto-deploy hook (web).

**Base já em prod:** resolveSource, is_primary, finance_source pending, safeCategory (será refatorado), card_purchase pending. Único CHECK de categoria de finanças = `pf_transactions_category_check` (pf_budgets/pf_bills NÃO têm).

---

## File Structure

- `src/finance/categories.data.js` *(novo)* — as 43 defaults + helpers (fonte única do engine).
- `src/finance/categories.data.test.js` *(novo)* — testes do módulo.
- `src/finance/categorize.js` *(modifica)* — `mapCategory(text, type)` type-aware do módulo.
- `src/finance/categorize.test.js` *(novo)* — testes do mapCategory novo.
- `src/engine.js` *(modifica)* — `safeCategory`/`PF_VALID_CATEGORIES` do módulo + type nos callers.
- `src/services/finance-format.js` *(modifica)* — `CAT_META` derivado do módulo.
- `skills/financeiro-pessoal.md` *(modifica)* — 43 categorias por tipo + regra plataforma≠categoria.
- Migration Supabase — `pf_categories` (criar+RLS+seed), `UPDATE extra→freelance`, drop CHECK.
- `web/src/lib/financeiro.ts` *(modifica)* — `PfCategory = string`.
- `web/src/lib/categorias.ts` *(novo)* — tipo `PfCategoryRow` + `listCategories()`.
- `web/src/hooks/useFinanceiro.ts` *(modifica)* — hook `useCategories()`.
- `web/src/screens/financeiro/components/TransactionSheet.tsx` *(modifica)* — picker filtra por tipo.
- `web/src/screens/financeiro/components/BillSheet.tsx` *(modifica)* — picker da tabela.
- `web/src/screens/financeiro/FinanceiroPage.tsx` *(modifica)* — emoji/label da tabela.

---

## Task C1: Módulo de dados das 43 categorias (TDD)

**Files:**
- Create: `src/finance/categories.data.js`
- Test: `src/finance/categories.data.test.js`

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/finance/categories.data.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { CATEGORIES, BY_SLUG, validSlugs, fallbackSlug } = require('./categories.data');

test('30 despesas + 13 receitas = 43', () => {
  assert.strictEqual(CATEGORIES.filter((c) => c.type === 'expense').length, 30);
  assert.strictEqual(CATEGORIES.filter((c) => c.type === 'income').length, 13);
});
test('slugs únicos', () => {
  assert.strictEqual(new Set(CATEGORIES.map((c) => c.slug)).size, 43);
});
test('todas têm label, emoji, color, type, keywords[]', () => {
  for (const c of CATEGORIES) {
    assert.ok(c.label && c.emoji && c.color && c.type, `incompleta: ${c.slug}`);
    assert.ok(Array.isArray(c.keywords), `keywords não-array: ${c.slug}`);
  }
});
test('fallbacks por tipo existem', () => {
  assert.strictEqual(fallbackSlug('expense'), 'outros');
  assert.strictEqual(fallbackSlug('income'), 'outras_receitas');
  assert.ok(BY_SLUG.outros && BY_SLUG.outras_receitas);
});
test('validSlugs filtra por tipo', () => {
  assert.ok(validSlugs('expense').has('beleza'));
  assert.ok(!validSlugs('expense').has('salario'));
  assert.ok(validSlugs('income').has('comissao'));
});
test('não existe categoria delivery (plataforma≠categoria)', () => {
  assert.ok(!BY_SLUG.delivery);
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `node --test src/finance/categories.data.test.js`
Expected: FAIL ("Cannot find module './categories.data'").

- [ ] **Step 3: Implementar o módulo**

```js
// src/finance/categories.data.js
// FONTE ÚNICA das categorias default do financeiro (engine). A migration
// pf_categories é seedada a partir DESTA lista. Plataforma (iFood/99/Uber) NÃO é
// categoria — o keyword da plataforma aponta pro uso dominante (ifood→alimentacao).

const CATEGORIES = [
  // ---- Despesas (30) ----
  { slug: 'alimentacao', label: 'Alimentação', emoji: '🍔', color: '#F59E0B', type: 'expense', keywords: ['ifood', 'rappi', 'uber eats', 'ubereats', 'comida', 'almoço', 'almoco', 'lanche', 'padaria', 'café', 'cafe'] },
  { slug: 'assinaturas', label: 'Assinaturas', emoji: '🔁', color: '#8B5CF6', type: 'expense', keywords: ['netflix', 'spotify', 'disney', 'hbo', 'prime', 'assinatura', 'mensalidade streaming'] },
  { slug: 'beleza', label: 'Beleza', emoji: '💅', color: '#EC4899', type: 'expense', keywords: ['salão', 'salao', 'cabelo', 'manicure', 'barbeiro', 'estética', 'estetica', 'maquiagem'] },
  { slug: 'combustivel', label: 'Combustível', emoji: '⛽', color: '#F97316', type: 'expense', keywords: ['gasolina', 'etanol', 'álcool', 'alcool', 'diesel', 'posto', 'combustível', 'combustivel'] },
  { slug: 'compras', label: 'Compras', emoji: '🛍️', color: '#FB923C', type: 'expense', keywords: ['loja', 'shopping', 'compra'] },
  { slug: 'contas_consumo', label: 'Contas de Consumo', emoji: '💡', color: '#EAB308', type: 'expense', keywords: ['luz', 'água', 'agua', 'gás', 'gas', 'energia', 'saneamento', 'conta de luz', 'internet', 'telefone'] },
  { slug: 'educacao', label: 'Educação', emoji: '📚', color: '#3B82F6', type: 'expense', keywords: ['curso', 'livro', 'escola', 'faculdade', 'material escolar'] },
  { slug: 'eletrodomesticos', label: 'Eletrodomésticos', emoji: '🔌', color: '#6366F1', type: 'expense', keywords: ['geladeira', 'fogão', 'fogao', 'microondas', 'máquina', 'maquina', 'eletrodoméstico', 'eletrodomestico'] },
  { slug: 'emprestimo', label: 'Empréstimo', emoji: '💸', color: '#EF4444', type: 'expense', keywords: ['empréstimo', 'emprestimo', 'parcela empréstimo'] },
  { slug: 'esportes', label: 'Esportes', emoji: '🏋️', color: '#22C55E', type: 'expense', keywords: ['academia', 'gym', 'esporte', 'personal', 'crossfit', 'futebol', 'natação', 'natacao'] },
  { slug: 'estacionamento', label: 'Estacionamento', emoji: '🅿️', color: '#0EA5E9', type: 'expense', keywords: ['estacionamento', 'zona azul', 'parquímetro', 'parquimetro'] },
  { slug: 'farmacia', label: 'Farmácia', emoji: '💊', color: '#F43F5E', type: 'expense', keywords: ['farmácia', 'farmacia', 'remédio', 'remedio', 'drogaria'] },
  { slug: 'filhos', label: 'Filhos', emoji: '👶', color: '#F472B6', type: 'expense', keywords: ['filho', 'criança', 'crianca', 'fralda', 'brinquedo', 'escola filho'] },
  { slug: 'financiamento', label: 'Financiamento', emoji: '🏦', color: '#7C3AED', type: 'expense', keywords: ['financiamento', 'prestação', 'prestacao', 'parcela financiamento'] },
  { slug: 'impostos', label: 'Impostos', emoji: '🧾', color: '#6B7280', type: 'expense', keywords: ['ipva', 'iptu', 'imposto', 'darf', 'taxa'] },
  { slug: 'lazer', label: 'Lazer', emoji: '🎬', color: '#D946EF', type: 'expense', keywords: ['cinema', 'teatro', 'show', 'bar', 'jogo', 'parque', 'lazer'] },
  { slug: 'mercado', label: 'Mercado', emoji: '🛒', color: '#16A34A', type: 'expense', keywords: ['mercado', 'supermercado', 'hortifruti', 'feira', 'atacadão', 'atacadao'] },
  { slug: 'moradia', label: 'Moradia', emoji: '🏠', color: '#8B5CF6', type: 'expense', keywords: ['aluguel', 'condomínio', 'condominio', 'moradia'] },
  { slug: 'outros', label: 'Outros', emoji: '📦', color: '#9CA3AF', type: 'expense', keywords: [] },
  { slug: 'pets', label: 'Pets', emoji: '🐾', color: '#A16207', type: 'expense', keywords: ['pet', 'ração', 'racao', 'veterinário', 'veterinario', 'petshop', 'cachorro', 'gato'] },
  { slug: 'presentes', label: 'Presentes', emoji: '🎁', color: '#F472B6', type: 'expense', keywords: ['presente', 'gift', 'lembrança', 'lembranca'] },
  { slug: 'reparos_manutencoes', label: 'Reparos e Manutenções', emoji: '🔧', color: '#78716C', type: 'expense', keywords: ['reparo', 'conserto', 'manutenção', 'manutencao', 'encanador', 'eletricista', 'pintura'] },
  { slug: 'restaurante', label: 'Restaurante', emoji: '🍽️', color: '#FBBF24', type: 'expense', keywords: ['restaurante', 'jantar', 'churrascaria', 'pizzaria', 'lanchonete'] },
  { slug: 'saude', label: 'Saúde', emoji: '🏥', color: '#EF4444', type: 'expense', keywords: ['médico', 'medico', 'dentista', 'consulta', 'plano de saúde', 'plano saude', 'exame', 'hospital'] },
  { slug: 'seguros', label: 'Seguros', emoji: '🛡️', color: '#0EA5E9', type: 'expense', keywords: ['seguro', 'apólice', 'apolice', 'seguro auto', 'seguro vida'] },
  { slug: 'tecnologia', label: 'Tecnologia', emoji: '💻', color: '#6366F1', type: 'expense', keywords: ['notebook', 'celular', 'computador', 'software', 'gadget', 'eletrônico', 'eletronico'] },
  { slug: 'transferencia_contas', label: 'Transferência entre Contas', emoji: '🔄', color: '#64748B', type: 'expense', keywords: [] },
  { slug: 'transporte', label: 'Transporte', emoji: '🚗', color: '#3B82F6', type: 'expense', keywords: ['uber', '99', 'ônibus', 'onibus', 'metrô', 'metro', 'táxi', 'taxi', 'passagem'] },
  { slug: 'vestuario', label: 'Vestuário', emoji: '👕', color: '#EC4899', type: 'expense', keywords: ['roupa', 'sapato', 'tênis', 'tenis', 'vestuário', 'vestuario'] },
  { slug: 'viagens', label: 'Viagens', emoji: '✈️', color: '#06B6D4', type: 'expense', keywords: ['viagem', 'hotel', 'passagem aérea', 'passagem aerea', 'airbnb', 'hospedagem'] },
  // ---- Receitas (13) ----
  { slug: 'salario', label: 'Salário', emoji: '💼', color: '#22C55E', type: 'income', keywords: ['salário', 'salario', 'pagamento la', 'holerite'] },
  { slug: 'comissao', label: 'Comissão', emoji: '💰', color: '#16A34A', type: 'income', keywords: ['comissão', 'comissao', 'venda loja', 'venda'] },
  { slug: 'decimo_terceiro', label: '13º Salário', emoji: '🎄', color: '#15803D', type: 'income', keywords: ['13º', 'décimo terceiro', 'decimo terceiro', '13 salário'] },
  { slug: 'aluguel_recebido', label: 'Aluguel', emoji: '🏠', color: '#22C55E', type: 'income', keywords: ['aluguel recebido', 'recebi aluguel', 'renda aluguel'] },
  { slug: 'aposentadoria', label: 'Aposentadoria', emoji: '👴', color: '#16A34A', type: 'income', keywords: ['aposentadoria', 'inss', 'previdência', 'previdencia'] },
  { slug: 'bonus', label: 'Bônus', emoji: '⭐', color: '#22C55E', type: 'income', keywords: ['bônus', 'bonus', 'prêmio', 'premio', 'bonificação'] },
  { slug: 'ferias', label: 'Férias', emoji: '🏖️', color: '#22C55E', type: 'income', keywords: ['férias', 'ferias', 'adicional férias'] },
  { slug: 'freelance', label: 'Freelance', emoji: '🧑‍💻', color: '#16A34A', type: 'income', keywords: ['freelance', 'freela', 'bico', 'projeto extra', 'renda extra', 'extra'] },
  { slug: 'investimentos', label: 'Investimentos', emoji: '📈', color: '#22C55E', type: 'income', keywords: ['investimento', 'dividendo', 'rendimento', 'juros', 'cdb', 'tesouro', 'ações', 'acoes'] },
  { slug: 'outras_receitas', label: 'Outras Receitas', emoji: '💵', color: '#9CA3AF', type: 'income', keywords: [] },
  { slug: 'pensao', label: 'Pensão', emoji: '🤝', color: '#16A34A', type: 'income', keywords: ['pensão', 'pensao', 'pensão alimentícia'] },
  { slug: 'presente_recebido', label: 'Presente', emoji: '🎁', color: '#22C55E', type: 'income', keywords: ['presente recebido', 'ganhei', 'recebi presente'] },
  { slug: 'restituicao_ir', label: 'Restituição IR', emoji: '🧾', color: '#16A34A', type: 'income', keywords: ['restituição', 'restituicao', 'restituição ir'] },
];

const BY_SLUG = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c]));

function validSlugs(type) {
  return new Set(CATEGORIES.filter((c) => !type || c.type === type).map((c) => c.slug));
}
function fallbackSlug(type) {
  return type === 'income' ? 'outras_receitas' : 'outros';
}

module.exports = { CATEGORIES, BY_SLUG, validSlugs, fallbackSlug };
```

- [ ] **Step 4: Rodar — deve passar**

Run: `node --test src/finance/categories.data.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5: Syntax check**

Run: `node --check src/finance/categories.data.js`
Expected: sem erro.

---

## Task C2: `categorize.js` — mapCategory type-aware do módulo (TDD)

**Files:**
- Modify: `src/finance/categorize.js`
- Create: `src/finance/categorize.test.js`

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/finance/categorize.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { mapCategory } = require('./categorize');

test('plataforma→uso dominante: ifood→alimentacao (não delivery)', () => {
  assert.strictEqual(mapCategory('gastei no ifood', 'expense'), 'alimentacao');
});
test('uber→transporte', () => {
  assert.strictEqual(mapCategory('uber pro trabalho', 'expense'), 'transporte');
});
test('salão→beleza, posto→combustivel, mercado→mercado', () => {
  assert.strictEqual(mapCategory('cortei o cabelo no salão', 'expense'), 'beleza');
  assert.strictEqual(mapCategory('abasteci no posto', 'expense'), 'combustivel');
  assert.strictEqual(mapCategory('compras no supermercado', 'expense'), 'mercado');
});
test('type-aware: aluguel income vs expense', () => {
  assert.strictEqual(mapCategory('recebi aluguel', 'income'), 'aluguel_recebido');
  assert.strictEqual(mapCategory('paguei o aluguel', 'expense'), 'moradia');
});
test('comissão (income)', () => {
  assert.strictEqual(mapCategory('comissão de venda loja', 'income'), 'comissao');
});
test('fallback por tipo: desconhecido expense→outros, income→outras_receitas', () => {
  assert.strictEqual(mapCategory('xyz nada a ver', 'expense'), 'outros');
  assert.strictEqual(mapCategory('xyz nada a ver', 'income'), 'outras_receitas');
});
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `node --test src/finance/categorize.test.js`
Expected: FAIL (mapCategory antigo ignora type / não tem categorias novas).

- [ ] **Step 3: Reescrever `categorize.js`**

```js
// Mapeamento de categoria por palavra-chave (type-aware) + normalizer de aliases.
// Keywords e categorias vêm do módulo único categories.data.js. Puro, sem I/O.
const { CATEGORIES, fallbackSlug } = require('./categories.data');

// mapCategory(text, type): casa keyword DENTRO do tipo (income/expense). Sem type,
// considera todas. Fallback por tipo (outros / outras_receitas).
function mapCategory(text, type) {
  const t = String(text || '').toLowerCase();
  for (const c of CATEGORIES) {
    if (type && c.type !== type) continue;
    if (c.keywords.some((w) => t.includes(w))) return c.slug;
  }
  return fallbackSlug(type);
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

module.exports = { mapCategory, normalizeParams };
```

> Removido o `CATEGORY_KEYWORDS` exportado (vinha hardcoded). Conferir que nada o importa: `grep -rn "CATEGORY_KEYWORDS" src/ web/src/` deve voltar vazio.

- [ ] **Step 4: Rodar — deve passar + conferir órfão**

Run: `node --test src/finance/categorize.test.js && grep -rn "CATEGORY_KEYWORDS" src/`
Expected: testes PASS; grep sem matches.

---

## Task C3: `engine.js` — safeCategory type-aware do módulo

**Files:**
- Modify: `src/engine.js` (helper `safeCategory`/`PF_VALID_CATEGORIES` ~5916; callers em register_transaction e card_purchase)

- [ ] **Step 1: Substituir o bloco PF_VALID_CATEGORIES + safeCategory**

Trocar o bloco atual (a const `PF_VALID_CATEGORIES` + função `safeCategory`) por:

```js
// Categorias válidas vêm do módulo único (categories.data.js). safeCategory é
// type-aware: slug inválido → tenta mapCategory(desc, type) → fallback por tipo
// (outros / outras_receitas). Garante enum válido no banco (sem CHECK).
const { validSlugs: pfValidSlugs, fallbackSlug: pfFallbackSlug } = require('./finance/categories.data');
function safeCategory(cat, description, type) {
  const c = String(cat || '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  if (pfValidSlugs(type).has(c)) return c;
  const mapped = mapCategory(description || '', type);
  return pfValidSlugs(type).has(mapped) ? mapped : pfFallbackSlug(type);
}
```

- [ ] **Step 2: Passar `type` nos callers de safeCategory/mapCategory**

No case `register_transaction`, a linha do category:
```js
      const category = safeCategory(p.category, p.description, type);
```
(`type` já está em escopo: `const type = p.type || 'expense';`)

No case `card_purchase` (compra é sempre despesa):
```js
      const category = safeCategory(params.category, params.description, 'expense');
```

No helper `recordCardPurchase`, a linha `const cat = safeCategory(category, description);`:
```js
  const cat = safeCategory(category, description, 'expense');
```

- [ ] **Step 3: Syntax check**

Run: `node --check src/engine.js`
Expected: sem erro.

---

## Task C4: `finance-format.js` — CAT_META derivado do módulo

**Files:**
- Modify: `src/services/finance-format.js` (const `CAT_META` ~61)

- [ ] **Step 1: Substituir o objeto CAT_META estático**

Trocar a const `CAT_META = { ... }` (10 entradas) por uma derivada do módulo:

```js
const { CATEGORIES: PF_CATEGORIES } = require('../finance/categories.data');
// CAT_META: slug → { emoji, label } pra TODAS as 43 (era 10 hardcoded).
const CAT_META = Object.fromEntries(
  PF_CATEGORIES.map((c) => [c.slug, { emoji: c.emoji, label: c.label }])
);
```

- [ ] **Step 2: Syntax check + suíte de format**

Run: `node --check src/services/finance-format.js && node --test src/services/finance-format.test.js`
Expected: sem erro; testes PASS (CAT_META[slug] resolve pros 43).

---

## Task C5: Skill — 43 categorias por tipo + plataforma≠categoria

**Files:**
- Modify: `skills/financeiro-pessoal.md` (seção `## Categorias válidas` ~68)

- [ ] **Step 1: Reescrever a seção de categorias**

Substituir a seção `## Categorias válidas` por:

```markdown
## Categorias válidas (use o slug exato; NUNCA invente fora desta lista)

**Despesas:** alimentacao, assinaturas, beleza, combustivel, compras, contas_consumo, educacao, eletrodomesticos, emprestimo, esportes, estacionamento, farmacia, filhos, financiamento, impostos, lazer, mercado, moradia, outros, pets, presentes, reparos_manutencoes, restaurante, saude, seguros, tecnologia, transferencia_contas, transporte, vestuario, viagens.

**Receitas:** salario, comissao, decimo_terceiro, aluguel_recebido, aposentadoria, bonus, ferias, freelance, investimentos, outras_receitas, pensao, presente_recebido, restituicao_ir.

🚨 **Plataforma ≠ categoria.** Classifique pela NATUREZA do gasto, não pelo app:
- iFood / Rappi → **alimentacao** por padrão. "remédio no iFood" → **farmacia**; "mercado no iFood" → **mercado**.
- Uber / 99 → **transporte** por padrão (99 é ambíguo — leia o conteúdo).
- Use **outros**/**outras_receitas** só em último caso. O objetivo é granularidade — evite jogar em Outros.
```

- [ ] **Step 2: Conferir que não sobrou a lista antiga de 10**

Run: `grep -n "Categorias válidas" skills/financeiro-pessoal.md`
Expected: 1 match (a seção nova).

---

## Task C6: Migration — `pf_categories` + seed + extra→freelance + drop CHECK

**Files:** Supabase (apply_migration + execute_sql).

- [ ] **Step 1: Criar tabela + RLS + índice**

Via `apply_migration` (name `pf_categories_create`):

```sql
CREATE TABLE IF NOT EXISTS pf_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  label text NOT NULL,
  emoji text NOT NULL,
  color text NOT NULL,
  type text NOT NULL CHECK (type IN ('expense','income')),
  keywords text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  collaborator_id uuid REFERENCES collaborators(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS pf_categories_slug_scope
  ON pf_categories (COALESCE(collaborator_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
ALTER TABLE pf_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY pf_categories_read ON pf_categories FOR SELECT
  USING (collaborator_id IS NULL OR collaborator_id = current_collab_id());
CREATE POLICY pf_categories_write ON pf_categories FOR ALL
  USING (collaborator_id = current_collab_id())
  WITH CHECK (collaborator_id = current_collab_id());
```

- [ ] **Step 2: Seed as 43 defaults**

Via `apply_migration` (name `pf_categories_seed`). Gerar os INSERTs a partir de `categories.data.js` (mesma ordem = sort_order). Exemplo das 2 primeiras linhas (repetir pras 43, `is_default=true`, `collaborator_id=null`):

```sql
INSERT INTO pf_categories (slug,label,emoji,color,type,keywords,is_default,sort_order) VALUES
('alimentacao','Alimentação','🍔','#F59E0B','expense', ARRAY['ifood','rappi','uber eats','ubereats','comida','almoço','almoco','lanche','padaria','café','cafe'], true, 1),
('assinaturas','Assinaturas','🔁','#8B5CF6','expense', ARRAY['netflix','spotify','disney','hbo','prime','assinatura','mensalidade streaming'], true, 2)
-- ... (as 41 restantes, na ordem do módulo; despesas depois receitas)
ON CONFLICT DO NOTHING;
```

> Autoria: copiar slug/label/emoji/color/type/keywords de `categories.data.js`. sort_order = índice+1.

- [ ] **Step 3: Migrar dado + dropar CHECK**

Via `execute_sql`:

```sql
UPDATE pf_transactions SET category='freelance' WHERE category='extra';
ALTER TABLE pf_transactions DROP CONSTRAINT IF EXISTS pf_transactions_category_check;
```

- [ ] **Step 4: Verificar**

Via `execute_sql`:

```sql
SELECT (SELECT count(*) FROM pf_categories) AS cats,
       (SELECT count(*) FROM pf_transactions WHERE category='extra') AS extras_restantes;
```
Expected: cats=43, extras_restantes=0.

---

## Task C7: PWA `lib/financeiro.ts` — PfCategory vira slug (string)

**Files:**
- Modify: `web/src/lib/financeiro.ts` (`export type PfCategory` ~8-15)

- [ ] **Step 1: Trocar a union fechada por string (slug)**

```ts
// Categoria = slug data-driven (pf_categories). Era union fechada de 10.
export type PfCategory = string;
```

> `PfTransaction.category` e `PfBill.category` continuam `PfCategory` (agora string). Os usos como chave de objeto seguem válidos.

- [ ] **Step 2: TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: sem erro (string é mais permissivo que a union).

---

## Task C8: PWA — `useCategories` + pickers por tipo

**Files:**
- Create: `web/src/lib/categorias.ts`
- Modify: `web/src/hooks/useFinanceiro.ts` (novo `useCategories`)
- Modify: `web/src/screens/financeiro/components/TransactionSheet.tsx`
- Modify: `web/src/screens/financeiro/components/BillSheet.tsx`
- Modify: `web/src/screens/financeiro/FinanceiroPage.tsx`

- [ ] **Step 1: `lib/categorias.ts` — tipo + fetch**

```ts
import { supabase } from './supabase';

export interface PfCategoryRow {
  id: string; slug: string; label: string; emoji: string; color: string;
  type: 'expense' | 'income'; sort_order: number;
}

export async function listCategories(): Promise<PfCategoryRow[]> {
  const { data, error } = await supabase
    .from('pf_categories')
    .select('id, slug, label, emoji, color, type, sort_order')
    .eq('is_active', true)
    .order('type').order('sort_order');
  if (error) throw error;
  return (data as PfCategoryRow[]) ?? [];
}
```

- [ ] **Step 2: Hook `useCategories` (cacheado)**

Em `web/src/hooks/useFinanceiro.ts`, adicionar (importar `listCategories` de `../lib/categorias`):

```ts
import { listCategories } from '../lib/categorias';

export function useCategories() {
  return useQuery({
    queryKey: ['pf_categories'],
    queryFn: listCategories,
    staleTime: 1000 * 60 * 30, // defaults raramente mudam
  });
}
```

- [ ] **Step 3: Pickers filtram por tipo**

Em `TransactionSheet.tsx` e `BillSheet.tsx`: ler `const { data: cats } = useCategories();` e montar as opções do seletor de categoria a partir de `cats` filtrado pelo `type` do form (despesa → `type==='expense'`, receita → `type==='income'`), exibindo `${emoji} ${label}` e gravando `slug`.

> Ler o JSX atual de cada sheet primeiro; substituir a lista estática de categorias (que hoje referencia os 10 slugs) pelo map de `cats` filtrado. Se o seletor usa `<CustomSelect>`, montar `options={cats.filter(c => c.type === formType).map(c => ({ value: c.slug, label: \`${c.emoji} ${c.label}\` }))}`.

- [ ] **Step 4: `FinanceiroPage.tsx` — emoji/label da tabela**

Substituir o `CAT_EMOJI` estático e os labels por lookup do `useCategories()`:
```tsx
const { data: cats } = useCategories();
const catBySlug = useMemo(() => Object.fromEntries((cats ?? []).map((c) => [c.slug, c])), [cats]);
// uso: catBySlug[t.category]?.emoji ?? '📦' ; catBySlug[t.category]?.label ?? t.category
```

- [ ] **Step 5: TypeScript + build**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: sem erros; build OK.

---

## Task C9: Deploy + smoke

**Files:** deploy (scp + pm2). Web via auto-deploy hook.

- [ ] **Step 1: SCP engine + skill + restart**

```bash
scp D:/la-organizer/_remote/src/finance/categories.data.js tom:/opt/LA-Organizer/src/finance/categories.data.js
scp D:/la-organizer/_remote/src/finance/categorize.js tom:/opt/LA-Organizer/src/finance/categorize.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/services/finance-format.js tom:/opt/LA-Organizer/src/services/finance-format.js
scp D:/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "pm2 restart tom && sleep 2 && pm2 logs tom --lines 4 --nostream | grep -iE 'pronto|error'"
```
Expected: TOM online, sem stacktrace.

- [ ] **Step 2: Smoke WhatsApp (Alf)**

1. "gastei 40 no ifood" → categoria **alimentacao** (não delivery).
2. "comprei remédio no ifood" → **farmacia** (conteúdo sobrepõe).
3. "cortei o cabelo, 50" → **beleza**.
4. "abasteci 200 no posto" → **combustivel**.
5. "recebi comissão 800 da loja" → **comissao** (receita).
6. Foto de salão (OCR) → **beleza**, não mais saude.

- [ ] **Step 3: Verificar categorias no banco**

Via `execute_sql`:
```sql
SELECT DISTINCT category FROM pf_transactions
WHERE collaborator_id='0576f4b6-183d-4cf1-980e-5c8d5da0177f'
  AND created_at > now() - interval '30 minutes'
  AND category NOT IN (SELECT slug FROM pf_categories);
```
Expected: 0 linhas (toda categoria gravada existe na tabela).

- [ ] **Step 4: PWA — picker por tipo**

No PWA (após Vercel), abrir o sheet de nova transação: despesa mostra 30 categorias, receita mostra 13, com emoji+label. Saldo/gráfico usam os labels novos.

---

## Notas de execução
- **Coordenação:** avisar o chat da fonte — o `pf_transactions_category_check` foi dropado e o `safeCategory` (que ele tinha visto recém-adicionado) foi refatorado pro módulo + virou type-aware. Nenhum outro CHECK de categoria de finanças existe (pf_budgets/pf_bills não têm).
- **Fonte única:** `categories.data.js` é a verdade do engine; a tabela `pf_categories` é seedada dela. Pra adicionar categoria no futuro: edita o módulo + 1 INSERT no seed (v2 traz CRUD).
- **Sem FK em pf_transactions.category:** validação app-level (safeCategory no engine, picker no PWA). Mantém flexibilidade pro custom (v2).
