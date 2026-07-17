# Categorização de fatura de cartão — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** O TOM entrega a fatura já classificada, pergunta só o que não sabe (agrupado por loja), aprende com a correção da pessoa e nunca pergunta a mesma loja duas vezes.

**Architecture:** Cascata pura de categoria (`aprendido > lista curada > palpite do Gemini > outros`) num módulo novo sem I/O. Memória por pessoa numa tabela nova (`pf_category_memory`). O Gemini ganha um campo `categoria` no passe que já lê o PDF. O engine liga os fios nos Intercepts A (abre a intent) e B (resposta). A prévia é **aditiva** — a lista item a item não muda; ganha um bloco de perguntas no fim.

**Tech Stack:** Node puro (`node --test`), Supabase (migration + RLS `current_collab_id()`), Gemini (`generativelanguage.googleapis.com/v1beta`, `gemini-3.1-flash-lite`).

**Spec:** `docs/superpowers/specs/2026-07-17-categorizacao-fatura-design.md`

## Global Constraints

- **Precedência absoluta:** `learned > rules > gemini > outros`. O LLM só preenche o vazio; nunca sobrescreve verdade conhecida.
- **Aprende só na CORREÇÃO**, nunca no "sim". O "sim" é aceite do lote, não endosso item a item.
- **Slug do LLM validado** contra `pfValidSlugs('expense')` + `extraSlugs` do usuário. Slug inválido → descartado → `outros`.
- **Ordenação dos desconhecidos:** `count DESC, total DESC`. NUNCA por valor só (esconderia o ConectCar 10×). Teto: top 3.
- **A lista da prévia NÃO muda.** `buildInvoicePreview` ganha param opcional; ausente → byte a byte igual a hoje.
- **Fail-safe:** Gemini falha / memória indisponível → cai no comportamento de hoje. Nunca pior.
- **Zero-regressão:** suíte `finance/` verde antes e depois. Baseline: **1780 pass / 5 fail** (as 5 são pré-existentes e fora do financeiro).
- **Deploy:** `scp` do `engine.js` é bloqueado pelo classificador → **pedir OK ao Alf**. `.deploy-hold` de OUTRO chat está no ar → **NÃO remover**; commit cirúrgico só dos meus arquivos.
- **collaborator_id da Rose (teste real):** `8bfb18b6-3c2e-4579-b4a9-06409d7e84c4`. Projeto Supabase TOM: `cesnbnrynvxvgdhfmaua`.

---

## Task 0: Baseline verde + cópia fresca da VPS

**Files:** nenhum (verificação).

- [ ] **Step 1: Baseline da suíte na VPS**

Run: `ssh tom "cd /opt/LA-Organizer && node --test src/**/*.test.js 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: `# pass 1780`, `# fail 5`. Anotar os 5 `not ok` (devem ser system-loadout, health-check, quiet-gate, group-chat-tasks, pending-intents-detect — nenhum no financeiro).

- [ ] **Step 2: Cópia FRESCA dos arquivos que vou tocar**

Run:
```bash
cd /c/Users/Texeira/AppData/Local/Temp/claude/D--la-organizer/0c73b0bf-b3e4-406e-8d3c-9a2987188d22/scratchpad
mkdir -p cat && cd cat
scp tom:/opt/LA-Organizer/src/finance/merchant-category.js .
scp tom:/opt/LA-Organizer/src/finance/categories.data.js .
scp tom:/opt/LA-Organizer/src/finance/invoice-import.js .
scp tom:/opt/LA-Organizer/src/services/gemini.js .
scp tom:/opt/LA-Organizer/src/engine.js .
md5sum engine.js && ssh tom "md5sum /opt/LA-Organizer/src/engine.js"
```
Expected: md5 local == VPS (base limpa pra editar).

- [ ] **Step 3: Extrair a fixture real (os "outros" da Rose)**

Run (via MCP `execute_sql`, projeto `cesnbnrynvxvgdhfmaua`):
```sql
select description, amount, category
from pf_transactions
where collaborator_id='8bfb18b6-3c2e-4579-b4a9-06409d7e84c4'
  and card_id is not null and category='outros' and created_at > '2026-07-01'
order by description;
```
Expected: ~30 linhas. Salvar como referência pro Task 2 (ConectCar 10×, Abastec 2×, Prezunic, Cencosud, etc.).

---

## Task 1: Migration `pf_category_memory`

**Files:**
- Create: `supabase/migrations/20260717120000_pf_category_memory.sql`

**Interfaces:**
- Produces: tabela `pf_category_memory(collaborator_id, merchant_key, category, hits)` com RLS `current_collab_id()` e `unique(collaborator_id, merchant_key)`.

- [ ] **Step 1: Escrever a migration**

Arquivo `supabase/migrations/20260717120000_pf_category_memory.sql`:
```sql
-- Memória de categoria por pessoa: loja (merchant_key) -> categoria.
-- Alimentada SÓ quando o usuário corrige a categoria de um item da fatura.
-- Espelha o padrão de RLS das outras pf_ (owner = current_collab_id()).
create table if not exists pf_category_memory (
  id uuid primary key default gen_random_uuid(),
  collaborator_id uuid not null references collaborators(id) on delete cascade,
  merchant_key text not null,
  category text not null,
  hits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (collaborator_id, merchant_key)
);

create index if not exists idx_pf_category_memory_lookup
  on pf_category_memory (collaborator_id, merchant_key);

alter table pf_category_memory enable row level security;

create policy pf_category_memory_owner on pf_category_memory
  for all using (collaborator_id = current_collab_id())
  with check (collaborator_id = current_collab_id());
```

- [ ] **Step 2: Aplicar via MCP `apply_migration`**

Name: `pf_category_memory`. Query: o conteúdo acima.
Expected: sucesso, sem erro.

- [ ] **Step 3: Verificar RLS e unique no banco**

Run (MCP `execute_sql`):
```sql
select policyname, qual::text from pg_policies where tablename='pf_category_memory';
select conname from pg_constraint where conrelid='pf_category_memory'::regclass and contype='u';
```
Expected: policy `pf_category_memory_owner` com `collaborator_id = current_collab_id()`; constraint unique presente.

- [ ] **Step 4: Commit**

```bash
cd /c/la-deploy-work && git fetch origin -q && git reset --hard origin/main -q
mkdir -p supabase/migrations
cp /d/la-organizer/_remote/supabase/migrations/20260717120000_pf_category_memory.sql supabase/migrations/ 2>/dev/null || echo "criar no _remote primeiro"
```
(A migration já foi aplicada no banco via MCP; o commit é só pra versionar o arquivo. Copiar o .sql pro `_remote` e pro clone, commitar só ele.)

---

## Task 2: `categorize-invoice.js` — a cascata pura (TDD)

**Files:**
- Create: `src/finance/categorize-invoice.js`
- Test: `src/finance/categorize-invoice.test.js`

**Interfaces:**
- Consumes: `categorizeMerchant(desc, type)` e `stripAcquirer(desc)` de `./merchant-category` (existentes).
- Produces:
  - `merchantKey(descricao) -> string`
  - `resolveItemCategory({ descricao, tipo, geminiHint, learned, validSlugs }) -> { slug, source }`
  - `groupUnknowns(itens) -> [{ merchantKey, label, count, total, sugestao }]`

- [ ] **Step 1: Escrever os testes de `merchantKey` (o linchpin)**

Arquivo `src/finance/categorize-invoice.test.js`:
```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { merchantKey, resolveItemCategory, groupUnknowns } = require('./categorize-invoice');

test('merchantKey: os 10 MP*CONECTCAR viram UMA chave', () => {
  const ks = ['MP*CONECTCAR', 'MP*CONECTCAR', 'mp*conectcar '].map(merchantKey);
  assert.strictEqual(new Set(ks).size, 1);
});

test('merchantKey: cidade/UF colada não separa (SmartShelvePETROPOLISBR == SmartShelve)', () => {
  assert.strictEqual(merchantKey('SmartShelvePETROPOLISBR'), merchantKey('SmartShelve'));
});

test('merchantKey: sufixo de parcela sai (AMAZON MARKETP 02/03 == AMAZON MARKETP)', () => {
  assert.strictEqual(merchantKey('AMAZON MARKETP 02/03'), merchantKey('AMAZON MARKETP'));
});

test('merchantKey: dígitos de loja colapsam (PREZUNIC 716 == PREZUNIC)', () => {
  assert.strictEqual(merchantKey('PREZUNIC 716RIO DE JANE'), merchantKey('Prezunic'));
});
```

- [ ] **Step 2: Rodar — vermelho (módulo não existe)**

Run: `cd .../scratchpad/cat && node --test categorize-invoice.test.js`
Expected: FAIL — `Cannot find module './categorize-invoice'`.

- [ ] **Step 3: Escrever `merchantKey`**

Arquivo `src/finance/categorize-invoice.js`:
```js
'use strict';
// Cascata de categoria da fatura (Fase categorização, 17/07). PURO, sem I/O.
// Precedência: learned (memória do usuário) > rules (merchant-category) > gemini > outros.
// O LLM só preenche o vazio; nunca sobrescreve verdade conhecida.
const { categorizeMerchant, stripAcquirer } = require('./merchant-category');

// Chave de agrupamento E de memória. É o linchpin: agrupa os 10 ConectCar numa pergunta
// e é a chave em pf_category_memory. Normaliza o "sujo" da fatura ao osso do nome da loja.
function merchantKey(descricao) {
  let s = stripAcquirer(descricao);                 // tira MP*, IFD*, PAG* + baixa + sem acento
  s = s.replace(/\b\d{1,2}\/\d{1,2}\b/g, ' ');      // parcela "02/03"
  s = s.replace(/\(\s*\d+\s*\/\s*\d+\s*\)/g, ' ');   // parcela "(2/3)"
  s = s.replace(/[^a-z\s]/g, ' ');                   // dígitos de loja, símbolos
  s = s.replace(/\b(rio de jane|sao paulo|br|rj|sp|ltda|ltd|me|epp)\b/g, ' '); // UF/cidade/sufixo comum
  s = s.replace(/\s+/g, ' ').trim();
  // cidade GRUDADA no fim sem espaço (SmartShelvePETROPOLISBR): corta o rabo em maiúsculas-cidade.
  // stripAcquirer já baixou tudo; então tira sufixos de cidade conhecidos colados.
  s = s.replace(/(petropolis|riodejane|saopaulo|duquedecaxias|niteroi)$/g, '').trim();
  return s;
}

module.exports = { merchantKey };
```
> ⚠️ **Nota de implementação:** o `merchantKey` é heurístico — o objetivo é agrupar, não ser perfeito. Ajustar os regexes rodando contra a fixture real (Task 0 Step 3) até os 10 ConectCar colapsarem e SmartShelve casar. Não perseguir 100% de merchants raros; o que escapa vira pergunta individual, não erro.

- [ ] **Step 4: Rodar — verde nos 4 de merchantKey**

Run: `node --test categorize-invoice.test.js`
Expected: 4 pass. Se `SmartShelvePETROPOLISBR` falhar, ajustar o regex de cidade colada e re-rodar.

- [ ] **Step 5: Testes de `resolveItemCategory` (a precedência)**

Adicionar ao `.test.js`:
```js
const SLUGS = new Set(['transporte','mercado','compras','farmacia','outros','combustivel']);

test('learned VENCE tudo (mesmo com gemini diferente)', () => {
  const learned = new Map([[merchantKey('MP*CONECTCAR'), 'transporte']]);
  const r = resolveItemCategory({ descricao: 'MP*CONECTCAR', tipo: 'expense', geminiHint: 'compras', learned, validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'transporte');
  assert.strictEqual(r.source, 'learned');
});

test('rules VENCE gemini (Prezunic cai em mercado pela regra, não pelo palpite)', () => {
  // depende de Prezunic entrar em MERCHANT_RULES (Task 2b). Se não, este vira gemini.
  const r = resolveItemCategory({ descricao: 'PREZUNIC 716', tipo: 'expense', geminiHint: 'compras', learned: new Map(), validSlugs: SLUGS });
  assert.ok(['mercado','compras'].includes(r.slug));
});

test('gemini preenche onde ninguém sabe', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ DESCONHECIDA', tipo: 'expense', geminiHint: 'compras', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'compras');
  assert.strictEqual(r.source, 'gemini');
});

test('slug INVÁLIDO do LLM é descartado → outros', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ', tipo: 'expense', geminiHint: 'pedágio', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'outros');
  assert.strictEqual(r.source, 'fallback');
});

test('income NUNCA casa merchant nem gemini', () => {
  const r = resolveItemCategory({ descricao: 'PIX RECEBIDO', tipo: 'income', geminiHint: 'compras', learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'outros');
});

test('gemini ausente (null) → cai em rules/outros (comportamento de hoje)', () => {
  const r = resolveItemCategory({ descricao: 'LOJA XYZ', tipo: 'expense', geminiHint: null, learned: new Map(), validSlugs: SLUGS });
  assert.strictEqual(r.slug, 'outros');
});
```

- [ ] **Step 6: Rodar — vermelho (resolveItemCategory não existe)**

Run: `node --test categorize-invoice.test.js`
Expected: FAIL — `resolveItemCategory is not a function`.

- [ ] **Step 7: Escrever `resolveItemCategory`**

Adicionar ao módulo:
```js
// learned: Map<merchantKey, slug> (o engine lê do banco e injeta). validSlugs: Set de slugs
// válidos (pfValidSlugs('expense') + custom do user). income nunca casa despesa.
function resolveItemCategory({ descricao, tipo, geminiHint, learned, validSlugs } = {}) {
  if (tipo === 'income') return { slug: 'outros', source: 'fallback' };
  const key = merchantKey(descricao);
  // 1) aprendido pelo usuário
  if (learned && learned.get(key)) return { slug: learned.get(key), source: 'learned' };
  // 2) lista curada (merchant-category)
  const byRule = categorizeMerchant(descricao, tipo);
  if (byRule) return { slug: byRule, source: 'rules' };
  // 3) palpite do Gemini — só se for slug VÁLIDO
  const hint = String(geminiHint || '').toLowerCase().trim();
  if (hint && validSlugs && validSlugs.has(hint) && hint !== 'outros') {
    return { slug: hint, source: 'gemini' };
  }
  // 4) outros
  return { slug: 'outros', source: 'fallback' };
}

module.exports = { merchantKey, resolveItemCategory };
```

- [ ] **Step 8: Rodar — verde**

Run: `node --test categorize-invoice.test.js`
Expected: todos pass.

- [ ] **Step 9: Testes de `groupUnknowns` (a TRAVA de ordenação)**

Adicionar ao `.test.js`:
```js
test('TRAVA: ConectCar (10×, R$135) vem ANTES de LUCASDONAS (1×, R$500)', () => {
  const itens = [
    { descricao: 'MP *LUCASDONAS', valor: 500, _catSource: 'fallback' },
    ...Array.from({ length: 10 }, () => ({ descricao: 'MP*CONECTCAR', valor: 13.5, _catSource: 'fallback' })),
  ];
  const g = groupUnknowns(itens);
  assert.strictEqual(g[0].merchantKey, merchantKey('MP*CONECTCAR'), 'repetição vence valor');
  assert.strictEqual(g[0].count, 10);
});

test('groupUnknowns: só agrupa fallback/gemini, ignora learned/rules', () => {
  const itens = [
    { descricao: 'A', valor: 10, _catSource: 'rules' },
    { descricao: 'B', valor: 10, _catSource: 'learned' },
    { descricao: 'C', valor: 10, _catSource: 'fallback' },
  ];
  const g = groupUnknowns(itens);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].label, merchantKey('C') ? g[0].label : g[0].label); // C presente
});

test('groupUnknowns: teto de 3 (o resto vai sem perguntar)', () => {
  const itens = ['A','B','C','D','E'].map((d) => ({ descricao: d, valor: 10, _catSource: 'fallback' }));
  assert.strictEqual(groupUnknowns(itens).length, 3);
});

test('groupUnknowns: zero desconhecido → array vazio (sem "me confirma 0 coisas")', () => {
  const itens = [{ descricao: 'A', valor: 10, _catSource: 'rules' }];
  assert.deepStrictEqual(groupUnknowns(itens), []);
});
```

- [ ] **Step 10: Rodar — vermelho**

Run: `node --test categorize-invoice.test.js`
Expected: FAIL — `groupUnknowns is not a function`.

- [ ] **Step 11: Escrever `groupUnknowns`**

```js
// Agrupa os itens ainda não-resolvidos (source gemini/fallback) por merchantKey, ordena por
// count DESC (a pergunta que resolve MAIS itens vem primeiro), total DESC como desempate.
// count, não valor: ensinar ConectCar 1× mata 10 itens; ensinar LUCASDONAS mata 1. Teto 3.
function groupUnknowns(itens) {
  const map = new Map();
  for (const it of (itens || [])) {
    if (it._catSource !== 'fallback' && it._catSource !== 'gemini') continue;
    const key = merchantKey(it.descricao);
    if (!key) continue;
    const g = map.get(key) || { merchantKey: key, label: it.descricao, count: 0, total: 0, sugestao: it.categoria };
    g.count += 1;
    g.total += Number(it.valor) || 0;
    map.set(key, g);
  }
  return [...map.values()]
    .sort((a, b) => (b.count - a.count) || (b.total - a.total))
    .slice(0, 3);
}

module.exports = { merchantKey, resolveItemCategory, groupUnknowns };
```

- [ ] **Step 12: Rodar — verde total**

Run: `node --test categorize-invoice.test.js`
Expected: todos pass.

- [ ] **Step 13: Commit**

```bash
git add src/finance/categorize-invoice.js src/finance/categorize-invoice.test.js
git commit -m "feat(fatura): cascata pura de categoria (learned>rules>gemini>outros) + agrupamento por count"
```

---

## Task 2b: Engordar `merchant-category.js` com as lojas da Rose

**Files:**
- Modify: `src/finance/merchant-category.js` (bloco `MERCHANT_RULES`)
- Test: `src/finance/merchant-category.test.js` (existente — adicionar casos)

**Interfaces:**
- Consumes/Produces: `categorizeMerchant` (mesma assinatura). Só cresce a lista de regras.

- [ ] **Step 1: Teste com os merchants reais da Rose que hoje caem em outros**

Adicionar ao `merchant-category.test.js` (ou criar se não existir):
```js
const casos = [
  ['MP*CONECTCAR', 'transporte'],
  ['Prezunic', 'mercado'],
  ['Cencosud', 'mercado'],
  ['Abastec', 'combustivel'],
  ['Global Park', 'estacionamento'],
  ['CITYFARMA', 'farmacia'],
  ['Rei do Mate', 'alimentacao'],
];
for (const [desc, slug] of casos) {
  test(`merchant real da Rose: ${desc} → ${slug}`, () => {
    assert.strictEqual(categorizeMerchant(desc, 'expense'), slug);
  });
}
```

- [ ] **Step 2: Rodar — vermelho (as lojas não estão na lista)**

Run: `node --test merchant-category.test.js`
Expected: FAIL nos 7 casos (retornam null).

- [ ] **Step 3: Adicionar as regras**

Em `MERCHANT_RULES`, nas seções correspondentes:
```js
  // transporte (pedágio/vale)
  { slug: 'transporte', re: /conectcar|sem\s?parar|veloe|move\s?mais|ultrapass/ },
  // mercado (redes sem "mercado/super")
  { slug: 'mercado', re: /prezunic|cencosud|guanabara|mundial|super\s?prix|hortifruti|zona\s?sul/ },
  // combustível
  { slug: 'combustivel', re: /abastec|shell|texaco/ },
  // estacionamento
  { slug: 'estacionamento', re: /global\s?park|estapar|multipark|parking/ },
  // farmácia
  { slug: 'farmacia', re: /cityfarma|farmalife|drogaria/ },
  // alimentação (cafeteria/rede)
  { slug: 'alimentacao', re: /rei\s?do\s?mate|kopenhagen|cacau\s?show/ },
```
> ⚠️ **Ordem importa:** adicionar cada regra na seção do slug certo, RESPEITANDO a ordem existente (assinaturas antes de e-commerce, etc.). Não mover regras existentes.

- [ ] **Step 4: Rodar — verde + zero-regressão do arquivo**

Run: `node --test merchant-category.test.js`
Expected: os 7 novos pass, os antigos intactos.

- [ ] **Step 5: Commit**

```bash
git add src/finance/merchant-category.js src/finance/merchant-category.test.js
git commit -m "feat(fatura): +regras de merchant (ConectCar, Prezunic, Abastec, Global Park...) da fatura real da Rose"
```

---

## Task 3: `gemini.js` — campo `categoria` nos DOIS schemas

**Files:**
- Modify: `src/services/gemini.js` (linha ~242 = PDF, ~267 = texto colado)

**Interfaces:**
- Produces: cada item do `invoice.itens` passa a ter `categoria: "<slug>" | null`.

- [ ] **Step 1: GREP obrigatório — achar TODOS os schemas (armadilha das duas portas)**

Run: `ssh tom "cd /opt/LA-Organizer && grep -n 'isInvoice.*emissor.*itens' src/services/gemini.js"`
Expected: DUAS linhas (242 e 267). **Se aparecer só uma ou três, PARAR e reinvestigar** — o número de portas mudou.
> Esta é a armadilha `[[project_trap_a_duas_portas]]` que causou `FIN-INVOICE-CARD-GUESSED-AT-INTENT-OPEN` esta semana. Alterar TODAS as portas, confirmadas por grep, não de cabeça.

- [ ] **Step 2: Adicionar `categoria` no schema + instrução, nos DOIS pontos**

Em cada um dos dois schemas, trocar o item de:
```
{"descricao":"<loja>","valor":<number>,"data":"YYYY-MM-DD","parcela_atual":<int>,"parcela_total":<int>}
```
por:
```
{"descricao":"<loja>","valor":<number>,"data":"YYYY-MM-DD","parcela_atual":<int>,"parcela_total":<int>,"categoria":"<slug ou null>"}
```
E adicionar, logo após a linha do schema, nos DOIS pontos:
```js
    'Para "categoria", use SOMENTE um destes slugs: alimentacao, assinaturas, beleza, combustivel, compras, contas_consumo, educacao, esportes, estacionamento, farmacia, filhos, impostos, lazer, mercado, moradia, pets, presentes, restaurante, saude, seguros, tecnologia, transporte, vestuario, viagens. NA DÚVIDA, use null — melhor vazio que errado.',
```

- [ ] **Step 3: Verificar sintaxe**

Run: `cd .../scratchpad/cat && node --check gemini.js`
Expected: sem erro.

- [ ] **Step 4: Confirmar que os DOIS schemas mudaram**

Run: `grep -c '"categoria"' gemini.js`
Expected: `2` (ou mais, contando a instrução). Se `1`, faltou uma porta.

- [ ] **Step 5: Commit**

```bash
git add src/services/gemini.js
git commit -m "feat(fatura): Gemini sugere categoria por item nos DOIS schemas (PDF + texto), null na dúvida"
```

---

## Task 4: `invoice-import.js` — bloco de perguntas (aditivo)

**Files:**
- Modify: `src/finance/invoice-import.js:128-143` (`buildInvoicePreview`)
- Test: `src/finance/invoice-import.test.js` (existente)

**Interfaces:**
- Consumes: `groupUnknowns` output `[{ label, count, total, sugestao }]` do Task 2.
- Produces: `buildInvoicePreview({ ...atual, unknowns })` — `unknowns` opcional.

- [ ] **Step 1: Teste — sem `unknowns`, prévia byte a byte igual (zero-regressão)**

Adicionar ao `invoice-import.test.js`:
```js
test('buildInvoicePreview sem unknowns → idêntico ao formato atual (rodapé intacto)', () => {
  const itens = [{ descricao: 'LOJA', valor: 10, data: '2026-06-15', categoria: 'compras' }];
  const p = buildInvoicePreview({ emissor: 'Itaú', vencimento: '2026-07-10', total: 10, cardName: 'X', itens, dupWarning: null });
  assert.ok(p.includes('Responde *lançar*, *anotações* (só salvar) ou *cancelar*.'));
  assert.ok(!p.includes('Me confirma'));
});
```

- [ ] **Step 2: Teste — com `unknowns`, bloco entre Total e rodapé**

```js
test('buildInvoicePreview com unknowns → bloco "Me confirma" antes do rodapé', () => {
  const itens = [{ descricao: 'MP*CONECTCAR', valor: 13.5, data: '2026-06-15', categoria: 'outros' }];
  const unknowns = [{ label: 'ConectCar', count: 10, total: 135.05, sugestao: 'transporte' }];
  const p = buildInvoicePreview({ emissor: 'Itaú', vencimento: '2026-07-10', total: 135.05, cardName: 'X', itens, dupWarning: null, unknowns });
  assert.ok(p.includes('Me confirma'));
  assert.ok(p.includes('ConectCar'));
  assert.ok(p.includes('10×'));
  // rodapé continua sendo a ÚLTIMA coisa
  assert.ok(p.trimEnd().endsWith('Responde *lançar*, *anotações* (só salvar) ou *cancelar*.'));
});
```

- [ ] **Step 3: Rodar — vermelho (param não existe)**

Run: `node --test invoice-import.test.js`
Expected: o teste com unknowns FALHA (não tem "Me confirma").

- [ ] **Step 4: Implementar o bloco aditivo**

Em `buildInvoicePreview`, trocar a assinatura e inserir o bloco ANTES do rodapé:
```js
function buildInvoicePreview({ emissor, vencimento, total, cardName, itens, dupWarning, unknowns }) {
  const head = `📄 *Fatura ${emissor || ''}*${vencimento ? ` · vence ${vencimento.slice(8, 10)}/${vencimento.slice(5, 7)}` : ''}`;
  const linhas = itens.map((it, i) => {
    const parc = it.parcela_total > 1 ? ` · ${it.parcela_atual}/${it.parcela_total}` : '';
    const dia = it.data ? `${it.data.slice(8, 10)}/${it.data.slice(5, 7)} · ` : '';
    return `${i + 1}. ${dia}${it.descricao} · R$ ${brl(it.valor)}${parc} · ${it.categoria || 'outros'}`;
  });
  const somaItens = itens.reduce((s, it) => s + Number(it.valor), 0);
  const partes = [
    head, '', linhas.join('\n'), '',
    `Total: R$ ${brl(total || somaItens)} · ${itens.length} lançamentos`,
  ];
  // Bloco aditivo: só as lojas que o TOM não soube classificar, agrupadas. Ausente = prévia de hoje.
  if (unknowns && unknowns.length) {
    const perg = unknowns.map((u, i) =>
      `${i + 1}. *${u.label}* — ${u.count}× · R$ ${brl(u.total)} → _${u.sugestao || 'outros'}_?`);
    partes.push('', '*Me confirma essas categorias* (ou só responde *lançar*):', perg.join('\n'),
      'Se algo estiver errado, corrige: _"1 é pedágio"_.');
  }
  if (dupWarning) partes.push('', dupWarning);
  partes.push('', `Lanço essas compras no *${cardName}*? Responde *lançar*, *anotações* (só salvar) ou *cancelar*.`);
  return partes.join('\n');
}
```

- [ ] **Step 5: Rodar — verde (novos + antigos de invoice-import)**

Run: `node --test invoice-import.test.js`
Expected: todos pass, incluindo os testes de prévia que já existiam.

- [ ] **Step 6: Commit**

```bash
git add src/finance/invoice-import.js src/finance/invoice-import.test.js
git commit -m "feat(fatura): buildInvoicePreview ganha bloco opcional de perguntas (aditivo, rodapé intacto)"
```

---

## Task 5: Engine — Intercept A (classifica) e B (aprende)

**Files:**
- Modify: `src/engine.js` — Intercept A (~9465, monta `_itensCat`), Intercept B (~9500, resposta à prévia)

**Interfaces:**
- Consumes: `resolveItemCategory`, `groupUnknowns` (Task 2); `buildInvoicePreview({unknowns})` (Task 4); `pfValidSlugs` (existe no engine).
- Produces: payload da intent ganha `categoria` + `_catSource` por item; prévia com `unknowns`; correção → upsert em `pf_category_memory`.

- [ ] **Step 1: Ler o Intercept A atual e o helper de slugs**

Run: `ssh tom "cd /opt/LA-Organizer && sed -n '9460,9470p' src/engine.js && grep -n 'function pfValidSlugs' src/engine.js"`
Expected: ver a linha `_itensCat = _inv.itens.map(...safeCategory...)` e a definição de `pfValidSlugs`.

- [ ] **Step 2: Intercept A — trocar `safeCategory` por `resolveItemCategory` + memória + unknowns**

Substituir a montagem de `_itensCat` (linha ~9465) e a chamada de prévia. Antes:
```js
      const _itensCat = _inv.itens.map((it) => ({ ...it, categoria: safeCategory(it.descricao, it.descricao, 'expense', _extraSlugs) }));
```
Depois:
```js
      // Cascata de categoria: learned (memória do user) > rules > gemini > outros. Lê a memória
      // UMA vez e injeta no módulo puro. Se a query falhar, learned vazio → comportamento de hoje.
      const { resolveItemCategory, groupUnknowns } = require('./finance/categorize-invoice');
      const _validSlugs = new Set([...pfValidSlugs('expense'), ...(_extraSlugs || [])]);
      let _learned = new Map();
      try {
        const { data: _mem } = await supabase.from('pf_category_memory')
          .select('merchant_key, category').eq('collaborator_id', collab.id);
        (_mem || []).forEach((r) => _learned.set(r.merchant_key, r.category));
      } catch (e) { console.warn('[Fatura] pf_category_memory read err:', e.message); }
      const _itensCat = _inv.itens.map((it) => {
        const _res = resolveItemCategory({
          descricao: it.descricao, tipo: 'expense', geminiHint: it.categoria,
          learned: _learned, validSlugs: _validSlugs,
        });
        return { ...it, categoria: _res.slug, _catSource: _res.source };
      });
      const _unknowns = groupUnknowns(_itensCat);
```
E na chamada de `buildInvoicePreview` do Intercept A, adicionar `unknowns: _unknowns`:
```js
      const _preview = invoiceImport.buildInvoicePreview({
        emissor: _inv.emissor, vencimento: _inv.vencimento, total: _inv.total,
        cardName: _card.name, itens: _itensCat, dupWarning: null, unknowns: _unknowns,
      });
```
> ⚠️ `_catSource` fica no payload da intent (não atrapalha o insert — o handler de commit só lê `categoria`). Se preferir, o commit pode fazer `delete it._catSource` antes de inserir; confirmar no código do handler que campos extra são ignorados (o padrão do projeto é spread, então é seguro).

**OBRIGATÓRIO — gravar `_unknowns` no payload da intent** (fecha o gap do self-review): no `openIntent(...'invoice_import'...)` do Intercept A, adicionar `_unknowns` ao objeto de payload, junto de `itens`. Sem isso o Intercept B não tem como mapear "1 é pedágio" → item. Ex.:
```js
      // ...openIntent existente... no objeto de payload, junto de `itens: _itensCat`:
          itens: _itensCat, _unknowns,   // <-- o bloco de perguntas VIAJA no payload p/ o Intercept B reencontrar
```
Isso vale tanto para o caminho com cartão resolvido quanto para o de re-estágio (correção de cartão) — em ambos o payload que abre a intent leva `_unknowns` recalculado.

- [ ] **Step 3: Intercept B — correção de categoria aprende + re-manda prévia**

No Intercept B (resposta à prévia, ~9500), ANTES do `if (_decision)` de commit, adicionar o caminho de correção de CATEGORIA (não de cartão — aquele já existe):
```js
      // Correção de CATEGORIA: "1 é pedágio", "o 3 é lazer", "ConectCar é transporte".
      // Aprende (upsert pf_category_memory) → re-resolve o lote → RE-MANDA A PRÉVIA (nunca commita:
      // ninguém confirma uma prévia que não viu — project_msg_promete_previa_mas_commita).
      const _catFix = invoiceImport.detectCategoryCorrection(text, _invIntent.payload.itens, _invIntent.payload._unknowns);
      if (_catFix) {
        const { merchantKey } = require('./finance/categorize-invoice');
        const _key = merchantKey(_catFix.descricao);
        try {
          await supabase.from('pf_category_memory').upsert({
            collaborator_id: collab.id, merchant_key: _key, category: _catFix.slug, updated_at: new Date().toISOString(),
          }, { onConflict: 'collaborator_id,merchant_key' });
        } catch (e) { console.error('[Fatura] upsert memória err:', e.message); }
        console.log(`[Fatura] aprendeu: ${_key} → ${_catFix.slug}`);
        // re-resolve e re-abre a prévia: superseder a intent + re-montar (reusa Intercept A? não —
        // aqui reaplica só a memória nova sobre os itens já no payload)
        // ... (re-resolve inline: aplica _catFix.slug aos itens com aquele merchantKey, re-agrupa)
        return; // detalhe de re-montagem no Step 4
      }
```
> ⚠️ Este step tem uma dependência: `detectCategoryCorrection` (parser) não existe ainda. Ver Step 4.

- [ ] **Step 4: Parser `detectCategoryCorrection` (TDD, em invoice-import.js)**

Antes de ligar o Step 3, escrever o parser puro. Teste em `invoice-import.test.js`:
```js
test('detectCategoryCorrection: "1 é pedágio" → item 1, slug transporte (via mapCategory)', () => {
  const itens = [{ descricao: 'MP*CONECTCAR', categoria: 'outros' }];
  const unknowns = [{ label: 'ConectCar', merchantKey: 'conectcar' }];
  const r = detectCategoryCorrection('1 é pedágio', itens, unknowns);
  assert.ok(r && r.descricao.includes('CONECTCAR'));
});
test('detectCategoryCorrection: fala sem correção → null', () => {
  assert.strictEqual(detectCategoryCorrection('sim', [], []), null);
});
```
Implementar em `invoice-import.js`: casa `^(\d+)\s+(é|eh|e)\s+(.+)` (número do bloco de perguntas → slug via `mapCategory`/`resolveCategorySlug`), OU `<loja> é <categoria>`. Devolve `{ descricao, slug }` ou `null`.
> Detalhe completo do parser + re-montagem da prévia: escrever na execução, guiado pelos testes. A regra dura: só age quando há correção EXPLÍCITA; senão devolve null e o fluxo segue pro commit/cancel normal.

- [ ] **Step 5: "sim" commita SEM gravar memória — teste de guarda**

Confirmar (teste ou smoke) que o caminho de `commit_financeiro` NÃO chama upsert de memória. O aceite do lote não é endosso item a item.

- [ ] **Step 6: Sintaxe + suíte financeira**

Run: `cd .../scratchpad/cat && node --check engine.js`
Run: `ssh tom` (após deploy) `node --test src/finance/*.test.js`
Expected: sem erro de sintaxe; suíte financeira verde.

---

## Task 6: Deploy + smoke real + olho no banco + KI + memória

**Files:** nenhum novo (deploy + verificação).

- [ ] **Step 1: Suíte COMPLETA na cópia local antes de subir**

Run: `cd .../scratchpad/cat && node --test *.test.js`
Expected: verde nos módulos puros.

- [ ] **Step 2: Copiar pro `_remote` + pedir OK do Alf pro scp do engine**

```bash
cp .../cat/{categorize-invoice.js,categorize-invoice.test.js} /d/la-organizer/_remote/src/finance/
cp .../cat/{merchant-category.js,invoice-import.js} /d/la-organizer/_remote/src/finance/
cp .../cat/gemini.js /d/la-organizer/_remote/src/services/
cp .../cat/engine.js /d/la-organizer/_remote/src/engine.js
```
Enviar módulos puros por scp (passam). Para o `engine.js`: **pedir OK ao Alf** (classificador bloqueia). Backup na VPS antes: `engine.js.bak-20260717`.

- [ ] **Step 3: md5 + sintaxe NA VPS + restart**

Run: `ssh tom "md5sum ..."` (local == VPS), `node --check src/engine.js`, `pm2 restart tom`, `tail logs/tom-out.log`.
Expected: md5 bate, sintaxe OK, "✅ TOM pronto", sem erro no boot.

- [ ] **Step 4: Suíte na VPS — zero-regressão**

Run: `ssh tom "cd /opt/LA-Organizer && node --test src/**/*.test.js 2>&1 | grep -E '^# (tests|pass|fail)'"`
Expected: pass subiu (novos testes), fail = **as mesmas 5** de baseline. Confirmar os `not ok` idênticos ao Task 0.

- [ ] **Step 5: Smoke real — reimportar uma fatura da Rose e OLHAR O BANCO**

Rodar o fluxo real (ou simular na VPS com os itens reais). Depois, MCP `execute_sql`:
```sql
select description, category from pf_transactions
where collaborator_id='8bfb18b6-3c2e-4579-b4a9-06409d7e84c4' and created_at > now() - interval '10 min';
select merchant_key, category from pf_category_memory where collaborator_id='8bfb18b6-3c2e-4579-b4a9-06409d7e84c4';
```
Expected: ConectCar NÃO está mais em "outros"; se houve correção, `pf_category_memory` tem a linha. **Teste verde não é prova — o banco é** (lição-mãe).

- [ ] **Step 6: Commit cirúrgico + push + git==VPS**

```bash
cd /c/la-deploy-work && git fetch origin -q && git reset --hard origin/main -q
# copiar SÓ meus arquivos do _remote (NÃO tocar no leader-cards.js do outro chat)
cp /d/la-organizer/_remote/src/finance/categorize-invoice.js src/finance/
# ... (os 5 arquivos meus + a migration)
node scripts/check-quiet-gates.js   # exit 0
git add <só os meus> && git commit -m "feat(fatura): categorização com cascata + memória por pessoa"
git push origin main
# verificar HEAD==origin/main e git==VPS por md5
```
NÃO remover o `.deploy-hold` (é de outro chat).

- [ ] **Step 7: Known issue + memória**

INSERT em `tom_known_issues` (código tipo `FIN-INVOICE-CATEGORY-ALL-OUTROS`, status corrigido, sinal_tipo `manual`). Criar/atualizar memória `project_categorizacao_fatura.md` + linha no `MEMORY.md`.

---

## Self-Review (rodado após escrever o plano)

**1. Cobertura da spec:**
- Cascata `learned>rules>gemini>outros` → Task 2 ✅
- `pf_category_memory` + RLS → Task 1 ✅
- Gemini nos 2 schemas → Task 3 ✅
- Prévia aditiva → Task 4 ✅
- Engine A (classifica) + B (aprende, re-manda prévia) → Task 5 ✅
- `count DESC` (não valor) com teste-trava → Task 2 Step 9 ✅
- Deploy cirúrgico + olho no banco → Task 6 ✅
- Lojas reais da Rose saem de "outros" → Task 2b ✅

**2. Placeholders:** Task 5 Steps 3-4 têm re-montagem "na execução" — é o único ponto com detalhe deixado pro implementador, mas com regra dura definida (só age em correção explícita; senão null). Aceitável porque depende de ler o Intercept B completo, que só se faz com o arquivo na mão. **Não é placeholder de código — é um TDD guiado.**

**3. Consistência de tipos:** `resolveItemCategory` retorna `{slug, source}`; `groupUnknowns` lê `_catSource` (= `source` gravado no item); `buildInvoicePreview` lê `unknowns[].{label,count,total,sugestao}`. Batem.

**Gap conhecido:** o parser `detectCategoryCorrection` (Task 5 Step 4) é a peça de maior risco — mapear "1 é pedágio" pro item certo depende do bloco de perguntas estar no payload (`_unknowns`). O plano injeta `_unknowns` no payload no Task 5 Step 2? **Ajustar:** o Intercept A deve gravar `_unknowns` no payload da intent pra o B reencontrar. Adicionado à nota do Step 2.
