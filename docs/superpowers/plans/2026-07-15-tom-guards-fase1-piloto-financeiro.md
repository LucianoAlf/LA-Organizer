# TOM Guards Fase 1 (piloto financeiro) — Plano de Implementação

> ## ⛔ NÃO EXECUTAR — PLANO ENCERRADO (15/07)
> Piloto **refutado pela própria investigação** (Task 0 confirmou a premissa mas revelou que o financeiro já é estado-gateado). Ver o bloco de encerramento na spec: `docs/superpowers/specs/2026-07-15-tom-guards-fase1-piloto-financeiro-design.md`. Resumo: Tasks 2-3 = no-op (detectores já gateados por intent, `engine.js:9404`/`8553`); Task 1 = infra sem consumidor; Task 4 = reprovada (regressiva + conceitualmente furada). Único deliverable que ficou: a **Task 0** (premissa confirmada) e o **baseline verde** (80/80). Nenhuma linha foi pra produção. A Fase 1 só reabre com falso-positivo de guard **global** documentado. Registro durável: `[[project_guards_fase1_turnstate_review]]`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Converter os guards do fluxo financeiro de confirmação de decisão-por-regex-de-texto para decisão-por-estado-do-turno + gate de domínio, matando na raiz a classe de bug que gerou os 4 incidentes de 14/07.

**Architecture:** Um helper puro `financeTurnState(openIntents, markerRows)` deriva o estado do turno (`pendingAction`/`proposal`/`domain`) do que o engine já lê. Os detectores financeiros passam a decidir *contra a proposta pendente*; o guard de recado ganha gate de domínio *por sinal de coordenação*. Sem estado → comportamento de hoje (nunca pior).

**Tech Stack:** Node.js CommonJS, `node:test`, deploy scp+pm2 na VPS, intents em `pending_intents` (Supabase).

## Global Constraints

- **Zero-regressão:** as suítes `src/finance/*.test.js`, `src/lib/coord-send-honesty.test.js`, `src/services/user-confirmation` (via launch-confirm.test.js) passam **antes e depois** de cada task. Nenhuma quebra.
- **Compatibilidade:** todo detector aceita `turnState` como parâmetro **opcional**; ausente → comportamento atual (os testes de 14/07 continuam válidos sem mudança).
- **Segurança de decisão:** na dúvida entre lançar e não, **não lança**; na dúvida entre silenciar guard de recado e deixar falar, **deixa falar** (falso-negativo de honestidade é pior que falso-positivo).
- **Deploy:** cada task de produção sobe via `.deploy-hold` + scp cirúrgico; a catraca revisa antes do restart. Helpers puros (Tasks 1-4) não deployam nada.
- **Premissa confirmada (Task 0):** `_openIntents` (engine.js:8522) disponível em todos os pontos de disparo; markers financeiros setados em ~11935 (DEPOIS do enforceSendHonesty 11636) → o gate do guard de recado usa **intents**, não marker-do-turno.

---

## File Structure

- `src/finance/finance-turn-state.js` (novo) — helper puro; deriva o estado do turno das intents+markers.
- `src/finance/finance-turn-state.test.js` (novo) — TDD do helper.
- `src/finance/invoice-import.js` (modificar) — `detectInvoiceReply(text, turnState?)` decide contra a proposta.
- `src/finance/launch-confirm.js` (modificar) — `detectLaunchConfirm(text, conf, turnState?)` decide contra a proposta.
- `src/lib/coord-send-honesty.js` (modificar) — `enforceSendHonesty(text, { turnState, isQuestion })` gate por sinal de coordenação.
- `src/engine.js` (modificar) — monta `turnState` 1x após 8523; passa aos detectores (9405, 8551-ish) e ao guard (11636).
- Testes-regressão: os 4 bugs de 14/07 já têm testes nos arquivos `.test.js`; esta fase adiciona as variantes com `turnState`.

---

## Task 0: Baseline verde + premissa confirmada

**Files:** nenhum (investigação + baseline).

- [ ] **Step 1: Rodar as suítes-alvo e confirmar verde ANTES de tocar em nada**

Run: `cd _remote && node --test src/finance/invoice-import.test.js src/finance/launch-confirm.test.js src/finance/pick-invoice-card.test.js src/lib/coord-send-honesty.test.js`
Expected: `pass` em todos, `fail 0`. (Baseline pra provar zero-regressão depois.)

- [ ] **Step 2: Registrar a premissa confirmada no topo do plano**

Já feito (ver "Premissa confirmada" nas Global Constraints): `_openIntents` disponível nos pontos de disparo; markers financeiros rodam depois do enforceSendHonesty → gate usa intents. Sem código.

---

## Task 1: `finance-turn-state.js` (helper puro, TDD)

**Files:**
- Create: `src/finance/finance-turn-state.js`
- Test: `src/finance/finance-turn-state.test.js`

**Interfaces:**
- Produces: `financeTurnState(openIntents, markerRows) -> { pendingAction, proposal, domain, hasCoordSignal }`
  - `pendingAction`: `'launch' | 'pay_invoice' | 'invoice_import' | null`
  - `proposal`: `{ card, amount, itens, competencia } | null` (do payload da intent ativa)
  - `domain`: `'finance' | null`
  - `hasCoordSignal`: `boolean` (marker COORDINATION_REQUEST no turno)

- [ ] **Step 1: Escrever o teste que falha**

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { financeTurnState } = require('./finance-turn-state');

const invIntent = { kind: 'invoice_import', asked_at: '2026-07-14T22:00:00Z',
  payload: { stage: 'awaiting_confirm', emissor: 'Itaú', itens: [{ valor: 10 }], vencimento: '2026-07-10' } };
const launchIntent = { kind: 'finance_source', asked_at: '2026-07-14T22:00:00Z',
  payload: { form: 'launch_confirm', actions: [{ action: 'card_purchase', params: { card: 'Nubank', amount: 50 } }] } };
const payIntent = { kind: 'finance_source', asked_at: '2026-07-14T22:00:00Z',
  payload: { form: 'launch_confirm', actions: [{ action: 'pay_invoice', params: { card: 'Nubank', amount: 900 } }] } };

test('invoice_import awaiting_confirm → pendingAction invoice_import + domain finance', () => {
  const s = financeTurnState([invIntent], []);
  assert.strictEqual(s.pendingAction, 'invoice_import');
  assert.strictEqual(s.domain, 'finance');
  assert.strictEqual(s.proposal.itens.length, 1);
});
test('finance_source launch_confirm card_purchase → launch', () => {
  assert.strictEqual(financeTurnState([launchIntent], []).pendingAction, 'launch');
});
test('finance_source launch_confirm pay_invoice → pay_invoice', () => {
  assert.strictEqual(financeTurnState([payIntent], []).pendingAction, 'pay_invoice');
});
test('form list / undo_launch NÃO são proposta de commit → pendingAction null mas domain finance', () => {
  const listI = { kind: 'finance_source', payload: { form: 'list' } };
  const s = financeTurnState([listI], []);
  assert.strictEqual(s.pendingAction, null);
  assert.strictEqual(s.domain, 'finance');
});
test('sem intent financeira → tudo null (comportamento de hoje)', () => {
  const s = financeTurnState([{ kind: 'confirmation', payload: {} }], []);
  assert.strictEqual(s.pendingAction, null);
  assert.strictEqual(s.domain, null);
});
test('marker COORDINATION_REQUEST no turno → hasCoordSignal true', () => {
  assert.strictEqual(financeTurnState([], [{ marker_type: 'COORDINATION_REQUEST', result: 'executed' }]).hasCoordSignal, true);
});
test('input nulo/vazio é seguro', () => {
  const s = financeTurnState(null, null);
  assert.strictEqual(s.pendingAction, null);
  assert.strictEqual(s.domain, null);
  assert.strictEqual(s.hasCoordSignal, false);
});
test('mais de uma intent financeira → prioriza a mais recente por asked_at', () => {
  const older = { kind: 'finance_source', asked_at: '2026-07-14T21:00:00Z', payload: { form: 'launch_confirm', actions: [{ action: 'card_purchase', params: {} }] } };
  const newer = { kind: 'invoice_import', asked_at: '2026-07-14T22:00:00Z', payload: { stage: 'awaiting_confirm', itens: [] } };
  assert.strictEqual(financeTurnState([older, newer], []).pendingAction, 'invoice_import');
});
```

- [ ] **Step 2: Rodar → falha ("Cannot find module './finance-turn-state'")**

Run: `node --test src/finance/finance-turn-state.test.js`
Expected: FAIL.

- [ ] **Step 3: Implementar o helper**

```js
'use strict';
// Estado do turno financeiro (Fase 1). PURO: recebe o que o engine já leu (intents abertas +
// marker_logs do turno) e deriva a proposta pendente + o domínio. Sem I/O. A decisão dos guards
// passa a consultar isto em vez de re-adivinhar pelo texto.

// Intents financeiras que representam uma PROPOSTA aguardando confirmação (o alvo do detector).
function _pendingFrom(intent) {
  if (!intent || !intent.payload) return null;
  const p = intent.payload;
  if (intent.kind === 'invoice_import' && p.stage === 'awaiting_confirm') return 'invoice_import';
  if (intent.kind === 'finance_source' && p.form === 'launch_confirm') {
    const act = (p.actions && p.actions[0] && p.actions[0].action) || '';
    return act === 'pay_invoice' ? 'pay_invoice' : 'launch';
  }
  return null; // form list/undo_launch etc.: é financeiro (domain) mas não proposta de commit
}

function _proposalFrom(intent, pending) {
  if (!intent || !intent.payload) return null;
  const p = intent.payload;
  if (pending === 'invoice_import') {
    return { card: p.emissor || p.card_name || null, amount: null, itens: p.itens || [], competencia: p.vencimento || null };
  }
  const params = (p.actions && p.actions[0] && p.actions[0].params) || {};
  return { card: params.card || params.account_name || null, amount: params.amount || null, itens: null, competencia: params.competencia || null };
}

function financeTurnState(openIntents, markerRows) {
  const intents = Array.isArray(openIntents) ? openIntents : [];
  const markers = Array.isArray(markerRows) ? markerRows : [];
  const fin = intents
    .filter((i) => i && (i.kind === 'finance_source' || i.kind === 'invoice_import'))
    .sort((a, b) => String(b.asked_at || '').localeCompare(String(a.asked_at || ''))); // mais recente 1º
  const active = fin[0] || null;
  const pendingAction = active ? _pendingFrom(active) : null;
  const domain = fin.length ? 'finance' : null;
  const hasCoordSignal = markers.some((m) => m && m.marker_type === 'COORDINATION_REQUEST');
  return { pendingAction, proposal: pendingAction ? _proposalFrom(active, pendingAction) : null, domain, hasCoordSignal };
}

module.exports = { financeTurnState };
```

- [ ] **Step 4: Rodar → passa**

Run: `node --test src/finance/finance-turn-state.test.js`
Expected: `pass 8, fail 0`.

- [ ] **Step 5: Sintaxe**

Run: `node --check src/finance/finance-turn-state.js`
Expected: sem saída (ok).

---

## Task 2: `detectInvoiceReply(text, turnState)` decide contra a proposta

**Files:**
- Modify: `src/finance/invoice-import.js` (função `detectInvoiceReply`, ~153)
- Test: `src/finance/invoice-import.test.js`

**Interfaces:**
- Consumes: `financeTurnState(...)` (Task 1) — usa `turnState.pendingAction === 'invoice_import'`.
- Produces: `detectInvoiceReply(text, turnState?) -> 'commit_financeiro' | 'commit_anotacoes' | 'cancel' | null`

- [ ] **Step 1: Escrever os testes que falham (turnState como contexto)**

```js
test('turnState invoice_import: afirmação clara commita; pergunta/ver NÃO (regressão 14/07 mantida)', () => {
  const ts = { pendingAction: 'invoice_import' };
  assert.strictEqual(detectInvoiceReply('pode lançar', ts), 'commit_financeiro');
  assert.strictEqual(detectInvoiceReply('Sim, me passa só o que falta lançar', ts), null); // view
  assert.strictEqual(detectInvoiceReply('qual fatura?', ts), null);                        // pergunta
  assert.strictEqual(detectInvoiceReply('não, cancela', ts), 'cancel');
});
test('turnState ausente → comportamento de hoje (compat)', () => {
  assert.strictEqual(detectInvoiceReply('pode lançar'), 'commit_financeiro');
  assert.strictEqual(detectInvoiceReply('Sim, me passa só o que falta lançar'), null);
});
```

- [ ] **Step 2: Rodar → passa já? Se sim, o parâmetro é aditivo.** As travas de 14/07 (`RE_VIEW_REQUEST` etc.) já cobrem os casos; `turnState` reforça sem quebrar.

Run: `node --test src/finance/invoice-import.test.js`
Expected: os testes novos passam (o detector atual já os satisfaz); confirma que o parâmetro é compatível.

- [ ] **Step 3: Aceitar `turnState` na assinatura (aditivo) + comentário**

```js
// turnState (Fase 1): quando pendingAction === 'invoice_import', a decisão é lida CONTRA a
// proposta pendente — os regexes (RE_VIEW_REQUEST, anchored) viram rede secundária. Ausente →
// comportamento de hoje.
function detectInvoiceReply(text, turnState) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  // (corpo atual inalterado — RE_VIEW_REQUEST → null, RE_CANCEL, RE_ANOTAR, RE_COMMIT_ANCHORED)
  // turnState é consumido pelo engine pra GATEAR quando este detector roda (só há proposta de
  // import se pendingAction === 'invoice_import'); a lógica léxica permanece a mesma.
  ...
}
```

- [ ] **Step 4: Rodar a suíte inteira → verde**

Run: `node --test src/finance/invoice-import.test.js`
Expected: `fail 0`.

---

## Task 3: `detectLaunchConfirm(text, conf, turnState)` decide contra a proposta

**Files:**
- Modify: `src/finance/launch-confirm.js` (função `detectLaunchConfirm`, ~68)
- Test: `src/finance/launch-confirm.test.js`

**Interfaces:**
- Produces: `detectLaunchConfirm(text, conf, turnState?) -> 'yes' | 'no' | null`

- [ ] **Step 1: Testes com turnState (regressão de hoje preservada)**

```js
test('turnState launch: pergunta e negação nunca lançam; afirmação lança', () => {
  const ts = { pendingAction: 'launch' };
  const conf = (t) => detectLaunchConfirm(t, require('../services/user-confirmation').detectUserConfirmation(t), ts);
  assert.strictEqual(conf('Tom, você vai lançar em qual fatura?'), null);
  assert.strictEqual(conf('Não lança'), 'no');
  assert.strictEqual(conf('pode lançar'), 'yes');
});
test('turnState ausente → comportamento de hoje', () => {
  assert.strictEqual(detectLaunchConfirm('pode lançar', 'yes'), 'yes');
});
```

- [ ] **Step 2: Rodar → passa (aditivo)**

Run: `node --test src/finance/launch-confirm.test.js`
Expected: novos testes verdes; parâmetro compatível.

- [ ] **Step 3: Aceitar `turnState` (aditivo)** — assinatura `detectLaunchConfirm(text, conf, turnState)`; corpo léxico inalterado (as guardas `_LAUNCH_QUESTION`/`_LAUNCH_NEG` de hoje permanecem). `turnState` é o gate de "existe proposta de launch" no engine.

- [ ] **Step 4: Suíte verde**

Run: `node --test src/finance/launch-confirm.test.js`
Expected: `fail 0`.

---

## Task 4: Gate de domínio no `enforceSendHonesty` (por sinal de coordenação)

**Files:**
- Modify: `src/lib/coord-send-honesty.js` (`enforceSendHonesty`)
- Test: `src/lib/coord-send-honesty.test.js`

**Interfaces:**
- Consumes: `turnState.domain`, `turnState.hasCoordSignal` (Task 1).
- Produces: `enforceSendHonesty(text, { isQuestion, turnState }) -> { reply, fired }`

- [ ] **Step 1: Testes — o caso Rose + a armadilha do falso-negativo (trava 2)**

```js
test('gate: turno financeiro SEM sinal de coordenação → guard NÃO age (Rose 14/07)', () => {
  const ts = { domain: 'finance', hasCoordSignal: false };
  const r = enforceSendHonesty('💳 Latam PASS · 62 itens\nMandando pra fatura de julho.', { turnState: ts });
  assert.strictEqual(r.fired, false);
});
test('gate: turno financeiro COM recado real (hasCoordSignal) → guard AINDA age (anti falso-negativo)', () => {
  const ts = { domain: 'finance', hasCoordSignal: true };
  const r = enforceSendHonesty('Avisei o Jhon sobre a fatura.', { turnState: ts });
  assert.strictEqual(r.fired, true, 'recado real num turno financeiro NÃO pode ser silenciado');
  assert.match(r.reply, /N[ÃA]O avisei/i);
});
test('sem turnState → comportamento de hoje (coordenação normal dispara)', () => {
  assert.strictEqual(enforceSendHonesty('Mandei o recado pra ela agora.', {}).fired, true);
});
```

- [ ] **Step 2: Rodar → o 1º teste falha** (hoje o guard não conhece turnState; "Mandando pra fatura" já é barrado pelo FIN_CTX por-linha, mas o gate por-estado é a 1ª linha — confirmar).

Run: `node --test src/lib/coord-send-honesty.test.js`
Expected: FAIL no teste do gate financeiro (turnState ignorado).

- [ ] **Step 3: Implementar o gate (afirma por sinal, não nega por domínio)**

```js
function enforceSendHonesty(text, opts = {}) {
  const { isQuestion = false, turnState = null } = opts;
  const s = String(text || '');
  // GATE DE DOMÍNIO (Fase 1, trava catraca): num turno com ação financeira e SEM sinal de
  // coordenação, "mandando/enviado" é financeiro → não age. MAS se há recado real no turno
  // (hasCoordSignal), o guard age mesmo em turno financeiro — senão silenciaria confab de recado
  // (falso-negativo, pior). O léxico por-linha (strong/weak+FIN_CTX) segue como 2ª linha.
  if (turnState && turnState.domain === 'finance' && !turnState.hasCoordSignal) {
    return { reply: s, fired: false };
  }
  if (isQuestion || !claimsSent(s)) return { reply: s, fired: false };
  const stripped = stripOptimisticSendLines(s);
  if (!stripped && s.length > 160) return { reply: s, fired: false };
  return { reply: stripped ? `${stripped}\n\n${SEND_NOMARKER_DISCLAIMER}` : SEND_NOMARKER_DISCLAIMER, fired: true };
}
```

- [ ] **Step 4: Suíte verde (regressão + gate)**

Run: `node --test src/lib/coord-send-honesty.test.js`
Expected: `fail 0` (os 22 de hoje + os 3 novos).

---

## Task 5: Wiring no engine + smoke real

**Files:**
- Modify: `src/engine.js` (montar turnState após 8523; passar aos detectores 9405 e ao guard 11636)

- [ ] **Step 1: Montar o turnState 1x após ler as intents (engine.js ~8524)**

```js
let _openIntents = [];
try { _openIntents = await pendingIntents.listOpenIntents(collab.id, { limit: 3 }); }
catch (e) { /* ... */ }
// Fase 1: estado do turno financeiro (intents + markers já rodados). Fail-safe: erro → null.
let _finTurn = null;
try { _finTurn = require('./finance/finance-turn-state').financeTurnState(_openIntents, _turnMarkerRows || []); }
catch (e) { console.warn('[FinTurnState] err:', e.message); }
```

(`_turnMarkerRows` = as linhas de marker_logs do turno já disponíveis; se não houver acumulador no ponto, passar `[]` — o gate usa `domain` das intents, que basta pro caso real. Confirmar no wiring.)

- [ ] **Step 2: Passar aos detectores**

`engine.js:9405`: `const _decision = invoiceImport.detectInvoiceReply(text, _finTurn);`
`engine.js` (consumidor launch, ~8551): `launchConfirm.detectLaunchConfirm(String(text||''), conf, _finTurn)`.

- [ ] **Step 3: Passar ao guard de recado (engine.js:11636)**

```js
const _sh = enforceSendHonesty(reply, { isQuestion: hasTrailingQuestion(reply) || isInfoGatheringReply(reply), turnState: _finTurn });
```

- [ ] **Step 4: node --check + suíte inteira de finance/coord (zero-regressão)**

Run: `node --check src/engine.js && node --test src/finance/*.test.js src/lib/coord-send-honesty.test.js`
Expected: `node --check` ok; `fail 0` em tudo.

- [ ] **Step 5: Deploy cirúrgico (via catraca) + smoke real na VPS**

`.deploy-hold` protege; scp dos 5 arquivos; `pm2 restart tom`; smoke no processo real (`node -e` require dos módulos) reproduzindo os 4 casos de 14/07 + verificar no banco que nada lançou indevido.

---

## Task 6: KI + memória + abrir janela de aceite

- [ ] **Step 1: Registrar em `tom_known_issues`** um entry `FASE1-GUARDS-TURNSTATE-FINANCE` (status corrigido) com o padrão e os 4 bugs cobertos.
- [ ] **Step 2: Memória** — atualizar `[[project_sendhonesty_falsefire_finance]]` e `[[project_invoice_import_view_and_card_guards]]` apontando o padrão estado+gate; nota na Fase 0.
- [ ] **Step 3: Abrir a janela de aceite** — anotar a data; reincidência ZERO da classe no fluxo financeiro por ~2 semanas em `tom_known_issues`/`marker_logs` fecha o piloto e valida o molde pras próximas fases.

---

## Self-Review

- **Cobertura da spec:** Task 0 = premissa (spec §Task 0) ✓; Task 1 = finance-turn-state (§Componentes 1) ✓; Tasks 2-3 = detectores contra proposta (§Componentes 2) ✓; Task 4 = gate por sinal (§Componentes 3 + trava 2) ✓; Task 5 = wiring (§Componentes 4 + Fluxo) ✓; Task 6 = portão de aceite (§Portão) ✓. Bordas (§Bordas): fail-safe try/catch na Task 5, compat opcional nas Tasks 2-4 ✓.
- **Placeholders:** o único ponto aberto é `_turnMarkerRows` na Task 5 Step 1 — resolvido explicitamente (passar `[]` se não houver acumulador; o gate usa `domain` das intents). Não é buraco, é decisão.
- **Consistência de tipos:** `financeTurnState -> {pendingAction, proposal, domain, hasCoordSignal}` usado igual em todas as tasks; `enforceSendHonesty(text, {isQuestion, turnState})` consistente entre Task 4 e Task 5 Step 3.
