# Criação de tarefa robusta — "fala = persistência ou honestidade" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Garantir que, quando o TOM diz que criou/anotou/organizou tarefa(s), a tarefa exista de verdade — e quando não criar, ele admita honestamente em vez de mentir em silêncio.

**Architecture:** Duas partes. (1) UX: skill reforça criar-na-hora-confirmar-depois (não gate "tá certo?" antes de criar). (2) Garantia determinística: helper puro `creation-claim.js` + um gancho no `engine.js` (antes do envio) que, quando a reply afirma criação MAS nenhum marker de tarefa rodou, reescreve a resposta honesta (NÃO auto-cria — anti-tarefa-fantasma). Defesa-em-profundidade, 100% aditiva.

**Tech Stack:** Node.js CommonJS, `node:test`, Supabase (service_role), skills `.md`.

## Global Constraints

- **Voz do TOM é sagrada:** não mudar tom/tamanho/personalidade. O TOM continua confirmando — só age antes e confirma depois. Mudança é de SEQUÊNCIA e de PERSISTÊNCIA, nunca de voz.
- **NÃO tocar:** `hasConcrete` (engine.js:8520), registrador genérico (engine.js:11001), recorrência / `materializeAll` / Balde A, `batch-complete`.
- **NÃO auto-criar no caso de falha** (decisão Alf 22/06, opção A): o auto-retry existente (Sprint 28.2) é anti-criação por design (guard de tarefa-fantasma 01/06). A rede é **reescrita honesta**, não auto-create.
- **Deploy (CLAUDE.md):** NÃO commitar entre tasks; trabalhar local em `_remote`. Engine vai pra VPS via `scp` + `pm2 restart` (Task 4); o resto sobe no auto-deploy do fim do turno. 1 bundle.
- **Português** em toda copy visível ao usuário.
- **Verificação:** `node --check` + `node --test` verdes; suíte inteira sem regressão nova; smoke na VPS.

---

### Task 1: Helper puro `creation-claim.js` (a lógica testável da garantia)

**Files:**
- Create: `src/utils/creation-claim.js`
- Test: `src/utils/creation-claim.test.js`

**Interfaces:**
- Produces:
  - `looksLikeCreationClaim(text: string): boolean` — a reply do TOM afirma ter criado/anotado/organizado tarefa?
  - `shouldHonestifyCreationClaim({ reply, taskMarkerFired, autoRetrySucceeded, awaitingConfirm, isInfoGathering }): boolean` — junta todos os gates.
  - `honestifyCreationClaim(text: string, sanitizeOptimisticConfirm?: fn): string` — rebaixa a prosa otimista (via sanitizer injetado) e anexa o pedido honesto de reconfirmação.

- [ ] **Step 1: Write the failing test**

Create `src/utils/creation-claim.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const {
  looksLikeCreationClaim, shouldHonestifyCreationClaim, honestifyCreationClaim,
} = require('./creation-claim');

test('looksLikeCreationClaim: pega o caso Dai (organizada + te cobro)', () => {
  assert.strictEqual(looksLikeCreationClaim(
    'Show, Dai! Semana do canto organizada então:\n\n• Campo Grande — terça\n\nTe cobro conforme for chegando. 👊'), true);
});

test('looksLikeCreationClaim: pega templates de criação (Anotado/Anotei/Criei)', () => {
  assert.strictEqual(looksLikeCreationClaim('✅ Anotado!\n\n*Reunião com Juliana*.'), true);
  assert.strictEqual(looksLikeCreationClaim('✅ Anotei pra você: terça Campo Grande.'), true);
  assert.strictEqual(looksLikeCreationClaim('Criei a tarefa e já agendei o lembrete.'), true);
});

test('looksLikeCreationClaim: NÃO pega pergunta pura nem recusa nem a própria linha honesta', () => {
  assert.strictEqual(looksLikeCreationClaim('Tá certo isso?'), false);
  assert.strictEqual(looksLikeCreationClaim('opa, não consegui registrar agora, me manda de novo?'), false);
  assert.strictEqual(looksLikeCreationClaim('Na real, não cheguei a registrar isso aqui ainda — me confirma os itens.'), false);
  assert.strictEqual(looksLikeCreationClaim('beleza, bora! 👊'), false);
});

test('shouldHonestify: afirmou criação + nenhum marker → true', () => {
  assert.strictEqual(shouldHonestifyCreationClaim({
    reply: 'Semana organizada, te cobro conforme for chegando.',
    taskMarkerFired: false, autoRetrySucceeded: false, awaitingConfirm: false, isInfoGathering: false,
  }), true);
});

test('shouldHonestify: cada gate bloqueia (marker/retry/confirm/info-gathering)', () => {
  const base = { reply: '✅ Anotei: Campo Grande terça.', taskMarkerFired: false, autoRetrySucceeded: false, awaitingConfirm: false, isInfoGathering: false };
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, taskMarkerFired: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, autoRetrySucceeded: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, awaitingConfirm: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, isInfoGathering: true }), false);
  assert.strictEqual(shouldHonestifyCreationClaim({ ...base, reply: 'beleza, bora!' }), false);
});

test('honestifyCreationClaim: rebaixa otimista (sanitizer injetado) + anexa honesto', () => {
  const fakeSanitize = (t, outcome) => { assert.strictEqual(outcome, 'failed'); return t.replace(/✅[^\n]*\n?/g, '').trim(); };
  const out = honestifyCreationClaim('✅ Anotei: Campo Grande.\nQualquer coisa me fala.', fakeSanitize);
  assert.ok(!out.includes('✅ Anotei'), 'removeu a confirmação falsa');
  assert.ok(/não cheguei a registrar/i.test(out), 'anexou a linha honesta');
});

test('honestifyCreationClaim: base vazia → só a linha honesta', () => {
  const out = honestifyCreationClaim('✅ Anotei!', () => '');
  assert.ok(/não cheguei a registrar/i.test(out));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/utils/creation-claim.test.js`
Expected: FAIL — "Cannot find module './creation-claim'".

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/creation-claim.js`:

```js
// src/utils/creation-claim.js
// Rede de honestidade pra criação de tarefa (PLANNING-CONFIRM-NO-CREATE, 22/06).
// Quando o TOM AFIRMA ter criado/anotado/organizado tarefa mas NENHUM marker de
// tarefa rodou no turno, o engine reescreve a resposta honesta (pede reconfirmação)
// em vez de deixar a mentira "criei" sair. NÃO auto-cria (anti-tarefa-fantasma,
// guard de 01/06). Decisão Alf 22/06: opção A. Irmão de FIN-FAKE-CONFIRM /
// AUDIT-OPTIMISTIC-CONFIRM / BATCH-COMPLETE-CONFIRM-NOOP.

// "Não consegui registrar" / a própria linha honesta NÃO são claim de criação.
const DECLINE_RE = /\bn[ãa]o\s+(?:consigo|consegui|d[áa]|deu|tem\s+como|rola|posso|cheguei\s+a)\b[^.!?]{0,40}\b(?:registr|anot|cri|adicion|salv|marc|guard|agend)/i;

const CLAIM_PATTERNS = [
  /\banotad[oa]\b/i,                                   // "Anotado!", "tarefa anotada"
  /\banotei\b/i,
  /\bregistr(?:ei|ad[oa])\b/i,
  /\bcri(?:ei|ad[oa])\b/i,                             // criei, criada, criado
  /\bagend(?:ei|ad[oa])\b/i,
  /\bmarquei\b/i,
  /\bdeixei\s+(?:anotad|marcad|agendad)/i,
  /\bcoloquei\s+(?:na|no)\s+(?:sua\s+)?(?:lista|agenda)\b/i,
  /\b(?:t[aá]|ficou)\s+na\s+sua\s+lista\b/i,
  /\borganizad[oa]\b/i,                                // "semana/agenda organizada"
  /\bte\s+cobro\b/i,                                   // "te cobro conforme for chegando"
];

function looksLikeCreationClaim(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  if (DECLINE_RE.test(s)) return false;
  return CLAIM_PATTERNS.some((re) => re.test(s));
}

function shouldHonestifyCreationClaim({ reply, taskMarkerFired, autoRetrySucceeded, awaitingConfirm, isInfoGathering } = {}) {
  if (!reply) return false;
  if (taskMarkerFired || autoRetrySucceeded || awaitingConfirm || isInfoGathering) return false;
  return looksLikeCreationClaim(reply);
}

const HONEST_LINE = '_⚠️ Na real, não cheguei a registrar isso aqui ainda — me confirma os itens (com o dia de cada um) que eu marco certinho agora._';

function honestifyCreationClaim(text, sanitizeOptimisticConfirm) {
  let base = String(text || '');
  if (typeof sanitizeOptimisticConfirm === 'function') {
    try { base = sanitizeOptimisticConfirm(base, 'failed') || ''; } catch (_) { /* mantém base */ }
  }
  base = String(base || '').trim();
  return base ? `${base}\n\n${HONEST_LINE}` : HONEST_LINE;
}

module.exports = { looksLikeCreationClaim, shouldHonestifyCreationClaim, honestifyCreationClaim };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/utils/creation-claim.test.js`
Expected: PASS (7 testes).

---

### Task 2: Ligar a rede honesta no `engine.js` (antes do envio)

**Files:**
- Modify: `src/engine.js` (import no topo ~linha 34; hoist de `fired` ~10790/10835; novo bloco após o detector ~10970)

**Interfaces:**
- Consumes: `looksLikeCreationClaim`/`shouldHonestifyCreationClaim`/`honestifyCreationClaim` (Task 1); `sanitizeOptimisticConfirm` (já importado, engine.js:34); `hasTrailingQuestion`/`isInfoGatheringReply` (já em escopo, usados em 10809).
- Produces: reescrita de `reply` antes do `whatsapp.sendMessage(phone, reply)` (engine.js:11074); marker `CREATION_CLAIM_NO_MARKER`; `_metrics.creation_claim_no_marker`.

- [ ] **Step 1: Importar o helper (engine.js:34, logo após o import do optimistic-confirm)**

Localizar:
```js
const { sanitizeOptimisticConfirm, hasOptimisticConfirm } = require('./lib/optimistic-confirm');
```
Adicionar na linha seguinte:
```js
const { shouldHonestifyCreationClaim, honestifyCreationClaim } = require('./utils/creation-claim');
```

- [ ] **Step 2: Hoist de `fired` pra fora do try do detector**

Localizar (engine.js ~10790), o início do bloco:
```js
  try {
    const ACTIONABLE_RE = /\b(anota|me\s+lembra|...
```
Inserir IMEDIATAMENTE ANTES do `try {`:
```js
  // PLANNING-CONFIRM-NO-CREATE: hoist dos markers que rodaram p/ a rede honesta abaixo.
  // null = detector não rodou/quebrou → a rede não arrisca reescrever (fail-safe).
  let _firedThisTurn = null;
```

Localizar (engine.js ~10835):
```js
    const fired = (recentMarkers || []).map(r => r.marker_type).filter(t =>
      t && !['LEAK_BLOCKED','UNKNOWN_MARKER_STRIPPED','TOOL_CALL_STRIPPED','PROVIDER'].includes(t));
```
Adicionar IMEDIATAMENTE DEPOIS:
```js
    _firedThisTurn = fired;
```

- [ ] **Step 3: Adicionar o bloco da rede honesta (logo após o `catch` do detector, ~10970)**

Localizar o fim do bloco detector:
```js
  } catch (e) { /* metric never breaks main flow */ }
```
(é o `catch` que fecha o try aberto no Step 2 — o que contém `ACTIONABLE_RE`/auto-retry).
Inserir LOGO DEPOIS dele:
```js
  // PLANNING-CONFIRM-NO-CREATE (22/06): nunca deixa "criei/anotei/organizada" sair sem
  // um marker de tarefa por trás. NÃO auto-cria (anti-fantasma) — reescreve honesto e
  // pede reconfirmação. _firedThisTurn=null → detector falhou → não arrisca (fail-safe).
  try {
    if (_firedThisTurn !== null && shouldHonestifyCreationClaim({
      reply,
      taskMarkerFired: _firedThisTurn.some((t) => /TASK/i.test(t)),
      autoRetrySucceeded: !!_metrics.auto_retry_succeeded,
      awaitingConfirm: !!_metrics.awaiting_user_confirm,
      isInfoGathering: hasTrailingQuestion(reply) || isInfoGatheringReply(reply),
    })) {
      await logMarker(collab.id, 'CREATION_CLAIM_NO_MARKER', 'rejected', `reply:${String(reply).slice(0, 200)}`, null);
      reply = honestifyCreationClaim(reply, sanitizeOptimisticConfirm);
      _metrics.creation_claim_no_marker = true;
      console.warn(`[CreationClaimNet] honestified claim-sem-marker phone=${_phoneTail}`);
    }
  } catch (e) { console.warn('[CreationClaimNet] err:', e.message); }
```

- [ ] **Step 4: Validar sintaxe**

Run: `node --check src/engine.js`
Expected: sai sem erro (sem output).

- [ ] **Step 5: Rodar a suíte do helper + suíte inteira (sem regressão)**

Run: `node --test src/utils/creation-claim.test.js` → PASS (7).
Run: `node --test` (raiz `_remote`) → confirmar que o número de falhas é o MESMO da baseline (34 pré-existentes de env/tooling; nenhuma nova).

---

### Task 3: Parte 1 (UX) — reforço create-first em `checklist-tarefas.md`

**Files:**
- Modify: `skills/checklist-tarefas.md` (inserir após a seção "## Confirmação antes do marker", ~linha 416)

- [ ] **Step 1: Inserir a subseção (additiva, não remove nada)**

Localizar:
```md
## Confirmação antes do marker
- intenção inequívoca → confirme e emita o marker na mesma resposta
- intenção ambígua → faça **UMA pergunta** e espere
- nunca chute
```
Inserir LOGO DEPOIS:
```md

## Planejamento falado → CRIE na hora (nunca "tá certo?" antes de criar)

Quando o colaborador enuncia tarefas de forma clara — inclusive **vários itens por áudio**, inclusive **misturando "já fiz X" com "vou fazer Y e Z"** — **emita o `<<TASK_UPDATE>>` com os `create` JÁ NESTE TURNO** e confirme na MESMA mensagem. Criar tarefa é reversível: você confirma DEPOIS de criar, nunca trava a criação atrás de um "tá certo?".

- ✅ **Certo:** "✅ Anotei pra você: terça *Campo Grande*, quinta *Recreio*. Me corrige se algo tiver errado." + `<<TASK_UPDATE>>` com os creates.
- ❌ **Errado (caso Dai 21/06):** "Tá certo isso?" / "Semana organizada, te cobro conforme for chegando" **sem** emitir o marker → a tarefa NÃO nasce e você prometeu em falso.

**Campo opcional faltando** (ex.: o "motivo" de uma ida): **crie com o que tem** e pergunte o detalhe DEPOIS — nunca segure a criação por um campo opcional. Ex.: "✅ Anotei: sexta *Ir à Barra*. (Me diz o motivo quando puder que eu complemento.)"

Isto vale só pra **criar** (reversível). Ações irreversíveis — `complete`, `cancel`, `delegate`, recado (`COORDINATION_REQUEST`) — continuam pedindo confirmação ANTES (ver vetos).
```

- [ ] **Step 2: Conferir que o arquivo continua íntegro (frontmatter + seções)**

Run: `node -e "const s=require('fs').readFileSync('skills/checklist-tarefas.md','utf8'); if(!s.startsWith('---')) throw new Error('frontmatter quebrou'); if(!s.includes('Planejamento falado')) throw new Error('seção não entrou'); console.log('skill OK len='+s.length)"`
Expected: `skill OK len=...`

---

### Task 4: Deploy + verificação + ledger + memória (bundle final)

**Files:**
- Deploy: `src/engine.js`, `src/utils/creation-claim.js`, `src/utils/creation-claim.test.js`, `skills/checklist-tarefas.md` → VPS
- Modify (memória): `C:\Users\Texeira\.claude\projects\D--la-organizer\memory\MEMORY.md` + novo `project_planning_confirm_no_create.md`
- DB: INSERT em `tom_known_issues`

- [ ] **Step 1: SCP dos arquivos do engine + skill pra VPS**

```bash
scp /d/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp /d/la-organizer/_remote/src/utils/creation-claim.js tom:/opt/LA-Organizer/src/utils/creation-claim.js
scp /d/la-organizer/_remote/src/utils/creation-claim.test.js tom:/opt/LA-Organizer/src/utils/creation-claim.test.js
scp /d/la-organizer/_remote/skills/checklist-tarefas.md tom:/opt/LA-Organizer/skills/checklist-tarefas.md
```

- [ ] **Step 2: Validar + testar + reiniciar na VPS**

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && echo CHECK_OK && node --test src/utils/creation-claim.test.js 2>&1 | tail -4 && node --env-file=.env -e \"const c=require('./src/utils/creation-claim'); console.log('SELFTEST', c.shouldHonestifyCreationClaim({reply:'Semana organizada, te cobro conforme for chegando.',taskMarkerFired:false,autoRetrySucceeded:false,awaitingConfirm:false,isInfoGathering:false}))\" && pm2 restart tom >/dev/null 2>&1 && sleep 3 && pm2 list | grep -E 'tom'"
```
Expected: `CHECK_OK`, testes pass, `SELFTEST true`, `tom ... online`.

- [ ] **Step 3: Registrar a KI**

```sql
insert into tom_known_issues
 (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
  colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
values (
 'PLANNING-CONFIRM-NO-CREATE',
 $t$Planejamento confirmado nao virava tarefa — TOM dizia "organizada/te cobro" e nao criava (Dai 21/06)$t$,
 'marker','alto','corrigido',
 $cr$Caso Dai 21/06 (Claude no ar, nao e fallback): planejou 3 tarefas por audio, TOM perguntou "Ta certo?", ela confirmou ("Isso mesmo"), TOM disse "Semana organizada, te cobro" e NAO criou nada. Duas camadas: (1) UX — TOM confirma ANTES de criar; (2) engine — ao perguntar sem marker, abre intent generico so-texto {last_user_text,last_tom_reply} (engine.js:11001); no "sim", hasConcrete=false (RECUR-TEMPLATE-DUP 10/06) injeta "NAO emita marker" -> o engine PROIBE a criacao mesmo apos confirmacao. Doenca de fundo: LLM narra acao sem emitir marker (familia AUDIT-OPTIMISTIC-CONFIRM / FIN-FAKE-CONFIRM). Detector actionable_intent nao reconhecia "organizada/te cobro" (veio false). Rose 33 em 14d no ACTIONABLE_NO_MARKER (lista subconta).$cr$,
 $fr$Opcao A (Alf 22/06). Parte 1 (UX): skill checklist-tarefas.md reforca criar-na-hora-confirmar-depois (anti-exemplo Dai). Parte 2 (garantia determinística): novo src/utils/creation-claim.js (looksLikeCreationClaim/shouldHonestify/honestify, TDD 7 casos) + gancho em engine.js (apos o detector ~10970, ANTES do envio 11074): se a reply afirma criacao E nenhum marker de tarefa rodou E nao houve auto-retry/dup-confirm/pergunta -> reescreve honesto ("nao cheguei a registrar, me confirma") em vez de mentir. NAO auto-cria (anti-fantasma, guard 01/06). NAO toca hasConcrete/registrador/recorrencia. Fail-safe: _firedThisTurn=null -> nao reescreve.$fr$,
 'manual',
 $sp$tom_metrics marker_emitted IS NULL + reply afirma criacao (anotei/criei/organizada/te cobro) + tarefa nao nasce; marker_logs CREATION_CLAIM_NO_MARKER$sp$,
 ARRAY['Dai','Rose'],
 '2026-06-21 17:17:00+00','2026-06-21 17:18:35+00',2, now()
)
returning codigo, status;
```

- [ ] **Step 4: Memória**

Criar `project_planning_confirm_no_create.md` (resumo: caso Dai + as 2 camadas + opção A + a regra "rede honesta, nunca auto-cria") e adicionar 1 linha no `MEMORY.md`. Vincular a `project_audit_0621_batch_complete_noop` (mesma família).

- [ ] **Step 5: Observação**

No próximo planejamento real (ou no relatório 07h), confirmar: criação dispara o marker (tarefa nasce) e, em falha, sai a linha honesta — nunca "criei" silencioso.

---

## Self-Review

**Spec coverage:** Parte 1 (UX create-first) → Task 3 ✅. Parte 2 (detector + reescrita honesta) → Tasks 1+2 ✅. Não-auto-criar → respeitado (Task 1 não cria; Task 2 só reescreve) ✅. Não-regressão (não toca hasConcrete/registrador/recorrência) → Tasks 1-2 ✅. Ledger → Task 4 Step 3 ✅. Testes reproduzindo Dai → Task 1 (caso "organizada+te cobro") ✅.

**Placeholder scan:** sem TBD/TODO; todo passo tem código/comando reais. ✅

**Type consistency:** `looksLikeCreationClaim`/`shouldHonestifyCreationClaim`/`honestifyCreationClaim` usados em Task 2 batem com as assinaturas de Task 1. `_firedThisTurn` declarado (Step 2) e usado (Step 3). `sanitizeOptimisticConfirm` é a fn já importada em engine.js:34. ✅
