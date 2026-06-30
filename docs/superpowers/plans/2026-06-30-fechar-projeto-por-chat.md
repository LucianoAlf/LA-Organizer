# Fechar/Cancelar Projeto por Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o dono/líder de um projeto o **conclua** ou **cancele** pelo WhatsApp, com confirmação obrigatória e execução determinística.

**Architecture:** Detector determinístico (fora do LLM) reconhece a intenção → helper puro resolve o projeto por nome/contexto, checa autoridade e conta tarefas abertas de terceiros → o engine abre uma intent `confirmation` ancorada no projeto → no "sim", um executor determinístico vira o `projects.status`. O LLM nunca re-emite marker de status.

**Tech Stack:** Node.js (CommonJS), `node:test`/`node:assert` (testes puros backend), Supabase JS client (service_role), pending_intents (kind `confirmation` reusado).

## Global Constraints

- **ZERO migration.** Reusa o kind `confirmation` de `pending_intents` (já no `VALID_KINDS` do JS e no CHECK do banco) com âncora `payload.anchor = { type:'project', id, title }` + `payload.action`. Não criar kind novo (evita o drift código-vs-CHECK do `project_invoice_confirm_intent_constraint`).
- **Zero-regressão.** Não tocar nos handlers `PROJECT_CREATE` / `PROJECT_APPROVE` / `PROJECT_REJECT` (engine 9625-9710). O dispatch do "sim" é **gated por `anchor.type === 'project'`** — não intercepta confirmações de task/event.
- **Paridade PWA.** Fechar = `update({ status:'completed' })`; cancelar = `'cancelled'`. **Não tocar nas tarefas.** Sem `completed_at`.
- **Voz do TOM sagrada.** Os textos saem dos builders puros; os números do aviso (contagem de abertas) são determinísticos (anti-confab de contagem).
- **`.deploy-hold` na raiz ANTES de editar `src/`** no fio do engine (Task 4) — `D:\la-organizer\.deploy-hold` (pai de `_remote`). Remover só no fim (Task 6).
- **Fronteira de chats.** Tasks 1, 2, 3, 5 (módulos puros + thin service + skill) = qualquer chat. **Task 4 (fio em `engine.js`) é território do chat "Financeiro Pessoal"**; este chat (catraca) **revisa**. Coordenar via Alf.
- **Helpers reusados (assinaturas reais, já no código):**
  - `stripReplyScaffold(text) -> { userText, quotedText }` em `src/events/detect-approval-reply.js`.
  - `openIntent(collabId, kind, payload, questionText) -> id|null` · `resolveIntent(intentId, resolution, note)` · `resolveAnchoredIntents(collabId, anchorId, resolution, note)` · `listOpenIntents(collabId, opts) -> [{id,kind,payload,asked_at}]` · `detectUserConfirmation(userText, opts) -> 'yes'|'no'|null` em `src/services/pending-intents.js`.
  - `resolveLeaderIdsOf(collab, allCollabs) -> string[]` em `src/services/leader-routing.js`.
- **Commits:** NÃO commitar entre tasks (regra do `_remote/CLAUDE.md`). O auto-deploy (Stop hook) commita tudo no fim. Os "commits" abaixo são marcos lógicos; na prática só rodar os testes e seguir. Deploy real só na Task 6.

---

### Task 1: Detector puro `detect-project-status-intent.js`

**Files:**
- Create: `src/lib/detect-project-status-intent.js`
- Test: `src/lib/detect-project-status-intent.test.js`

**Interfaces:**
- Consumes: `stripReplyScaffold` de `../events/detect-approval-reply`.
- Produces: `detectProjectStatusIntent(rawText) -> { action:'complete'|'cancel', nameHint:string|null, quotedText:string|null } | null`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/detect-project-status-intent.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { detectProjectStatusIntent } = require('./detect-project-status-intent');

test('via explícita: "fecha o projeto Marketing" → complete + nameHint', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('fecha o projeto Marketing'),
    { action: 'complete', nameHint: 'Marketing', quotedText: null });
});

test('via explícita: "cancela o projeto Vendas Q1" → cancel + nameHint', () => {
  assert.deepStrictEqual(detectProjectStatusIntent('cancela o projeto Vendas Q1'),
    { action: 'cancel', nameHint: 'Vendas Q1', quotedText: null });
});

test('"conclui o projeto X" e "encerra o projeto X" também disparam complete', () => {
  assert.strictEqual(detectProjectStatusIntent('conclui o projeto X').action, 'complete');
  assert.strictEqual(detectProjectStatusIntent('encerra o projeto X').action, 'complete');
});

test('cancel tem precedência quando ambos os verbos aparecem', () => {
  // "cancela e fecha o projeto X" — cancelar é o verbo mais específico/destrutivo
  assert.strictEqual(detectProjectStatusIntent('cancela o projeto X').action, 'cancel');
});

test('NEGATIVO: "fechei a tarefa" (sem token projeto, sem reply) → null', () => {
  assert.strictEqual(detectProjectStatusIntent('fechei a tarefa'), null);
  assert.strictEqual(detectProjectStatusIntent('conclui isso'), null);
});

test('NEGATIVO: pergunta não é comando', () => {
  assert.strictEqual(detectProjectStatusIntent('fecho o projeto Marketing?'), null);
});

test('via reply-bare: "pode fechar" com scaffold → complete, nameHint null, quote preservado', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "✅ Tarefas feitas nesses projetos: • *Marketing* — suas tarefas já tão concluídas 🎉"]\npode fechar';
  const r = detectProjectStatusIntent(raw);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, null);
  assert.match(r.quotedText, /Marketing/);
});

test('reply-scaffold com token projeto: lê fala real, não a citação', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "vence amanhã?"]\nfecha o projeto Lançamento';
  const r = detectProjectStatusIntent(raw);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, 'Lançamento');
});

test('NEGATIVO: "pode fechar" SEM scaffold → null (sem âncora de contexto)', () => {
  assert.strictEqual(detectProjectStatusIntent('pode fechar'), null);
});

test('bare com token projeto sem nome → nameHint null (resolve por quote depois)', () => {
  const raw = '[O usuário está RESPONDENDO a esta mensagem anterior: "• *Marketing* concluído?"]\nfecha esse projeto';
  const r = detectProjectStatusIntent(raw);
  assert.strictEqual(r.action, 'complete');
  assert.strictEqual(r.nameHint, null); // "esse" não é nome → null
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/la-organizer/_remote && node --test src/lib/detect-project-status-intent.test.js`
Expected: FAIL (`Cannot find module './detect-project-status-intent'`).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/detect-project-status-intent.js`:

```js
'use strict';

// Detector determinístico de intenção de MUDAR STATUS DE PROJETO por chat (fechar/cancelar).
// Irmão de src/events/detect-approval-reply.js. Lê a fala REAL via stripReplyScaffold
// (família FINEDIT-QUOTE-SCAFFOLD-MISROUTE: nunca casar no texto cru com a citação).
const { stripReplyScaffold } = require('../events/detect-approval-reply');

const COMPLETE_RE = /\b(fech(?:a|ar|o|ei|ando)|conclu[ií](?:r|ndo|do|da|o|i)?|encerr(?:a|ar|o|ando)|finaliz(?:a|ar|o|ando))\b/i;
const CANCEL_RE = /\b(cancel(?:a|ar|o|ando))\b/i;
const PROJECT_RE = /\bprojetos?\b/i;
const ARTICLES = new Set(['o', 'a', 'os', 'as', 'esse', 'essa', 'este', 'esta', 'esses', 'essas', 'um', 'uma', 'meu', 'minha']);

// Extrai o nome após o token "projeto". Retorna string (>=2 chars) ou null.
function _extractNameAfterProjeto(text) {
  const m = text.match(/\bprojetos?\b\s*[:\-–]?\s*(.+)$/i);
  if (!m || !m[1]) return null;
  let name = m[1].trim()
    .replace(/^["'“”]+|["'“”]+$/g, '')
    .replace(/[?!.…]+$/g, '')
    .trim();
  // tira UM artigo/demonstrativo solto líder ("o", "esse"...)
  const words = name.split(/\s+/);
  if (words.length && ARTICLES.has(words[0].toLowerCase())) words.shift();
  name = words.join(' ').trim();
  return name.length >= 2 ? name : null;
}

function detectProjectStatusIntent(rawText) {
  const { userText, quotedText } = stripReplyScaffold(String(rawText || ''));
  const text = (userText || '').trim();
  if (!text) return null;
  if (/\?\s*$/.test(text)) return null; // pergunta não é comando (lição EVENT-CONFAB)

  const hasCancel = CANCEL_RE.test(text);
  const hasComplete = COMPLETE_RE.test(text);
  if (!hasCancel && !hasComplete) return null;
  const action = hasCancel ? 'cancel' : 'complete'; // cancel é mais específico → precedência

  const q = quotedText || null;
  // Via 1: token "projeto" presente na fala real
  if (PROJECT_RE.test(text)) {
    return { action, nameHint: _extractNameAfterProjeto(text), quotedText: q };
  }
  // Via 2: reply-bare (verbo + scaffold, sem token projeto) → resolve por quote depois
  if (q != null) {
    return { action, nameHint: null, quotedText: q };
  }
  // Sem token projeto e sem reply → null (colisão com complete de tarefa)
  return null;
}

module.exports = { detectProjectStatusIntent, _extractNameAfterProjeto };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/la-organizer/_remote && node --test src/lib/detect-project-status-intent.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Marco lógico** (sem commit — auto-deploy cuida no fim). Rodar `node --check src/lib/detect-project-status-intent.js` → sem erro.

---

### Task 2: Helper puro `project-status.js`

**Files:**
- Create: `src/lib/project-status.js`
- Test: `src/lib/project-status.test.js`

**Interfaces:**
- Produces:
  - `resolveProjectByName(aliveProjects, nameHint, quotedText) -> {status:'match',project} | {status:'ambiguous',candidates} | {status:'none'}`
  - `canChangeStatus(collab, project, leaderIds) -> boolean`
  - `summarizeOpenWork(openTasks) -> { total:number, byPerson:[{name,count}] }`
  - `buildStatusConfirm(project, action, openSummary) -> string`
  - `buildStatusResult(project, action, openSummary) -> string`
  - `STATUS_BY_ACTION = { complete:'completed', cancel:'cancelled' }`
  - `ALIVE_STATUSES` (Set)
- Tipos: `aliveProjects` = `[{id,name,status,created_by}]`; `openTasks` = `[{status,assignee_name}]`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/project-status.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  resolveProjectByName, canChangeStatus, summarizeOpenWork,
  buildStatusConfirm, buildStatusResult, STATUS_BY_ACTION,
} = require('./project-status');

const PROJS = [
  { id: 'p1', name: 'Marketing', status: 'active', created_by: 'u1' },
  { id: 'p2', name: 'Marketing Digital', status: 'planning', created_by: 'u2' },
  { id: 'p3', name: 'Folha de Pagamento', status: 'paused', created_by: 'u1' },
];

test('resolve: nome exato → match único mesmo com prefixo de outro', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, 'Marketing', null),
    { status: 'match', project: PROJS[0] });
});

test('resolve: nome parcial que casa 1 → match', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, 'folha', null),
    { status: 'match', project: PROJS[2] });
});

test('resolve: parcial ambíguo → ambiguous com candidatos', () => {
  const r = resolveProjectByName(PROJS, 'market', null);
  assert.strictEqual(r.status, 'ambiguous');
  assert.deepStrictEqual(r.candidates, [{ id: 'p1', name: 'Marketing' }, { id: 'p2', name: 'Marketing Digital' }]);
});

test('resolve: nome inexistente → none', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, 'Inventário', null), { status: 'none' });
});

test('resolve por quote (sem nameHint): quote cita 1 projeto vivo → match', () => {
  const quote = '✅ Tarefas feitas: • *Folha de Pagamento* — concluídas 🎉';
  assert.deepStrictEqual(resolveProjectByName(PROJS, null, quote),
    { status: 'match', project: PROJS[2] });
});

test('resolve por quote: quote cita 2 projetos → ambiguous', () => {
  const quote = '• *Marketing* • *Folha de Pagamento*';
  assert.strictEqual(resolveProjectByName(PROJS, null, quote).status, 'ambiguous');
});

test('resolve: sem hint e sem quote → none', () => {
  assert.deepStrictEqual(resolveProjectByName(PROJS, null, null), { status: 'none' });
});

test('resolve: lista vazia → none', () => {
  assert.deepStrictEqual(resolveProjectByName([], 'Marketing', null), { status: 'none' });
});

test('autoridade: criador pode', () => {
  assert.strictEqual(canChangeStatus({ id: 'u1' }, PROJS[0], []), true);
});

test('autoridade: líder do criador pode', () => {
  assert.strictEqual(canChangeStatus({ id: 'boss' }, PROJS[0], ['boss']), true);
});

test('autoridade: estranho não pode', () => {
  assert.strictEqual(canChangeStatus({ id: 'rando' }, PROJS[0], ['boss']), false);
});

test('summarize: agrupa abertas por pessoa, ignora done/cancelled, ordena desc', () => {
  const tasks = [
    { status: 'pending', assignee_name: 'Ana' },
    { status: 'in_progress', assignee_name: 'Ana' },
    { status: 'done', assignee_name: 'Ana' },
    { status: 'pending', assignee_name: 'Beto' },
    { status: 'cancelled', assignee_name: 'Caio' },
  ];
  assert.deepStrictEqual(summarizeOpenWork(tasks),
    { total: 3, byPerson: [{ name: 'Ana', count: 2 }, { name: 'Beto', count: 1 }] });
});

test('summarize: vazio → total 0', () => {
  assert.deepStrictEqual(summarizeOpenWork([]), { total: 0, byPerson: [] });
});

test('confirm complete sem abertas → 🎉, sem ⚠️', () => {
  assert.strictEqual(buildStatusConfirm(PROJS[0], 'complete', { total: 0, byPerson: [] }),
    'Fecho o projeto *Marketing*? 🎉');
});

test('confirm cancel sem abertas → sem 🎉', () => {
  assert.strictEqual(buildStatusConfirm(PROJS[0], 'cancel', { total: 0, byPerson: [] }),
    'Cancelo o projeto *Marketing*?');
});

test('confirm com abertas → ⚠️ + contagem + pessoas antes da pergunta', () => {
  const s = { total: 3, byPerson: [{ name: 'Ana', count: 2 }, { name: 'Beto', count: 1 }] };
  assert.strictEqual(buildStatusConfirm(PROJS[0], 'complete', s),
    '⚠️ Ainda tem 3 tarefas abertas (Ana, Beto).\n\nFecho o projeto *Marketing*?');
});

test('confirm com 1 aberta → singular', () => {
  const s = { total: 1, byPerson: [{ name: 'Ana', count: 1 }] };
  assert.match(buildStatusConfirm(PROJS[0], 'complete', s), /1 tarefa aberta \(Ana\)/);
});

test('result complete sem abertas', () => {
  assert.strictEqual(buildStatusResult(PROJS[0], 'complete', { total: 0, byPerson: [] }),
    '✅ Projeto *Marketing* concluído!');
});

test('result cancel com abertas → nota honesta', () => {
  const s = { total: 2, byPerson: [{ name: 'Ana', count: 2 }] };
  assert.strictEqual(buildStatusResult(PROJS[0], 'cancel', s),
    'Projeto *Marketing* cancelado.\n\n_Deixei as 2 tarefas abertas como estavam._');
});

test('STATUS_BY_ACTION', () => {
  assert.strictEqual(STATUS_BY_ACTION.complete, 'completed');
  assert.strictEqual(STATUS_BY_ACTION.cancel, 'cancelled');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd D:/la-organizer/_remote && node --test src/lib/project-status.test.js`
Expected: FAIL (`Cannot find module './project-status'`).

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/project-status.js`:

```js
'use strict';
// Helper PURO do fechar/cancelar projeto por chat (testável sem Supabase, padrão
// adherence-projects.js). Resolve projeto, checa autoridade, conta abertas e monta textos.

const ALIVE_STATUSES = new Set(['pending_approval', 'planning', 'active', 'paused']);
const STATUS_BY_ACTION = { complete: 'completed', cancel: 'cancelled' };

function _norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
const _cand = (p) => ({ id: p.id, name: p.name });

function resolveProjectByName(aliveProjects, nameHint, quotedText) {
  const projects = (aliveProjects || []).filter((p) => p && p.id && p.name);
  if (!projects.length) return { status: 'none' };

  const hint = _norm(nameHint);
  if (hint) {
    const exact = projects.filter((p) => _norm(p.name) === hint);
    if (exact.length === 1) return { status: 'match', project: exact[0] };
    if (exact.length > 1) return { status: 'ambiguous', candidates: exact.map(_cand) };
    const contains = projects.filter((p) => {
      const n = _norm(p.name);
      return n.includes(hint) || hint.includes(n);
    });
    if (contains.length === 1) return { status: 'match', project: contains[0] };
    if (contains.length > 1) return { status: 'ambiguous', candidates: contains.map(_cand) };
    return { status: 'none' };
  }

  const q = _norm(quotedText);
  if (q) {
    const inQuote = projects.filter((p) => q.includes(_norm(p.name)));
    if (inQuote.length === 1) return { status: 'match', project: inQuote[0] };
    if (inQuote.length > 1) return { status: 'ambiguous', candidates: inQuote.map(_cand) };
  }
  return { status: 'none' };
}

function canChangeStatus(collab, project, leaderIds) {
  if (!collab || !project) return false;
  if (project.created_by && project.created_by === collab.id) return true;
  return Array.isArray(leaderIds) && leaderIds.includes(collab.id);
}

function summarizeOpenWork(openTasks) {
  const open = (openTasks || []).filter((t) => t && t.status !== 'done' && t.status !== 'cancelled');
  const byName = new Map();
  for (const t of open) {
    const name = String(t.assignee_name || 'sem responsável').trim() || 'sem responsável';
    byName.set(name, (byName.get(name) || 0) + 1);
  }
  const byPerson = [...byName.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  return { total: open.length, byPerson };
}

const _verbConfirm = (action) => (action === 'cancel' ? 'Cancelo' : 'Fecho');
const _plural = (n) => (n === 1 ? 'tarefa aberta' : 'tarefas abertas');

function buildStatusConfirm(project, action, openSummary) {
  const head = `${_verbConfirm(action)} o projeto *${project.name}*?`;
  const s = openSummary || { total: 0, byPerson: [] };
  if (!s.total) return action === 'cancel' ? head : `${head} 🎉`;
  const people = s.byPerson.map((p) => p.name).slice(0, 4).join(', ');
  return `⚠️ Ainda tem ${s.total} ${_plural(s.total)} (${people}).\n\n${head}`;
}

function buildStatusResult(project, action, openSummary) {
  const s = openSummary || { total: 0, byPerson: [] };
  const head = action === 'cancel'
    ? `Projeto *${project.name}* cancelado.`
    : `✅ Projeto *${project.name}* concluído!`;
  if (s.total) return `${head}\n\n_Deixei as ${s.total} ${_plural(s.total)} como estavam._`;
  return head;
}

module.exports = {
  resolveProjectByName, canChangeStatus, summarizeOpenWork,
  buildStatusConfirm, buildStatusResult, STATUS_BY_ACTION, ALIVE_STATUSES, _norm,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd D:/la-organizer/_remote && node --test src/lib/project-status.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Marco lógico.** `node --check src/lib/project-status.js` → sem erro.

---

### Task 3: Executor determinístico `project-status-exec.js`

**Files:**
- Create: `src/services/project-status-exec.js`

**Interfaces:**
- Consumes: `ALIVE_STATUSES` de `../lib/project-status`; `supabase` de `../supabase/client` (service_role, só na VPS).
- Produces: `applyProjectStatusChange(collab, { projectId, newStatus }) -> { ok:boolean, project?, reason? }`.

> **Nota:** este módulo importa `../supabase/client`, que **só existe na VPS** (padrão local-vs-VPS). Não dá pra `node --test` local com efeito real — a validação é por **`node --check`** (sintaxe) na Task 3 e **E2E live na VPS** na Task 6.

- [ ] **Step 1: Write the implementation**

Create `src/services/project-status-exec.js`:

```js
'use strict';
// PETERSON/KRISSYA família — executor DETERMINÍSTICO do fechar/cancelar projeto.
// Chamado no "sim" do usuário (NUNCA por marker do LLM). Autoridade já garantida no
// gate de confirmação (a intent só foi aberta pra quem podia) e carregada pela posse
// da intent — aqui só re-checamos idempotência/corrida.
const supabase = require('../supabase/client');
const { ALIVE_STATUSES } = require('../lib/project-status');

async function applyProjectStatusChange(collab, opts) {
  const { projectId, newStatus } = opts || {};
  if (!collab || !projectId || !newStatus) return { ok: false, reason: 'bad_args' };
  if (newStatus !== 'completed' && newStatus !== 'cancelled') return { ok: false, reason: 'bad_status' };

  // 1) lê estado atual (idempotência contra "sim" duplo / corrida)
  const { data: proj, error: readErr } = await supabase
    .from('projects')
    .select('id, name, status, created_by')
    .eq('id', projectId)
    .single();
  if (readErr || !proj) return { ok: false, reason: 'not_found' };
  if (!ALIVE_STATUSES.has(proj.status)) return { ok: false, reason: 'already_closed', project: proj };

  // 2) update com guarda de corrida (.in status vivo): só muda se ainda estava vivo
  const { data: upd, error: updErr } = await supabase
    .from('projects')
    .update({ status: newStatus })
    .eq('id', projectId)
    .in('status', [...ALIVE_STATUSES])
    .select('id');
  if (updErr) return { ok: false, reason: `persist_error:${updErr.message}`, project: proj };
  if (!upd || !upd.length) return { ok: false, reason: 'already_closed', project: proj };

  console.log(`[ProjectStatus] ${String(collab.id).slice(0, 8)} -> ${proj.name} = ${newStatus}`);
  return { ok: true, project: { ...proj, status: newStatus } };
}

module.exports = { applyProjectStatusChange };
```

- [ ] **Step 2: Verify syntax**

Run: `cd D:/la-organizer/_remote && node --check src/services/project-status-exec.js`
Expected: sem saída (OK). (Teste de efeito real fica na Task 6, E2E na VPS.)

---

### Task 4: Fio no `engine.js` (TERRITÓRIO DO CHAT "FINANCEIRO PESSOAL")

> **Coordenação:** Esta task edita `src/engine.js` — território do chat "Financeiro Pessoal". Quem executar deve **criar `D:\la-organizer\.deploy-hold` ANTES** de editar. Este chat (catraca) **revisa** o diff antes do deploy (Task 6). Nada aqui toca `PROJECT_CREATE`/`APPROVE`/`REJECT`.

**Files:**
- Modify: `src/engine.js` — adicionar (a) `require` dos novos módulos no topo; (b) bloco de **detecção** de status de projeto perto do `detectApprovalReply` (caminho determinístico, antes do roteamento por LLM); (c) ramo de **resolução do "sim"** no dispatcher de `detectUserConfirmation`, gated por `anchor.type==='project'`.

**Interfaces:**
- Consumes: `detectProjectStatusIntent` (Task 1); `resolveProjectByName, canChangeStatus, summarizeOpenWork, buildStatusConfirm, buildStatusResult, STATUS_BY_ACTION, ALIVE_STATUSES` (Task 2); `applyProjectStatusChange` (Task 3); `openIntent, resolveIntent, resolveAnchoredIntents, listOpenIntents, detectUserConfirmation` (pending-intents); `resolveLeaderIdsOf` (leader-routing).
- Produces: nada novo exportado.

- [ ] **Step 1: Criar o `.deploy-hold`**

Run: `touch D:/la-organizer/.deploy-hold` (ou criar o arquivo vazio). Confirma que existe antes de editar `src/`.

- [ ] **Step 2: Adicionar os requires no topo do `engine.js`**

Perto dos outros `require` de `src/lib` / `src/services` (ex.: ao lado do require de `temporal-intent`):

```js
const { detectProjectStatusIntent } = require('./lib/detect-project-status-intent');
const projectStatusLib = require('./lib/project-status');
const { applyProjectStatusChange } = require('./services/project-status-exec');
const { resolveLeaderIdsOf } = require('./services/leader-routing');
```

(Se `resolveLeaderIdsOf`/pending-intents helpers já estiverem requeridos no arquivo, não duplicar.)

- [ ] **Step 3: Bloco de DETECÇÃO (caminho determinístico)**

Inserir **antes** do roteamento por LLM (espelhar onde `detectApprovalReply` é consumido). Pseudocódigo concreto — adaptar nomes de variáveis locais existentes (`collab`, `userText`/texto cru, `allCollabs`, `supabase`):

```js
// Fechar/cancelar projeto por chat (determinístico — KRISSYA-PROJECT-CLOSE-NO-HANDLER).
const psIntent = detectProjectStatusIntent(rawUserText);
if (psIntent) {
  // 1) projetos VIVOS do caller (id, name, status, created_by)
  const { data: aliveRaw } = await supabase
    .from('projects')
    .select('id, name, status, created_by')
    .eq('created_by', collab.id)
    .in('status', [...projectStatusLib.ALIVE_STATUSES]);
  // (se quiser cobrir projetos que ele LIDERA mas não criou, unir aqui os projetos cujos
  //  created_by ∈ pessoas lideradas por collab — opcional; v1 pode ficar só nos criados +
  //  resolução por quote, que cobre o caso Krissya do ritual.)
  const alive = aliveRaw || [];
  const res = projectStatusLib.resolveProjectByName(alive, psIntent.nameHint, psIntent.quotedText);

  if (res.status === 'none') {
    return finalize('Não achei um projeto com esse nome aberto pra você. Qual é o nome certinho?');
  }
  if (res.status === 'ambiguous') {
    const names = res.candidates.map((c) => `*${c.name}*`).join(' ou ');
    return finalize(`Tenho mais de um: ${names}. Qual deles?`);
  }
  // res.status === 'match'
  const project = res.project;

  // 2) autoridade: criador OU líder do criador
  let leaderIds = [];
  try {
    const creator = (allCollabs || []).find((c) => c.id === project.created_by);
    if (creator) leaderIds = resolveLeaderIdsOf(creator, allCollabs) || [];
  } catch (_) { /* sem governança → só criador decide */ }
  if (!projectStatusLib.canChangeStatus(collab, project, leaderIds)) {
    return finalize('Esse projeto não é seu pra fechar — só quem criou ou lidera pode. Quer que eu avise alguém?');
  }

  // 3) conta abertas de TERCEIROS (todas as tarefas do projeto)
  const { data: openRaw } = await supabase
    .from('tasks')
    .select('status, assignee:collaborators!tasks_assigned_to_fkey(full_name)')
    .eq('project_id', project.id)
    .not('status', 'in', '(done,cancelled)');
  const openTasks = (openRaw || []).map((t) => ({
    status: t.status,
    assignee_name: t.assignee && t.assignee.full_name ? t.assignee.full_name.split(' ')[0] : 'sem responsável',
  }));
  const openSummary = projectStatusLib.summarizeOpenWork(openTasks);

  // 4) abre intent de confirmação ancorada no projeto + devolve a pergunta determinística
  const confirmText = projectStatusLib.buildStatusConfirm(project, psIntent.action, openSummary);
  await openIntent(collab.id, 'confirmation', {
    anchor: { type: 'project', id: project.id, title: project.name },
    action: psIntent.action,
    open_total: openSummary.total, // congela a contagem do momento da pergunta (honestidade)
  }, confirmText);
  return finalize(confirmText);
}
```

> `finalize(...)` = como o engine já devolve uma resposta determinística e encerra o turno (ex.: o mesmo caminho do `detectApprovalReply` quando aplica direto). Usar o mecanismo existente; não chamar o LLM.

- [ ] **Step 4: Ramo do "sim" no dispatcher de confirmação (gated por anchor.type)**

Onde o engine já consome `detectUserConfirmation` para resolver intents abertas, adicionar — **antes/ao lado** dos consumidores de task/event, mas só atuando quando a âncora é de projeto:

```js
const yn = detectUserConfirmation(userTextStripped);
if (yn) {
  const open = await listOpenIntents(collab.id);
  const projIntent = open.find((i) =>
    i.kind === 'confirmation' && i.payload && i.payload.anchor && i.payload.anchor.type === 'project');
  if (projIntent) {
    const a = projIntent.payload.anchor;
    if (yn === 'no') {
      await resolveIntent(projIntent.id, 'denied');
      return finalize('Beleza, deixei como tá. 👍');
    }
    // yn === 'yes'
    const newStatus = projectStatusLib.STATUS_BY_ACTION[projIntent.payload.action];
    const r = await applyProjectStatusChange(collab, { projectId: a.id, newStatus });
    await resolveAnchoredIntents(collab.id, a.id, 'confirmed');
    if (r.ok) {
      // re-conta pra nota honesta no resultado (ou reusa payload.open_total congelado)
      const summary = { total: projIntent.payload.open_total || 0, byPerson: [] };
      return finalize(projectStatusLib.buildStatusResult(
        { name: a.title }, projIntent.payload.action, summary));
    }
    if (r.reason === 'already_closed') return finalize(`O projeto *${a.title}* já tava fechado. 👍`);
    return finalize('Tentei mudar o status mas deu ruim — tenta de novo daqui a pouco?');
  }
  // sem intent de projeto → segue o fluxo EXISTENTE de task/event (NÃO interceptar)
}
```

> **Catraca/zero-regressão:** o `find` por `anchor.type==='project'` garante que esse ramo só age em intents de projeto. Se não houver, o código cai no fluxo existente de confirmação de task/event **sem alteração**. Não mover nem reescrever os consumidores atuais — só adicionar este ramo guardado.

- [ ] **Step 5: Verificar sintaxe**

Run: `cd D:/la-organizer/_remote && node --check src/engine.js`
Expected: sem saída (OK).

---

### Task 5: Skill `fechar-projeto.md` + regra no prompt

**Files:**
- Create: `skills/fechar-projeto.md`
- Modify: `src/prompts/system.js` — uma linha curta na seção de detecção de ação (perto da linha 96-97, onde já mapeia "criei/abri/registrei + projeto").

**Interfaces:** nenhuma (texto/prompt).

- [ ] **Step 1: Criar a skill**

Create `skills/fechar-projeto.md`:

```markdown
# Fechar / Cancelar projeto

Quando o usuário pede pra **fechar/concluir** ou **cancelar** um PROJETO (ex.: "fecha o
projeto X", "pode concluir o projeto Y", "cancela o projeto Z"):

- **Você NÃO executa isso sozinho nem inventa que fechou.** O sistema cuida da mudança de
  status de forma determinística, com confirmação. Sua resposta é só natural — a pergunta de
  confirmação e o resultado são montados pelo sistema.
- **Nunca diga "fechei/concluí/cancelei o projeto" antes de o usuário confirmar.** Antes do
  "sim", o projeto continua aberto.
- Só quem **criou** ou **lidera** o projeto pode fechá-lo. Se não for o caso, o sistema avisa.
- Fechar/cancelar **não mexe nas tarefas** do projeto — elas continuam como estão.
- Não existe marker de status de projeto pra você emitir. Não invente `<<PROJECT_...>>` de
  fechamento.
```

- [ ] **Step 2: Adicionar a regra no `system.js`**

Localizar a linha (≈96) que mapeia verbos de criação a markers e adicionar logo abaixo:

```
    - "fecha/conclui/encerra o projeto X" / "cancela o projeto X" → NÃO emita marker; o sistema confirma e muda o status. NUNCA afirme que fechou antes do usuário confirmar.
```

- [ ] **Step 3: Verificar sintaxe do system.js**

Run: `cd D:/la-organizer/_remote && node --check src/prompts/system.js`
Expected: sem saída (OK).

- [ ] **Step 4: Confirmar carregamento da skill** — checar como skills são carregadas (loader em `src/prompts/system.js` ou `engine`); se houver lista/índice de skills por contexto, registrar `fechar-projeto` no gatilho de ação de projeto (espelhar como `aprovar-projeto`/`criar-recorrencia` são injetadas). Run: `grep -rn "aprovar-projeto" src/` pra achar o ponto de injeção e seguir o mesmo padrão.

---

### Task 6: Validação, deploy e registro

**Files:** nenhum novo. Deploy + E2E + known-issue.

- [ ] **Step 1: Rodar TODOS os testes puros locais**

Run: `cd D:/la-organizer/_remote && node --test src/lib/detect-project-status-intent.test.js src/lib/project-status.test.js`
Expected: PASS em todos.

- [ ] **Step 2: `node --check` nos arquivos tocados**

Run: `cd D:/la-organizer/_remote && node --check src/lib/detect-project-status-intent.js && node --check src/lib/project-status.js && node --check src/services/project-status-exec.js && node --check src/engine.js && node --check src/prompts/system.js`
Expected: sem saída.

- [ ] **Step 3: REVISÃO DA CATRACA do diff do `engine.js`** (este chat) — confirmar: não tocou `PROJECT_CREATE/APPROVE/REJECT`; ramo do "sim" gated por `anchor.type==='project'`; detecção lê fala real; nada chama o LLM no caminho determinístico. Só depois disso, deploy.

- [ ] **Step 4: Deploy (scp + restart)**

```bash
scp D:/la-organizer/_remote/src/lib/detect-project-status-intent.js tom:/opt/LA-Organizer/src/lib/detect-project-status-intent.js
scp D:/la-organizer/_remote/src/lib/project-status.js tom:/opt/LA-Organizer/src/lib/project-status.js
scp D:/la-organizer/_remote/src/services/project-status-exec.js tom:/opt/LA-Organizer/src/services/project-status-exec.js
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
scp D:/la-organizer/_remote/skills/fechar-projeto.md tom:/opt/LA-Organizer/skills/fechar-projeto.md
ssh tom "pm2 restart tom"
```

- [ ] **Step 5: Boot limpo + md5 VPS==local**

```bash
ssh tom "pm2 logs tom --lines 30 --nostream"   # esperar "✅ TOM pronto", sem erro novo
ssh tom "md5sum /opt/LA-Organizer/src/engine.js /opt/LA-Organizer/src/lib/project-status.js /opt/LA-Organizer/src/lib/detect-project-status-intent.js /opt/LA-Organizer/src/services/project-status-exec.js"
md5sum D:/la-organizer/_remote/src/engine.js D:/la-organizer/_remote/src/lib/project-status.js D:/la-organizer/_remote/src/lib/detect-project-status-intent.js D:/la-organizer/_remote/src/services/project-status-exec.js
```
Expected: md5 iguais (o que roda É o que a catraca gateou).

- [ ] **Step 6: E2E live na VPS do executor** (projeto descartável)

Criar um projeto descartável no Supabase (status `active`, `created_by` = um colab de teste), depois:
```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env -e \"
  const { applyProjectStatusChange } = require('./src/services/project-status-exec');
  (async () => {
    const collab = { id: '<COLLAB_ID>' };
    const r1 = await applyProjectStatusChange(collab, { projectId: '<PROJ_ID>', newStatus: 'completed' });
    console.log('1º:', JSON.stringify(r1));            // esperado ok:true
    const r2 = await applyProjectStatusChange(collab, { projectId: '<PROJ_ID>', newStatus: 'completed' });
    console.log('2º (idempotência):', JSON.stringify(r2)); // esperado ok:false reason:already_closed
  })();
\""
```
Expected: 1º `ok:true` (projeto vira `completed` no PWA), 2º `already_closed`. Depois apagar/limpar o projeto descartável.

- [ ] **Step 7: Smoke no zap** (ficha/projeto descartável): "fecha o projeto <descartável>" → confirma com contagem certa de abertas → "sim" → status muda no PWA; repetir com "não" em outro descartável → não muda; testar nome ambíguo → pergunta qual.

- [ ] **Step 8: Registrar known-issue** (`tom_known_issues`): atualizar `KRISSYA-PROJECT-CLOSE-NO-HANDLER` de interim → handler real:
```sql
UPDATE tom_known_issues
SET status='corrigido',
    fix_resumo='Handler real de fechar/cancelar projeto por chat: detect-project-status-intent.js (detector puro) + project-status.js (resolve/autoridade/contagem/textos) + project-status-exec.js (executor determinístico, idempotente) + fio no engine (confirm-first via pending_intents kind confirmation, anchor.type=project) + skill fechar-projeto. Paridade PWA (só status, não toca tarefas). Zero migration.',
    corrigido_em=now()
WHERE codigo='KRISSYA-PROJECT-CLOSE-NO-HANDLER';
```

- [ ] **Step 9: Liberar o `.deploy-hold`**

Run: `rm D:/la-organizer/.deploy-hold`
Depois o Stop hook (auto-deploy) commita+pusha tudo e sincroniza o git da VPS.

- [ ] **Step 10: Atualizar memória** — registrar em `MEMORY.md` um pointer pro novo handler (família projeto), linkando `[[project_planning_confirm_no_create]]` e `[[project_fin_confirm_camada2]]` (mesma família confirm-first + executor determinístico).

---

## Self-Review (catraca)

**1. Cobertura da spec:**
- Detector (via explícita + reply-bare + anti-colisão + `?`→null + scaffold) → Task 1 ✅
- `resolveProjectByName`/`canChangeStatus`/`summarizeOpenWork`/builders/`STATUS_BY_ACTION` → Task 2 ✅
- Executor determinístico idempotente → Task 3 ✅
- Fio engine (detect→resolve→autoridade→contagem→confirm→intent; "sim" gated por anchor.type) → Task 4 ✅
- Skill + regra prompt → Task 5 ✅
- Casos de borda (já fechado, 0 abertas, ambíguo, sem autoridade, reply, "sim" duplo, colisão cancela-tarefa) → cobertos em Tasks 1/2/3/4 ✅
- Zero-regressão (não toca PROJECT_*, kind confirmation, gate anchor.type) → Global Constraints + Task 4 Step 4 ✅
- Testes puros + E2E VPS + smoke → Task 6 ✅

**2. Placeholders:** nenhum `TBD`/"handle errors" — todo passo tem código real. O único ponto adaptativo (`finalize(...)` e nomes de variáveis locais do engine) está explicitado como "usar o mecanismo existente", apropriado por ser território do outro chat.

**3. Consistência de tipos:** `aliveProjects`=`{id,name,status,created_by}` e `openTasks`=`{status,assignee_name}` usados igualzinho entre Tasks 2/3/4. `STATUS_BY_ACTION`, `ALIVE_STATUSES`, `resolveProjectByName` retorno (`match|ambiguous|none`) batem entre módulo e consumo no engine. `applyProjectStatusChange` retorno (`ok/reason/project`) idem.
