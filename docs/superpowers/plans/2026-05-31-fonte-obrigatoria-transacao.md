# Fonte Obrigatória + Roteamento Conta/Cartão/Dinheiro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Steps usam checkbox `- [ ]`.

**Goal:** Nenhuma transação grava sem fonte. O engine resolve a fonte pelo que existe (carteira/cartão/Dinheiro), roteia certo, e quando falta fonte **pergunta e não grava** — despesa e receita.

**Architecture:** Lógica de classificação vira função **pura** (`classifySource`) testável; `resolveSource` faz o I/O (lista carteiras+cartões, garante Dinheiro). O handler `register_transaction` roteia por `kind`. Pergunta de fonte é um builder puro. Trava dupla: skill pede a fonte; engine é safety-net. Nomes (sem saldo) injetados no contexto da skill.

**Tech Stack:** Node CommonJS, `node:test`, Supabase service_role, WhatsApp text.

**Spec:** `docs/superpowers/specs/2026-05-31-fonte-obrigatoria-transacao-design.md`

---

## Mapa de arquivos
- **Modify** `src/finance/source.js` (Create) — `classifySource` puro + test.
- **Modify** `src/services/financeiro-service.js` — `ensureDinheiro`, `resolveSource` (usa classifySource), export.
- **Modify** `src/services/finance-format.js` — `buildSourceQuestion` (puro) + test; corrige footer receita.
- **Modify** `src/engine.js` — `register_transaction`: resolve+roteia; remove log diag; helper `recordCardPurchase`.
- **Modify** `src/prompts/system.js` — injeta nomes de carteiras+cartões no body da skill financeira.
- **Modify** `skills/financeiro-pessoal.md` — fonte obrigatória, remove regra antiga de colisão, method-words, receita.
- **Deploy** SCP dos arquivos `src/**` + skill + restart pm2.

Categorias/labels existentes em `finance-format.js: CAT_META`. Cartões: `listCards`, `findCard`, `insertCardPurchase`, `cardUsage`, `checkAndMarkLimitAlert` (já existem).

---

## Task 1: `classifySource` puro (TDD)

**Files:** Create `src/finance/source.js`, Create `src/finance/source.test.js`

- [ ] **Step 1: teste que falha** — `src/finance/source.test.js`
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { classifySource } = require('./source');

const A = ['Dinheiro', 'Conta Itaú'];
const C = ['Nubank'];

test('vazio → none', () => assert.strictEqual(classifySource('', A, C).kind, 'none'));
test('método de pagamento → none', () => {
  for (const m of ['pix','débito','debito','transferência','ted','boleto'])
    assert.strictEqual(classifySource(m, A, C).kind, 'none', m);
});
test('dinheiro/espécie → cash', () => {
  assert.strictEqual(classifySource('dinheiro', A, C).kind, 'cash');
  assert.strictEqual(classifySource('em espécie', A, C).kind, 'cash');
});
test('match só cartão → card', () => {
  const r = classifySource('nubank', A, C);
  assert.strictEqual(r.kind, 'card'); assert.strictEqual(r.cardName, 'Nubank');
});
test('match só carteira → account', () => {
  const r = classifySource('itaú', A, C);
  assert.strictEqual(r.kind, 'account'); assert.strictEqual(r.accountName, 'Conta Itaú');
});
test('match nos dois → ambiguous', () => {
  const r = classifySource('nubank', ['Nubank'], ['Nubank']);
  assert.strictEqual(r.kind, 'ambiguous');
  assert.strictEqual(r.accountName, 'Nubank'); assert.strictEqual(r.cardName, 'Nubank');
});
test('desconhecido → none', () => assert.strictEqual(classifySource('xpto', A, C).kind, 'none'));
```

- [ ] **Step 2: rodar e falhar** — `node --test src/finance/source.test.js` → FAIL (módulo inexistente)

- [ ] **Step 3: implementar** — `src/finance/source.js`
```js
// Classifica a FONTE de uma transação a partir do nome dito e das listas do usuário.
// Puro: sem I/O. kind ∈ none|cash|card|account|ambiguous.
const METHODS = ['pix','debito','débito','transferencia','transferência','ted','doc','boleto','cartao','cartão','credito','crédito'];
const CASH_RE = /\b(dinheiro|esp[ée]cie|cash|grana|vivo)\b/i;

function classifySource(rawName, accountNames = [], cardNames = []) {
  const name = String(rawName || '').trim().toLowerCase();
  if (!name) return { kind: 'none' };
  if (CASH_RE.test(name)) return { kind: 'cash' };
  if (METHODS.includes(name)) return { kind: 'none' };
  const hit = (list) => list.find((n) => {
    const x = String(n).toLowerCase();
    return x.includes(name) || name.includes(x);
  });
  const a = hit(accountNames);
  const c = hit(cardNames);
  if (a && c) return { kind: 'ambiguous', accountName: a, cardName: c };
  if (c) return { kind: 'card', cardName: c };
  if (a) return { kind: 'account', accountName: a };
  return { kind: 'none' };
}

module.exports = { classifySource };
```
Nota: `cartão/crédito` como method → `none` (força perguntar a conta? NÃO — esses devem virar cartão). Correção: remova `cartao/cartão/credito/crédito` de METHODS — o roteamento pra cartão é por **match de nome de cartão**, não por palavra "cartão". Mantenha METHODS só com pix/débito/transferência/ted/doc/boleto.

- [ ] **Step 4: ajustar METHODS** (remover cartao/credito) e **rodar** — `node --test src/finance/source.test.js` → PASS

- [ ] **Step 5: commit** — `git add src/finance/source.js src/finance/source.test.js && git commit -m "feat(finance): classifySource puro (fonte por carteira/cartão/dinheiro)"`

---

## Task 2: `buildSourceQuestion` + footer de receita (TDD)

**Files:** Modify `src/services/finance-format.js`, Modify `src/services/finance-format.test.js`

- [ ] **Step 1: testes que falham** (append em finance-format.test.js)
```js
const { buildSourceQuestion } = require('./finance-format');
test('pergunta de fonte (despesa): verbo "saiu", lista carteiras+cartões+Dinheiro', () => {
  const q = buildSourceQuestion({ type:'expense', amount:30,
    accounts:[{name:'Itaú',icon:'🧡'}], cards:[{name:'Nubank'}] });
  assert.match(q, /saiu de qual conta/i);
  assert.match(q, /1️⃣ 🧡 Itaú/);
  assert.match(q, /Nubank \(cartão\)/);
  assert.match(q, /💵 Dinheiro/);
});
test('pergunta de fonte (receita): verbo "caiu" e SEM cartão na lista', () => {
  const q = buildSourceQuestion({ type:'income', amount:5000,
    accounts:[{name:'Itaú',icon:'🧡'}], cards:[{name:'Nubank'}] });
  assert.match(q, /caiu em qual conta/i);
  assert.doesNotMatch(q, /cartão/i);
});
test('footer educativo de receita não diz "de onde saiu"', () => {
  const f = buildTxnFooter({ categoryMissing:false, accountLinked:false, tipSeed:0, type:'income' });
  assert.doesNotMatch(f, /de onde saiu/i);
});
```

- [ ] **Step 2: rodar e falhar** — `node --test src/services/finance-format.test.js`

- [ ] **Step 3: implementar** em `finance-format.js` (antes do module.exports)
```js
// Pergunta de fonte quando a transação chega sem origem resolvível.
function buildSourceQuestion({ type, amount, accounts = [], cards = [] }) {
  const income = type === 'income';
  const emoji = income ? '💰' : '💸';
  const head = income ? 'Entrada' : 'Gasto';
  const verbo = income ? 'caiu em qual conta' : 'saiu de qual conta';
  const opts = accounts.map((a) => `${a.icon || '🏦'} ${a.name}`);
  if (!income) cards.forEach((c) => opts.push(`💳 ${c.name} (cartão)`));
  if (!accounts.some((a) => String(a.name).toLowerCase() === 'dinheiro')) opts.push('💵 Dinheiro');
  const numbered = opts.map((o, i) => `${i + 1}️⃣ ${o}`).join('\n');
  return `${emoji} *${head} de ${money(amount)}* — ${verbo}?\n${SEP}\n${numbered}\n\n_Responda o número ou o nome._`;
}
```
E ajustar `buildTxnFooter` pra aceitar `type`: quando `!accountLinked` e `type==='income'`, usar `_💡 Em qual conta caiu? Ex: "...no Nubank" ou "...no Itaú"._` em vez de "De onde saiu?".

- [ ] **Step 4: export** — adicionar `buildSourceQuestion` ao module.exports. **Rodar** → PASS

- [ ] **Step 5: commit** — `git add src/services/finance-format.* && git commit -m "feat(finance): buildSourceQuestion + footer de receita correto"`

---

## Task 3: `ensureDinheiro` + `resolveSource` no service

**Files:** Modify `src/services/financeiro-service.js`

- [ ] **Step 1: implementar** (perto de listAccounts)
```js
const { classifySource } = require('../finance/source');

async function ensureDinheiro(collaboratorId) {
  const existing = (await listAccounts(collaboratorId)).find((a) => String(a.name).toLowerCase() === 'dinheiro');
  if (existing) return existing;
  return createAccount(collaboratorId, { name: 'Dinheiro', type: 'wallet', icon: '💵' });
}

// Resolve a fonte: {kind, account?, card?}. Faz o I/O e converte nomes→objetos.
async function resolveSource(collaboratorId, name) {
  const accounts = await listAccounts(collaboratorId);
  const cards = await listCards(collaboratorId);
  const cls = classifySource(name, accounts.map((a) => a.name), cards.map((c) => c.name));
  if (cls.kind === 'cash') return { kind: 'account', account: await ensureDinheiro(collaboratorId) };
  if (cls.kind === 'account') return { kind: 'account', account: accounts.find((a) => a.name === cls.accountName) };
  if (cls.kind === 'card') return { kind: 'card', card: cards.find((c) => c.name === cls.cardName) };
  if (cls.kind === 'ambiguous') return {
    kind: 'ambiguous',
    account: accounts.find((a) => a.name === cls.accountName),
    card: cards.find((c) => c.name === cls.cardName),
  };
  return { kind: 'none', accounts, cards };
}
```

- [ ] **Step 2: export** — adicionar `ensureDinheiro, resolveSource` ao module.exports.
- [ ] **Step 3: validar** — `node --check src/services/financeiro-service.js`
- [ ] **Step 4: commit** — `git add src/services/financeiro-service.js && git commit -m "feat(finance): ensureDinheiro + resolveSource (carteira/cartão/dinheiro)"`

---

## Task 4: Roteamento no `register_transaction` (engine)

**Files:** Modify `src/engine.js` (case `register_transaction`)

- [ ] **Step 1: remover o log diag e reescrever a resolução de fonte + roteamento.**
Substituir o trecho atual (do `console.log('[FinanceDbg]...` até o `insertTransaction(...)`) por:
```js
    case 'register_transaction': {
      if (!p.amount || p.amount <= 0) return '❓ Qual foi o valor?';
      const type = p.type || 'expense';
      const category = p.category || mapCategory(p.description || '');
      const srcName = params.account_name || params.account || params.carteira || params.conta || params.card || p.account_name;

      // Resolve a fonte. Sem fonte (ou cartão numa receita) → pergunta e NÃO grava.
      const src = srcName ? await financeService.resolveSource(cid, srcName) : { kind: 'none' };
      if (src.kind === 'ambiguous') {
        return `🤔 "${src.account.name}" é *carteira* e *cartão*. Foi no cartão ou na conta?`;
      }
      if (src.kind === 'card' && type === 'expense') {
        return await recordCardPurchase(cid, src.card, { amount: p.amount, description: p.description, category, installments: params.installments, date: p.date });
      }
      if (src.kind === 'none' || (src.kind === 'card' && type === 'income')) {
        const accounts = src.accounts || await financeService.listAccounts(cid);
        const cards = src.cards || await financeService.listCards(cid);
        return financeFmt.buildSourceQuestion({ type, amount: Number(p.amount), accounts, cards });
      }

      // src.kind === 'account' → transação de caixa com fonte garantida
      const account = src.account;
      const account_id = account.id;
      const prev = type === 'expense' ? await financeService.monthCategoryTotal(cid, category) : 0;
      await financeService.insertTransaction(cid, { type, category, amount: p.amount, description: p.description, transaction_date: p.date, account_id });
```
(O restante do case — bloco de orçamento, saldo, footer, `buildTxnConfirmation` — permanece, mas: usar `account` (não mais `account ? ... : null`, agora sempre há conta); footer com `accountLinked: true` e passar `type`.)

- [ ] **Step 2: ajustar o fim do case** pra refletir que `account` sempre existe:
```js
      const meta = financeFmt.CAT_META[category] || { emoji: '📦', label: category };
      const newBalance = Number(account.balance) + (type === 'income' ? Number(p.amount) : -Number(p.amount));
      const footer = financeFmt.buildTxnFooter({ categoryMissing: category === 'outros', accountLinked: true, tipSeed: new Date().getUTCDate(), type });
      return financeFmt.buildTxnConfirmation({
        type, description: p.description, amount: Number(p.amount),
        categoryLabel: meta.label, categoryEmoji: meta.emoji,
        account: { name: account.name, icon: account.icon }, newBalance, budgetBlock, footer,
      });
    }
```

- [ ] **Step 3: criar helper `recordCardPurchase`** perto de `handleFinanceAction` (extrai a lógica do case `card_purchase` pra reuso):
```js
async function recordCardPurchase(cid, card, { amount, description, category, installments, date }) {
  const financeFmt = require('./services/finance-format');
  const inst = parseInt(installments || 1, 10) || 1;
  const cat = category || mapCategory(description || '');
  const rows = await financeService.insertCardPurchase(cid, card, { category: cat, amount: Number(amount), description, transaction_date: date, installments: inst });
  const usage = await financeService.cardUsage(cid, card);
  let reply = financeFmt.txnRegistered(card, { description, amount: Number(amount), category: cat, installments: inst, competencia: rows[0].competencia }, usage);
  const al = await financeService.checkAndMarkLimitAlert(cid, card);
  if (al) reply += '\n\n' + financeFmt.limitAlert(card, al.band, al.usage);
  return reply;
}
```
E no case `card_purchase` existente, **substituir o corpo duplicado** por uma chamada a `recordCardPurchase` (DRY) — mantendo a parte de `findCard`/desambiguação que já existe lá.

- [ ] **Step 4: validar** — `node --check src/engine.js`
- [ ] **Step 5: commit** — `git add src/engine.js && git commit -m "feat(finance): fonte obrigatória + roteamento conta/cartão/dinheiro no register_transaction"`

---

## Task 5: Injeção de nomes no contexto da skill

**Files:** Modify `src/prompts/system.js`

- [ ] **Step 1:** garantir `const financeService = require('../services/financeiro-service');` no topo do system.js (se não houver).
- [ ] **Step 2:** no branch `if (FINANCE_RE.test(...))` do `pickSkill`, trocar por:
```js
  if (FINANCE_RE.test(String(lastUserMessage || ''))) {
    let body = loadSkill('financeiro-pessoal');
    try {
      const [accts, cards] = await Promise.all([
        financeService.listAccounts(collab.id),
        financeService.listCards(collab.id),
      ]);
      const linhas = [
        ...accts.map((a) => `• ${a.name} (carteira)`),
        ...cards.map((c) => `• ${c.name} (cartão)`),
      ];
      body += `\n\n## Fontes deste usuário (use pra resolver/perguntar — SEM citar saldo)\n${linhas.join('\n') || '• (nenhuma ainda)'}\n• Dinheiro (carteira)`;
    } catch { /* contexto opcional */ }
    return { name: 'financeiro-pessoal', body };
  }
```

- [ ] **Step 3: validar** — `node --check src/prompts/system.js`
- [ ] **Step 4: commit** — `git add src/prompts/system.js && git commit -m "feat(finance): injeta nomes de carteiras/cartões no contexto da skill"`

---

## Task 6: Skill — fonte obrigatória + remover regra antiga

**Files:** Modify `skills/financeiro-pessoal.md`

- [ ] **Step 1:** Em `register_transaction` (lista de ações), reforçar: param `account_name` agora é **obrigatório de fato** — se o usuário não disser de onde saiu/caiu, **pergunte** (liste as Fontes do contexto), **não invente**. Métodos ("pix/débito/transferência") NÃO são conta → pergunte. "no cartão / crédito / parcelei / em Nx" → cartão.
- [ ] **Step 2:** **Remover** a linha antiga de colisão *"gastei no Nubank (SEM dizer cartão) = register_transaction com account_name=Nubank"* — substituir por: *"a fonte é resolvida pelo que existe (o engine decide); se o nome for de cartão, vai pro cartão; se houver carteira E cartão com o mesmo nome, pergunte."*
- [ ] **Step 3:** Receita também exige conta ("recebi X" → caiu em qual conta?).
- [ ] **Step 4: commit** — `git add skills/financeiro-pessoal.md && git commit -m "docs(skill): fonte obrigatória + remove regra antiga de colisão"`

---

## Task 7: Deploy + smoke E2E

- [ ] **Step 1: testes puros** — `node --test src/finance/source.test.js src/services/finance-format.test.js` → todos PASS
- [ ] **Step 2: syntax** — `node --check src/engine.js && node --check src/services/financeiro-service.js && node --check src/prompts/system.js`
- [ ] **Step 3: SCP + restart**
```bash
scp src/finance/source.js src/finance/source.test.js tom:/opt/LA-Organizer/src/finance/
scp src/services/financeiro-service.js src/services/finance-format.js src/services/finance-format.test.js tom:/opt/LA-Organizer/src/services/
scp src/engine.js src/prompts/system.js tom:/opt/LA-Organizer/src/  # ajustar caminho de system.js → src/prompts/
scp skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/
ssh tom "pm2 restart tom --update-env && sleep 3 && pm2 logs tom --lines 12 --nostream | grep -iE 'error|cannot find' | tail; echo HEALTH_OK"
```
(Atenção: `system.js` vai em `src/prompts/`.)

- [ ] **Step 4: smoke WhatsApp** (Alf), conferir + reconciliar no banco (MCP):
  1. `gastei 45 no nubank com lazer` → fatura do cartão (não no caixa)
  2. `paguei uber 30 no pix` → pergunta "💸 saiu de qual conta?" + lista (NÃO grava)
  3. `do dinheiro` → grava em Dinheiro, debita
  4. `recebi 2000 de extra` → pergunta "💰 caiu em qual conta?" (NÃO grava)
  5. `no itaú` (após criar carteira Itaú) → credita Itaú
  6. reconciliação SQL: nenhuma transação nova com `account_id NULL AND card_id NULL`.

- [ ] **Step 5:** remover qualquer resíduo do log `[FinanceDbg]` (confirmado removido na Task 4).

---

## Notas
- **Backfill: NÃO fazer** (dado de teste; Alf re-registra). Ver spec §7.
- **DRY:** `recordCardPurchase` é a fonte única da lógica de compra no cartão (case `card_purchase` passa a chamá-la).
- **Privacidade:** contexto injeta só NOMES, nunca saldo (§6.4 do design de finanças).
