# O Mapa — Fase 1 (Fast-path por Intenção) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar o prompt do TOM por intenção — papo → prompt mínimo (2-4s), tarefa → caminho de hoje intacto — atrás de flag reversível, sem tocar a voz.

**Architecture:** Um classificador puro (`classifyIntent`) roda antes da montagem. `conversational` → `buildSystemPrompt` monta enxuto (voz + histórico curto, sem os 24 blocos de DB, sem skill, sem decompositor). `operational` (default/fallback) → caminho de hoje byte a byte. Tudo gated por `TOM_MAPA`.

**Tech Stack:** Node.js CommonJS, `node --test` (test runner nativo), regex determinística (sem LLM no classificador).

## Global Constraints

- **Voz sagrada:** NUNCA editar `soul/SOUL.md` nem `soul/AGENTS.md`. A voz sempre carrega nos dois loadouts.
- **Zero-regressão:** o ramo `operational` produz prompt IDÊNTICO ao de hoje. Golden test obrigatório.
- **Flag reversível:** `TOM_CLAUDE`... na verdade `TOM_MAPA` (env). Off = 100% caminho de hoje. Revert em 1s (`.env` VPS + `pm2 restart tom`).
- **Classificador conservador:** na menor dúvida → `operational`. Falso-conversational é o único erro que degrada.
- **`.deploy-hold`** na raiz (`D:\la-organizer\.deploy-hold`) ANTES de editar `engine.js`/`system.js` (Tasks 2-3); remover só no fim da Task 4.
- **Catraca/TDD:** teste vermelho → código → verde. `node --check` nos arquivos que puxam `../supabase/client`.
- Projeto Supabase: `cesnbnrynvxvgdhfmaua`. Deploy: `scp` p/ `tom:/opt/LA-Organizer/...` + `ssh tom "pm2 restart tom"`.

---

### Task 1: Módulo puro `intent-map.js` (classifyIntent + LOADOUTS)

**Files:**
- Create: `src/prompts/intent-map.js`
- Test: `src/prompts/intent-map.test.js`

**Interfaces:**
- Consumes: `stripReplyScaffold` de `src/events/detect-approval-reply.js` (retorna `{ userText, quotedText }`).
- Produces: `classifyIntent(rawText: string, recentHistory: Array) → { intent: 'conversational'|'operational', loadout: Loadout }` e `LOADOUTS` (objeto). `Loadout = { skill: 'auto'|null, contextBlocks: 'full'|'minimal', decompose: 'auto'|false }`.

- [ ] **Step 1: Escrever os testes que falham** — `src/prompts/intent-map.test.js`

```js
// Rodar: node --test src/prompts/intent-map.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { classifyIntent, LOADOUTS } = require('./intent-map');

test('saudação pura → conversational', () => {
  for (const s of ['fala Tom', 'bom dia', 'oi', 'e aí', 'Coe, Tom! Tudo bem?', 'opa']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'conversational', s);
  }
});

test('agradecimento/reação curta → conversational', () => {
  for (const s of ['valeu', 'vlw Tom', 'show', 'perfeito', 'entendi', 'ok', 'fechou 👍']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'conversational', s);
  }
});

test('verbo de ação → operational', () => {
  for (const s of ['cria uma tarefa pra amanhã', 'fecha o projeto X', 'me lembra às 15h',
    'reagenda pra sexta', 'delega isso pro Yuri', 'manda pro grupo', 'lista os nomes numerados']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'operational', s);
  }
});

test('pergunta sobre dado → operational', () => {
  for (const s of ['quantas tarefas tenho hoje?', 'cadê meu projeto?', 'qual meu prazo?', 'meus gastos do mês']) {
    assert.strictEqual(classifyIntent(s, []).intent, 'operational', s);
  }
});

test('reply-quote presente → operational (contexto do quote importa)', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "lista de nomes"]\nfaz isso';
  assert.strictEqual(classifyIntent(raw, []).intent, 'operational');
});

test('texto vazio (mídia/áudio puro) → operational', () => {
  assert.strictEqual(classifyIntent('', []).intent, 'operational');
  assert.strictEqual(classifyIntent(null, []).intent, 'operational');
});

test('afirmação longa/ambígua → operational (conservador)', () => {
  // "essa lista é X" cai em operational por conter sinal ambíguo — MISS SEGURO (sem dano)
  assert.strictEqual(classifyIntent('essa lista aqui é de ciência de dados e tal', []).intent, 'operational');
});

test('loadout casa com a intenção', () => {
  assert.deepStrictEqual(classifyIntent('valeu', []).loadout, LOADOUTS.conversational);
  assert.deepStrictEqual(classifyIntent('cria tarefa', []).loadout, LOADOUTS.operational);
  assert.strictEqual(LOADOUTS.conversational.contextBlocks, 'minimal');
  assert.strictEqual(LOADOUTS.conversational.skill, null);
  assert.strictEqual(LOADOUTS.conversational.decompose, false);
  assert.strictEqual(LOADOUTS.operational.contextBlocks, 'full');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `node --test src/prompts/intent-map.test.js`
Expected: FAIL — `Cannot find module './intent-map'`.

- [ ] **Step 3: Implementar `intent-map.js`**

```js
'use strict';
// O Mapa (Fase 1) — classificador de intenção PURO (sem LLM). Decide o loadout do prompt.
// Conservador: na menor dúvida → operational (caminho completo de hoje). Ver
// docs/superpowers/specs/2026-07-01-mapa-intencao-prompt-design.md
const { stripReplyScaffold } = require('../events/detect-approval-reply');

const LOADOUTS = {
  conversational: { skill: null, contextBlocks: 'minimal', decompose: false },
  operational: { skill: 'auto', contextBlocks: 'full', decompose: 'auto' },
};

// Qualquer verbo de ação → operational.
const ACTION_RE = /\b(cri[ae]|criar|fech[ae]|fechar|conclu|reagend|remarc|delega|cobr[ae]|cobrar|apag|delet|cancel|marc[ae]|marcar|adicion|registr|agend[ae]|lembr|avis|mand[ae]|mandar|envi|salv|edit|atualiz|mov[ae]|arquiv|aprov|rejeit|paus|planej|organiz|list[ae]|listar|resum|separ|conta)\b/i;
// Pergunta sobre dado do sistema → operational.
const DATA_Q_RE = /\b(quant[ao]s?|quais|qual|cad[êe]|onde|quando|meus?|minhas?|tenho|tarefas?|projetos?|eventos?|agenda|h[áa]bitos?|prazos?|pend[êe]ncias?|financ|gast[oa]s?|contas?|relat[óo]ri)\b/i;
// Papo puro.
const GREETING_RE = /^(oi|ol[áa]|e\s*a[íi]|coe|bom\s*dia|boa\s*tarde|boa\s*noite|fala|opa|salve|beleza|blz|tudo\s*bem|tudo\s*certo|de\s*boa)\b/i;
const ACK_RE = /^(valeu|vlw|obrigad[oa]?|show|top|massa|perfeito|isso|entendi|ok|okay|certo|fechou|combinado|👍|❤️|😂)[\s!.]*$/i;

function classifyIntent(rawText, recentHistory) {
  const raw = String(rawText || '');
  const { userText } = stripReplyScaffold(raw);
  const text = (userText || '').trim();
  const op = { intent: 'operational', loadout: LOADOUTS.operational };
  if (!text) return op;                                   // mídia/áudio puro
  if (/RESPONDENDO a esta mensagem/i.test(raw)) return op; // reply-quote
  if (ACTION_RE.test(text) || DATA_Q_RE.test(text)) return op;
  if ((GREETING_RE.test(text) || ACK_RE.test(text)) && text.length <= 120) {
    return { intent: 'conversational', loadout: LOADOUTS.conversational };
  }
  return op; // default seguro
}

module.exports = { classifyIntent, LOADOUTS };
```

- [ ] **Step 4: Rodar e confirmar verde**

Run: `node --test src/prompts/intent-map.test.js`
Expected: PASS — todos os testes verdes.

- [ ] **Step 5: Commit**

```bash
git add src/prompts/intent-map.js src/prompts/intent-map.test.js
git commit -m "feat(mapa): classifyIntent + LOADOUTS puros (Fase 1)"
```

---

### Task 2: `buildSystemPrompt` aceita loadout + ramo enxuto (com golden de zero-regressão)

**Files:**
- Modify: `src/prompts/system.js` (função `buildSystemPrompt`, começa em :2631; export em :3840)
- Test: `src/prompts/system-loadout.test.js` (golden)

**Interfaces:**
- Consumes: `LOADOUTS` de `./intent-map`.
- Produces: `buildSystemPrompt(collab, opts)` passa a respeitar `opts.loadout`. Quando `opts.loadout.contextBlocks === 'minimal'`: monta SÓ a voz (o mesmo cabeçalho SOUL+AGENTS que já monta hoje) + histórico curto (últimas 8 msgs), SEM `fetchCollaboratorContext`, SEM `pickSkill`. Retorna o mesmo shape `{ systemPrompt, ctx }` (ctx mínimo: `{ recentMessages }`). Quando ausente ou `contextBlocks === 'full'`: **comportamento de hoje, inalterado.**

- [ ] **Step 1: Escrever o golden de zero-regressão (falha só se o operational mudar)** — `src/prompts/system-loadout.test.js`

```js
// Rodar na VPS (puxa ../supabase/client): ssh tom "cd /opt/LA-Organizer && node --test src/prompts/system-loadout.test.js"
// Golden: operational (default) == sem opts.loadout. E conversational NÃO chama fetchCollaboratorContext.
const { test } = require('node:test');
const assert = require('node:assert');
const system = require('./system');
const { LOADOUTS } = require('./intent-map');

// stub mínimo de collaborator já usado nos smokes da VPS
const COLLAB = { id: process.env.TEST_COLLAB_ID, role: 'director' };

test('operational: passar loadout full == não passar loadout (mesmo tamanho de prompt)', async () => {
  const a = await system.buildSystemPrompt(COLLAB, {});
  const b = await system.buildSystemPrompt(COLLAB, { loadout: LOADOUTS.operational });
  assert.strictEqual(a.systemPrompt.length, b.systemPrompt.length, 'operational divergiu do caminho de hoje');
});

test('conversational: prompt bem menor e sem blocos de contexto', async () => {
  const full = await system.buildSystemPrompt(COLLAB, {});
  const conv = await system.buildSystemPrompt(COLLAB, { loadout: LOADOUTS.conversational });
  assert.ok(conv.systemPrompt.length < full.systemPrompt.length * 0.4,
    `conversational deveria ser <40% do full (foi ${conv.systemPrompt.length} vs ${full.systemPrompt.length})`);
  // a voz continua presente (assinatura do SOUL)
  assert.match(conv.systemPrompt, /TOM/);
});
```

- [ ] **Step 2: Rodar na VPS e confirmar que falha** (o ramo minimal ainda não existe)

Run: `scp src/prompts/system-loadout.test.js src/prompts/intent-map.js tom:/opt/LA-Organizer/src/prompts/ && ssh tom "cd /opt/LA-Organizer && TEST_COLLAB_ID=<id_do_alf> node --test src/prompts/system-loadout.test.js"`
Expected: FAIL no teste `conversational` (hoje ele monta o full sempre).

- [ ] **Step 3: Implementar o ramo minimal no `buildSystemPrompt`**

Ler `buildSystemPrompt` (system.js:2631) e, logo após a resolução de `opts`, inserir o early-return enxuto ANTES de `fetchCollaboratorContext`:

```js
// O Mapa (Fase 1) — loadout minimal: monta só a voz + histórico curto. Pula os ~24
// blocos de DB e o pickSkill. Reusa o MESMO cabeçalho de voz do caminho full (extrair
// o trecho SOUL+AGENTS que já é lido no topo do build para uma const `voiceHeader`).
if (opts.loadout && opts.loadout.contextBlocks === 'minimal') {
  const hist = await fetchRecentHistory(collaborator.id, 8); // helper que lê só as últimas 8 msgs
  const systemPrompt = [voiceHeader, formatMessages(hist)].filter(Boolean).join('\n\n');
  console.log(`[Prompt] size: ${systemPrompt.length} chars (loadout: minimal, history: ${hist.length})`);
  return { systemPrompt, ctx: { recentMessages: hist } };
}
```

Notas de implementação (o executor confirma lendo o código):
- `voiceHeader` = o mesmo bloco SOUL+AGENTS que o build já concatena hoje. Extrair para uma variável reutilizável nos dois ramos (DRY) — NÃO reescrever o conteúdo.
- `fetchRecentHistory(id, n)` — se já existir leitura de histórico isolada, reusar; senão, `select ... from conversation_history where collaborator_id=id order by created_at desc limit n` e `.reverse()` (mesmo padrão de system.js:1839).
- O ramo full permanece 100% intacto abaixo do early-return.

- [ ] **Step 4: Rodar o golden na VPS e confirmar verde**

Run: `ssh tom "cd /opt/LA-Organizer && TEST_COLLAB_ID=<id_do_alf> node --test src/prompts/system-loadout.test.js"`
Expected: PASS nos dois — operational igual ao de hoje, conversational <40% e com a voz.

- [ ] **Step 5: `node --check` + commit**

```bash
node --check src/prompts/system.js && echo OK
git add src/prompts/system.js src/prompts/system-loadout.test.js
git commit -m "feat(mapa): buildSystemPrompt respeita loadout minimal (golden zero-regressão)"
```

---

### Task 3: Wiring no engine — classificar, gate por flag, pular decompositor, telemetria

**Files:**
- Modify: `src/engine.js` (require no topo; classificar perto de :8209; passar loadout ao `buildSystemPrompt` em :9640)

**Interfaces:**
- Consumes: `classifyIntent` de `./prompts/intent-map`; `buildSystemPrompt(collab, { loadout })` da Task 2.
- Produces: comportamento observável — msg conversational (com `TOM_MAPA=1`) pula decompositor e monta minimal; qualquer outra ou flag off = caminho de hoje.

- [ ] **Step 1: Criar `.deploy-hold` (protege o auto-deploy enquanto edito o engine)**

Run: `touch /d/la-organizer/.deploy-hold && echo held`
Expected: `held`.

- [ ] **Step 2: Adicionar o require + a flag no topo do engine.js**

Perto dos outros requires (ex.: após o require de `audio-decompose`, linha ~76):

```js
const { classifyIntent } = require('./prompts/intent-map');
const TOM_MAPA = process.env.TOM_MAPA === '1';
```

- [ ] **Step 3: Classificar e gatear ANTES do decompositor**

No fluxo da mensagem, imediatamente antes de `const _decompose = await audioDecompose.decomposeIfLarge(text);` (engine.js:8209):

```js
// O Mapa (Fase 1) — classifica intenção. conversational + flag ON → loadout minimal, pula decompositor.
const _mapa = TOM_MAPA ? classifyIntent(text, recentHistory) : { intent: 'operational', loadout: null };
const _isConv = _mapa.intent === 'conversational';
console.log(`[Mapa] intent=${_mapa.intent} flag=${TOM_MAPA ? 'on' : 'off'} phone=${_phoneTail}`);
```

E gatear o decompositor (envolver a chamada existente):

```js
const _decompose = _isConv
  ? { decomposed: false, reason: 'conversational_skip' }
  : await audioDecompose.decomposeIfLarge(text);
```

- [ ] **Step 4: Passar o loadout ao buildSystemPrompt**

Na chamada de :9640, trocar:

```js
let { systemPrompt, ctx } = await buildSystemPrompt(collab, _promptOpts);
```
por:
```js
let { systemPrompt, ctx } = await buildSystemPrompt(collab, { ..._promptOpts, loadout: _mapa.loadout });
```
(Quando `_mapa.loadout` é `null` — flag off ou operational — o `buildSystemPrompt` ignora e faz o de hoje.)

- [ ] **Step 5: `node --check`**

Run: `node --check src/engine.js && echo OK`
Expected: `OK`.

- [ ] **Step 6: Commit**

```bash
git add src/engine.js
git commit -m "feat(mapa): engine classifica intenção e gateia decompositor+loadout (flag TOM_MAPA)"
```

---

### Task 4: Deploy gated + medição + registro

**Files:** nenhum novo (deploy + validação).

- [ ] **Step 1: Deploy dos arquivos (flag ainda OFF na VPS)**

```bash
scp src/prompts/intent-map.js src/prompts/intent-map.test.js src/prompts/system.js src/prompts/system-loadout.test.js src/engine.js tom:/opt/LA-Organizer/src/prompts/ 2>/dev/null
scp src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom"
```
(garantir que `TOM_MAPA` NÃO está no `.env` ainda → flag off → caminho de hoje.)

- [ ] **Step 2: Verificar zero-regressão LIVE com a flag OFF**

Run: `ssh tom "pm2 logs tom --lines 20 --nostream | grep -vE 'prefsRes' | tail"`
Expected: boot limpo; mensagens reais continuam com `[Prompt] size` normal (operational), sem `[Mapa]`.

- [ ] **Step 3: Ligar a flag + restart**

```bash
ssh tom "printf '\nTOM_MAPA=1\n' >> /opt/LA-Organizer/.env && grep -n TOM_MAPA /opt/LA-Organizer/.env && pm2 restart tom"
```

- [ ] **Step 4: Medir (com um 'fala Tom' de teste real do Alf)**

Run: `ssh tom "pm2 logs tom --lines 60 --nostream | grep -E '\[Mapa\]|loadout: minimal|\[AI\].*dur='"`
Expected: numa msg de papo → `[Mapa] intent=conversational`, `[Prompt] size: ... (loadout: minimal ...)` bem menor, e `[AI] ... dur=` de ~2-4s.

- [ ] **Step 5: Remover o `.deploy-hold` + registrar**

```bash
rm -f /d/la-organizer/.deploy-hold
```
Registrar no `tom_known_issues` (via MCP Supabase, projeto `cesnbnrynvxvgdhfmaua`) o código `MAPA-FASE1-FASTPATH` (status corrigido, causa_raiz = prompt cego, fix_resumo = classifyIntent+loadout minimal gated). Atualizar memória `project_mapa_intencao_prompt` (Fase 1 LIVE).

---

## Self-Review

**1. Cobertura da spec:**
- classifyIntent puro → Task 1 ✅
- Tabela de loadout → Task 1 (`LOADOUTS`) ✅
- Gate na montagem + flag `TOM_MAPA` → Tasks 2-3 ✅
- Ramo minimal (voz + histórico curto, sem 24 blocos/skill) → Task 2 ✅
- Pular decompositor no conversational → Task 3 (Step 3) ✅
- Telemetria (`[Mapa]` + loadout no `[Prompt] size`) → Tasks 2-3 ✅
- Golden zero-regressão (operational == hoje) → Task 2 ✅
- Deploy gated + medição + rollback → Task 4 ✅
- SOUL intocado → Global Constraints + Task 2 reusa voiceHeader, não reescreve ✅

**2. Placeholder scan:** o único ponto que o executor resolve lendo o código é o `voiceHeader`/`fetchRecentHistory` na Task 2 (extração de trecho já existente do `buildSystemPrompt`) — é DRY sobre código atual, não invenção. Aceitável e explicitado.

**3. Consistência de tipos:** `classifyIntent → { intent, loadout }`; `LOADOUTS.{conversational,operational}` com `{skill, contextBlocks, decompose}`; `buildSystemPrompt(collab, {loadout})` retorna `{systemPrompt, ctx}` nos dois ramos. Consistente entre Tasks 1-3.

**Fora de escopo (Fase 2/3):** contexto scoped por intenção operacional, dieta de skills, limpeza AGENTS. Não entram neste plano.
