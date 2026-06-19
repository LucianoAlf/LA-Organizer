# Latência do TOM — Quick Wins de Infra — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir a latência percebida do TOM atacando overload (fail-fast pro Codex), overhead de build (embedding assíncrono) e dando observabilidade pra medir — **sem tocar no comportamento/respostas do TOM**.

**Architecture:** Três mudanças cirúrgicas de infra no caminho da mensagem: (1) log enriquecido no provider + medição de espera na fila; (2) `getEmbedding` da OpenAI sai do caminho síncrono do build do prompt; (3) teto de timeout do Claude cai de 120s (valor real na VPS) pra 45s, derrubando antes pro fallback Codex em overload. O **paralelismo da fila (K=2)** é um subsistema à parte (Fase 1 da spec de paralelismo) e tem **plano próprio**.

**Tech Stack:** Node.js (ES CommonJS), `node:test` + `node:assert` (testes co-localizados `*.test.js`, rodam com `node --test`), PM2 na VPS, CLI `claude` headless.

## Global Constraints

- **NÃO mexer no comportamento, tom, jeito ou tamanho das respostas do TOM** (veto do dono). Estas mudanças são 100% infra/roteamento.
- **NÃO mexer no `_claudeQueue` (mutex serial)** neste plano — isso é o plano de paralelismo (Fase 1), separado.
- Validação de sintaxe backend: `node --check src/<arquivo>.js`. Testes: `node --test src/<caminho>.test.js`.
- Deploy: `_remote` é a fonte; engine vai pra VPS via `scp` + `ssh tom "pm2 restart tom"`. **NÃO commitar entre tarefas** (convenção do projeto: bundle no fim; auto-deploy hook cuida do git). **Execução está retida pelo `.deploy-hold` — resolver com o Alf antes de aplicar na VPS.**
- `.env` da VPS hoje: `CLAUDE_TIMEOUT_MS=120000`, `TOM_VOICE_ENABLED=true`.

---

### Task 1: Observabilidade — separar fila de chamada nos logs

**Por quê:** hoje só `duration_ms` é logado. Pra medir o efeito deste plano (e do paralelismo depois) precisamos enxergar `duration_api_ms` (só API), `output_tokens` e o **tempo de espera na fila** (`queue_wait_ms`). Sem isso, otimizamos às cegas.

**Files:**
- Modify: `src/ai/claude.js` (wrapper `chat`, ~linha 78-83; `_chatInner` resolve meta, ~linha 252-264)
- Modify: `src/ai/provider.js` (log de sucesso, linha 10)

**Interfaces:**
- Produces: `meta.queue_wait_ms` (number) no retorno de `claude.chat()`, consumido pelo log do provider.

- [ ] **Step 1: Instrumentar a espera na fila no wrapper `chat()`**

Em `src/ai/claude.js`, trocar o wrapper `chat` (hoje):
```js
async function chat(systemPrompt, messages, maxTokens) {
  const job = _claudeQueue.then(() => _chatInner(systemPrompt, messages, maxTokens));
  _claudeQueue = job.catch(() => {});
  return job;
}
```
por (captura o instante de enfileiramento e passa adiante):
```js
async function chat(systemPrompt, messages, maxTokens) {
  const enqueuedAt = Date.now();
  const job = _claudeQueue.then(() => _chatInner(systemPrompt, messages, maxTokens, enqueuedAt));
  _claudeQueue = job.catch(() => {});
  return job;
}
```

- [ ] **Step 2: Calcular `queue_wait_ms` no início de `_chatInner` e expor no meta**

Mudar a assinatura de `_chatInner` para receber `enqueuedAt` e medir o início real:
```js
async function _chatInner(systemPrompt, messages, enqueuedAt) {
  const startedAt = Date.now();
  const queueWaitMs = enqueuedAt ? (startedAt - enqueuedAt) : 0;
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
```
(o param `maxTokens` já era ignorado — ver comentário existente `/*, maxTokens */`.)

No objeto `meta` do `resolve(...)` (hoje em ~252-264), acrescentar uma linha:
```js
      meta: {
        duration_ms: parsed.duration_ms,
        duration_api_ms: parsed.duration_api_ms,
        num_turns: parsed.num_turns,
        stop_reason: parsed.stop_reason,
        input_tokens: parsed.usage?.input_tokens,
        output_tokens: parsed.usage?.output_tokens,
        sanitized_chars: sanitizedDelta,
        queue_wait_ms: queueWaitMs,
      },
```

- [ ] **Step 3: Enriquecer o log do provider**

Em `src/ai/provider.js`, trocar a linha 10:
```js
    console.log(`[AI] Claude respondeu em ${r.meta?.duration_ms ?? '?'}ms`);
```
por:
```js
    console.log(`[AI] Claude ok dur=${r.meta?.duration_ms ?? '?'}ms api=${r.meta?.duration_api_ms ?? '?'}ms fila=${r.meta?.queue_wait_ms ?? '?'}ms out=${r.meta?.output_tokens ?? '?'}tok`);
```

- [ ] **Step 4: Verificar sintaxe**

Run: `node --check src/ai/claude.js && node --check src/ai/provider.js`
Expected: sem saída (exit 0).

- [ ] **Step 5: Garantir que os testes de `buildArgs` seguem passando**

Run: `node --test src/ai/claude.test.js`
Expected: todos PASS (a mudança não toca `buildArgs`/`stripModelHtml`).

---

### Task 2: Fail-fast — teto de timeout de 120s → 45s

**Por quê:** o `.env` da VPS tem `CLAUDE_TIMEOUT_MS=120000`, que sobrepõe o default 60000 do código. Em overload, a mensagem trava até **120s** antes de cair pro Codex. Decisão do Alf: *Claude padrão, Codex só no extremo* → teto de 45s. (Respostas legítimas são curtas e rápidas; p95 da chamada ≈ 42s, então 45s quase não corta caso legítimo.)

**Files:**
- Modify: `src/ai/claude.js` (constante `CLAUDE_TIMEOUT_MS`, linha 34)
- Modify (VPS): `/opt/LA-Organizer/.env` (`CLAUDE_TIMEOUT_MS`)

**Interfaces:**
- Consumes: nada novo. Produces: nada novo (só muda o valor efetivo do timeout existente).

- [ ] **Step 1: Atualizar o default no código para 45000 (consistência com a decisão)**

Em `src/ai/claude.js` linha 34, trocar:
```js
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 60000;
```
por:
```js
// Fail-fast (19/06): teto de 45s — Claude é o padrão; em overload cai pro Codex
// "só no extremo". p95 real da chamada ≈ 42s, então 45s quase não corta caso legítimo.
// O .env da VPS DEVE estar alinhado (estava em 120000 — ver plano).
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 45000;
```

- [ ] **Step 2: Atualizar o comentário do bloco (linhas 27-33) para refletir 45s**

Substituir a referência a "60s dá ~5-6x de folga" no comentário acima da constante por "45s corta o hang antes, sem cortar resposta legítima (p95≈42s)". (Ajuste textual; não muda lógica.)

- [ ] **Step 3: Verificar sintaxe**

Run: `node --check src/ai/claude.js`
Expected: exit 0.

- [ ] **Step 4: Corrigir o `.env` da VPS (deploy — só após HOLD liberado)**

Run:
```bash
ssh tom "sed -i 's/^CLAUDE_TIMEOUT_MS=.*/CLAUDE_TIMEOUT_MS=45000/' /opt/LA-Organizer/.env && grep CLAUDE_TIMEOUT_MS /opt/LA-Organizer/.env"
```
Expected: `CLAUDE_TIMEOUT_MS=45000`

- [ ] **Step 5: (no deploy) restart e confirmar via log**

Após scp do `claude.js` e `pm2 restart tom`, observar `pm2 logs` — em overload, ver `[AI] Claude falhou kind=timeout` aparecer perto de ~45s (não mais 120s), seguido de fallback Codex.

---

### Task 3: Build assíncrono — tirar o `getEmbedding` do caminho síncrono

**Por quê:** no build do prompt, `getEmbedding` (chamada OpenAI, síncrona) roda **depois** de `fetchCollaboratorContext` e o bloqueia. Rodando os dois em paralelo, o tempo do embedding deixa de somar (vira `max`), e um timeout curto garante que nunca trave o build.

**Files:**
- Create: `src/utils/async.js`
- Create: `src/utils/async.test.js`
- Modify: `src/prompts/system.js` (bloco de busca semântica, ~linhas 2601-2624)

**Interfaces:**
- Produces: `promiseWithTimeout(promise, ms, fallback) -> Promise` — resolve com o valor da promise se ela terminar antes de `ms`; senão resolve com `fallback`. Não rejeita por timeout (rejeição da promise interna é responsabilidade de quem chama, via `.catch`).

- [ ] **Step 1: Escrever o teste do helper (falha primeiro)**

Create `src/utils/async.test.js`:
```js
// Rodar: node --test src/utils/async.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { promiseWithTimeout } = require('./async');

const wait = (ms, val) => new Promise((r) => setTimeout(() => r(val), ms));

test('resolve com o valor quando termina antes do timeout', async () => {
  const r = await promiseWithTimeout(wait(10, 'ok'), 100, 'fb');
  assert.strictEqual(r, 'ok');
});

test('resolve com o fallback quando estoura o timeout', async () => {
  const r = await promiseWithTimeout(wait(100, 'ok'), 20, 'fb');
  assert.strictEqual(r, 'fb');
});

test('fallback default é null', async () => {
  const r = await promiseWithTimeout(wait(100, 'ok'), 20);
  assert.strictEqual(r, null);
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `node --test src/utils/async.test.js`
Expected: FAIL — `Cannot find module './async'`.

- [ ] **Step 3: Implementar o helper**

Create `src/utils/async.js`:
```js
// promiseWithTimeout: corre uma promise contra um timeout. Se a promise terminar
// antes de `ms`, resolve com o valor; senão resolve com `fallback` (default null).
// Não rejeita por timeout — quem chama trata rejeição da promise interna via .catch.
function promiseWithTimeout(promise, ms, fallback = null) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); return v; },
      (e) => { clearTimeout(timer); throw e; },
    ),
    timeout,
  ]);
}

module.exports = { promiseWithTimeout };
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `node --test src/utils/async.test.js`
Expected: 3 PASS.

- [ ] **Step 5: Paralelizar o embedding no build do prompt**

Em `src/prompts/system.js`, o bloco atual (~2601-2624):
```js
  const ctx = await fetchCollaboratorContext(collaborator);

  // Busca semântica para "Contexto recente" — top 5 que não sejam crítico nem preference.
  if (lastUserMessage && process.env.OPENAI_API_KEY) {
    try {
      const { getEmbedding } = require('../services/embeddings');
      const embedding = await getEmbedding(lastUserMessage);
      const { data: semanticMems } = await supabase.rpc('match_memories', {
        p_collaborator_id: collaborator.id,
        p_embedding: embedding,
        p_match_count: 15,
        p_threshold: 0.6,
      });
      const usedIds = new Set([
        ...(ctx.criticalMemories || []).map(m => m.id),
        ...(ctx.preferenceMemories || []).map(m => m.id),
      ]);
      ctx.recentContextMemories = (semanticMems || [])
        .filter(m => !usedIds.has(m.id) && m.importance !== 'critical' && m.memory_type !== 'preference')
        .slice(0, 5);
    } catch (err) {
      console.warn('[Prompt] semantic search err:', err.message);
    }
  }
```
passa a (dispara o embedding ANTES e em paralelo ao fetch, com timeout de 1500ms):
```js
  // Build async (19/06): o getEmbedding (OpenAI) é a parte lenta — dispara ANTES,
  // em paralelo ao fetchCollaboratorContext, com timeout curto. Se demorar/falhar,
  // segue sem o "contexto recente" semântico (degradação graciosa).
  const { promiseWithTimeout } = require('../utils/async');
  const _embeddingPromise = (lastUserMessage && process.env.OPENAI_API_KEY)
    ? promiseWithTimeout(
        require('../services/embeddings').getEmbedding(lastUserMessage).catch((err) => {
          console.warn('[Prompt] embedding err:', err.message);
          return null;
        }),
        1500,
        null,
      )
    : Promise.resolve(null);

  const ctx = await fetchCollaboratorContext(collaborator);
  const _embedding = await _embeddingPromise;

  if (_embedding) {
    try {
      const { data: semanticMems } = await supabase.rpc('match_memories', {
        p_collaborator_id: collaborator.id,
        p_embedding: _embedding,
        p_match_count: 15,
        p_threshold: 0.6,
      });
      const usedIds = new Set([
        ...(ctx.criticalMemories || []).map(m => m.id),
        ...(ctx.preferenceMemories || []).map(m => m.id),
      ]);
      ctx.recentContextMemories = (semanticMems || [])
        .filter(m => !usedIds.has(m.id) && m.importance !== 'critical' && m.memory_type !== 'preference')
        .slice(0, 5);
    } catch (err) {
      console.warn('[Prompt] semantic search err:', err.message);
    }
  }
```

- [ ] **Step 6: Verificar sintaxe**

Run: `node --check src/prompts/system.js`
Expected: exit 0.

- [ ] **Step 7: Smoke test do require (sem efeito colateral de rede)**

Run: `node -e "require('./src/utils/async'); console.log('async ok')"`
Expected: `async ok`

---

## Execução & deploy

1. **Resolver o HOLD** com o Alf (`.deploy-hold` local ainda existe). Sem isso, nada vai pra VPS.
2. Ordem sugerida de deploy (menor risco primeiro): Task 1 (obs) → Task 2 (timeout) → Task 3 (build async).
3. Deploy do engine: `scp` dos arquivos tocados (`src/ai/claude.js`, `src/ai/provider.js`, `src/utils/async.js`, `src/prompts/system.js`) + `ssh tom "pm2 restart tom"`. O `.env` (Task 2 Step 4) é editado direto na VPS.
4. Pós-deploy: observar `pm2 logs tom` por algumas horas — confirmar `fila=Xms` baixo fora de pico, `api=` como componente dominante, e timeout caindo em ~45s (não 120s) sob overload.

## Self-review

- **Cobertura da spec:** fail-fast ✓ (Task 2), build async ✓ (Task 3), observabilidade `output_tokens`/`duration_api_ms` ✓ (Task 1). Paralelismo K=2 → **fora deste plano** (plano próprio, Fase 1 da spec de paralelismo). Enxugar prompt / API SDK → fora de escopo por decisão.
- **Placeholders:** nenhum — todo step tem código/comando real.
- **Consistência de tipos:** `meta.queue_wait_ms` definido na Task 1 e consumido só no log da Task 1; `promiseWithTimeout(promise, ms, fallback)` definido na Task 3 Step 3 e usado na Task 3 Step 5 com a mesma assinatura.
- **Risco:** baixo. Nenhuma mudança toca o output do TOM. `_claudeQueue` intacto. Maior risco = Task 3 (ordem de await) — mitigado pelo timeout e pelo `.catch` que preserva o comportamento atual (segue sem embedding).
