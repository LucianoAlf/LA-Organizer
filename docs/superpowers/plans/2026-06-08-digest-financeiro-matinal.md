# Digest Financeiro Matinal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir as 4–5 mensagens financeiras matinais picotadas por UMA mensagem consolidada (formato "Opção A", agrupada por urgência), enviada logo após o briefing diário.

**Architecture:** Builder puro `buildFinanceDigest` (formato Opção A) + query `dueItemsForDigest` (junta contas+faturas classificadas por urgência) + função `sendFinanceDigest` no dispatcher, engatada logo após `fireRitual('daily_briefing')`. Aposenta `checkFinanceBillReminders` e `checkCardDueReminders` do tick e remove a finance-line anexada ao briefing.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase (service_role), pm2 na VPS.

> **Convenção do repo (sobrepõe "frequent commits" da skill):** NÃO commitar por task. Trabalha tudo em `D:\la-organizer\_remote`. O deploy do TOM é `scp` + `pm2 restart` (Task 5); o commit/push é automático pelo Stop hook no fim do turno. Testes rodam com `node --test`.

---

### Task 1: Builder `buildFinanceDigest` (puro, TDD)

**Files:**
- Create: `src/finance/finance-digest.js`
- Test: `src/finance/finance-digest.test.js`

- [ ] **Step 1: Escrever o teste que falha**

```js
// src/finance/finance-digest.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildFinanceDigest, fmtMoney } = require('./finance-digest');

test('vazio → string vazia (sinaliza "não enviar")', () => {
  assert.strictEqual(buildFinanceDigest({ nome: 'Alf' }), '');
  assert.strictEqual(buildFinanceDigest({ nome: 'Alf', atrasadas: [], hoje: [], emBreve: [] }), '');
});

test('fmtMoney: inteiro sem centavos, fração com vírgula', () => {
  assert.strictEqual(fmtMoney(1800), 'R$ 1.800');
  assert.strictEqual(fmtMoney(120.5), 'R$ 120,50');
  assert.strictEqual(fmtMoney(650), 'R$ 650');
});

test('caso do print do Alf: 3 blocos em ordem + 💳 na fatura', () => {
  const msg = buildFinanceDigest({
    nome: 'Alf',
    atrasadas: [{ name: 'Aluguel', amount: 1800, dia: 5, isCard: false }],
    hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }],
    emBreve: [
      { name: 'Conta de Luz', amount: 150, dia: 10, isCard: false },
      { name: 'Fatura Nubank', amount: 650, dia: 10, isCard: true },
    ],
  });
  // ordem: atrasada → hoje → em breve
  assert.ok(msg.indexOf('🔴') < msg.indexOf('🟡'));
  assert.ok(msg.indexOf('🟡') < msg.indexOf('🔵'));
  assert.match(msg, /Aluguel · \*R\$ 1\.800\*  _\(venceu dia 5\)_/);
  assert.match(msg, /Internet · \*R\$ 120\*/);
  assert.match(msg, /💳 Fatura Nubank · \*R\$ 650\* _\(dia 10\)_/);
  assert.match(msg, /Financeiro de hoje, Alf/);
});

test('só um bloco → os outros são omitidos', () => {
  const msg = buildFinanceDigest({ nome: 'Alf', hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }] });
  assert.doesNotMatch(msg, /🔴/);
  assert.doesNotMatch(msg, /🔵/);
  assert.match(msg, /🟡/);
});

test('rodapé cita 1 conta + 1 fatura', () => {
  const msg = buildFinanceDigest({
    nome: 'Alf',
    hoje: [{ name: 'Internet', amount: 120, dia: 8, isCard: false }],
    emBreve: [{ name: 'Fatura Nubank', amount: 650, dia: 10, isCard: true }],
  });
  assert.match(msg, /"paguei internet"/);
  assert.match(msg, /"paguei a fatura do nubank"/);
});

test('só cartão → rodapé sem exemplo de conta', () => {
  const msg = buildFinanceDigest({ nome: 'Alf', hoje: [{ name: 'Fatura Nubank', amount: 650, dia: 8, isCard: true }] });
  assert.match(msg, /"paguei a fatura do nubank"/);
  assert.doesNotMatch(msg, /paguei internet/);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/finance/finance-digest.test.js`
Expected: FAIL — `Cannot find module './finance-digest'`.

- [ ] **Step 3: Implementar o builder**

```js
// src/finance/finance-digest.js
'use strict';
// Builder PURO do digest financeiro matinal (1 msg consolidada, formato "Opção A").
// Recebe itens JÁ classificados por urgência. NÚMERO vem daqui (código), nunca do LLM.

const SEP = '━━━━━━━━━━━━━━━━';

// 1800 → "R$ 1.800"; 120.5 → "R$ 120,50"
function fmtMoney(v) {
  const n = Number(v) || 0;
  const cents = Math.round((Math.abs(n) % 1) * 100);
  const intPart = Math.floor(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return 'R$ ' + intPart + (cents ? ',' + String(cents).padStart(2, '0') : '');
}

// item: { name, amount, dia, isCard }
function buildFinanceDigest({ nome, atrasadas = [], hoje = [], emBreve = [] }) {
  if (atrasadas.length + hoje.length + emBreve.length === 0) return '';
  const tag = (it) => (it.isCard ? '💳 ' : '') + it.name + ' · *' + fmtMoney(it.amount) + '*';
  const out = [`👽 *Financeiro de hoje, ${nome}*`, SEP];
  if (atrasadas.length) {
    out.push('🔴 *Atrasada*');
    for (const it of atrasadas) out.push('   ' + tag(it) + `  _(venceu dia ${it.dia})_`);
  }
  if (hoje.length) {
    if (atrasadas.length) out.push('');
    out.push('🟡 *Vence hoje*');
    for (const it of hoje) out.push('   ' + tag(it));
  }
  if (emBreve.length) {
    if (atrasadas.length || hoje.length) out.push('');
    out.push('🔵 *Em breve*');
    for (const it of emBreve) out.push('   ' + tag(it) + ` _(dia ${it.dia})_`);
  }
  out.push(SEP);
  const all = [...atrasadas, ...hoje, ...emBreve];
  const conta = all.find((i) => !i.isCard);
  const cartao = all.find((i) => i.isCard);
  const ex = [];
  if (conta) ex.push(`"paguei ${conta.name.toLowerCase()}"`);
  if (cartao) ex.push(`"paguei a fatura do ${cartao.name.replace(/^fatura\s+/i, '').toLowerCase()}"`);
  out.push(`💡 Pagou alguma? Me diz ${ex.join(' ou ')} que eu baixo aqui.`);
  return out.join('\n');
}

module.exports = { buildFinanceDigest, fmtMoney };
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `node --test src/finance/finance-digest.test.js`
Expected: PASS — todos os testes verdes.

---

### Task 2: Query `dueItemsForDigest` (financeiro-service.js)

**Files:**
- Modify: `src/services/financeiro-service.js` (adicionar função + export)

- [ ] **Step 1: Adicionar a função** (logo após `cardsForAlerts`, ~linha 643)

```js
// Junta numa só chamada o que entra no digest financeiro matinal: contas (atrasadas/hoje/
// em ≤2 dias) + faturas de cartão a vencer (≤2 dias, não pagas), classificadas por urgência.
// SEGURANÇA: tudo filtrado por collaboratorId (service_role ignora RLS).
async function dueItemsForDigest(collaboratorId, { dom, ymd }) {
  const out = { atrasadas: [], hoje: [], emBreve: [] };
  // Contas fixas vencendo em ≤2 dias (inclui atrasadas, mesma janela do ritual antigo).
  const bills = await billsDueWithin(collaboratorId, 2);
  for (const b of bills) {
    const dias = b.due_day - dom;
    const item = { name: b.name, amount: Number(b.amount), dia: b.due_day, isCard: false };
    if (dias < 0) out.atrasadas.push(item);
    else if (dias === 0) out.hoje.push(item);
    else out.emBreve.push(item);
  }
  // Faturas de cartão (mesma lógica do antigo checkCardDueReminders).
  const DAYS_BEFORE = 2;
  const y = Number(ymd.slice(0, 4)), mo = Number(ymd.slice(5, 7));
  const cards = (await cardsForAlerts()).filter((c) => c.collaborator_id === collaboratorId);
  for (const card of cards) {
    if (card.due_day < dom || card.due_day > dom + DAYS_BEFORE) continue;
    const monthOff = card.due_day >= card.closing_day ? 0 : -1;
    const dueComp = new Date(Date.UTC(y, (mo - 1) + monthOff, 1)).toISOString().slice(0, 10);
    const inv = await cardInvoice(collaboratorId, card.id, dueComp);
    if (inv.isPaid || inv.total <= 0) continue;
    const item = { name: 'Fatura ' + card.name, amount: inv.remaining, dia: card.due_day, isCard: true };
    if (card.due_day - dom === 0) out.hoje.push(item); else out.emBreve.push(item);
  }
  return out;
}
```

- [ ] **Step 2: Exportar** — adicionar `dueItemsForDigest,` na linha de export do bloco cartão (junto de `cardInvoice, cardUsage, ...`).

- [ ] **Step 3: node --check**

Run: `node --check src/services/financeiro-service.js`
Expected: sem erro (exit 0).

- [ ] **Step 4: Smoke real na VPS** (após deploy na Task 5; aqui só registrar o comando)

Run (VPS): `node -e "require('./src/services/financeiro-service').dueItemsForDigest('<cid-teste>', { dom: <dia>, ymd: '<YYYY-MM-DD>' }).then(r=>console.log(JSON.stringify(r,null,2)))"`
Expected: objeto `{atrasadas,hoje,emBreve}` coerente com as contas/faturas do colaborador de teste.

---

### Task 3: `sendFinanceDigest` no dispatcher + hook + aposentar rituais antigos

**Files:**
- Modify: `src/rituals/dispatcher.js`

- [ ] **Step 1: Adicionar `sendFinanceDigest`** (logo após `checkCardDueReminders`, ~linha 514)

```js
// Digest financeiro consolidado — enviado LOGO APÓS o briefing (substitui os rituais
// fragmentados checkFinanceBillReminders + checkCardDueReminders). 1 msg, formato Opção A.
async function sendFinanceDigest(collab, now) {
  const whatsapp = require('../services/whatsapp');
  const financeService = require('../services/financeiro-service');
  const { buildFinanceDigest } = require('../finance/finance-digest');
  const ymd = now.ymd || nowSaoPaulo().ymd;
  const dom = Number(ymd.slice(8, 10));
  try {
    if (await alreadySent(collab.id, 'financeiro_digest', ymd)) return;
    const items = await financeService.dueItemsForDigest(collab.id, { dom, ymd });
    if (items.atrasadas.length + items.hoje.length + items.emBreve.length === 0) return; // nada → sem msg
    const q = await isQuietNow(collab.id, now, 'personal');
    if (q.quiet) { await logRitualEvent(collab.id, 'financeiro_digest', 'skipped', `quiet:${q.reason}`, ymd); return; }
    const claim = await claimRitualSend(supabase, collab.id, 'financeiro_digest', ymd);
    if (!claim.won) { if (!claim.duplicate) await logRitualEvent(collab.id, 'financeiro_digest', 'error', `claim_err:${claim.code || ''}`, ymd); return; }
    const nome = String(collab.full_name || '').split(' ')[0];
    await whatsapp.sendMessage(collab.phone, buildFinanceDigest({ nome, ...items }));
  } catch (err) {
    console.error('[sendFinanceDigest]', collab.full_name, err.message);
    if (isTransientRitualError(err)) { /* claim rollback opcional: digest re-tenta amanhã */ }
    await logRitualEvent(collab.id, 'financeiro_digest', 'error', err.message, ymd);
  }
}
```

- [ ] **Step 2: Engatar após o briefing** — em `dispatcher.js:3063`, logo após `await fireRitual(c, 'daily_briefing', now.ymd);`, adicionar:

```js
          await fireRitual(c, 'daily_briefing', now.ymd);
          await sendFinanceDigest(c, now);   // digest financeiro logo depois do briefing
```

- [ ] **Step 3: Aposentar os rituais fragmentados** — em `dispatcher.js`, remover as chamadas no tick (linhas ~3655 e ~3659). Trocar:

```js
  try { await checkFinanceBillReminders(now); } catch (e) { console.error('[run] financeBillReminders', e); }
```
por:
```js
  // checkFinanceBillReminders/checkCardDueReminders aposentados: agora consolidados no
  // sendFinanceDigest (logo após o briefing). Ver docs/superpowers/specs/2026-06-08-digest-financeiro-matinal-design.md
```
E remover a linha `try { await checkCardDueReminders(now); ... }`. Manter `checkFinanceMonthly`. As funções `checkFinanceBillReminders`/`checkCardDueReminders` ficam definidas (mortas) — remover só as CHAMADAS, pra diff mínimo.

- [ ] **Step 4: node --check**

Run: `node --check src/rituals/dispatcher.js`
Expected: sem erro.

---

### Task 4: Remover a finance-line anexada ao briefing (engine.js)

**Files:**
- Modify: `src/engine.js:9352-9365`

- [ ] **Step 1: Substituir o bloco** — trocar:

```js
  // Sprint 27 — seção financeira no briefing pessoal/diário (PRD §6.5).
  // DETERMINÍSTICO: a linha "💰 Vence hoje" é montada em código e ANEXADA ao texto do LLM,
  // pra o número nunca depender do LLM (lição do Bug 3).
  let finalText = response.text;
  if (ritualType === 'daily_briefing' || ritualType === 'personal_briefing') {
    try {
      const financeService = require('./services/financeiro-service');
      const { buildBriefingFinanceLine } = require('./finance/ritual-messages');
      const dom = Number(todaySaoPaulo().slice(8, 10));
      const billsToday = (await financeService.billsDueWithin(collaboratorId, 0)).filter((b) => b.due_day === dom);
      const finLine = buildBriefingFinanceLine(billsToday);
      if (finLine) finalText = `${finalText}\n\n${finLine}`;
    } catch (e) { console.error('[Briefing finance line]', e.message); }
  }
```
por:
```js
  // Contas NÃO entram mais no briefing — saem no digest financeiro consolidado, enviado
  // logo depois pelo dispatcher (sendFinanceDigest). Spec: docs/superpowers/specs/2026-06-08-digest-financeiro-matinal-design.md
  let finalText = response.text;
```

- [ ] **Step 2: node --check**

Run: `node --check src/engine.js`
Expected: sem erro.

---

### Task 5: Deploy + smoke real + verificação manual

**Files:** nenhum (deploy)

- [ ] **Step 1: Rodar TODOS os testes locais**

Run: `node --test src/finance/finance-digest.test.js`
Expected: PASS.

- [ ] **Step 2: Syntax check dos 3 arquivos editados**

Run: `node --check src/engine.js && node --check src/rituals/dispatcher.js && node --check src/services/financeiro-service.js`
Expected: exit 0.

- [ ] **Step 3: scp + restart**

```bash
scp D:/la-organizer/_remote/src/finance/finance-digest.js tom:/opt/LA-Organizer/src/finance/finance-digest.js
scp D:/la-organizer/_remote/src/finance/finance-digest.test.js tom:/opt/LA-Organizer/src/finance/finance-digest.test.js
scp D:/la-organizer/_remote/src/services/financeiro-service.js tom:/opt/LA-Organizer/src/services/financeiro-service.js
scp D:/la-organizer/_remote/src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom"
```

- [ ] **Step 4: Smoke do digest na VPS** (colaborador de teste com contas vencendo — ex. Matheus/Alf)

Run (VPS): `node -e "const d=require('./src/rituals/dispatcher'); /* usar gatilho --force do briefing se exposto, OU chamar sendFinanceDigest direto */"`
Alternativa direta: `node -e "const f=require('./src/services/financeiro-service'); const {buildFinanceDigest}=require('./src/finance/finance-digest'); f.dueItemsForDigest('<cid>',{dom:<dia>,ymd:'<ymd>'}).then(i=>console.log(buildFinanceDigest({nome:'Alf',...i})||'(vazio → sem msg)'))"`
Expected: imprime a mensagem consolidada no formato Opção A (ou "(vazio)" se nada vencendo).

- [ ] **Step 5: Verificação de regressão**
  - Confirmar que o briefing NÃO traz mais a linha "💰 Vence hoje" (grep no log de um briefing disparado).
  - Confirmar que NÃO saem mais as mensagens 1-por-conta nem a fatura separada (os 2 rituais não são mais chamados no tick).
  - md5 local==VPS dos 5 arquivos.

---

## Self-Review

**1. Spec coverage:**
- Briefing intacto menos finance-line → Task 4. ✅
- Digest consolidado Opção A após briefing → Task 1 (builder) + Task 3 (hook). ✅
- Aposentar 2 rituais 08h → Task 3 Step 3. ✅
- Agrupamento por urgência + 💳 + rodapé + "em breve" com dia por item → Task 1 (testado). ✅
- Nada vencendo → sem msg → Task 1 (`return ''`) + Task 3 (early return). ✅
- Quiet/idempotência → Task 3 (isQuietNow + claimRitualSend 'financeiro_digest'). ✅
- Sem total → builder não soma. ✅
- Testes → Task 1 (TDD builder) + Task 2/5 (smokes). ✅

**2. Placeholder scan:** sem TBD/“handle edge cases”. Código completo em cada step. ✅

**3. Type consistency:** `dueItemsForDigest` retorna `{atrasadas,hoje,emBreve}` de itens `{name,amount,dia,isCard}`; `buildFinanceDigest` consome exatamente esse shape; `sendFinanceDigest` faz `{nome, ...items}`. Consistente. ✅
