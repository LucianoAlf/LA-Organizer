# Card de Confirmação de Transação (educativo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a confirmação de `register_transaction` do TOM num card hierárquico, com saldo da carteira e um rodapé educativo contextual que ensina a pessoa a falar com o TOM.

**Architecture:** Toda a montagem do texto vira função **pura** em `src/services/finance-format.js` (`buildTxnConfirmation` + `buildTxnFooter` + mapa `CAT_META`), testada com `node:test`. O handler `register_transaction` em `src/engine.js` calcula os dados (saldo pós-trigger por cálculo determinístico, bloco de orçamento via `buildBudgetAlert` existente, footer contextual) e chama o builder. Deploy do engine via SCP + `pm2 restart tom`.

**Tech Stack:** Node.js (CommonJS), `node:test`/`node:assert`, Supabase service_role, WhatsApp (texto `*negrito*` / `_itálico_`).

**Spec:** `docs/superpowers/specs/2026-05-30-card-transacao-educativo-design.md`

---

## Mapa de arquivos

- **Modify** `src/services/finance-format.js` — adiciona `CAT_META`, `buildTxnFooter`, `buildTxnConfirmation` + export.
- **Create** `src/services/finance-format.test.js` — testes puros dos novos builders.
- **Modify** `src/engine.js` — handler `case 'register_transaction'` passa a montar o card.
- **Modify** `skills/financeiro-pessoal.md` — reforço de 1 linha (mandar categoria + de onde saiu na mesma frase).
- **Deploy** SCP `engine.js`, `finance-format.js`, `finance-format.test.js`, `skills/financeiro-pessoal.md` + `pm2 restart tom`.

Convenção de categorias (schema `pf_transactions`): receitas `salario|comissao|extra`; despesas `moradia|alimentacao|transporte|saude|educacao|lazer|outros`.

---

## Task 1: `CAT_META` + `buildTxnFooter` (rodapé educativo, puro, TDD)

**Files:**
- Modify: `src/services/finance-format.js`
- Test: `src/services/finance-format.test.js` (create)

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/services/finance-format.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { CAT_META, buildTxnFooter } = require('./finance-format');

test('CAT_META cobre todas as categorias do schema com emoji e label', () => {
  for (const k of ['salario','comissao','extra','moradia','alimentacao','transporte','saude','educacao','lazer','outros']) {
    assert.ok(CAT_META[k], `falta CAT_META[${k}]`);
    assert.ok(CAT_META[k].emoji && CAT_META[k].label, `CAT_META[${k}] incompleto`);
  }
});

test('footer: sem categoria ensina a dizer categoria', () => {
  const f = buildTxnFooter({ categoryMissing: true, accountLinked: true, tipSeed: 0 });
  assert.match(f, /Faltou a categoria/i);
  assert.match(f, /^_.*_$/m); // itálico WhatsApp
});

test('footer: com categoria e sem carteira ensina a dizer de onde saiu', () => {
  const f = buildTxnFooter({ categoryMissing: false, accountLinked: false, tipSeed: 0 });
  assert.match(f, /De onde saiu/i);
});

test('footer: completo retorna dica rotativa determinística pelo seed', () => {
  const a = buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: 0 });
  const b = buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: 1 });
  assert.match(a, /^_💡 .*_$/);
  assert.notStrictEqual(a, b); // seeds diferentes → dicas diferentes
  const a2 = buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: 0 });
  assert.strictEqual(a, a2); // mesmo seed → mesma dica (determinístico)
});

test('footer NUNCA ensina comando de correção/edição (fora de escopo)', () => {
  const todos = [0,1,2,3].map((s) => buildTxnFooter({ categoryMissing: false, accountLinked: true, tipSeed: s }))
    .concat(buildTxnFooter({ categoryMissing: true, accountLinked: false, tipSeed: 0 }));
  for (const f of todos) {
    assert.doesNotMatch(f, /era \d|muda pra|apaga|exclui/i, 'rodapé não pode ensinar edição neste round');
  }
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/finance-format.test.js`
Expected: FAIL (`CAT_META`/`buildTxnFooter` is not a function / undefined).

- [ ] **Step 3: Implementar `CAT_META` + `buildTxnFooter`**

Em `src/services/finance-format.js`, antes do `module.exports`:
```js
const CAT_META = {
  salario:    { emoji: '💼', label: 'Salário' },
  comissao:   { emoji: '💰', label: 'Comissão' },
  extra:      { emoji: '💵', label: 'Extra' },
  moradia:    { emoji: '🏠', label: 'Moradia' },
  alimentacao:{ emoji: '🍔', label: 'Alimentação' },
  transporte: { emoji: '🚗', label: 'Transporte' },
  saude:      { emoji: '🏥', label: 'Saúde' },
  educacao:   { emoji: '📚', label: 'Educação' },
  lazer:      { emoji: '🎮', label: 'Lazer' },
  outros:     { emoji: '📦', label: 'Outros' },
};

// Pool de dicas de educação financeira (só comandos que o TOM EXECUTA hoje).
const EDU_TIPS = [
  '_💡 Já separou algo pra sua meta esse mês?_',
  '_💡 Quer ver pra onde foi tudo? "quanto gastei esse mês?"_',
  '_💡 Dá pra pôr um teto: "define orçamento de alimentação 500"._',
  '_💡 Suas carteiras: "quais minhas carteiras?"_',
];

// Rodapé educativo contextual. Prioridade: categoria > carteira > dica rotativa.
// NUNCA ensina edição/correção (era X / muda pra / apaga) — fora de escopo deste round.
function buildTxnFooter({ categoryMissing, accountLinked, tipSeed = 0 }) {
  if (categoryMissing) {
    return '_💡 Faltou a categoria. Da próxima, diga pra onde foi:_\n'
         + '_"gastei 30 no Nubank com lazer" — assim eu organizo certo._';
  }
  if (!accountLinked) {
    return '_💡 De onde saiu? Ex: "gastei 30 no Nubank" ou "...no dinheiro"._';
  }
  return EDU_TIPS[((tipSeed % EDU_TIPS.length) + EDU_TIPS.length) % EDU_TIPS.length];
}
```
E acrescentar `CAT_META, buildTxnFooter` ao `module.exports`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/finance-format.test.js`
Expected: PASS (todos os testes desta task).

- [ ] **Step 5: Commit**

```bash
git add src/services/finance-format.js src/services/finance-format.test.js
git commit -m "feat(finance): CAT_META + rodapé educativo contextual (puro, testado)"
```

---

## Task 2: `buildTxnConfirmation` (montagem do card, puro, TDD)

**Files:**
- Modify: `src/services/finance-format.js`
- Test: `src/services/finance-format.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar em `src/services/finance-format.test.js`:
```js
const { buildTxnConfirmation } = require('./finance-format');

test('card de gasto com carteira: header, dados, saldo negativo e footer com respiro', () => {
  const card = buildTxnConfirmation({
    type: 'expense', amount: 30,
    categoryEmoji: '📦', categoryLabel: 'Outros',
    account: { name: 'Nubank', icon: '💜', newBalance: -30 },
    budgetBlock: null,
    footer: '_💡 Faltou a categoria._',
  });
  assert.match(card, /^✅ \*Gasto registrado\*/);
  assert.match(card, /💸 R\$ 30,00  ·  📦 Outros/);
  assert.match(card, /💜 Nubank → saldo agora: \*−R\$ 30,00\*/);
  assert.match(card, /_💡 Faltou a categoria\._$/);
  assert.match(card, /\n\n/); // tem linha em branco separando blocos
});

test('card de gasto SEM carteira omite a linha de saldo', () => {
  const card = buildTxnConfirmation({
    type: 'expense', amount: 80, categoryEmoji: '🍔', categoryLabel: 'Alimentação',
    account: null, budgetBlock: null, footer: '_💡 De onde saiu?_',
  });
  assert.doesNotMatch(card, /saldo agora/);
  assert.match(card, /💸 R\$ 80,00  ·  🍔 Alimentação/);
});

test('card de receita: header e saldo positivo com +', () => {
  const card = buildTxnConfirmation({
    type: 'income', amount: 5000, categoryEmoji: '💼', categoryLabel: 'Salário',
    account: { name: 'Itaú', icon: '🧡', newBalance: 9875 }, budgetBlock: null, footer: '_x_',
  });
  assert.match(card, /^✅ \*Receita registrada\*/);
  assert.match(card, /💰 R\$ 5\.000,00  ·  💼 Salário/);
  assert.match(card, /🧡 Itaú → saldo agora: \*\+R\$ 9\.875,00\*/);
});

test('card com bloco de orçamento aparece antes do footer', () => {
  const card = buildTxnConfirmation({
    type: 'expense', amount: 80, categoryEmoji: '🍔', categoryLabel: 'Alimentação',
    account: null,
    budgetBlock: '📊 Alimentação: R$ 125,00 / R$ 100,00 (125%)\n💀 Estourou.',
    footer: '_💡 dica_',
  });
  const iBudget = card.indexOf('📊 Alimentação');
  const iFooter = card.indexOf('_💡 dica_');
  assert.ok(iBudget > 0 && iFooter > iBudget, 'orçamento deve vir antes do footer');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/services/finance-format.test.js`
Expected: FAIL (`buildTxnConfirmation is not a function`).

- [ ] **Step 3: Implementar `buildTxnConfirmation`**

Em `src/services/finance-format.js`, junto dos demais builders:
```js
// Card de confirmação de transação de carteira/dinheiro (NÃO cartão — esse é txnRegistered).
// Blocos separados por linha em branco: confirmação → dados → (orçamento) → educação.
function buildTxnConfirmation({ type, amount, categoryEmoji, categoryLabel, account, budgetBlock, footer }) {
  const header = type === 'income' ? '✅ *Receita registrada*' : '✅ *Gasto registrado*';
  const valEmoji = type === 'income' ? '💰' : '💸';
  const dados = [`${valEmoji} ${money(amount)}  ·  ${categoryEmoji} ${categoryLabel}`];
  if (account) {
    const nb = Number(account.newBalance);
    const signed = `${nb < 0 ? '−' : '+'}${money(Math.abs(nb))}`;
    dados.push(`${account.icon || '🏦'} ${account.name} → saldo agora: *${signed}*`);
  }
  const blocks = [header, dados.join('\n')];
  if (budgetBlock) blocks.push(budgetBlock);
  if (footer) blocks.push(footer);
  return blocks.join('\n\n');
}
```
Acrescentar `buildTxnConfirmation` ao `module.exports`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/services/finance-format.test.js`
Expected: PASS (todos os testes do arquivo).

- [ ] **Step 5: Commit**

```bash
git add src/services/finance-format.js src/services/finance-format.test.js
git commit -m "feat(finance): buildTxnConfirmation — card de transação com respiro e saldo"
```

---

## Task 3: Integrar o card no handler `register_transaction`

**Files:**
- Modify: `src/engine.js` (case `'register_transaction'` em `handleFinanceAction`)

Contexto atual do case (já com o vínculo de carteira por nome, da correção anterior):
```js
    case 'register_transaction': {
      if (!p.amount || p.amount <= 0) return '❓ Qual foi o valor?';
      const type = p.type || 'expense';
      const category = p.category || mapCategory(p.description || '');
      // Vínculo à carteira por nome ("gastei 50 no Nubank"): resolve nome→id. null = sem carteira.
      let account_id = p.account_id || null; // trigger BEFORE barra conta de outro dono
      const acctName = params.account_name || params.account || p.account_name;
      if (!account_id && acctName) {
        const acct = await financeService.findAccountByName(cid, acctName);
        if (acct) account_id = acct.id;
      }
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
```

- [ ] **Step 1: Reescrever o case pra montar o card**

Substituir o bloco do case por:
```js
    case 'register_transaction': {
      if (!p.amount || p.amount <= 0) return '❓ Qual foi o valor?';
      const type = p.type || 'expense';
      const category = p.category || mapCategory(p.description || '');
      // Vínculo à carteira por nome ("gastei 50 no Nubank"): resolve nome→id. null = sem carteira.
      let account_id = p.account_id || null; // trigger BEFORE barra conta de outro dono
      let account = null; // {name, icon, balance(pre-insert)}
      const acctName = params.account_name || params.account || p.account_name;
      if (!account_id && acctName) {
        const acct = await financeService.findAccountByName(cid, acctName);
        if (acct) { account_id = acct.id; account = acct; }
      }
      const prev = type === 'expense' ? await financeService.monthCategoryTotal(cid, category) : 0;
      await financeService.insertTransaction(cid, { type, category, amount: p.amount, description: p.description, transaction_date: p.date, account_id });

      // Bloco de orçamento (só despesa com limite definido), reaproveitando buildBudgetAlert.
      let budgetBlock = null;
      if (type === 'expense') {
        const limit = await financeService.getBudget(cid, category);
        if (limit) {
          const novo = prev + Number(p.amount);
          const pct = Math.round((novo / limit) * 100);
          const meta = financeFmt.CAT_META[category] || { label: category };
          budgetBlock = `📊 ${meta.label}: ${financeFmt.money(novo)} / ${financeFmt.money(limit)} (${pct}%)`;
          const cruzou = crossedThreshold(prev, novo, limit);
          if (cruzou) budgetBlock += `\n${buildBudgetAlert(category, novo, limit, cruzou)}`;
        }
      }

      // Saldo pós-trigger por cálculo determinístico (trigger: income +amount, expense -amount).
      const meta = financeFmt.CAT_META[category] || { emoji: '📦', label: category };
      const accountForCard = account
        ? { name: account.name, icon: account.icon, newBalance: Number(account.balance) + (type === 'income' ? Number(p.amount) : -Number(p.amount)) }
        : null;
      const footer = financeFmt.buildTxnFooter({
        categoryMissing: category === 'outros',
        accountLinked: !!account_id,
        tipSeed: new Date().getUTCDate(),
      });
      return financeFmt.buildTxnConfirmation({
        type, amount: Number(p.amount),
        categoryEmoji: meta.emoji, categoryLabel: meta.label,
        account: accountForCard, budgetBlock, footer,
      });
    }
```
(`financeFmt` já está disponível no topo de `handleFinanceAction`: `const financeFmt = require('./services/finance-format');`.)

- [ ] **Step 2: Validar sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída (exit 0).

- [ ] **Step 3: Commit**

```bash
git add src/engine.js
git commit -m "feat(finance): register_transaction monta card educativo com saldo e orçamento"
```

---

## Task 4: Reforço de 1 linha na skill

**Files:**
- Modify: `skills/financeiro-pessoal.md`

- [ ] **Step 1: Acrescentar exemplo na regra de ouro**

No bloco `## Como agir`, logo após a linha de `update_goal`, adicionar:
```md
  - Numa frase só você pode mandar valor + categoria + de onde saiu: "gastei 30 no Nubank com lazer" → register_transaction com category="lazer", account_name="Nubank". Quanto mais completo, menos o engine precisa ensinar no rodapé.
```

- [ ] **Step 2: Commit**

```bash
git add skills/financeiro-pessoal.md
git commit -m "docs(skill): exemplo de transação completa (categoria + carteira)"
```

---

## Task 5: Deploy + restart + testes em produção

**Files:** nenhum (deploy).

- [ ] **Step 1: Rodar os testes puros localmente**

Run: `node --test src/services/finance-format.test.js`
Expected: PASS (todos).

- [ ] **Step 2: Validar sintaxe do engine**

Run: `node --check src/engine.js`
Expected: exit 0.

- [ ] **Step 3: SCP dos 4 arquivos + restart**

```bash
scp src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp src/services/finance-format.js tom:/opt/LA-Organizer/src/services/finance-format.js
scp src/services/finance-format.test.js tom:/opt/LA-Organizer/src/services/finance-format.test.js
scp skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "pm2 restart tom --update-env && sleep 3 && pm2 logs tom --lines 12 --nostream | grep -iE 'error|cannot find' | tail; echo HEALTH_OK"
```
Expected: `HEALTH_OK` sem linhas de erro/`cannot find`.

---

## Task 6: Smoke E2E (WhatsApp) + reconciliação no banco

**Files:** nenhum (validação manual + SQL via MCP Supabase).

- [ ] **Step 1: Bateria no WhatsApp (Alf manda, conferir resposta)**

| Mensagem | Esperado no card |
|---|---|
| `gastei 30 no Nubank` | header Gasto + `📦 Outros` + `💜 Nubank → saldo agora` + rodapé "Faltou a categoria" |
| `gastei 25 com uber` | `🚗 Transporte`, sem linha de saldo, rodapé "De onde saiu?" |
| `gastei 40 no Nubank com lazer` | `🎮 Lazer` + saldo Nubank + rodapé dica rotativa (sem ensinar edição) |
| `recebi 1000 de extra no Nubank` | header Receita + `💵 Extra` + saldo Nubank com `+` |
| `gastei 90 com mercado` (após orçamento alimentação) | bloco `📊 Alimentação …` antes do rodapé |

- [ ] **Step 2: Reconciliar saldo no banco (MCP execute_sql, projeto `cesnbnrynvxvgdhfmaua`)**

```sql
with alf as (select id from collaborators where phone like '%8047%' limit 1)
select a.name, a.balance::text as saldo_real,
  coalesce(sum(case when t.type='income' then t.amount else -t.amount end),0)::text as esperado_pelas_txs
from pf_accounts a
left join pf_transactions t on t.account_id=a.id
where a.collaborator_id=(select id from alf)
group by a.name, a.balance;
```
Expected: para cada carteira, `saldo_real == esperado_pelas_txs` (o número do card bate com o banco).

- [ ] **Step 3: Confirmar visualmente que cada card tem os 3 blocos com linha em branco** entre eles (sem "maçaroca").

---

## Notas de execução

- **Deploy é manual (SCP + pm2)** porque é engine do TOM — não espera o auto-deploy. Os 4 arquivos precisam subir juntos (o engine novo requer os builders novos do finance-format).
- **Fora de escopo (round futuro):** editar/recategorizar/excluir transação ("era 50", "muda pra alimentação", "apaga isso" + listar→apagar). O rodapé NÃO ensina esses comandos por enquanto (teste em Task 1, Step 1 garante isso).
- **Heurística aceita:** `category === 'outros'` é tratado como "faltou categoria" pro rodapé.
