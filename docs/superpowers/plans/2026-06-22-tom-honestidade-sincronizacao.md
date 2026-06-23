# TOM — Honestidade anti-"sincronização" + ação ao "já mudei a data" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps usam checkbox `- [ ]`.

**Goal:** Matar a confabulação "delay de sincronização" (prompt + rede determinística) e fazer o TOM agir no banco quando o user diz "já mudei a data".

**Architecture:** 3 frentes — (A) regra de honestidade no system prompt; (B) subfluxo novo na skill de tarefas; (C) helper puro `sync-excuse-guard.js` (TDD) plugado no chokepoint anti-confab do engine, com guarda pra não tocar o caso legítimo da fatura.

**Tech Stack:** Node CJS, node:test/node:assert, system prompt (system.js) + skills .md.

## Global Constraints

- **Voz/tom/tamanho do TOM é SAGRADO** — mexer só em honestidade + ação.
- **NÃO tocar** `src/finance/pluggy-query-format.js` (mensagem de fatura legítima) — protegida por `isInvoiceContext`.
- **Texto aprovado pelo Alf** (verbatim): `Opa — aqui do meu lado a *<tarefa>* ainda tá com prazo <data> e em aberto. Pode ser que você mudou em outro item. Pra quando ficou? Eu acerto aqui agora.`
- `_remote` não é git repo → **sem git commit por task**; auto-deploy versiona no fim do turno.
- **`.deploy-hold`** (raiz `D:\la-organizer\.deploy-hold`) ANTES de editar `src/`; remover só na Task 5 com OK.
- Engine/skills deploy = `scp` + `pm2 restart`, **só com OK explícito do Alf**.
- Validação: `node --test`/`node --check` com cwd `_remote`.

---

### Task 0: Deploy-hold

- [ ] **Step 1: Criar o hold**

Run: `echo "tom-sync-excuse 2026-06-22" > /d/la-organizer/.deploy-hold && ls /d/la-organizer/.deploy-hold`
Expected: arquivo existe.

---

### Task 1: `sync-excuse-guard.js` (rede determinística) — TDD

**Files:**
- Create: `_remote/src/lib/sync-excuse-guard.js`
- Test: `_remote/src/lib/sync-excuse-guard.test.js`

**Interfaces — Produces:**
- `hasSyncExcuse(text): boolean`
- `isInvoiceContext(text): boolean`
- `stripSyncExcuse(text): string`
- `enforceNoSyncExcuse(reply): string` — se `!isInvoiceContext && hasSyncExcuse` → `stripSyncExcuse`, senão retorna `reply` intacto.

- [ ] **Step 1: Escrever os testes (failing-first)**

Criar `_remote/src/lib/sync-excuse-guard.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { hasSyncExcuse, isInvoiceContext, stripSyncExcuse, enforceNoSyncExcuse } = require('./sync-excuse-guard');

test('frase do Matheus: detecta e remove a desculpa de sincronização', () => {
  const t = 'Entendido, vacilo meu — não cobro mais. Se o banco ainda mostra atrasado aqui do meu lado, é delay de sincronização. Fica tranquilo.';
  assert.strictEqual(hasSyncExcuse(t), true);
  const out = enforceNoSyncExcuse(t);
  assert.ok(!/sincroniz/i.test(out), 'removeu a menção a sincronização');
  assert.ok(/não cobro mais/.test(out), 'manteve o resto da frase');
  assert.ok(/Fica tranquilo/.test(out));
});

test('fatura (Open Finance): NÃO mexe — sincronização é legítima', () => {
  const t = '⚠️ A fatura deste mês ainda tá sincronizando com o banco (Open Finance) — costuma cair em 1-3 dias.';
  assert.strictEqual(isInvoiceContext(t), true);
  assert.strictEqual(enforceNoSyncExcuse(t), t);
});

test('falso-positivo: "sincronizei com o Quintela" não dispara', () => {
  const t = '✅ Sincronizei com o Quintela sobre a agenda da semana.';
  assert.strictEqual(hasSyncExcuse(t), false);
  assert.strictEqual(enforceNoSyncExcuse(t), t);
});

test('variante "demora a atualizar"', () => {
  const t = 'Pode ser que o sistema demora a atualizar. Tenta de novo.';
  assert.strictEqual(hasSyncExcuse(t), true);
  assert.ok(!/demora/i.test(enforceNoSyncExcuse(t)));
});

test('texto comum: inalterado', () => {
  const t = '✅ Fechado: *Reunião com a Bia*.';
  assert.strictEqual(enforceNoSyncExcuse(t), t);
});

test('vazio/não-string: no-op seguro', () => {
  assert.strictEqual(enforceNoSyncExcuse(''), '');
  assert.strictEqual(enforceNoSyncExcuse(null), null);
  assert.strictEqual(enforceNoSyncExcuse(undefined), undefined);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/lib/sync-excuse-guard.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o helper**

Criar `_remote/src/lib/sync-excuse-guard.js`:
```js
// src/lib/sync-excuse-guard.js
// Rede determinística anti-confabulação de CAUSA: o TOM às vezes inventa "delay de
// sincronização" pra justificar por que algo aparece atrasado/pendente. O banco de
// tarefa/evento/projeto é AO VIVO — isso é mentira (caso Matheus 22/06). SÓ é legítimo
// pra FATURA de cartão (Open Finance/Pluggy). 2ª camada — o prompt é a 1ª.
'use strict';

const SYNC_EXCUSE_RES = [
  /\b(delay|atraso)\b[^.!?\n]{0,20}sincroniz/i,
  /sincroniz\w*[^.!?\n]{0,30}(banco|sistema|app|atualiz|meu lado|cai em|dias)/i,
  /demora\w*[^.!?\n]{0,12}atualiz/i,
  /banco[^.!?\n]{0,25}(do )?meu lado/i,
];
const INVOICE_RE = /fatura|cart[ãa]o|open\s*finance|pluggy/i;

function hasSyncExcuse(text) {
  if (!text || typeof text !== 'string') return false;
  return SYNC_EXCUSE_RES.some((re) => re.test(text));
}

function isInvoiceContext(text) {
  if (!text || typeof text !== 'string') return false;
  return INVOICE_RE.test(text);
}

// Remove a(s) sentença(s) que contêm a desculpa; mantém o resto.
function stripSyncExcuse(text) {
  if (!text || typeof text !== 'string') return text;
  const parts = text.split(/(?<=[.!?\n])/); // mantém o delimitador em cada pedaço
  const kept = parts.filter((s) => !SYNC_EXCUSE_RES.some((re) => re.test(s)));
  return kept.join('').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// Se NÃO é fatura E tem a desculpa → remove. Senão, intacto.
function enforceNoSyncExcuse(reply) {
  if (!reply || typeof reply !== 'string') return reply;
  if (isInvoiceContext(reply)) return reply;
  if (!hasSyncExcuse(reply)) return reply;
  return stripSyncExcuse(reply);
}

module.exports = { hasSyncExcuse, isInvoiceContext, stripSyncExcuse, enforceNoSyncExcuse };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/lib/sync-excuse-guard.test.js`
Expected: PASS (6 testes).

- [ ] **Step 5:** Sem commit.

---

### Task 2: Wiring no `engine.js` (chokepoint anti-confab)

**Files:**
- Modify: `_remote/src/engine.js:41` (require) e `~:11223` (após `enforceNoMarkerHonesty`)

**Interfaces — Consumes:** `enforceNoSyncExcuse` (Task 1).

- [ ] **Step 1: Adicionar o require**

Em `_remote/src/engine.js`, na linha 41 (logo após o require do optimistic-confirm):
```js
const { sanitizeOptimisticConfirm, hasOptimisticConfirm, enforceNoMarkerHonesty } = require('./lib/optimistic-confirm');
```
Adicionar a linha:
```js
const { enforceNoSyncExcuse } = require('./lib/sync-excuse-guard');
```

- [ ] **Step 2: Aplicar no chokepoint**

Localizar o bloco `reply = enforceNoMarkerHonesty(reply, {...})` (~linha 11223) e seu fechamento `try/catch`. **Logo após** esse bloco (ainda antes do bloco de voz), inserir:
```js
  // SYNC-EXCUSE-CONFAB: rede determinística — remove "delay de sincronização"/desculpa
  // técnica inventada pra justificar atrasada (banco é ao vivo; só fatura sincroniza).
  // Roda antes da voz E do texto, como a Camada 1.
  try {
    const before = reply;
    reply = enforceNoSyncExcuse(reply);
    if (reply !== before) console.log('[SYNC_EXCUSE_STRIPPED] removeu desculpa de sincronização do reply');
  } catch (e) { console.error('[SYNC_EXCUSE_STRIPPED] erro:', e.message); }
```

- [ ] **Step 3: Verificar sintaxe**

Run: `cd _remote && node --check src/engine.js`
Expected: sem saída (OK).

- [ ] **Step 4:** Sem commit.

---

### Task 3: Fix A — regra de honestidade no `system.js`

**Files:**
- Modify: `_remote/src/prompts/system.js` (após o item 20 das regras de honestidade)

- [ ] **Step 1: Achar o ponto**

Run: `cd _remote && grep -n "NUNCA confirme \"marquei" src/prompts/system.js`
Expected: 1 linha (o item 20, ~112).

- [ ] **Step 2: Inserir a regra**

Logo após o texto do item 20 (`...Confirmar = só depois de emitir o marker de verdade.`), inserir um novo parágrafo (mantendo o estilo; sem renumerar — bloco destacado):
```
21. **Banco é AO VIVO — nunca invente "sincronização".** Tarefas, eventos, projetos e inventário são lidos em tempo real, sem atraso de propagação. NUNCA diga "delay de sincronização", "tá sincronizando", "demora a atualizar" ou "banco do meu lado" pra justificar por que algo aparece atrasado/pendente — é mentira; isso SÓ vale pra FATURA de cartão (Open Finance). Se o usuário afirma algo que o contexto contradiz (ex.: "mudei a data" mas a tarefa segue com o prazo antigo), diga a VERDADE com o dado do contexto ("aqui a tarefa X ainda tá com prazo <data> e em aberto") e ofereça acertar na hora. Nunca aceite a afirmação cegamente nem invente causa técnica. E nunca prometa "não cobro mais" — quem cobra é o ritual automático; ele só para quando a tarefa for reagendada/concluída/cancelada DE VERDADE.
```
(Se o item seguinte já for `21.`, renumerar a sequência a partir dele, ou usar marcador sem número conforme o padrão local — conferir o contexto ao redor antes de inserir.)

- [ ] **Step 3: Verificar sintaxe**

Run: `cd _remote && node --check src/prompts/system.js`
Expected: OK.

- [ ] **Step 4:** Sem commit.

---

### Task 4: Fix B — subfluxo "2b" na skill `checklist-tarefas.md`

**Files:**
- Modify: `_remote/skills/checklist-tarefas.md` (após o subfluxo "### 2. Reagendar tarefa (`reschedule`)", ~linha 158, antes de "### 3. Criar tarefa")

- [ ] **Step 1: Inserir o subfluxo**

Localizar o fim do subfluxo 2 (a linha `---` antes de `### 3. Criar tarefa (`create`)`). Inserir ANTES desse `---`:
```markdown

### 2b. User AFIRMA que já mudou a data (mas o banco pode não refletir)

Quando o user responde a uma cobrança/atrasada com "**eu já alterei/mudei a data**" (de entrega/validade/no app) — ele está **afirmando que mudou por fora**, NÃO pedindo pra você reagendar. Olhe o prazo da tarefa no contexto:

- **Tarefa AINDA atrasada / com o prazo antigo no contexto** → o banco não reflete; provável que ele mexeu em outro item. NÃO "fique quieto" nem invente "sincronização". Diga a verdade e ofereça acertar:
  `Opa — aqui do meu lado a *<tarefa>* ainda tá com prazo <data> e em aberto. Pode ser que você mudou em outro item. Pra quando ficou? Eu acerto aqui agora.`
  Quando ele responder a data → `reschedule`. Se ele disser que na verdade concluiu → `complete`.
- **Tarefa JÁ com a data nova / fora de atraso no contexto** → confirme e siga.

NUNCA prometa "não cobro mais": a cobrança é automática (ritual) e só para com `reschedule`/`complete`/`cancel` real no banco.
```

- [ ] **Step 2:** Sem verificação de sintaxe (markdown). Conferir visualmente que ficou entre o subfluxo 2 e o 3.

- [ ] **Step 3:** Sem commit.

---

### Task 5: Validação + deploy (com OK do Alf) + registro

- [ ] **Step 1: Gate local**

Run: `cd _remote && node --test src/lib/sync-excuse-guard.test.js && node --check src/engine.js && node --check src/prompts/system.js`
Expected: 6 testes PASS; checks OK.

- [ ] **Step 2: Pedir OK explícito do Alf** pra subir (engine + prompt + skill).

- [ ] **Step 3: Deploy (após OK)**

Run:
```bash
scp /d/la-organizer/_remote/src/lib/sync-excuse-guard.js tom:/opt/LA-Organizer/src/lib/sync-excuse-guard.js && \
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js && \
scp /d/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js && \
scp /d/la-organizer/_remote/skills/checklist-tarefas.md tom:/opt/LA-Organizer/skills/checklist-tarefas.md && \
ssh tom "pm2 restart tom >/dev/null 2>&1 && echo RESTART_OK"
```
Expected: `RESTART_OK`.

- [ ] **Step 4: Smoke VPS** (prova a rede com a fala real do Matheus + a msg de fatura):
```bash
ssh tom "cd /opt/LA-Organizer && node -e \"const {enforceNoSyncExcuse}=require('./src/lib/sync-excuse-guard'); console.log('MATHEUS:', enforceNoSyncExcuse('Entendido, vacilo meu — não cobro mais. Se o banco ainda mostra atrasado aqui do meu lado, é delay de sincronização. Fica tranquilo.')); console.log('FATURA:', enforceNoSyncExcuse('A fatura deste mês ainda tá sincronizando com o banco (Open Finance) — costuma cair em 1-3 dias.'));\""
```
Expected: MATHEUS sem "sincronização"; FATURA intacta.

- [ ] **Step 5: Registrar known-issue + memória + remover hold**

- `INSERT` em `tom_known_issues` (Supabase `cesnbnrynvxvgdhfmaua`): código `TOM-SYNC-EXCUSE-CONFAB`, area `dispatcher`/`marker`, status `corrigido`, causa (TOM generalizou a desculpa legítima de fatura Pluggy pra tarefa; não agiu no banco ao "já mudei a data"), fix (prompt honestidade + subfluxo 2b + rede `sync-excuse-guard`), afetados `Matheus`.
- Atualizar `[[project_adherence_balance]]` ou novo arquivo de memória + MEMORY.md.
- `rm -f /d/la-organizer/.deploy-hold && echo "HOLD LIBERADO"`.

---

## Self-Review

**1. Spec coverage:**
- Fix A (honestidade system.js) → Task 3. ✅
- Fix B (subfluxo 2b skill) → Task 4. ✅
- Fix C (sync-excuse-guard + wiring + telemetria) → Tasks 1/2. ✅
- Proteção fatura (isInvoiceContext) → Task 1 (testado). ✅
- Texto aprovado verbatim → Task 4. ✅
- Testes (TDD puros + smoke VPS) → Tasks 1/5. ✅

**2. Placeholder scan:** sem TBD/TODO; código real em todo step. ✅

**3. Type consistency:** `hasSyncExcuse`/`isInvoiceContext`/`stripSyncExcuse`/`enforceNoSyncExcuse` consistentes entre Task 1 (define) e Task 2 (consome só `enforceNoSyncExcuse`). ✅
