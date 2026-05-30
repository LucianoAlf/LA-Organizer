# Decompositor de Áudio Longo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parar de perder demandas quando o usuário manda áudio longo com muitas intenções (caso Peterson) — extrair a lista numa chamada LLM enxuta ANTES do pipeline pesado e devolver o áudio reescrito como lista enumerada para o fluxo normal processar item-a-item.

**Architecture:** Pré-passada de extração em `processMessage` quando o texto é áudio transcrito e ultrapassa o gatilho de tamanho. A pré-passada chama `claude.chat` diretamente com um system prompt minúsculo focado só em "liste as demandas distintas, uma por linha". O resultado é uma lista enumerada que substitui (com prefixo + verbatim original preservado) o `text` que segue para `buildSystemPrompt` + `ai.chat`. O fluxo normal de markers (TASK_CREATE/EVENT_CREATE/etc.) e a infra existente (AUTO_RETRY, ACTIONABLE_NO_MARKER, P5 do coach) continuam intactos. P5 vira fallback para o caso em que o decompositor falhe ou ainda assim o LLM principal perca algo.

**Tech Stack:** Node.js, `src/ai/claude.js` (CLI Claude), `src/engine.js` (pipeline principal), `src/services/metrics.js` (tom_metrics), Supabase para telemetria.

---

## Spec curto

### Problema
Áudio longo (caso Peterson) → TOM gera `ACTIONABLE_NO_MARKER`, `schema_invalid`, timeout (Claude → Codex fallback). Causa raiz: uma chamada única faz tudo (transcrever-+-interpretar-+-decidir-+-emitir markers) competindo contra os ~100KB de skills + janela de 120s. Diferente do ChatGPT, que num único call só ouve e extrai sem peso adicional.

### Solução (PASSO 1 + PASSO 2)
1. **PASSO 1 — Extrator enxuto** (novo): `claude.chat(EXTRACTOR_PROMPT, [{role:'user', content: textOriginal}])` SEM `buildSystemPrompt`. Prompt minúsculo (~500 chars). Output: lista enumerada de demandas (1 por linha, verbatim do colaborador).
2. **PASSO 2 — Fluxo normal**: o `text` que vai para `buildSystemPrompt` é reescrito como `[áudio transcrito + decomposto] <verbatim original>\n\n>>> Demandas detectadas (processar TODAS):\n1. ...\n2. ...\n3. ...`. O LLM principal continua emitindo markers, mas vendo a lista já enumerada — não compete com sua própria extração.

### Gatilho (heurística)
Pré-passada SOMENTE quando TODAS forem verdade:
- `_metrics.message_kind === 'audio'` (texto começa com `[áudio transcrito]`)
- `text.length >= TOM_DECOMPOSE_MIN_CHARS` (default **600 chars** — ~45-60s de áudio típico)
- Heurística de múltiplas intenções: `count(/\b(e|também|outra coisa|ah|por favor|preciso|quero|marca|cria|agenda|cobra|manda|avisa|lembra)\b/gi) >= 4` OU `text.split(/[.!?]/).length >= 5`

Áudio curto (1-3 itens) → fluxo atual SEM pré-passada (zero regressão).

### Fallback (P5 do coach)
Se o decompositor falhar (timeout, lista vazia, parse inválido), seguir o fluxo atual SEM decompor. O LLM principal vê o áudio cru e pode acionar o padrão P5 do `coach-usabilidade.md` (já existe — não mexer).

### Telemetria nova (em `tom_metrics`)
- `decompose_triggered: boolean`
- `decompose_items_count: int | null`
- `decompose_latency_ms: int | null`
- `decompose_skipped_reason: string | null` (`'too_short'`, `'low_intent_density'`, `'not_audio'`, `'extractor_failed'`)

### Idempotência
A reescrita substitui `text` ANTES da chamada principal. Não há risco de duplicação porque o LLM principal continua sendo o único emissor de markers. Os parsers atuais (`parseTaskCreateMarker`, `parseEventCreateMarker`, etc.) já são idempotentes via dedupe service.

### Custo
+1 chamada Claude CLI apenas em áudios grandes (≈5-10% das mensagens). Claude CLI é assinatura, não metered. Latência total sobe ~3-8s no melhor caso vs 60-120s + fallback Codex no pior caso atual.

### Não-mexer
- `coach-usabilidade.md` (P5 continua como fallback)
- `tratamento-audio.md` (skill já carregada normalmente)
- `provider.js` (fallback Codex continua igual)
- Mutex `_claudeQueue` em `claude.js` (serial fica)
- Parsers de markers existentes

---

## Decisão arquitetural pendente (PRECISA OK DO ALF)

Duas opções para o "PASSO 2":

**Opção B-prime (recomendada — escolhida neste plano):**
- O `text` reescrito vai para o LLM principal (1 chamada `ai.chat`).
- O LLM vê a lista enumerada e emite todos os markers de uma vez.
- Vantagens: mínima cirurgia, 1 resposta única ao user, reaproveita 100% do pipeline.
- Risco: LLM principal ainda pode falhar ao coordenar 6+ markers num call só.

**Opção C (alternativa — mais defensiva):**
- Loop item-a-item: cada demanda extraída → chamada LLM focada (skill+prompt enxuto) que emite UM marker.
- Vantagem: praticamente impossível perder item.
- Custo: N chamadas Claude (latência total proporcional). Mutex serial pioraria. Precisa montar a resposta WhatsApp final agregando.

**Recomendação:** começar com **B-prime** (este plano). Se logs ainda mostrarem perda em áudios extremos (>10 demandas), avaliar C como upgrade.

---

## File Structure

- **Create:** `src/services/audio-decompose.js` — Extrator (1 função: `decomposeIfLarge(text) → { decomposed: boolean, items: string[], rewrittenText: string|null, reason: string|null, latencyMs: number }`)
- **Modify:** `src/engine.js` (entre linhas 5771 e 6205, dentro de `processMessage`) — chamar o decompositor e reescrever `text`
- **Modify:** `src/engine.js` (~linha 6240) — adicionar campos de telemetria em `_metrics`
- **Create:** `src/services/audio-decompose.test.js` — testes do extrator (mock do `claude.chat`)
- **Create:** `scripts/smoke-decompose.js` — smoke E2E com transcript fixo do caso Peterson + caso curto

---

## Tasks

### Task 1: Criar serviço `audio-decompose.js`

**Files:**
- Create: `src/services/audio-decompose.js`
- Test: `src/services/audio-decompose.test.js`

- [ ] **Step 1: Escrever o teste falhando — caso "áudio grande"**

```js
// src/services/audio-decompose.test.js
const test = require('node:test');
const assert = require('node:assert');
const { decomposeIfLarge, _setClaudeForTests } = require('./audio-decompose');

test('decomposeIfLarge — extrai lista quando texto passa do gatilho', async () => {
  _setClaudeForTests({
    chat: async (sys, msgs) => ({
      text: '1. marcar reunião com Juliana terça\n2. cobrar Rafinha sobre relatório\n3. comprar pilha pra microfonia',
      provider: 'claude',
    }),
  });
  const long = '[áudio transcrito] ' + 'ah Tom, preciso marcar uma reunião com a Juliana terça, também cobra o Rafinha do relatório e por favor compra pilha pra microfonia, '.repeat(4);
  const r = await decomposeIfLarge(long);
  assert.equal(r.decomposed, true);
  assert.equal(r.items.length, 3);
  assert.ok(r.rewrittenText.includes('Demandas detectadas'));
  assert.ok(r.rewrittenText.includes('1.'));
  assert.ok(r.latencyMs > 0);
});

test('decomposeIfLarge — pula áudio curto', async () => {
  const short = '[áudio transcrito] marca reunião com Juliana terça';
  const r = await decomposeIfLarge(short);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'too_short');
});

test('decomposeIfLarge — pula texto não-áudio', async () => {
  const txt = 'olá tudo bem? ' + 'lorem '.repeat(200);
  const r = await decomposeIfLarge(txt);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'not_audio');
});

test('decomposeIfLarge — pula áudio grande sem densidade de intenções', async () => {
  const monolog = '[áudio transcrito] ' + 'estava pensando na vida ontem '.repeat(40);
  const r = await decomposeIfLarge(monolog);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'low_intent_density');
});

test('decomposeIfLarge — fallback gracioso quando extractor falha', async () => {
  _setClaudeForTests({
    chat: async () => { const e = new Error('timeout'); e.kind = 'timeout'; throw e; },
  });
  const long = '[áudio transcrito] ' + 'preciso marcar uma reunião, cobra o Rafa, compra pilha, agenda a sala, '.repeat(3);
  const r = await decomposeIfLarge(long);
  assert.equal(r.decomposed, false);
  assert.equal(r.reason, 'extractor_failed');
});
```

- [ ] **Step 2: Rodar testes pra confirmar que falham**

```bash
ssh tom "cd /opt/LA-Organizer && node --test src/services/audio-decompose.test.js"
```
Expected: FAIL com `Cannot find module './audio-decompose'`

- [ ] **Step 3: Implementar `audio-decompose.js`**

```js
// src/services/audio-decompose.js
// Pré-passada de extração para áudios longos. Chama claude.chat com prompt
// minúsculo (sem skills) só pra listar as demandas distintas. Resultado vira
// uma reescrita estruturada do texto que vai pro pipeline normal.
let _claude = require('../ai/claude');

const MIN_CHARS = Number(process.env.TOM_DECOMPOSE_MIN_CHARS) || 600;
const INTENT_REGEX = /\b(e|tamb[ée]m|outra coisa|ah|por favor|preciso|quero|marca|cria|agenda|cobra|manda|avisa|lembra)\b/gi;
const MIN_INTENT_HITS = 4;
const MIN_SENTENCES = 5;
const AUDIO_PREFIX_RE = /^\[áudio transcrito\]/i;

const EXTRACTOR_SYSTEM = `Você é um extrator. Sua ÚNICA tarefa é listar as demandas distintas do colaborador.
Regras:
- Uma demanda por linha, prefixada com número.
- Use as PALAVRAS DO COLABORADOR (verbatim curto), sem parafrasear.
- NÃO execute nada, NÃO emita markers, NÃO responda nada além da lista.
- Se houver só uma demanda, retorne uma linha só.
- Se for fala social/divagação sem demanda, retorne string vazia.`;

function shouldDecompose(text) {
  if (!AUDIO_PREFIX_RE.test(text)) return { ok: false, reason: 'not_audio' };
  if (text.length < MIN_CHARS) return { ok: false, reason: 'too_short' };
  const intentHits = (text.match(INTENT_REGEX) || []).length;
  const sentenceCount = text.split(/[.!?]+/).filter(s => s.trim().length > 3).length;
  if (intentHits < MIN_INTENT_HITS && sentenceCount < MIN_SENTENCES) {
    return { ok: false, reason: 'low_intent_density' };
  }
  return { ok: true };
}

function parseList(raw) {
  if (!raw || !raw.trim()) return [];
  return raw
    .split('\n')
    .map(l => l.replace(/^\s*[\d]+[\.\)\-:]\s*/, '').trim())
    .filter(l => l.length >= 3);
}

async function decomposeIfLarge(text) {
  const t0 = Date.now();
  const gate = shouldDecompose(text);
  if (!gate.ok) {
    return { decomposed: false, items: [], rewrittenText: null, reason: gate.reason, latencyMs: 0 };
  }
  try {
    const r = await _claude.chat(EXTRACTOR_SYSTEM, [{ role: 'user', content: text }], 600);
    const items = parseList(r.text);
    if (items.length === 0) {
      return { decomposed: false, items: [], rewrittenText: null, reason: 'extractor_empty', latencyMs: Date.now() - t0 };
    }
    const enumerated = items.map((it, i) => `${i + 1}. ${it}`).join('\n');
    const rewrittenText =
      text +
      `\n\n>>> Demandas detectadas pelo decompositor (processe TODAS, uma por uma):\n` +
      enumerated;
    return { decomposed: true, items, rewrittenText, reason: null, latencyMs: Date.now() - t0 };
  } catch (err) {
    console.warn(`[Decompose] extractor falhou kind=${err.kind || 'unknown'} msg=${err.message.slice(0, 120)}`);
    return { decomposed: false, items: [], rewrittenText: null, reason: 'extractor_failed', latencyMs: Date.now() - t0 };
  }
}

function _setClaudeForTests(stub) { _claude = stub; }

module.exports = { decomposeIfLarge, shouldDecompose, _setClaudeForTests };
```

- [ ] **Step 4: Rodar testes pra confirmar que passam**

```bash
ssh tom "cd /opt/LA-Organizer && node --test src/services/audio-decompose.test.js"
```
Expected: PASS em todos os 5 testes.

- [ ] **Step 5: Não commitar ainda — passa pra task 2**

Sem commit individual (auto-deploy faz no fim do turno conforme CLAUDE.md `_remote`).

---

### Task 2: Plugar decompositor em `processMessage`

**Files:**
- Modify: `src/engine.js` (após linha 5771 — após inicialização de `_metrics`, antes de `findByPhone`)

- [ ] **Step 1: Ler o trecho exato a alterar**

Confirmar linhas 5760-5785 atuais antes de editar.

- [ ] **Step 2: Adicionar require no topo do engine.js**

Localizar o bloco de requires (linhas 1-30). Adicionar:

```js
const audioDecompose = require('./services/audio-decompose');
```

- [ ] **Step 3: Inserir chamada do decompositor após `_metrics` ser criado**

Após linha 5772 (`};` fecha `_metrics`), antes de `const collab = await collaboratorService.findByPhone(phone);`:

```js
  // Sprint 32 — Decompositor de áudio longo. Quando o transcript é grande e
  // tem múltiplas intenções, faz uma pré-passada LLM enxuta (sem ~100KB de
  // skills) só pra extrair a lista de demandas. Reescreve `text` com a lista
  // enumerada anexada, pra que o LLM principal não tenha que extrair sozinho.
  // Fallback gracioso: se falhar, segue o fluxo atual (P5 coach pode reagir).
  const _decompose = await audioDecompose.decomposeIfLarge(text);
  _metrics.decompose_triggered = _decompose.decomposed;
  _metrics.decompose_items_count = _decompose.decomposed ? _decompose.items.length : null;
  _metrics.decompose_latency_ms = _decompose.latencyMs || null;
  _metrics.decompose_skipped_reason = _decompose.reason || null;
  if (_decompose.decomposed) {
    console.log(`[Engine] DECOMPOSE_OK items=${_decompose.items.length} latency=${_decompose.latencyMs}ms phone=${_phoneTail}`);
    text = _decompose.rewrittenText;
  } else if (_decompose.reason === 'extractor_failed') {
    console.warn(`[Engine] DECOMPOSE_FAIL — seguindo com texto original phone=${_phoneTail}`);
  }
```

- [ ] **Step 4: Validar sintaxe**

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js"
```
Expected: sem output (sintaxe OK).

- [ ] **Step 5: Verificar que `inboundVerbatimText` continua sendo o texto ORIGINAL**

`inboundVerbatimText` é capturado na linha 5763 (`const inboundVerbatimText = text;`) — ANTES do decompositor. Confirmar que essa linha não foi tocada e que `inboundVerbatimText` é usado depois pra COORDINATION_RESPONSE (mantém o verbatim sem a reescrita). Grep:

```bash
ssh tom "grep -n inboundVerbatimText /opt/LA-Organizer/src/engine.js"
```
Expected: pelo menos 2 hits — captura na linha ~5763 + uso(s) posterior(es) com o texto original.

---

### Task 3: Hint opcional no system prompt quando decomposto

**Files:**
- Modify: `src/engine.js` (~linha 6213, onde `relayHint` é anexado)

- [ ] **Step 1: Anexar dica curta ao system prompt quando `_decompose.decomposed`**

Após o bloco do `relayHint` (linha 6212-6217), antes de `const onboardingActive`:

```js
  if (_decompose.decomposed) {
    systemPrompt +=
      `\n\n>>> AVISO INTERNO: o colaborador mandou um áudio longo. ` +
      `Um decompositor extraiu ${_decompose.items.length} demandas distintas ` +
      `(estão enumeradas no final da mensagem dele). ` +
      `Emita o marker correspondente pra CADA demanda. Não perca nenhuma. ` +
      `Se ficou em dúvida em alguma, salve as que captou e pergunte só sobre a que ficou em dúvida (padrão P5).`;
  }
```

- [ ] **Step 2: Validar sintaxe**

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js"
```
Expected: sem output.

---

### Task 4: Smoke E2E offline

**Files:**
- Create: `scripts/smoke-decompose.js`

- [ ] **Step 1: Criar smoke**

```js
// scripts/smoke-decompose.js
// Smoke offline: roda decomposeIfLarge contra 2 transcripts reais.
// Não chama Whisper (texto já dado). Não persiste no Supabase.
// Roda contra o Claude CLI REAL — testa latência e qualidade da extração.
const dec = require('../src/services/audio-decompose');

const CASE_LONG = `[áudio transcrito] Tom, bom dia. Olha, preciso que você tome conta de algumas coisas pra mim. Primeiro, marca uma reunião com a Juliana pra terça-feira no fim do dia, umas 18h, pra revisar o calendário do mês. Ah, também queria que você cobrasse o Rafinha sobre o relatório de matrículas — ele tinha prometido pra ontem e até agora nada. Outra coisa, por favor, manda comprar pilha tamanho AA pra microfonia da unidade Tatuapé, antes de sexta. E avisa o Yuri que a reunião de equipe vai mudar de quinta pra sexta, mesma hora. Ah, e lembra de mim na semana que vem pra eu fazer o checkpoint do projeto novo do LA Journey. Acho que é só isso. Valeu.`;
const CASE_SHORT = `[áudio transcrito] Marca reunião com Juliana terça às 18h.`;

(async () => {
  console.log('--- Caso longo (Peterson-like) ---');
  const r1 = await dec.decomposeIfLarge(CASE_LONG);
  console.log(JSON.stringify({
    decomposed: r1.decomposed,
    items_count: r1.items.length,
    latency_ms: r1.latencyMs,
    reason: r1.reason,
  }, null, 2));
  console.log('Items:');
  r1.items.forEach((it, i) => console.log(`  ${i + 1}. ${it}`));
  console.log('\nrewrittenText (primeiros 400 chars):');
  console.log((r1.rewrittenText || '').slice(0, 400));

  console.log('\n--- Caso curto ---');
  const r2 = await dec.decomposeIfLarge(CASE_SHORT);
  console.log(JSON.stringify({
    decomposed: r2.decomposed,
    items_count: r2.items.length,
    latency_ms: r2.latencyMs,
    reason: r2.reason,
  }, null, 2));

  process.exit(0);
})().catch(err => { console.error('SMOKE FAIL:', err); process.exit(1); });
```

- [ ] **Step 2: Rodar smoke no VPS (precisa Claude CLI real)**

```bash
scp _remote/scripts/smoke-decompose.js tom:/opt/LA-Organizer/scripts/
ssh tom "cd /opt/LA-Organizer && node scripts/smoke-decompose.js"
```
Expected:
- Caso longo: `decomposed: true`, `items_count >= 5`, latência < 15s.
- Caso curto: `decomposed: false`, `reason: "too_short"`, latência 0.

- [ ] **Step 3: Validar manualmente com Alf — qualidade da extração**

Mostrar o output da lista pro Alf e perguntar:
1. Capturou TODAS as demandas do áudio longo?
2. Alguma duplicação ou item alucinado?
3. Linguagem verbatim suficiente pro LLM principal entender?

Decisão GO/NO-GO antes de subir.

---

### Task 5: Deploy + validação em produção

- [ ] **Step 1: SCP dos arquivos novos/alterados**

```bash
scp _remote/src/services/audio-decompose.js tom:/opt/LA-Organizer/src/services/
scp _remote/src/engine.js tom:/opt/LA-Organizer/src/
scp _remote/scripts/smoke-decompose.js tom:/opt/LA-Organizer/scripts/
```

- [ ] **Step 2: Reiniciar TOM**

```bash
ssh tom "pm2 restart tom"
```
Expected: `tom │ online`

- [ ] **Step 3: Monitorar logs ao vivo por 5min**

```bash
ssh tom "pm2 logs tom --lines 50 --nostream"
```
Procurar `DECOMPOSE_OK` ou `DECOMPOSE_FAIL`.

- [ ] **Step 4: Validação prática com Alf**

Alf manda um áudio longo (simular Peterson) → confirmar que TODOS os itens viraram TASK/EVENT no Supabase. Query:

```sql
-- via mcp Supabase
SELECT marker_type, result, reason, created_at
FROM marker_logs
WHERE collaborator_id = '<alf-id>'
  AND created_at >= now() - interval '10 minutes'
ORDER BY created_at DESC;

SELECT decompose_triggered, decompose_items_count, decompose_latency_ms,
       provider_used, latency_ms, marker_emitted, marker_result
FROM tom_metrics
WHERE collaborator_id = '<alf-id>'
  AND created_at >= now() - interval '10 minutes'
ORDER BY created_at DESC;
```

- [ ] **Step 5: Rollback rápido se algo quebrar**

Se métricas mostrarem regressão em áudios normais (decompose_triggered=true em áudio curto, ou latência principal subindo): setar `TOM_DECOMPOSE_MIN_CHARS=99999` em `.env` do VPS pra desligar o gatilho sem mexer no código.

```bash
ssh tom "cd /opt/LA-Organizer && grep TOM_DECOMPOSE_MIN_CHARS .env || echo 'TOM_DECOMPOSE_MIN_CHARS=99999' >> .env && pm2 restart tom"
```

- [ ] **Step 6: Marcar Sprint 32 fechada**

Atualizar `CLAUDE.md` (seção "Sprint X hardening" no `claude.js` se aplicável — ou só comentar a finalização aqui).

---

## Self-Review (checklist do writing-plans)

**1. Spec coverage:**
- Gatilho heurístico ✅ Task 1 (`shouldDecompose`)
- Pré-passada LLM enxuta ✅ Task 1 (`decomposeIfLarge`)
- Reescrita do `text` ✅ Task 2
- Hint pro LLM principal ✅ Task 3
- Telemetria ✅ Task 2 (4 campos novos em `_metrics`)
- Fallback gracioso ✅ Task 1 (try/catch retorna `extractor_failed`)
- P5 coach como segunda rede ✅ não-mexer (existe)
- Smoke E2E ✅ Task 4
- Deploy + rollback ✅ Task 5

**2. Placeholder scan:** sem TBD/TODO/"add error handling". Todo código está completo.

**3. Type consistency:** `decomposeIfLarge` retorna o mesmo shape em todos os caminhos (sucesso, gate-skip, extractor-fail). `_metrics.decompose_*` campos consistentes.

---

## Execution Handoff

**Plano salvo em `_remote/docs/superpowers/plans/2026-05-30-decompositor-audio-longo.md`.**

Antes de executar, **PRECISA OK DO ALF** em 2 pontos:
1. Opção B-prime vs Opção C (recomendação: B-prime).
2. Limiares do gatilho: `MIN_CHARS=600`, `MIN_INTENT_HITS=4`, `MIN_SENTENCES=5`.

Após OK, sugiro:
- **Subagent-Driven (recomendado)** — dispatch Task 1 → review → Task 2 → review → ... Mínimo de cirurgia no pipeline central, fácil de reverter por task.
