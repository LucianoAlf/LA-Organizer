# Fonte ambígua type-aware (carteira↔cartão) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Quando o nome dito colide (conta E cartão com mesmo nome, ex. "Nubank"/"C6 Bank"), a resolução de fonte passa a respeitar o tipo da transação e sinais de método: receita nunca vai pro cartão; gasto com sinal explícito ("crédito"/"débito"/"pix"/"conta") resolve direto; gasto sem sinal continua perguntando "cartão ou conta?".

**Architecture:** Toda a decisão fica na função pura `classifySource` (TDD). `resolveSource` repassa `{type, method}`. O engine lê `method` do marker e injeta. Trava defensiva no consumidor do intent binário (receita nunca grava em cartão). Backend-only (engine + service + skill). Sem PWA, sem migration.

**Tech Stack:** Node CommonJS. Deploy via scp + `pm2 restart tom`.

---

### Task 1: `classifySource` type/method-aware (TDD)

**Files:**
- Modify: `src/finance/source.js`
- Test: `src/finance/source.test.js`

- [ ] **Step 1: Escrever os testes que falham** — adicionar ao `source.test.js` (mantém os existentes):

```js
const { classifySource } = require('./source');
const ACC = ['Nubank', 'Itau'];
const CARD = ['Nubank'];

// receita nunca vai pro cartão
test('income + nome colidente → account (sem ambiguidade)', () => {
  expect(classifySource('nubank', ACC, CARD, { type: 'income' })).toEqual({ kind: 'account', accountName: 'Nubank' });
});
test('income + nome só de cartão → none (engine pergunta/usa principal)', () => {
  expect(classifySource('nubank', ['Itau'], CARD, { type: 'income' })).toEqual({ kind: 'none' });
});
// gasto com sinal explícito resolve direto
test('expense + colidente + method credito → card', () => {
  expect(classifySource('nubank', ACC, CARD, { type: 'expense', method: 'credito' })).toEqual({ kind: 'card', cardName: 'Nubank' });
});
test('expense + colidente + method debito → account', () => {
  expect(classifySource('nubank', ACC, CARD, { type: 'expense', method: 'debito' })).toEqual({ kind: 'account', accountName: 'Nubank' });
});
test('expense + colidente + method pix → account', () => {
  expect(classifySource('nubank', ACC, CARD, { type: 'expense', method: 'pix' })).toEqual({ kind: 'account', accountName: 'Nubank' });
});
// gasto sem sinal continua ambíguo (comportamento atual preservado)
test('expense + colidente + sem method → ambiguous', () => {
  expect(classifySource('nubank', ACC, CARD, { type: 'expense' })).toEqual({ kind: 'ambiguous', accountName: 'Nubank', cardName: 'Nubank' });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `cd /d/la-organizer/_remote && npx vitest run src/finance/source.test.js` (ou `node --test` se for o runner do repo; checar o topo do test existente). Espera: novos testes falham.

- [ ] **Step 3: Implementar** — substituir a função `classifySource` em `src/finance/source.js` por:

```js
function classifySource(rawName, accountNames = [], cardNames = [], opts = {}) {
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
  const type = opts.type === 'income' ? 'income' : 'expense';
  const method = String(opts.method || '').toLowerCase();
  const wantsCard = /cr[ée]dito|cart|fatura|parcel/.test(method);
  const wantsAcct = /d[ée]bito|pix|transfer|ted|doc|boleto|conta/.test(method);

  // Receita NUNCA vai pro cartão: colapsa pra conta; se só casou cartão, vira none.
  if (type === 'income') {
    if (a) return { kind: 'account', accountName: a };
    return { kind: 'none' };
  }
  // Despesa
  if (a && c) {
    if (wantsCard) return { kind: 'card', cardName: c };
    if (wantsAcct) return { kind: 'account', accountName: a };
    return { kind: 'ambiguous', accountName: a, cardName: c };
  }
  if (c) return { kind: 'card', cardName: c };
  if (a) return { kind: 'account', accountName: a };
  return { kind: 'none' };
}
```

- [ ] **Step 4: Rodar e ver passar** — todos os testes (novos + antigos) verdes.

---

### Task 2: `resolveSource` repassa `{type, method}`

**Files:** Modify `src/services/financeiro-service.js`

- [ ] **Step 1** — trocar a assinatura e a chamada de `classifySource`:

De:
```js
async function resolveSource(collaboratorId, name) {
  const accounts = await listAccounts(collaboratorId);
  const cards = await listCards(collaboratorId);
  const cls = classifySource(name, accounts.map((a) => a.name), cards.map((c) => c.name));
```
Para:
```js
async function resolveSource(collaboratorId, name, opts = {}) {
  const accounts = await listAccounts(collaboratorId);
  const cards = await listCards(collaboratorId);
  const cls = classifySource(name, accounts.map((a) => a.name), cards.map((c) => c.name), opts);
```
(o resto da função não muda.)

- [ ] **Step 2** — `node --check src/services/financeiro-service.js` → OK.

---

### Task 3: Engine — injetar method, educar, trava defensiva

**Files:** Modify `src/engine.js`

- [ ] **Step 1: ler `method` e passar pro resolveSource** — no `case 'register_transaction'`, localizar:
```js
      const srcName = params.account_name || params.account || params.carteira || params.conta || params.card || p.account_name;

      // FONTE OBRIGATÓRIA (robusta): engine resolve. Nunca grava órfã, nunca depende do LLM no turno-2.
      const src = srcName ? await financeService.resolveSource(cid, srcName) : { kind: 'none' };
```
Trocar por:
```js
      const srcName = params.account_name || params.account || params.carteira || params.conta || params.card || p.account_name;
      const srcMethod = params.method || params.metodo || params.via || p.method || '';

      // FONTE OBRIGATÓRIA (robusta): engine resolve, type-aware. Nunca grava órfã, nunca depende do LLM no turno-2.
      const src = srcName ? await financeService.resolveSource(cid, srcName, { type, method: srcMethod }) : { kind: 'none' };
```

- [ ] **Step 2: educar na pergunta de desambiguação** — localizar a string de retorno do branch `src.kind === 'ambiguous'`:
```js
        return `🤔 *${src.account.name}* é carteira e cartão. Foi no *cartão* ou na *conta*?`;
```
Trocar por:
```js
        return `🤔 *${src.account.name}* é carteira e cartão. Foi no *cartão* ou na *conta*?\n_(dica: diz "no crédito" ou "no débito/pix" que eu já anoto direto 😉)_`;
```

- [ ] **Step 3: trava defensiva no consumidor do intent binário** — localizar:
```js
            reply = card
              ? await recordCardPurchase(collab.id, card, { amount: txn.amount, description: txn.description, category: txn.category, installments: txn.installments, date: txn.date })
              : await writeCashTransaction(collab.id, { type: txn.type, category: txn.category, amount: txn.amount, description: txn.description, date: txn.date, account });
```
Trocar por:
```js
            // Receita nunca grava em cartão (defesa em profundidade): se o pendente for income, força conta.
            const useCard = !!card && txn.type !== 'income';
            reply = useCard
              ? await recordCardPurchase(collab.id, card, { amount: txn.amount, description: txn.description, category: txn.category, installments: txn.installments, date: txn.date })
              : await writeCashTransaction(collab.id, { type: txn.type, category: txn.category, amount: txn.amount, description: txn.description, date: txn.date, account });
```

- [ ] **Step 4** — `node --check src/engine.js` → OK.

---

### Task 4: Skill — documentar `method` + aliases

**Files:** Modify `skills/financeiro-pessoal.md`

- [ ] **Step 1** — na linha do `register_transaction` (params), acrescentar o `method` e nota de educação. Localizar a linha que começa com "- `register_transaction` — params:" e acrescentar ao final dela:
```
 Quando o usuário disser EXPLICITAMENTE a forma de pagamento, passe `method` ("credito"/"cartao"/"debito"/"pix"/"conta"/"transferencia") — assim o engine resolve sem perguntar quando o nome é carteira E cartão ao mesmo tempo (ex. "Nubank"). Receita (income) o engine sempre joga na conta, nunca no cartão.
```

- [ ] **Step 2** — `node --check` não se aplica (md). Conferir que o JSON de exemplo continua válido.

---

### Task 5: Deploy backend

- [ ] **Step 1** — scp dos 3 arquivos:
```bash
scp /d/la-organizer/_remote/src/finance/source.js tom:/opt/LA-Organizer/src/finance/source.js
scp /d/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp /d/la-organizer/_remote/skills/financeiro-pessoal.md tom:/opt/LA-Organizer/skills/financeiro-pessoal.md
ssh tom "pm2 restart tom"
```
Expected: scp OK; `tom` online.

---

## Notas
- `classifySource` é chamada com 3 args em outros pontos (default `opts={}` → type='expense', mantém comportamento). Backward-compatible.
- Limpeza dos 2 lançamentos de teste + smoke ficam com o controlador (fora deste plano).
