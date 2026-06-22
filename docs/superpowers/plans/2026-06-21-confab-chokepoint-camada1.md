# Chokepoint Anti-Confabulação — Camada 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Um chokepoint único que impede o TOM de afirmar "✅ feito" quando NADA persistiu no turno — cobrindo todos os ~14 handlers de uma vez.

**Architecture:** 2 funções puras novas em `src/lib/optimistic-confirm.js` (`hasCompletionClaim` = gate verbo-baseado; `enforceNoMarkerHonesty` = aplica o rebaixamento) + UMA chamada no `engine.js` no ponto único de pré-envio (cobre voz e texto). Reusa sinais já computados (`_metrics`) e o `sanitizeOptimisticConfirm` existente.

**Tech Stack:** Node CJS, `node --test`/`--check`, cwd `_remote`.

## Global Constraints
- **Voz do TOM é sagrada:** corrige só honestidade; NUNCA o jeito de falar. O gate é verbo-baseado pra NÃO tocar ✅ decorativo.
- **Zero regressão:** os guards por-handler atuais (TASK/EVENT) FICAM; rodar o teste existente da lib; vocab só adiciona (passado/particípio).
- `_remote` NÃO é git repo → pular `git commit` por-task (auto-deploy bundla no fim do turno).
- Auto-deploy faz `pm2 restart` quando `src/` muda → **criar `.deploy-hold` na raiz ANTES de editar `src/`**; remover só na Task 3 com OK do Alf.
- Deploy (scp+restart) **só com OK explícito do Alf**. scp com path ABSOLUTO (`/d/la-organizer/_remote/...` — cwd reseta).
- Fora de escopo (próximo): bug #1 da Ana (parser `title→habit_name`) e Camada 2 (executor determinístico de confirmação).

---

### Task 0: Salvaguarda — `.deploy-hold`

- [ ] **Step 1: Criar o hold (antes de tocar em src/)**

Escrever `D:\la-organizer\.deploy-hold` com conteúdo:
```
HOLD — Camada 1 chokepoint anti-confab (plano 2026-06-21-confab-chokepoint-camada1.md).
Não auto-deployar feature pela metade. Lift na Task 3 com OK do Alf.
```

---

### Task 1: Lib `optimistic-confirm.js` — `hasCompletionClaim` + `enforceNoMarkerHonesty` (TDD)

**Files:**
- Modify: `_remote/src/lib/optimistic-confirm.js` (estende `COMPLETION_CORE`; +2 funções; +exports)
- Test: `_remote/src/lib/optimistic-confirm.test.js` (criar OU estender se já existir)

**Interfaces:**
- Consome (já existem na lib): `COMPLETION_ANCHORED`, `COMPLETION_ANYWHERE`, `SUCCESS_EMOJI_RE`, `TOTALIZER_RE`, `_stripLeadingEmoji`, `sanitizeOptimisticConfirm`.
- Produz: `hasCompletionClaim(text: string): boolean`; `enforceNoMarkerHonesty(reply: string, opts: {nothingPersisted, infoGathering, awaitingConfirm}): string`.

- [ ] **Step 1: Checar/rodar teste existente da lib (não regredir)**

Run: `cd /d/la-organizer/_remote && (ls src/lib/optimistic-confirm.test.js 2>/dev/null && node --test src/lib/optimistic-confirm.test.js 2>&1 | tail -8 || echo "SEM teste existente")`
Expected: ou "SEM teste existente", ou os testes existentes PASSAM (anota a contagem — tem que continuar verde no fim).

- [ ] **Step 2: Escrever os testes novos (falham primeiro)**

Criar/anexar em `_remote/src/lib/optimistic-confirm.test.js`:
```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { hasCompletionClaim, enforceNoMarkerHonesty, sanitizeOptimisticConfirm } = require('./optimistic-confirm');

const PERSIST_NO = { nothingPersisted: true, infoGathering: false, awaitingConfirm: false };

test('hasCompletionClaim: Ana (✅ + verbo no fim) = true', () => {
  assert.strictEqual(hasCompletionClaim('✅ Alice com a bombinha em dia — as duas doses confirmadas!'), true);
});
test('hasCompletionClaim: Rose (✅ + lançado) = true', () => {
  assert.strictEqual(hasCompletionClaim('✅ Lançado nas parcelas jul/ago/set'), true);
});
test('hasCompletionClaim: ✅ decorativo sem verbo = false', () => {
  assert.strictEqual(hasCompletionClaim('✅ Boa! Tá tudo certo por aí?'), false);
});
test('hasCompletionClaim: referência a ação passada sem ✅ = false', () => {
  assert.strictEqual(hasCompletionClaim('O evento que você criou semana passada tá lá na agenda'), false);
});

test('enforce: Ana rebaixa (remove a linha falsa + aviso)', () => {
  const out = enforceNoMarkerHonesty('✅ as duas doses confirmadas!', PERSIST_NO);
  assert.ok(!/confirmadas/i.test(out), 'a confirmação falsa devia sumir: ' + out);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), 'devia ter aviso honesto: ' + out);
});
test('enforce: Rose rebaixa', () => {
  const out = enforceNoMarkerHonesty('✅ Lançado nas parcelas jul/ago/set', PERSIST_NO);
  assert.ok(!/lançado/i.test(out), out);
  assert.ok(/n[ãa]o consegui registrar/i.test(out), out);
});
test('enforce NÃO mexe: ✅ decorativo', () => {
  const t = '✅ Boa! Tá tudo certo por aí?';
  assert.strictEqual(enforceNoMarkerHonesty(t, PERSIST_NO), t);
});
test('enforce NÃO mexe: algo persistiu (nothingPersisted=false)', () => {
  const t = '✅ Tarefa criada!';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: false, infoGathering: false, awaitingConfirm: false }), t);
});
test('enforce NÃO mexe: infoGathering', () => {
  const t = '✅ Criado! Quer que eu marque a hora?';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: true, infoGathering: true, awaitingConfirm: false }), t);
});
test('enforce NÃO mexe: awaitingConfirm', () => {
  const t = '✅ Confirmado, crio as duas?';
  assert.strictEqual(enforceNoMarkerHonesty(t, { nothingPersisted: true, infoGathering: false, awaitingConfirm: true }), t);
});
```

- [ ] **Step 3: Rodar — deve FALHAR (funções não existem)**

Run: `cd /d/la-organizer/_remote && node --test src/lib/optimistic-confirm.test.js 2>&1 | tail -15`
Expected: FAIL (`hasCompletionClaim is not a function` ou similar).

- [ ] **Step 4: Estender `COMPLETION_CORE` + implementar as 2 funções**

Em `_remote/src/lib/optimistic-confirm.js`, na string `COMPLETION_CORE`, trocar a última linha de verbos:
```js
  'cancelad[oa]s?|cancelei|pront[oa]|prontinh[oa]|feit[oa])\\b';
```
por (adiciona confirmar/lançar/adicionar/inserir — só passado/particípio):
```js
  'cancelad[oa]s?|cancelei|confirmad[oa]s?|confirmei|lan[çc]ad[oa]s?|lancei|' +
  'adicionad[oa]s?|adicionei|inserid[oa]s?|pront[oa]|prontinh[oa]|feit[oa])\\b';
```

Adicionar, ANTES do `module.exports`:
```js
// hasCompletionClaim — gate do chokepoint Camada 1 (CONFAB-NOMARKER-CHOKEPOINT).
// Por linha: verbo de conclusão NO INÍCIO, OU ✅ na linha JUNTO com verbo em qualquer
// posição, OU totalizador + verbo. NÃO dispara no ✅ decorativo sozinho (protege a voz).
function _isCompletionClaimLine(line) {
  const t = String(line).trim();
  if (!t) return false;
  const noEmoji = _stripLeadingEmoji(t);
  if (COMPLETION_ANCHORED.test(noEmoji)) return true;
  if (SUCCESS_EMOJI_RE.test(t) && COMPLETION_ANYWHERE.test(t)) return true;
  if (TOTALIZER_RE.test(t) && COMPLETION_ANYWHERE.test(t)) return true;
  return false;
}
function hasCompletionClaim(text) {
  if (!text) return false;
  return String(text).split('\n').some(_isCompletionClaimLine);
}

// enforceNoMarkerHonesty — Camada 1: se a fala afirma conclusão mas NADA persistiu no
// turno, rebaixa pra honesta. PURO. Os sinais vêm do engine (nunca adivinhados do texto).
const NO_MARKER_HONEST_NOTE = '_⚠️ Na real não consegui registrar isso agora — me manda de novo, por favor._';
function enforceNoMarkerHonesty(reply, opts) {
  const o = opts || {};
  if (!reply || !o.nothingPersisted || o.infoGathering || o.awaitingConfirm) return reply;
  if (!hasCompletionClaim(reply)) return reply;
  const cleaned = sanitizeOptimisticConfirm(reply, 'failed');
  return cleaned ? cleaned + '\n\n' + NO_MARKER_HONEST_NOTE : NO_MARKER_HONEST_NOTE;
}
```

Atualizar o `module.exports` (que hoje é `{ sanitizeOptimisticConfirm, hasOptimisticConfirm }`) para incluir as novas:
```js
module.exports = { sanitizeOptimisticConfirm, hasOptimisticConfirm, hasCompletionClaim, enforceNoMarkerHonesty };
```

- [ ] **Step 5: Rodar — novos PASSAM + existentes continuam verdes**

Run: `cd /d/la-organizer/_remote && node --test src/lib/optimistic-confirm.test.js 2>&1 | tail -15`
Expected: todos PASS (os 10 novos + os existentes do Step 1). Se algum existente quebrar → a extensão do vocab regrediu; revisar antes de seguir.

---

### Task 2: Wiring no `engine.js` (ponto único, cobre voz+texto)

**Files:**
- Modify: `_remote/src/engine.js` (import na linha ~41; bloco novo entre 11012 e 11014)

**Interfaces:**
- Consome: `enforceNoMarkerHonesty` de `./lib/optimistic-confirm`; sinais `_metrics.marker_emitted`, `_metrics.auto_retry_succeeded`, `_replyIsInfoGathering`, `_metrics.awaiting_user_confirm`.

- [ ] **Step 1: Adicionar `enforceNoMarkerHonesty` ao import existente (linha ~41)**

Trocar:
```js
const { sanitizeOptimisticConfirm, hasOptimisticConfirm } = require('./lib/optimistic-confirm');
```
por:
```js
const { sanitizeOptimisticConfirm, hasOptimisticConfirm, enforceNoMarkerHonesty } = require('./lib/optimistic-confirm');
```

- [ ] **Step 2: Inserir o chokepoint entre o bloco pending-intents e o de voz**

Localizar (engine.js ~11011-11014):
```js
    console.warn('[PendingIntents] hook err:', e.message);
  }

  // ---- Sprint 28 — TOM Voice (TTS via ElevenLabs)
```
Substituir por (insere o bloco ANTES do comentário de voz — assim o reply corrigido alimenta voz E texto):
```js
    console.warn('[PendingIntents] hook err:', e.message);
  }

  // CONFAB-NOMARKER-CHOKEPOINT (Camada 1) — trava universal de honestidade.
  // Se a fala afirma conclusão (✅+verbo / verbo no início) mas NADA persistiu neste
  // turno (nem o auto-retry), rebaixa pra honesta. Único lugar; cobre os ~14 handlers.
  // Roda antes da voz E do texto. Não toca ✅ decorativo (gate verbo-baseado).
  try {
    reply = enforceNoMarkerHonesty(reply, {
      nothingPersisted: !_metrics.marker_emitted && !_metrics.auto_retry_succeeded,
      infoGathering: !!_replyIsInfoGathering,
      awaitingConfirm: !!_metrics.awaiting_user_confirm,
    });
  } catch (e) { console.warn('[ConfabGuard] non-fatal:', e.message); }

  // ---- Sprint 28 — TOM Voice (TTS via ElevenLabs)
```

- [ ] **Step 3: Verificar sintaxe**

Run: `cd /d/la-organizer/_remote && node --check src/engine.js && echo "engine OK"`
Expected: `engine OK`.

---

### Task 3: Deploy + prova + registro (SÓ com OK do Alf)

**Files:** nenhum (deploy + DB + memória).

- [ ] **Step 1: PEDIR OK EXPLÍCITO DO ALF.** Só seguir após "pode subir".

- [ ] **Step 2: Remover hold + deploy + prova de boot**

Run:
```bash
rm -f /d/la-organizer/.deploy-hold && scp /d/la-organizer/_remote/src/lib/optimistic-confirm.js tom:/opt/LA-Organizer/src/lib/ && scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/ && ssh tom "pm2 restart tom >/dev/null 2>&1; sleep 2; pm2 describe tom | grep -E 'status|unstable' | head -3; pm2 logs tom --lines 5 --nostream 2>/dev/null | tail -5"
```
Expected: `status online`, `unstable restarts 0`, log de boot sem erro.

- [ ] **Step 3: Smoke na VPS (rebaixa Ana / preserva decorativo)**

Escrever `D:\la-organizer\smoke-confab.js` (fora de `_remote`):
```js
const { enforceNoMarkerHonesty } = require('/opt/LA-Organizer/src/lib/optimistic-confirm');
const NP = { nothingPersisted: true, infoGathering: false, awaitingConfirm: false };
const ana = enforceNoMarkerHonesty('✅ Alice com a bombinha em dia — as duas doses confirmadas!', NP);
console.log('ANA rebaixou?', /n[ãa]o consegui registrar/i.test(ana) && !/confirmadas/i.test(ana) ? 'SIM (correto)' : 'NAO (!)');
const deco = '✅ Boa! Tá tudo certo por aí?';
console.log('DECORATIVO preservado?', enforceNoMarkerHonesty(deco, NP) === deco ? 'SIM (correto)' : 'NAO (!)');
process.exit(0);
```
Run: `scp /d/la-organizer/smoke-confab.js tom:/tmp/ && ssh tom "node /tmp/smoke-confab.js; rm -f /tmp/smoke-confab.js" && rm -f /d/la-organizer/smoke-confab.js`
Expected: `ANA rebaixou? SIM` + `DECORATIVO preservado? SIM`.

- [ ] **Step 4: Registrar known-issue + memória**

SQL (Supabase `cesnbnrynvxvgdhfmaua`):
```sql
INSERT INTO tom_known_issues (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao, colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES ('CONFAB-NOMARKER-CHOKEPOINT', 'TOM afirma "✅ feito" sem nada persistir (confabulação sem marker) — trava anti-mentira espalhada por handler, faltava em ~14', 'marker', 'alto', 'corrigido',
'A trava sanitizeOptimisticConfirm existia em 3 handlers (TASK/EVENT/EVENT_UPDATE) e faltava em ~14 (HABIT/FINANCE schema/CHECKLIST/PROJECT/etc.). O caso "nenhum marker executado + fala afirma conclusão" não tinha enforcement universal (só log ACTIONABLE_NO_MARKER). Casos: Ana (HABIT_ACTION rejected, turno nem flag actionable) + Rose (FINANCE no-marker).',
'Chokepoint único Camada 1: enforceNoMarkerHonesty no pré-envio (engine ~11013, cobre voz+texto). Gate verbo-baseado (hasCompletionClaim: verbo no início OU ✅+verbo OU totalizador+verbo) + nothingPersisted (!marker_emitted && !auto_retry_succeeded) + !infoGathering + !awaitingConfirm → sanitizeOptimisticConfirm(failed)+aviso honesto. Não toca ✅ decorativo. Guards por-handler mantidos (falha parcial). Camada 2 (executor determinístico) e parser title→habit_name = próximos.',
'manual', '%marker_logs result=rejected ou ACTIONABLE_NO_MARKER + fala do TOM com ✅+verbo de conclusão (confirmadas/lançado/criado) sem row persistida%', ARRAY['Ana Paula','Rose'], '2026-06-21 10:47:20+00', now(), 1, now());
```
Atualizar memória `project_audit_0621_batch_complete_noop` (ou criar pointer) anotando o chokepoint Camada 1 entregue.

- [ ] **Step 5: Reportar ao Alf** — Camada 1 viva; pedir validação real opcional (mandar pro TOM algo que falhe e ver "não consegui" em vez de "✅"); confirmar que segue pra Camada 2.

---

## Self-Review
- **Spec coverage:** gate verbo-baseado (Task 1c) ✓; enforce (1d) ✓; vocab estendido (1b) ✓; wiring voz+texto (Task 2) ✓; guards mantidos (não removo nada) ✓; deploy+smoke+registro (Task 3) ✓; não-regressão (Step 1 + Step 5 do Task 1) ✓.
- **Placeholder scan:** sem TBD; todo código real. ✓
- **Type consistency:** `enforceNoMarkerHonesty(reply, {nothingPersisted, infoGathering, awaitingConfirm})` idêntico em Task 1, 2, testes e smoke ✓; `hasCompletionClaim(text)` idêntico ✓.
