# Lote A — "Pedido largado via ritual" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que o atalho determinístico de fechamento e completes-em-lote do LLM sequestrem a resposta do usuário, sem quebrar o fechamento legítimo.

**Architecture:** Um guard PURO (`shouldClosingInterceptorFire`) gateia o interceptor de fechamento (`engine.js:7748`); a regra de negação do `parseClosingReply` é estreitada; um guard PURO (`batchCompleteNeedsConfirm`) faz o engine CONFIRMAR antes de fechar tarefas em lote não citadas. Toda a lógica decisória fica em módulos puros testáveis; o engine só consulta. Fail-safe: na dúvida, NÃO short-circuita (cai no fluxo atual).

**Tech Stack:** Node.js CommonJS, `node:test` + `node:assert`. Deploy via `scp` + `pm2 restart` (NÃO usar git commit entre tasks — o auto-deploy hook versiona no fim do turno).

> **Spec:** `docs/superpowers/specs/2026-06-15-lote-a-pedido-largado-design.md`
> **Convenção de commit deste repo:** não commitar entre tasks; o "ship" de cada lote é `scp`+`pm2 restart` após a suíte inteira verde + repro real. Os passos "Verificar" substituem os "Commit" do template.

---

## File Structure

- `src/utils/closing-reply.js` — **Modify.** Estreitar `parseClosingReply` (rule #4); adicionar `shouldClosingInterceptorFire` e `batchCompleteNeedsConfirm`; exportá-los.
- `src/utils/closing-reply.test.js` — **Create/Modify.** Testes `node:test` dos 3 acima (a trava de regressão).
- `src/engine.js` — **Modify** em 2 pontos: `~7748` (gate A1 no interceptor) e `~4044` (guard A2 antes do loop de actions).
- `src/events/detect-approval-reply.js` — **Verify** que `stripReplyScaffold` retorna `quotedText` (se não, adicionar).

---

## Task 1: Estreitar `parseClosingReply` regra #4 (mata "não foi a ADM…")

**Files:**
- Modify: `src/utils/closing-reply.js:120-123`
- Test: `src/utils/closing-reply.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `src/utils/closing-reply.test.js` (criar o arquivo com o header abaixo se não existir):

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseClosingReply } = require('./closing-reply');

test('parseClosingReply: "não foi a ADM, foi a de hoje" NÃO casa (rule #4 estreitada)', () => {
  assert.strictEqual(parseClosingReply('não foi a ADM, foi a de hoje', 3).matched, false);
});
test('parseClosingReply: bare "não" casa como nenhuma', () => {
  const r = parseClosingReply('não', 3);
  assert.strictEqual(r.matched, true);
  assert.deepStrictEqual(r.statuses, ['none', 'none', 'none']);
});
test('parseClosingReply: "nada." casa (pontuação ignorada)', () => {
  assert.strictEqual(parseClosingReply('nada.', 2).matched, true);
});
test('parseClosingReply: "fiz tudo" segue casando done (regressão)', () => {
  assert.deepStrictEqual(parseClosingReply('fiz tudo', 3).statuses, ['done', 'done', 'done']);
});
test('parseClosingReply: "1, 2 - em andamento" segue casando (regressão)', () => {
  assert.deepStrictEqual(parseClosingReply('1, 2 - em andamento', 3).statuses, ['done', 'progress', 'none']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/utils/closing-reply.test.js`
Expected: FAIL no caso "não foi a ADM" (hoje `matched:true` porque `^não\b` casa).

- [ ] **Step 3: Estreitar a regra #4**

Em `src/utils/closing-reply.js`, substituir o bloco (linhas ~120-123):

```js
  // 4) Bare "não"/"nenhuma"/"nada" sem números → não fez nenhuma (regra BUG-6 da skill).
  if (/^(n[ãa]o|nao|nenhuma|nada)\b/.test(t)) {
    return { matched: true, statuses };
  }
```

por:

```js
  // 4) Bare "não/nada/nenhuma" SOZINHO → não fez nenhuma. ESTREITADO
  //    (CLOSING-INTERCEPTOR-OVERCAPTURE): só quando a mensagem é ESSENCIALMENTE só a
  //    negação. Antes `^não\b` capturava qualquer frase iniciada por "não" ("não foi a
  //    ADM, foi a de hoje" virava "não fiz nenhuma"). Frase longa cai no LLM (fail-safe).
  const bare = t.replace(/[\s.!,]+$/g, '');
  if (/^(n[ãa]o|nao|nada|nenhuma)$/.test(bare)) {
    return { matched: true, statuses };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/utils/closing-reply.test.js`
Expected: PASS (todos, inclusive as regressões "fiz tudo" e "1, 2 - em andamento").

---

## Task 2: `shouldClosingInterceptorFire` — guard puro do interceptor

**Files:**
- Modify: `src/utils/closing-reply.js` (nova função + export)
- Test: `src/utils/closing-reply.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `src/utils/closing-reply.test.js`:

```js
const { shouldClosingInterceptorFire } = require('./closing-reply');

const TODAY = new Date('2026-06-15T18:00:00Z'); // 15:00 BRT
const mkClosing = (askedAt) => ({
  id: 'c1', kind: 'confirmation', asked_at: askedAt,
  payload: { closing: { items: [
    { index: 1, type: 'task', id: 't1', title: 'Lançamentos BG' },
    { index: 2, type: 'task', id: 't2', title: 'Editar vídeo Copa' },
  ] } },
});

test('fire=true: fechamento de HOJE, sem quote, sem fresher (Yuri positivo)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    openIntents: [], replyParsed: { userText: '1 - em andamento' }, now: TODAY });
  assert.strictEqual(r.fire, true);
});
test('fire=false not_today: fechamento de ONTEM 23h (Fabi overnight)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-14T23:00:00Z'), now: TODAY });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'not_today']);
});
test('fire=false reply_quote_elsewhere: citou menu de duplicata (Juliana)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    replyParsed: { userText: '2', quotedText: 'Qual desses? 1) Reunião ADM 2) Reunião DM' }, now: TODAY });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'reply_quote_elsewhere']);
});
test('fire=true: reply-quote AO PRÓPRIO fechamento (caso 7 positivo)', () => {
  const r = shouldClosingInterceptorFire({ closingIntent: mkClosing('2026-06-15T11:00:00Z'),
    replyParsed: { userText: '1,2', quotedText: 'Fechamento de hoje: 1) Lançamentos BG 2) Editar vídeo Copa' }, now: TODAY });
  assert.strictEqual(r.fire, true);
});
test('fire=false fresher_intent: intent aberta mais recente que o fechamento', () => {
  const c = mkClosing('2026-06-15T11:00:00Z');
  const r = shouldClosingInterceptorFire({ closingIntent: c,
    openIntents: [c, { id: 'i2', asked_at: '2026-06-15T17:00:00Z' }], now: TODAY });
  assert.deepStrictEqual([r.fire, r.reason], [false, 'fresher_intent']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/utils/closing-reply.test.js`
Expected: FAIL com "shouldClosingInterceptorFire is not a function".

- [ ] **Step 3: Implementar a função**

Em `src/utils/closing-reply.js`, antes do `module.exports`, adicionar:

```js
/**
 * Decide se o atalho determinístico de fechamento pode disparar para ESTA mensagem.
 * Princípio (CLOSING-INTERCEPTOR-OVERCAPTURE): a mensagem real do usuário vence o ritual.
 * Fail-safe: qualquer dúvida → { fire:false } (cai no fluxo normal, comportamento atual).
 * @param {{closingIntent:object, openIntents?:object[], replyParsed?:{userText?:string,quotedText?:string}, now?:Date}} args
 * @returns {{fire:boolean, reason:string}}
 */
function shouldClosingInterceptorFire(args = {}) {
  const { closingIntent, openIntents = [], replyParsed = {}, now = new Date() } = args;
  if (!closingIntent || !closingIntent.payload || !closingIntent.payload.closing) return { fire: false, reason: 'no_closing' };
  const items = closingIntent.payload.closing.items;
  if (!Array.isArray(items) || items.length === 0) return { fire: false, reason: 'no_items' };
  // (today) fechamento é de HOJE em BRT — substitui a janela de 16h corridas (caso Fabi).
  if (!closingIntent.asked_at || brtDay(closingIntent.asked_at) !== brtDay(now)) return { fire: false, reason: 'not_today' };
  // (reply-quote elsewhere) citou uma mensagem que NÃO é o fechamento (Juliana/Yuri).
  const quoted = replyParsed && replyParsed.quotedText ? String(replyParsed.quotedText).toLowerCase() : '';
  if (quoted.trim()) {
    const matchesClosing = /fechamento/.test(quoted)
      || items.some((it) => it && it.title && quoted.includes(String(it.title).toLowerCase().slice(0, 18)));
    if (!matchesClosing) return { fire: false, reason: 'reply_quote_elsewhere' };
  }
  // (fresher) há intent aberta mais recente que o fechamento → prefere a mais fresca.
  const closingAt = new Date(closingIntent.asked_at).getTime();
  const hasFresher = (openIntents || []).some((i) =>
    i && i.id !== closingIntent.id && i.asked_at && new Date(i.asked_at).getTime() > closingAt);
  if (hasFresher) return { fire: false, reason: 'fresher_intent' };
  return { fire: true, reason: 'ok' };
}
```

E no `module.exports`, adicionar `shouldClosingInterceptorFire`:

```js
module.exports = { buildClosingItems, parseClosingReply, shouldClosingInterceptorFire, _brtDay: brtDay };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/utils/closing-reply.test.js`
Expected: PASS (todos os 10 — Task 1 + Task 2).

---

## Task 3: Ligar o gate A1 no interceptor (`engine.js:7748`)

**Files:**
- Modify: `src/engine.js:7748-7757`
- Verify: `src/events/detect-approval-reply.js` (`stripReplyScaffold` retorna `quotedText`)

- [ ] **Step 1: Garantir que `stripReplyScaffold` retorna `quotedText`**

Run: `grep -n "function stripReplyScaffold" -A 25 src/events/detect-approval-reply.js`
Confirme que o retorno inclui `quotedText` (o texto citado). Se retornar só `{ userText }`, adicionar `quotedText` (a parte citada/scaffold extraída). Se já retorna, seguir.

- [ ] **Step 2: Substituir o `find` + adicionar o gate**

Em `src/engine.js`, no bloco do interceptor (linha ~7748), substituir:

```js
  try {
    const closingIntent = _openIntents.find((i) =>
      i.kind === 'confirmation' && i.payload && i.payload.closing &&
      Array.isArray(i.payload.closing.items) && i.payload.closing.items.length &&
      withinConfirmWindow(i.asked_at, 16 * 60));
    if (closingIntent) {
      const items = closingIntent.payload.closing.items;
      const _closingReplyText = stripReplyScaffold(String(text || '')).userText;
      const parsed = parseClosingReply(_closingReplyText, items.length);
      if (parsed.matched) {
```

por:

```js
  try {
    const { shouldClosingInterceptorFire } = require('./utils/closing-reply');
    const closingCandidate = _openIntents.find((i) =>
      i.kind === 'confirmation' && i.payload && i.payload.closing &&
      Array.isArray(i.payload.closing.items) && i.payload.closing.items.length);
    const _replyParsed = stripReplyScaffold(String(text || ''));
    const _closingGate = closingCandidate
      ? shouldClosingInterceptorFire({ closingIntent: closingCandidate, openIntents: _openIntents, replyParsed: _replyParsed, now: new Date() })
      : { fire: false, reason: 'no_candidate' };
    if (closingCandidate && !_closingGate.fire) {
      console.log(`[Closing] gate skip (${_closingGate.reason}) phone=${_phoneTail}`);
    }
    if (closingCandidate && _closingGate.fire) {
      const closingIntent = closingCandidate;
      const items = closingIntent.payload.closing.items;
      const _closingReplyText = _replyParsed.userText;
      const parsed = parseClosingReply(_closingReplyText, items.length);
      if (parsed.matched) {
```

(O corpo a partir de `if (parsed.matched) {` permanece **idêntico** — só muda a condição de entrada. O `withinConfirmWindow(i.asked_at, 16*60)` sai do `find`; agora quem decide a janela é o gate, por dia BRT.)

- [ ] **Step 3: Checar sintaxe**

Run: `node --check src/engine.js`
Expected: sem saída (OK).

- [ ] **Step 4: Suíte inteira (zero regressão)**

Run: `node --test src/ 2>&1 | tail -8`
Expected: `fail 0`. (Roda TODOS os `*.test.js` do backend — a trava anti-regressão.)

---

## Task 4: Guard A2 — confirmar antes de fechar lote não citado (`engine.js:~4044`)

> **Sequenciamento:** só começar após A1 (Tasks 1-3) estar deployado e verificado em produção. Toca o loop quente de `TASK_UPDATE`; isolar do A1 pra qualquer regressão ser rastreável.

**Files:**
- Modify: `src/utils/closing-reply.js` (+ `batchCompleteNeedsConfirm`)
- Modify: `src/engine.js:~4044` (antes do `for (const a of actions)`)
- Test: `src/utils/closing-reply.test.js`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar em `src/utils/closing-reply.test.js`:

```js
const { batchCompleteNeedsConfirm } = require('./closing-reply');

test('batchComplete: 2+ tarefas NÃO citadas → precisa confirmar (Leo)', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({
    completedTitles: ['Definir repertório do show', 'Alinhar com produção'],
    inboundText: 'criar 2 eventos pedagógicos pra semana que vem' }), true);
});
test('batchComplete: usuário citou as tarefas → NÃO confirma (legítimo)', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({
    completedTitles: ['Repertório do show', 'Produção do evento'],
    inboundText: 'fechei o repertório e a produção' }), false);
});
test('batchComplete: 1 tarefa só → nunca é lote', () => {
  assert.strictEqual(batchCompleteNeedsConfirm({ completedTitles: ['X'], inboundText: 'qualquer' }), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test src/utils/closing-reply.test.js`
Expected: FAIL com "batchCompleteNeedsConfirm is not a function".

- [ ] **Step 3: Implementar o helper**

Em `src/utils/closing-reply.js`, antes do `module.exports`:

```js
/**
 * Complete em LOTE (2+ tarefas) onde o usuário NÃO citou nenhuma das tarefas = sinal de
 * sequestro pelo contexto de briefing (caso Leo: pediu criar eventos, TOM "fechou" tarefas).
 * Retorna true → o engine deve CONFIRMAR antes de fechar (princípio (b): não fechar no escuro).
 * @param {{completedTitles?:string[], inboundText?:string}} args
 * @returns {boolean}
 */
function batchCompleteNeedsConfirm(args = {}) {
  const titles = (args.completedTitles || []).filter(Boolean);
  if (titles.length < 2) return false;
  const txt = String(args.inboundText || '').toLowerCase();
  if (!txt.trim()) return true;
  const referenced = titles.some((title) =>
    String(title).toLowerCase().split(/\s+/).filter((w) => w.length >= 4).some((w) => txt.includes(w)));
  return !referenced;
}
```

Adicionar `batchCompleteNeedsConfirm` ao `module.exports`.

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test src/utils/closing-reply.test.js`
Expected: PASS (13 testes).

- [ ] **Step 5: Ligar no engine antes do loop de actions (`~4044`)**

Em `src/engine.js`, imediatamente ANTES de `for (const a of actions) {` (linha ~4044), inserir o guard. Ele resolve os títulos dos completes em lote, e se `batchCompleteNeedsConfirm`, remove os completes de `actions`, empilha 1 mensagem de confirmação e abre intent ancorada — **espelhando o padrão do guard de data-futura já existente em 4087-4096** (`failMessages.push(...)` + `pendingIntents.openIntent(...)`):

```js
  // A2 (CLOSING-INTERCEPTOR-OVERCAPTURE / caso Leo): complete em LOTE (2+) sem o usuário
  // citar as tarefas = provável sequestro pelo contexto de briefing. Confirma antes de fechar.
  try {
    const { batchCompleteNeedsConfirm } = require('./utils/closing-reply');
    const completes = actions.filter((a) => a && a.action === 'complete');
    if (completes.length >= 2) {
      const titles = [];
      for (const c of completes) {
        const tt = await resolveTaskByShortId(collaborator.id, c.id).catch(() => null);
        if (tt && tt.title) titles.push(tt.title);
      }
      if (batchCompleteNeedsConfirm({ completedTitles: titles, inboundText: text })) {
        const lista = titles.map((t) => `*${t}*`).join(', ');
        failMessages.push(`Você quer que eu feche ${titles.length} tarefas (${lista})? Não vi você citar elas na mensagem.`);
        try {
          await pendingIntents.openIntent(collaborator.id, 'confirmation',
            { batch_complete: completes.map((c) => c.id) },
            `Confirmar fechamento em lote: ${lista}?`);
        } catch (_) { /* intent best-effort */ }
        actions = actions.filter((a) => !(a && a.action === 'complete'));
        console.warn(`[Task] batch-complete não-ancorado (${titles.length}) → pedindo confirmação, removido do lote`);
      }
    }
  } catch (e) { console.warn('[Task] A2 guard err:', e.message); }
```

(Confirme que `actions` é reatribuível — se for `const`, trocar a linha 4041 `actions = allowed;` indica que já é `let`. Se for `const`, ajustar para filtrar numa nova variável usada no loop.)

- [ ] **Step 6: Checar sintaxe + suíte inteira**

Run: `node --check src/engine.js && node --test src/ 2>&1 | tail -8`
Expected: OK + `fail 0`.

---

## Task 5: Deploy isolado + verificação real + registro

- [ ] **Step 1: Baseline da suíte (antes do deploy)**

Run: `node --test src/ 2>&1 | tail -8` → `fail 0`. Run web se tocou TS: `cd web && npx tsc --noEmit` (não toca nesse lote — pular).

- [ ] **Step 2: Deploy A1 primeiro (scp + restart)**

```bash
scp D:/la-organizer/_remote/src/utils/closing-reply.js tom:/opt/LA-Organizer/src/utils/closing-reply.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && md5sum src/utils/closing-reply.js src/engine.js"
```
Conferir md5 local == VPS. Depois: `ssh tom "pm2 restart tom"` e checar `status=online unstable=0`.

- [ ] **Step 3: Reproduzir os casos reais na VPS (prova)**

Rodar um script descartável (fora de `_remote`, requires absolutos) que carrega `shouldClosingInterceptorFire` e roda os cenários Fabi/Juliana/Yuri com os `asked_at` reais (mesmo padrão da verificação de governança desta sessão). Esperado: Fabi/Juliana → `fire:false`; Yuri → `fire:true`.

- [ ] **Step 4: Registrar known issue**

INSERT em `tom_known_issues` (`codigo='CLOSING-INTERCEPTOR-OVERCAPTURE'`, area `marker`, severidade `medio`, status `corrigido`) com causa_raiz (janela 16h + descarta reply-quote + rule #4 gulosa) e fix_resumo (gate `shouldClosingInterceptorFire` por dia BRT + reply-quote + fresher; rule #4 estreitada; A2 confirma lote não citado). `sinal_padrao`: "resposta de fechamento aplicada a outra coisa / fechamento de ontem captura msg de hoje".

- [ ] **Step 5: Marcar os findings do audit como corrigidos**

UPDATE `tom_audit_findings SET status='corrigido', promoted_code='CLOSING-INTERCEPTOR-OVERCAPTURE'` nos ids dos casos Fabi/Juliana/Leo/Yuri (evita reincidência no próximo audit — pré-requisito do Lote F).

---

## Self-Review (feito)

- **Cobertura do spec:** A1 (rule #4 → Task 1; gate → Tasks 2-3) ✓; A2 → Task 4 ✓; testes 1-7 do spec → cobertos nos testes das Tasks 1-2 e na repro da Task 5 ✓; protocolo anti-regressão → Task 3 Step 4 + Task 5 ✓.
- **Sem placeholders:** todo passo tem código/comando reais.
- **Consistência de tipos:** `shouldClosingInterceptorFire({closingIntent, openIntents, replyParsed, now})→{fire,reason}` e `batchCompleteNeedsConfirm({completedTitles, inboundText})→bool` usados igualzinho no engine. `brtDay` reutilizado do próprio arquivo.
- **#8 (reply-quote reschedule do Alf) fora deste plano** → Lote D (decidido no spec).
