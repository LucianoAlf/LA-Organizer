# Paridade do fallback Codex/GPT-5.5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o fallback Codex pronto pra assumir com paridade do Claude — histórico de conversa, sanitização de output e cwd limpo — sem virar primário nem mudar o jeito do TOM.

**Architecture:** Extrair o que hoje é exclusivo do `claude.js` (montagem do user prompt + sanitização do output) pra dois helpers puros compartilhados (`prompt.js`, `sanitize.js`), refatorar o `claude.js` pra consumi-los (comportamento primário inalterado, garantido por golden-master), e aplicar os mesmos helpers + `cwd: os.tmpdir()` no `openai.js`.

**Tech Stack:** Node.js (CommonJS), `node --test` (test runner nativo), CLIs `claude` e `codex exec`.

## Global Constraints

- **Comportamento do TOM é sagrado:** nenhuma mudança no system prompt, tom, ou jeito das respostas. Só input/output plumbing do fallback.
- **Primário inalterado:** o refactor do `claude.js` NÃO pode mudar o comportamento do Claude — provado por golden-master capturado antes de tocar o código.
- **Commits:** NÃO commitar manualmente entre tasks (regra do `_remote/CLAUDE.md`). O auto-deploy hook (Stop) agrega tudo num bundle no fim do turno. Cada task termina com **testes verdes + `node --check`** como gate de revisão, não com `git commit`.
- **Deploy pra E2E:** os helpers puros testam local (`node --test`). O E2E roda só na VPS via `scp` explícito dos arquivos + `node --env-file=.env` (o engine só precisa de `pm2 restart` na adoção final, NÃO durante o teste — o harness importa os módulos isolado).
- **Verbatim do histórico:** copiar a lógica `slice(0,-1)` + `pop()` idêntica ao `claude.js:164-173`. A sutileza de desalinhamento (última msg não-user) já existe hoje; **não consertar** (mudaria o primário; YAGNI).
- **`sanitizeOutput` inclui o `.trim()` final** e retorna a string 100% limpa; o caller calcula `rawResult.length - limpo.length` pra `sanitized_chars` (bate idêntico ao de hoje).

---

### Task 1: `prompt.js` — buildUserPrompt (helper puro compartilhado)

**Files:**
- Create: `src/ai/prompt.js`
- Test: `src/ai/prompt.test.js`

**Interfaces:**
- Produces: `buildUserPrompt(messages: Array<{role:string, content:string}>) → string`

- [ ] **Step 1: Write the failing test**

`src/ai/prompt.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildUserPrompt } = require('./prompt');

test('com histórico: embrulha "Conversa recente" + "Mensagem atual"', () => {
  const msgs = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Olá! 👽' },
    { role: 'user', content: 'cria tarefa X' },
  ];
  assert.strictEqual(
    buildUserPrompt(msgs),
    'Conversa recente:\nUsuário: oi\nTOM: Olá! 👽\n\nMensagem atual do usuário:\ncria tarefa X'
  );
});

test('sem histórico (1 msg): retorna só a mensagem', () => {
  assert.strictEqual(buildUserPrompt([{ role: 'user', content: 'oi' }]), 'oi');
});

test('array vazio: string vazia', () => {
  assert.strictEqual(buildUserPrompt([]), '');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test src/ai/prompt.test.js`
Expected: FAIL — `Cannot find module './prompt'`.

- [ ] **Step 3: Write minimal implementation**

`src/ai/prompt.js` (copiado verbatim de `claude.js:164-173`):
```js
// Monta o user prompt do TOM: histórico recente formatado + mensagem atual.
// Lógica IDÊNTICA à que vivia inline no claude.js (paridade Claude/Codex).
function buildUserPrompt(messages) {
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
  const history = messages
    .slice(0, -1)
    .map(m => (m.role === 'user' ? 'Usuário: ' : 'TOM: ') + m.content)
    .join('\n');
  return history
    ? `Conversa recente:\n${history}\n\nMensagem atual do usuário:\n${lastUser}`
    : lastUser;
}

module.exports = { buildUserPrompt };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test src/ai/prompt.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Gate** — `node --check src/ai/prompt.js` limpo. (Sem commit — ver Global Constraints.)

---

### Task 2: `sanitize.js` — sanitizeOutput (helper puro + golden-master)

**Files:**
- Create: `scripts/capture-sanitize-golden.js` (descartável — gera o golden da cadeia atual)
- Create: `src/ai/__fixtures__/sanitize.golden.json`
- Create: `src/ai/sanitize.js`
- Test: `src/ai/sanitize.test.js`

**Interfaces:**
- Produces: `sanitizeOutput(raw: string) → string` (limpo, pós-`.trim()`)

- [ ] **Step 1: Capturar o golden-master ANTES de extrair**

`scripts/capture-sanitize-golden.js` — contém uma **cópia verbatim** da cadeia inline atual de `claude.js:276-321` aplicada a um corpus, e grava o snapshot:
```js
const fs = require('fs');
const path = require('path');
function currentSanitize(rawResult) {
  const sanitized = rawResult
    .replace(/<tool_(call|use|name|result)[\s\S]*?<\/tool_\1>/gi, '')
    .replace(/<\/?tool_(call|use|name|result)\b[^>]*>/gi, '')
    .replace(/<function_call[\s\S]*?<\/function_call>/gi, '')
    .replace(/<\/?function_call\b[^>]*>/gi, '')
    .replace(/<parameters?[\s\S]*?<\/parameters?>/gi, '')
    .replace(/<\/?parameters?\b[^>]*>/gi, '')
    .replace(/<details[\s\S]*?<\/details>/gi, '')
    .replace(/<\/?details\b[^>]*>/gi, '')
    .replace(/<summary[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/?summary\b[^>]*>/gi, '')
    .replace(/<(?:antml:)?invoke\b[\s\S]*?<\/(?:antml:)?invoke>/gi, '')
    .replace(/<\/?(?:antml:)?(?:function_calls|invoke|parameter)\b[^>]*>/gi, '')
    .replace(/^.*\b(?:feedback\s+memory|memory\s+hint|saving\s+feedback)\b.*$/gim, '')
    .replace(/^.*\b(Based on|Now let me|Let me (?:update|read|write|check|create|save|run|verify|now)|I.ll (?:update|read|write|check|create|save|run|now)|I need to (?:update|read|write|check|create|save|run))\b.*$/gim, '')
    .replace(/^.*\b(MEMORY\.md|memory\/[\w-]+\.md|\/root\/\.claude|\.claude\/projects|\/opt\/LA-Organizer\/(?!docs\b))\b.*$/gim, '')
    .replace(/^.*\b(?:vou\s+salvar\s+isso\s+na\s+mem[óo]ria|salvando\s+na\s+mem[óo]ria|saving\s+to\s+memory)\b.*$/gim, '')
    .replace(/^.*\bsav(?:e[ds]?|ing)\b.*\bmemor(?:y|ies|[óo]ria)\b.*$/gim, '')
    .replace(/^.*\bsalv(?:o|a|ei|ando)\b.*\bmem[óo]ria\s+local\b.*$/gim, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^.*(?:\bssh\s+tom\b|\bscp\b|\bpm2\b|cat\s+\.env|grep\s+SUPABASE|setup-vps-key|connection\s+string|service_role|\/mnt\/[a-z]\/|\/opt\/LA-Organizer|\bsudo\s|\bnpm\s+run\b|node\s+--).*$/gim, '');
  return sanitized.trim();
}
const corpus = [
  '✅ Fechado, Fabi! Já dei baixa.\n\n<<TASK_UPDATE>>\n[{"action":"complete","id":"abc"}]\n<<END>>',
  'Now let me update the task list\nTarefa criada! 👽',
  'Para reiniciar rode ssh tom "pm2 restart tom" no servidor.',
  'Olha o código:\n```\nservice_role key aqui\n```\nPronto!',
  'Vou salvar isso na memória local pra lembrar depois.',
  '<invoke name="x"><parameter name="y">z</parameter></invoke>Resposta real.',
  'Bom dia! 👽 Tudo certo por aqui, sem novidades.',
  'Texto\n\n\n\ncom muitas quebras.',
];
const golden = corpus.map(input => ({ input, output: currentSanitize(input) }));
const dest = path.join(__dirname, '..', 'src', 'ai', '__fixtures__', 'sanitize.golden.json');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(golden, null, 2), 'utf8');
console.log('golden gravado:', golden.length, 'casos →', dest);
```

- [ ] **Step 2: Gerar o snapshot**

Run: `node scripts/capture-sanitize-golden.js`
Expected: `golden gravado: 8 casos → .../src/ai/__fixtures__/sanitize.golden.json` (arquivo criado).

- [ ] **Step 3: Write the failing test**

`src/ai/sanitize.test.js`:
```js
const { test } = require('node:test');
const assert = require('node:assert');
const { sanitizeOutput } = require('./sanitize');
const golden = require('./__fixtures__/sanitize.golden.json');

test('remove cerca de código inteira', () => {
  assert.strictEqual(sanitizeOutput('antes\n```\nssh tom x\n```\ndepois'), 'antes\n\ndepois');
});

test('remove linha de comando de infra (ssh tom)', () => {
  assert.strictEqual(sanitizeOutput('a\nrode ssh tom "pm2 restart"\nb'), 'a\n\nb');
});

test('remove narração em inglês', () => {
  assert.strictEqual(sanitizeOutput('Now let me update the task\nTarefa criada!'), 'Tarefa criada!');
});

test('preserva texto legítimo do TOM E markers', () => {
  const ok = '✅ Fechado, Fabi! 👽\n\n<<TASK_UPDATE>>\n[{"action":"complete","id":"abc"}]\n<<END>>';
  assert.strictEqual(sanitizeOutput(ok), ok);
});

test('aplica trim no fim', () => {
  assert.strictEqual(sanitizeOutput('  oi  \n\n'), 'oi');
});

test('golden-master: reproduz a cadeia atual do claude.js', () => {
  for (const { input, output } of golden) {
    assert.strictEqual(sanitizeOutput(input), output);
  }
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test src/ai/sanitize.test.js`
Expected: FAIL — `Cannot find module './sanitize'`.

- [ ] **Step 5: Write the implementation**

`src/ai/sanitize.js` — cadeia **idêntica** à de `claude.js:276-321`, com o `.trim()` final embutido:
```js
// Sanitiza o output do LLM antes de chegar no engine/usuário. Provider-agnóstico
// (Claude e Codex). Higiene de saída: remove tool-tags embutidas, narração em
// inglês, cercas de código, paths/comandos de infra e promessas falsas de "salvar
// na memória". Extraído verbatim de claude.js (Sprint 10-12, casos Rose 10-12/06).
// Inclui o .trim() final → retorna a string 100% limpa (idêntico ao `text` de hoje).
function sanitizeOutput(raw) {
  const rawResult = typeof raw === 'string' ? raw : '';
  const sanitized = rawResult
    .replace(/<tool_(call|use|name|result)[\s\S]*?<\/tool_\1>/gi, '')
    .replace(/<\/?tool_(call|use|name|result)\b[^>]*>/gi, '')
    .replace(/<function_call[\s\S]*?<\/function_call>/gi, '')
    .replace(/<\/?function_call\b[^>]*>/gi, '')
    .replace(/<parameters?[\s\S]*?<\/parameters?>/gi, '')
    .replace(/<\/?parameters?\b[^>]*>/gi, '')
    .replace(/<details[\s\S]*?<\/details>/gi, '')
    .replace(/<\/?details\b[^>]*>/gi, '')
    .replace(/<summary[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/?summary\b[^>]*>/gi, '')
    .replace(/<(?:antml:)?invoke\b[\s\S]*?<\/(?:antml:)?invoke>/gi, '')
    .replace(/<\/?(?:antml:)?(?:function_calls|invoke|parameter)\b[^>]*>/gi, '')
    .replace(/^.*\b(?:feedback\s+memory|memory\s+hint|saving\s+feedback)\b.*$/gim, '')
    .replace(/^.*\b(Based on|Now let me|Let me (?:update|read|write|check|create|save|run|verify|now)|I.ll (?:update|read|write|check|create|save|run|now)|I need to (?:update|read|write|check|create|save|run))\b.*$/gim, '')
    .replace(/^.*\b(MEMORY\.md|memory\/[\w-]+\.md|\/root\/\.claude|\.claude\/projects|\/opt\/LA-Organizer\/(?!docs\b))\b.*$/gim, '')
    .replace(/^.*\b(?:vou\s+salvar\s+isso\s+na\s+mem[óo]ria|salvando\s+na\s+mem[óo]ria|saving\s+to\s+memory)\b.*$/gim, '')
    .replace(/^.*\bsav(?:e[ds]?|ing)\b.*\bmemor(?:y|ies|[óo]ria)\b.*$/gim, '')
    .replace(/^.*\bsalv(?:o|a|ei|ando)\b.*\bmem[óo]ria\s+local\b.*$/gim, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^.*(?:\bssh\s+tom\b|\bscp\b|\bpm2\b|cat\s+\.env|grep\s+SUPABASE|setup-vps-key|connection\s+string|service_role|\/mnt\/[a-z]\/|\/opt\/LA-Organizer|\bsudo\s|\bnpm\s+run\b|node\s+--).*$/gim, '')
    .replace(/\n{3,}/g, '\n\n');
  return sanitized.trim();
}

module.exports = { sanitizeOutput };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test src/ai/sanitize.test.js`
Expected: PASS (6 testes, incluindo o golden-master de 8 casos).

- [ ] **Step 7: Gate** — `node --check src/ai/sanitize.js` limpo.

---

### Task 3: Refatorar `claude.js` pra consumir os helpers (primário inalterado)

**Files:**
- Modify: `src/ai/claude.js` (topo: requires; `:164-173` userPrompt; `:276-321` sanitização)

**Interfaces:**
- Consumes: `buildUserPrompt` (Task 1), `sanitizeOutput` (Task 2)

- [ ] **Step 1: Adicionar os requires no topo do arquivo**

Após `const { classifyClaudeExit } = require('./classify-claude-exit');` (linha 19), adicionar:
```js
const { buildUserPrompt } = require('./prompt');
const { sanitizeOutput } = require('./sanitize');
```

- [ ] **Step 2: Substituir a montagem inline do userPrompt (linhas 164-173)**

Trocar o bloco:
```js
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';

  // Histórico recente como contexto na mensagem do usuário (para Claude ver o turno anterior).
  const history = messages
    .slice(0, -1)
    .map(m => (m.role === 'user' ? 'Usuário: ' : 'TOM: ') + m.content)
    .join('\n');
  const userPrompt = history
    ? `Conversa recente:\n${history}\n\nMensagem atual do usuário:\n${lastUser}`
    : lastUser;
```
por:
```js
  const userPrompt = buildUserPrompt(messages);
```

- [ ] **Step 3: Substituir a cadeia de sanitização inline (linhas 276-321)**

Trocar todo o bloco `const sanitized = rawResult.replace(...)...;` seguido de `const text = sanitized.trim();` por:
```js
      const text = sanitizeOutput(rawResult);
```
(As linhas `const sanitizedDelta = rawResult.length - text.length;`, o `if (sanitizedDelta > 0) { console.warn(...) }` e o `if (!text) {...}` permanecem **intactos** — `sanitized_chars` segue idêntico porque `text` continua pós-trim.)

- [ ] **Step 4: Verificar o golden-master ainda passa**

Run: `node --test src/ai/sanitize.test.js`
Expected: PASS — confirma que `sanitizeOutput` (agora a única fonte) reproduz a cadeia que estava no `claude.js`.

- [ ] **Step 5: Gate** — `node --check src/ai/claude.js` limpo; conferir visualmente que `meta.sanitized_chars` e o `console.warn` continuam no arquivo.

---

### Task 4: Paridade no `openai.js` (histórico + sanitize + cwd)

**Files:**
- Modify: `src/ai/openai.js` (topo: requires; `:8-9` prompt; `:27-33` spawn; `:50-52` output)

**Interfaces:**
- Consumes: `buildUserPrompt` (Task 1), `sanitizeOutput` (Task 2)

- [ ] **Step 1: Adicionar requires no topo**

Após `const { spawn } = require('child_process');` (linha 1), adicionar:
```js
const os = require('os');
const { buildUserPrompt } = require('./prompt');
const { sanitizeOutput } = require('./sanitize');
```

- [ ] **Step 2: Dar histórico ao prompt (linhas 8-9)**

Trocar:
```js
  const lastUser = messages.filter(m => m.role === 'user').pop()?.content || '';
  const prompt = 'System: ' + systemPrompt + '\n\nUser: ' + lastUser;
```
por:
```js
  const userPrompt = buildUserPrompt(messages);
  const prompt = 'System: ' + systemPrompt + '\n\nUser: ' + userPrompt;
```

- [ ] **Step 3: Fechar o cwd no spawn (linha ~33)**

Trocar:
```js
    ], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
```
por:
```js
    ], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], cwd: os.tmpdir() });
```

- [ ] **Step 4: Sanitizar o output (linhas ~50-52)**

Trocar:
```js
      const text = out.trim();
      if (!text) return reject_('empty', 'Codex retornou vazio.');
      resolve({ text, provider: 'openai' });
```
por (passa `out` cru — `sanitizeOutput` já faz o trim — pra o `sanitized_chars` ficar análogo ao do Claude):
```js
      const text = sanitizeOutput(out);
      const sanitizedDelta = out.length - text.length;
      if (sanitizedDelta > 0) console.warn(`[Codex] sanitizer stripped ${sanitizedDelta} chars`);
      if (!text) return reject_('empty', 'Codex retornou vazio.');
      resolve({ text, provider: 'openai' });
```

- [ ] **Step 5: Gate** — `node --check src/ai/openai.js` limpo.

---

### Task 5: Versionar o harness de comparação

**Files:**
- Create: `scripts/compare-models-batch.js`
- Create: `scripts/compare-models-casos.json`

**Interfaces:**
- Consumes: `claude.chat`, `openai.chat` (testa o `openai.js` REAL pós-paridade), `buildSystemPrompt`, `formatMessages`

- [ ] **Step 1: Criar o harness**

`scripts/compare-models-batch.js` — Claude isolado num HOME próprio (não toca o CANON); Codex via `openai.chat()` real (exercita o `openai.js` novo, com cwd/sanitize/histórico):
```js
// Comparativo Sonnet 4.6 vs GPT-5.5 com paridade. Roda SÓ na VPS:
//   node --env-file=.env scripts/compare-models-batch.js scripts/compare-models-casos.json
// Claude usa HOME isolado (cópia do CANON) → zero risco de corromper o .claude.json do engine.
process.env.TOM_CLAUDE_HOME = '/tmp/tomcmp/.claude-tom';
process.env.CLAUDE_HOME = '/tmp/tomcmp/.claude-tom/.claude';
process.env.TOM_CLAUDE_PARALLEL = '0';
const fs = require('fs');
const BASE = process.cwd();
const isoHome = '/tmp/tomcmp/.claude-tom/.claude';
fs.mkdirSync(isoHome, { recursive: true });
fs.copyFileSync(BASE + '/.claude-tom/.claude/.credentials.json', isoHome + '/.credentials.json');
try { fs.chmodSync(isoHome + '/.credentials.json', 0o600); } catch (_) {}
const supabase = require(BASE + '/src/supabase/client');
const { buildSystemPrompt, formatMessages } = require(BASE + '/src/prompts/system');
const claude = require(BASE + '/src/ai/claude');
const openai = require(BASE + '/src/ai/openai');

const casos = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
(async () => {
  for (const caso of casos) {
    const { data: collab } = await supabase.from('collaborators').select('*').eq('id', caso.cid).single();
    if (!collab) { console.log('\n██ ' + caso.label + ' — collab não achado'); continue; }
    const { systemPrompt, ctx } = await buildSystemPrompt(collab, { lastUserMessage: caso.text });
    const msgs = formatMessages(ctx.recentMessages, caso.text);
    let sonnet, gpt;
    const t0 = Date.now();
    try { sonnet = { ...(await claude.chat(systemPrompt, msgs)), ms: Date.now() - t0 }; }
    catch (e) { sonnet = { text: '(erro Claude) ' + e.message, ms: Date.now() - t0 }; }
    const t1 = Date.now();
    try { gpt = { ...(await openai.chat(systemPrompt, msgs)), ms: Date.now() - t1 }; }
    catch (e) { gpt = { text: '(erro Codex) ' + e.message, ms: Date.now() - t1 }; }
    const L = '\n' + '─'.repeat(72) + '\n';
    console.log('\n\n██████ ' + caso.label + ' (' + collab.full_name + ') ██████');
    console.log('MSG: ' + JSON.stringify(caso.text) + ' | hist=' + (ctx.recentMessages || []).length);
    console.log(L + 'SONNET 4.6 (' + sonnet.ms + 'ms)' + L + sonnet.text);
    console.log(L + 'GPT-5.5 c/ paridade (' + gpt.ms + 'ms)' + L + gpt.text);
  }
  try { require('child_process').execSync('rm -rf /tmp/tomcmp'); } catch (_) {}
  process.exit(0);
})();
```

- [ ] **Step 2: Criar os casos** (os mesmos 10 do comparativo 20/06 — multi-turno + markers + verbatim + ambíguo)

`scripts/compare-models-casos.json`:
```json
[
{"label":"C1 desabafo","cid":"0576f4b6-183d-4cf1-980e-5c8d5da0177f","text":"to meio perdido com tanta coisa pra fazer hoje, nem sei por onde começar"},
{"label":"C2 concluir tarefas","cid":"9df91fd3-c949-4ca0-a872-bfb321e7778d","text":"essas ok, pode dar concluido"},
{"label":"C5 recado verbatim","cid":"bfd77b2c-3303-47fe-abe1-e73a2d8da0e1","text":"Tom, mande uma mensagem ao Alf dizendo: Rafinha fez um contato cntg na segunda sobre o pedido das cordas solez, conseguiu fazer o pedido??"},
{"label":"C6 tarefa vs lembrete","cid":"5d74b86b-da6a-4aa1-8783-4b80a2a6d102","text":"tom, tem como vc não atribuir todos os \" Dar presença dos alunos\" como uma tarefa e sim como um lembrete?"},
{"label":"C7 lista compras","cid":"f238cfb7-54ab-43a7-93ab-3f29c636fb8c","text":"Montar lista de compras nas minhas anotações pessoais\n\n5kg de arroz\n2 kg de feijão\nBiscoitos para Alice levar para a escola"},
{"label":"C8 consulta produto","cid":"5bb97642-bbc1-44c5-a3dc-bdab74347011","text":"para que serve esse grupo de trabalho?"},
{"label":"C9 inventario sem itens","cid":"82c6233c-f1e2-491f-8fc6-027bc7b20ca1","text":"preciso que adicione itens ao inventario da sala KIDS CLUB da Barra"},
{"label":"C10 multi-turno Feito","cid":"4d52c86f-6211-47d1-87fe-e97a9679ac67","text":"[O usuário está RESPONDENDO a esta mensagem anterior: \"🔴 *Responder lead do Instagram (Hugo)* atrasou 1 dia. Resolve hoje ou reagenda?\"]\nFeito"}
]
```

- [ ] **Step 3: Gate** — `node --check scripts/compare-models-batch.js` limpo; JSON válido (`node -e "require('./scripts/compare-models-casos.json')"`).

---

### Task 6: E2E na VPS — validar paridade e medir duplicação

**Files:** (nenhum novo — validação)

- [ ] **Step 1: Subir os arquivos pra VPS**

Run:
```bash
for f in src/ai/prompt.js src/ai/sanitize.js src/ai/claude.js src/ai/openai.js scripts/compare-models-batch.js scripts/compare-models-casos.json; do scp "/d/la-organizer/_remote/$f" "tom:/opt/LA-Organizer/$f"; done
```
Expected: 6 arquivos transferidos sem erro.

- [ ] **Step 2: Rodar os testes unitários na VPS** (sanidade no runtime real)

Run: `ssh tom 'cd /opt/LA-Organizer && node --test src/ai/prompt.test.js src/ai/sanitize.test.js'`
Expected: PASS (todos).

- [ ] **Step 3: Rodar o E2E comparativo**

Run: `ssh tom 'cd /opt/LA-Organizer && node --env-file=.env scripts/compare-models-batch.js scripts/compare-models-casos.json'`
Expected: 8 casos, cada um com resposta do Sonnet e do GPT-5.5.

- [ ] **Step 4: Avaliar (checklist explícito, documentar achados)**

Confirmar nas saídas:
1. **Histórico:** no C10 ("Feito"), o Codex referencia a tarefa correta do histórico (não responde no vácuo) — prova que `buildUserPrompt` chegou nele.
2. **Sanitizer não corta legítimo:** nenhuma resposta de negócio (com 👽, markers `<<...>>`) aparece truncada.
3. **cwd limpo:** nenhuma resposta do Codex contém `/opt/LA-Organizer`, `ssh tom`, etc.
4. **Duplicação (medir ativamente):** comparar com os achados de 20/06 — o Codex re-executa ação já feita (C2/C7)? Registrar SIM/NÃO por caso. Se SIM recorrente → abrir nota pra trava anti-dup (fase 2). Se NÃO → registrar que o histórico resolveu.

- [ ] **Step 5: Registrar o resultado** no spec (seção "Resultado E2E") e atualizar a memória `project_motor_tom_sonnet_vs_gpt55` com o veredito de duplicação.

---

## Adoção em produção (após E2E verde)

⚠️ **O auto-deploy hook reinicia o engine no fim do turno se `src/` mudou.** Logo, a Task 6 (E2E) **deve passar no mesmo turno** em que `claude.js`/`openai.js` forem tocados — senão o restart adota código não-validado. Se a execução for multi-turno, isolar as mudanças de `src/ai/` no turno em que o E2E roda.

Os arquivos já estão na VPS (Step 1). Para o engine real passar a usar o fallback com paridade: `ssh tom "pm2 restart tom"`. O auto-deploy hook commita o bundle (`prompt.js`, `sanitize.js`, `claude.js`, `openai.js`, `scripts/`, specs, plano) no fim do turno. Rollback, se preciso: `git revert` do bundle + restart (o fallback volta ao comportamento atual).
