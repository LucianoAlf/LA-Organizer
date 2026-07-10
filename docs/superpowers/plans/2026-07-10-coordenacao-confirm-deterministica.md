# Rede determinística de confirmação de coordenação (Fabi) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou superpowers:executing-plans. Steps usam checkbox (`- [ ]`).

**Goal:** Quando o TOM vai mandar um recado a outra pessoa, o "sim" da confirmação passa a executar o envio **deterministicamente** (sem depender do LLM re-emitir o marker), espelhando a rede do financeiro.

**Architecture:** O LLM emite o `<<COORDINATION_REQUEST>>` no 1º turno + escreve a pergunta; o engine **estagia** o payload num `pending_intent` (kind `confirmation`, `payload.coordination.items`) e ecoa a prosa do LLM, **sem enviar**; no "sim" (handler pré-LLM), o engine chama o `applyCoordinationRequestAction` existente e despacha.

**Tech Stack:** Node CommonJS, `node:test`. Supabase `cesnbnrynvxvgdhfmaua`. Executor reusado: `applyCoordinationRequestAction(collab, parsed) → {ok, reason, replyText?}` (engine.js:1836).

## Global Constraints

- **NÃO deployar.** `.deploy-hold` fica no ar. Os hunks de `engine.js` e `system.js` vão pra **catraca** aplicar cirúrgico sobre a cópia fresca da VPS. Só os módulos novos + testes são "meus".
- **`require('./engine')` quebra local** (engine → supabase/client, VPS-only): helpers PUROS testados com `node --test`; engine/prompt verificados por `node --check` + E2E na VPS pós-deploy.
- **Sem `git commit` entre tasks** (CLAUDE.md: `_remote` não é git repo; auto-deploy commita no fim — bloqueado pelo hold). "Fechamento" de task = testes verdes + `node --check`.
- **Voz sagrada** ([[feedback_tom_comportamento_sagrado]]): a pergunta é prosa do LLM (`cleanText`); o prompt muda só a MECÂNICA e **não sobe sem OK explícito do Alf** (Task 5).
- **Escopo:** só `COORDINATION_REQUEST` 1:1 (relay_literal/relay_assisted/followup). Fora: `COORDINATION_RESPONSE`, delegação (`TASK_UPDATE` delegate), grupos.

---

### Task 1: Helper `shouldStageCoordination` (fail-safe)

**Files:**
- Create: `src/coordination/coord-confirm.js`
- Test: `src/coordination/coord-confirm.test.js`

**Interfaces:**
- Produces: `shouldStageCoordination(items: object[], opts?: object) → boolean`

- [ ] **Step 1: Write the failing test** (guarda-corpo #1 — fail-safe)

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { shouldStageCoordination } = require('./coord-confirm');

test('fail-safe: item com mode válido → estagia', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'Jhonatan', mode: 'relay_assisted', message_body: 'valeu' }]), true);
});
test('fail-safe: mode AUSENTE ou INESPERADO → estagia (NUNCA envia cego)', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'X' }]), true);
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'X', mode: 'xpto' }]), true);
});
test('múltiplos itens → estagia', () => {
  assert.strictEqual(shouldStageCoordination([{ recipient_name: 'A' }, { recipient_name: 'B' }]), true);
});
test('nada a estagiar: vazio / não-array → false (não abre intent à toa)', () => {
  assert.strictEqual(shouldStageCoordination([]), false);
  assert.strictEqual(shouldStageCoordination(null), false);
  assert.strictEqual(shouldStageCoordination('x'), false);
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `node --test src/coordination/coord-confirm.test.js`
Expected: FAIL ("shouldStageCoordination is not a function")

- [ ] **Step 3: Minimal implementation**

```js
'use strict';
// coord-confirm.js — rede determinística de confirmação de coordenação (Fabi 10/07).
// Espelha o staging do financeiro: o engine estagia o COORDINATION_REQUEST e confirma
// antes de enviar; o "sim" despacha via applyCoordinationRequestAction (executor existente).

// shouldStageCoordination — FAIL-SAFE: estagiar é o DEFAULT. Todo COORDINATION_REQUEST em
// escopo (toca outra pessoa) DEVE confirmar antes de enviar. NUNCA "envia direto por
// omissão" (fail-OPEN = envio cego sem confirmação = proibido). O parser já rejeita mode
// fora do escopo (schema_invalid), mas este helper NÃO depende disso — retorna true pra
// qualquer lista não-vazia; só uma exceção FUTURA explicitamente segura retornaria false.
function shouldStageCoordination(items, _opts = {}) {
  return Array.isArray(items) && items.length > 0;
}

module.exports = { shouldStageCoordination };
```

- [ ] **Step 4: Run — verify PASS**

Run: `node --test src/coordination/coord-confirm.test.js`
Expected: PASS (4 tests)

---

### Task 2: Helper `buildCoordinationConfirmPreview` (fallback de voz)

**Files:**
- Modify: `src/coordination/coord-confirm.js`
- Test: `src/coordination/coord-confirm.test.js`

**Interfaces:**
- Produces: `buildCoordinationConfirmPreview(items: object[]) → string`

- [ ] **Step 1: Write the failing test** (guarda-corpo #4 — golden de voz do fallback)

```js
const { buildCoordinationConfirmPreview } = require('./coord-confirm');

test('preview 1 destinatário lê no tom do TOM', () => {
  assert.strictEqual(buildCoordinationConfirmPreview([{ recipient_name: 'Jhonatan' }]), 'Aviso o Jhonatan? Confirma?');
});
test('preview N destinatários lista os nomes', () => {
  assert.strictEqual(
    buildCoordinationConfirmPreview([{ recipient_name: 'Ana' }, { recipient_name: 'Léo' }]),
    'Aviso 2 pessoas (Ana, Léo)? Confirma?');
});
test('preview defensivo: sem recipient válido → pergunta genérica (nunca vazio)', () => {
  assert.strictEqual(buildCoordinationConfirmPreview([]), 'Confirma que eu mando esse recado?');
  assert.strictEqual(buildCoordinationConfirmPreview([{}]), 'Confirma que eu mando esse recado?');
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `node --test src/coordination/coord-confirm.test.js`
Expected: FAIL ("buildCoordinationConfirmPreview is not a function")

- [ ] **Step 3: Implementation** (adicionar ao módulo + exportar)

```js
// buildCoordinationConfirmPreview — FALLBACK da pergunta quando o LLM não escreveu prosa
// (cleanText vazio). O caminho normal usa a prosa do LLM (voz intacta); este é a rede.
function buildCoordinationConfirmPreview(items) {
  const list = (Array.isArray(items) ? items : []).filter((i) => i && i.recipient_name);
  if (!list.length) return 'Confirma que eu mando esse recado?';
  if (list.length === 1) return `Aviso o ${list[0].recipient_name}? Confirma?`;
  return `Aviso ${list.length} pessoas (${list.map((i) => i.recipient_name).join(', ')})? Confirma?`;
}

module.exports = { shouldStageCoordination, buildCoordinationConfirmPreview };
```

- [ ] **Step 4: Run — verify PASS**

Run: `node --test src/coordination/coord-confirm.test.js`
Expected: PASS (7 tests)

---

### Task 3: Hunk de STAGING no engine (bloco de coordenação)

**Files:**
- Modify: `src/engine.js` — ramo `else if (parsedCoord && parsedCoord.items)` (~11510)

**Interfaces:**
- Consumes: `shouldStageCoordination`, `buildCoordinationConfirmPreview` (Task 1-2); `pendingIntents.openIntent`, `logMarker`, `applyCoordinationRequestAction` (existentes).

- [ ] **Step 1: Reescrever o ramo** — estagia por default; o loop de envio atual vira o `else` (fail-safe: só roda se `shouldStageCoordination` disser false, que hoje nunca acontece em escopo).

```js
} else if (parsedCoord && parsedCoord.items) {
  // Audit 10/07 (Fabi) — COORD-CONFIRM-NOOP: rede determinística. Em vez de enviar direto,
  // ESTAGIA o payload e pergunta; o "sim" (handler pré-LLM ~9548) despacha via
  // applyCoordinationRequestAction. Fail-safe: shouldStageCoordination default=true → nunca
  // envia sem confirmar. A pergunta é a prosa do LLM (voz intacta); fallback = preview.
  const { shouldStageCoordination, buildCoordinationConfirmPreview } = require('./coordination/coord-confirm');
  if (shouldStageCoordination(parsedCoord.items)) {
    const _preview = (parsedCoord.cleanText && parsedCoord.cleanText.trim())
      ? parsedCoord.cleanText.trim()
      : buildCoordinationConfirmPreview(parsedCoord.items);
    const _cid = await pendingIntents.openIntent(
      collab.id, 'confirmation', { coordination: { items: parsedCoord.items } }, _preview);
    if (!_cid) {
      await logMarker(collab.id, 'COORDINATION_REQUEST', 'rejected', 'coord_confirm_intent_null', null);
      reply = 'Opa, não consegui preparar o envio do recado — me manda de novo, por favor 🙏';
    } else {
      _metrics.awaiting_user_confirm = true;
      await logMarker(collab.id, 'COORDINATION_REQUEST', 'skipped', `staged_coord:${parsedCoord.items.length}`, null);
      reply = _preview;
    }
  } else {
    // Fail-safe: caminho de envio-direto só existiria numa exceção futura de
    // shouldStageCoordination. Mantém o comportamento antigo (loop de applyCoordinationRequestAction).
    let okCount = 0, failCount = 0;
    const failedRecipients = [];
    const failedResults = [];
    for (const item of parsedCoord.items) {
      const result = await applyCoordinationRequestAction(collab, item);
      await logMarker(collab.id, 'COORDINATION_REQUEST', result.ok ? 'executed' : 'rejected', `${item.recipient_name}:${result.reason}`, null);
      if (result.ok) okCount++;
      else { failCount++; failedRecipients.push(`${item.recipient_name} (${result.reason})`); failedResults.push(result); }
    }
    if (okCount > 0) coordRequestHandledThisTurn = true;
    reply = parsedCoord.cleanText || reply;
    if (failCount > 0) {
      if (parsedCoord.items.length === 1 && okCount === 0 && failedResults[0]?.replyText) reply = failedResults[0].replyText;
      else reply = (reply || '') + `\n\n⚠️ Não consegui enviar pra: ${failedRecipients.join(', ')}.`;
    }
  }
}
```

- [ ] **Step 2: node --check**

Run: `node --check src/engine.js`
Expected: sem erro.

- [ ] **Step 3:** marcar `result='skipped'` reusado (CHECK-válido — mesmo padrão do financeiro `staged_launch`). Sem migration.

---

### Task 4: Hunk de EXECUÇÃO no "sim" + "não" (handler de confirmação)

**Files:**
- Modify: `src/engine.js` — handler pré-LLM, ramo novo ANTES do genérico (~9548, ao lado do `batch_complete`); ramo "no" (~9586).

- [ ] **Step 1: Inserir o ramo coordination no "sim"** (logo após o bloco `batch_complete`, antes de `} else if (userConfirm === 'yes') {`):

```js
      } else if (userConfirm === 'yes' && Array.isArray(target.payload?.coordination?.items) && target.payload.coordination.items.length) {
        // COORD-CONFIRM-NOOP (Fabi 10/07): confirmação de recado/aviso. Executa determinístico
        // (applyCoordinationRequestAction), sem depender do LLM re-emitir o marker. Espelha o
        // executor ancorado/batch. Retorna cedo → o LLM não é chamado (sem re-estágio/loop).
        const _items = target.payload.coordination.items;
        let _okC = 0; const _fail = [];
        for (const _it of _items) {
          try {
            const _r = await applyCoordinationRequestAction(collab, _it);
            await logMarker(collab.id, 'COORDINATION_REQUEST', _r.ok ? 'executed' : 'rejected', `${_it.recipient_name}:${_r.reason}`, null);
            if (_r.ok) _okC++; else _fail.push(_r.replyText || `${_it.recipient_name} (${_r.reason})`);
          } catch (e) { console.warn('[CoordConfirm] exec err:', e.message); _fail.push(`${_it.recipient_name} (erro)`); }
        }
        await pendingIntents.resolveIntent(target.id, 'confirmed', `coord confirm (engine) ${_okC}/${_items.length}`);
        let _outC;
        if (_okC === _items.length) _outC = _okC === 1 ? '📨 Recado enviado!' : `📨 ${_okC} recados enviados!`;
        else if (_okC > 0) _outC = `📨 Enviei ${_okC} de ${_items.length}. Não consegui: ${_fail.join('; ')}.`;
        else _outC = _fail.length === 1 ? _fail[0] : `Não consegui enviar: ${_fail.join('; ')}.`;
        try { await whatsapp.sendMessage(phone, _outC); await logConversation(collab.id, 'outbound', _outC); } catch (_) { /* já persistiu */ }
        console.log(`[Engine] processMessage DONE phone=${_phoneTail} in=${Date.now()-_t0}ms (coord_confirm_${_okC}/${_items.length})`);
        return;
```

- [ ] **Step 2: "não" — nada é enviado.** No ramo `} else if (userConfirm === 'no') {` (~9586), o `_pendingIntentToResolve = {intent: target, resolution: 'denied'}` já cobre (resolve denied + o LLM responde). Confirmar que payload.coordination não precisa de tratamento extra no "não" (não enviou nada → nada a desfazer). Sem mudança de código; validar por leitura.

- [ ] **Step 3: node --check**

Run: `node --check src/engine.js`
Expected: sem erro.

---

### Task 5: Diff do system.js:71 (PROPOSTO — gate no OK do Alf) + teste anti-over-emissão

**Files:**
- Modify (PROPOSTO): `src/prompts/system.js:71`
- Test/fixture: `src/coordination/coord-confirm.test.js` (asserção conceitual anti-over-emissão)

- [ ] **Step 1: Registrar o diff EXATO no plano** (guarda-corpo #2 — **NÃO aplicar sem OK do Alf**).

**ANTES (system.js:71, última frase do item 🚫):**
> Só emita o `<<TASK_UPDATE>>` action=delegate ou `<<COORDINATION_REQUEST>>` DEPOIS do "sim" do usuário.

**DEPOIS (proposto):**
> Para **delegar tarefa** (`<<TASK_UPDATE>>` action=delegate): emita só DEPOIS do "sim". Para **recado/aviso** (`<<COORDINATION_REQUEST>>`): emita o marker JÁ neste turno, junto com a pergunta — o engine **NÃO envia na hora**, ele estagia e confirma com o usuário; no "sim" o engine despacha sozinho. (Continua valendo: não diga "vou avisar" afirmando envio — a pergunta é "aviso o Fulano? Confirma?".)

Racional: desacopla coordenação (nova mecânica: marker staged no 1º turno) de delegação (inalterada). "NÃO envia na hora" preserva a política "nunca dispara no 1º turno" — o engine é quem segura. A Regra 12 (afirmar envio exige marker) segue: agora há marker + pergunta (sem confab).

- [ ] **Step 2: Teste anti-over-emissão** (guarda-corpo #3) — menção casual não pode virar estágio. Como o marker é emitido pelo LLM (não testável unit local), a rede determinística é: `shouldStageCoordination` só recebe `parsedCoord.items`, que só existe quando há marker `<<COORDINATION_REQUEST>>` bem-formado. Documentar o invariante + asserção de que sem items não abre intent:

```js
test('anti-over-emissão: sem marker (items vazio/ausente) → NÃO estagia', () => {
  // "o Jhonatan é gente boa" não gera <<COORDINATION_REQUEST>> → parsedCoord.items ausente
  // → shouldStageCoordination(undefined) === false → engine não abre intent de coordenação.
  assert.strictEqual(shouldStageCoordination(undefined), false);
  assert.strictEqual(shouldStageCoordination([]), false);
});
```
E na revisão E2E (Task 6): mandar "o Jhonatan é gente boa" ao TOM na VPS e conferir `marker_logs` sem `COORDINATION_REQUEST` + nenhum intent aberto.

- [ ] **Step 3: Golden de voz** (guarda-corpo #4) — E2E: "agradeça ao X" deve produzir a pergunta "Aviso o X? Confirma?" lendo IGUAL ao de hoje (prosa do LLM via `cleanText`). Conferir no smoke da catraca.

---

### Task 6: Integração + handoff pra catraca

- [ ] **Step 1: Suíte completa**

Run: `node --test src/coordination/coord-confirm.test.js src/services/user-confirmation.test.js src/utils/closing-reply.test.js src/lib/intent-executor.test.js src/utils/batch-complete.test.js src/services/reply-classify.test.js`
Expected: PASS (coord-confirm 9 + regressão adjacente).

- [ ] **Step 2: node --check**

Run: `node --check src/engine.js && node --check src/prompts/system.js && node --check src/coordination/coord-confirm.js`
Expected: sem erro.

- [ ] **Step 3: Handoff pra catraca** — pacote: `coord-confirm.js` (+test) novo; hunks `engine.js` (Task 3-4); diff PROPOSTO do `system.js:71` (Task 5, **gate OK Alf**). KI a registrar no deploy: `COORD-CONFIRM-NOOP` (coordination/alto). E2E na VPS pós-deploy: (a) "agradeça ao X" → estagia + "sim" → `COORDINATION_REQUEST executed` + entrega; (b) anti-over-emissão; (c) golden de voz. **NÃO deployar; hold no ar.**

---

## Self-Review (feito)

- **Cobertura da spec:** staging (§1)→T3; sim/não (§2-3)→T4; prompt (§4)→T5; helpers→T1-2; escopo→Global Constraints; error handling (openIntent null, recipient not found)→T3/T4; testing→T1-2,T5-6. ✔
- **Guarda-corpos:** #1 fail-safe→T1; #2 diff exato→T5 Step1 (gated); #3 anti-over-emissão→T5 Step2; #4 golden voz→T2+T5 Step3. ✔
- **Placeholders:** nenhum "TBD/TODO"; todo step com código real. ✔
- **Consistência de tipos:** `shouldStageCoordination`/`buildCoordinationConfirmPreview` mesmos nomes em T1-2-3; `payload.coordination.items` mesmo shape em T3 (escreve) e T4 (lê); `applyCoordinationRequestAction(collab, item)→{ok,reason,replyText}` consistente. ✔
