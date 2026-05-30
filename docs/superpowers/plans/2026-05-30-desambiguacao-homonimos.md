# Desambiguação de Homônimos (Dai/Daiana) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um nome coloquial casa 2+ colaboradores ativos (ex. "Dai"), resolver a pessoa certa por contexto (domínio do requester + assunto) e, se ainda ambíguo, fazer o TOM perguntar 1x em vez de mandar pra pessoa errada.

**Architecture:** Extrair a lógica de resolução pura para um módulo novo testável (`src/services/collaborator-resolver.js`); `src/engine.js` vira só fiação — busca os ativos no banco e injeta nos 5 callsites que resolvem nome. Ambiguidade vira estado de primeira classe (`resolved`/`ambiguous`/`not_found`). Migration só adiciona aliases (sem coluna nova). Domínio é derivado de `function_role`/`unit` já existentes.

**Tech Stack:** Node.js 20 (ES CommonJS), `node:test` + `node:assert` (test runner built-in, sem dep nova), Supabase (`@supabase/supabase-js`), deploy via scp + `pm2 restart tom`, migration via Supabase MCP.

**Spec:** `docs/superpowers/specs/2026-05-30-desambiguacao-homonimos-design.md`

---

## File Structure

- **Create:** `src/services/collaborator-resolver.js` — lógica pura de resolução/desambiguação + a função async `resolveCollaboratorByName(name, {requester, subject, fetchActive})`. Sem `require` de supabase (DB injetado via `fetchActive`), 100% testável.
- **Create:** `src/services/collaborator-resolver.test.js` — testes unitários (`node --test`).
- **Modify:** `src/engine.js` — (a) import do módulo + `_fetchActiveCollaborators` + wrapper `resolveCollaboratorByName`/`findCollaboratorByName`; (b) 5 callsites; (c) guard no `_buildIntegrityConfirmText`.
- **Create:** `scripts/smoke-homonimos.js` — smoke read-only contra o banco real (roda no VPS).
- **Migration:** via Supabase MCP `apply_migration` (append em `collaborators.aliases`).

Dados reais (não inventar — usados nos testes):
- Dai-ped `4c5796ca-dea0-40ea-9d96-3b1fd3929bb7`: `full_name:"Dai"`, `function_role:"pedagogico"`, `pedagogical_role:"assistant"`, `unit:"all"`, aliases `["Dai Ped","Daiana Ped","Dai Pedagógica","Day Ped","Day Pedagógica"]`
- Daiana `e6afed0d-59af-432b-aec3-ce2427db7be2`: `full_name:"Daiana"`, `function_role:"farmer"`, `pedagogical_role:null`, `unit:"recreio"`, aliases `["Dayana","Dai ADM","Dai Recreio","Dai DM","Daiana Farmer","Day ADM","Day Recreio","Diana","Diana Recreio"]`

---

## Task 1: Módulo resolver puro (TDD)

**Files:**
- Create: `src/services/collaborator-resolver.js`
- Test: `src/services/collaborator-resolver.test.js`

- [ ] **Step 1: Write the failing test**

Create `src/services/collaborator-resolver.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('./collaborator-resolver');

// Fixtures espelhando os dados reais de Dai/Daiana.
const DAI_PED = {
  id: 'ped', full_name: 'Dai', preferred_name: null,
  function_role: 'pedagogico', pedagogical_role: 'assistant', unit: 'all',
  aliases: ['Dai Ped', 'Daiana Ped', 'Dai Pedagógica', 'Day Ped', 'Day Pedagógica'],
};
const DAIANA = {
  id: 'farm', full_name: 'Daiana', preferred_name: null,
  function_role: 'farmer', pedagogical_role: null, unit: 'recreio',
  aliases: ['Dayana', 'Dai ADM', 'Dai Recreio', 'Dai DM', 'Daiana Farmer', 'Day ADM', 'Day Recreio', 'Diana', 'Diana Recreio'],
};
const GABI = { id: 'gabi', full_name: 'Gabi Souza', preferred_name: null, function_role: 'farmer', pedagogical_role: null, unit: 'recreio', aliases: [] };
const ROWS = [DAI_PED, DAIANA, GABI];

const PED_REQUESTER = { function_role: 'pedagogico', pedagogical_role: 'teacher', unit: 'tijuca' };
const FARM_REQUESTER = { function_role: 'farmer', pedagogical_role: null, unit: 'recreio' };
const NEUTRAL_REQUESTER = { function_role: 'director', pedagogical_role: null, unit: 'all' };

const fetchActive = async () => ROWS;

// --- gatherCandidates ---
test('gatherCandidates: nome único (Gabi) → 1 candidato', () => {
  const r = R.gatherCandidates('Gabi', ROWS);
  assert.strictEqual(r.exact, null);
  assert.deepStrictEqual(r.union.map(c => c.id), ['gabi']);
});
test('gatherCandidates: "Dai" casa as DUAS (full_name ped + alias farm)', () => {
  const r = R.gatherCandidates('Dai', ROWS);
  assert.strictEqual(r.exact, null);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: "Daiana" casa as DUAS (full_name farm + alias ped)', () => {
  const r = R.gatherCandidates('Daiana', ROWS);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: "Day" casa as DUAS (só aliases)', () => {
  const r = R.gatherCandidates('Day', ROWS);
  assert.deepStrictEqual(r.union.map(c => c.id).sort(), ['farm', 'ped']);
});
test('gatherCandidates: qualificador exato "Dai Recreio" → exact = Daiana', () => {
  const r = R.gatherCandidates('Dai Recreio', ROWS);
  assert.strictEqual(r.exact.id, 'farm');
});
test('gatherCandidates: qualificador exato "Dai Ped" → exact = Dai-ped', () => {
  const r = R.gatherCandidates('Dai Ped', ROWS);
  assert.strictEqual(r.exact.id, 'ped');
});
test('gatherCandidates: nome inexistente → vazio', () => {
  const r = R.gatherCandidates('Fulano', ROWS);
  assert.strictEqual(r.exact, null);
  assert.strictEqual(r.union.length, 0);
});

// --- domainOf / subjectDomainTokens ---
test('domainOf: Dai-ped → pedagogico', () => {
  assert.ok(R.domainOf(DAI_PED).has('pedagogico'));
});
test('domainOf: Daiana → farmer + unit:recreio (unit=all não conta)', () => {
  const d = R.domainOf(DAIANA);
  assert.ok(d.has('farmer'));
  assert.ok(d.has('unit:recreio'));
  assert.ok(!R.domainOf(DAI_PED).has('unit:all'));
});
test('subjectDomainTokens: "aula do aluno João" → pedagogico', () => {
  assert.ok(R.subjectDomainTokens('aula do aluno João').has('pedagogico'));
});
test('subjectDomainTokens: "repor estoque da lojinha" → farmer', () => {
  assert.ok(R.subjectDomainTokens('repor estoque da lojinha').has('farmer'));
});
test('subjectDomainTokens: "recreio" → farmer + unit:recreio', () => {
  const t = R.subjectDomainTokens('passa no recreio');
  assert.ok(t.has('farmer'));
  assert.ok(t.has('unit:recreio'));
});
test('subjectDomainTokens: neutro → vazio', () => {
  assert.strictEqual(R.subjectDomainTokens('bom dia, tudo certo?').size, 0);
});

// --- disambiguate ---
test('disambiguate: 1 candidato → resolved direto (sem contexto)', () => {
  assert.deepStrictEqual(R.disambiguate([GABI], {}), { status: 'resolved', collaborator: GABI });
});
test('disambiguate: 0 candidatos → not_found', () => {
  assert.deepStrictEqual(R.disambiguate([], {}), { status: 'not_found' });
});
test('disambiguate: Farmer + "estoque" → Daiana', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: FARM_REQUESTER, subject: 'repor estoque da lojinha' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('disambiguate: pedagógico + "aula do aluno" → Dai-ped', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: PED_REQUESTER, subject: 'aula do aluno João' });
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.collaborator.id, 'ped');
});
test('disambiguate: assunto vence quem-manda (pedagógico falando de estoque → Daiana)', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: PED_REQUESTER, subject: 'conferir o estoque da loja' });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('disambiguate: requester neutro + assunto neutro → ambiguous', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], { requester: NEUTRAL_REQUESTER, subject: 'preciso falar com ela' });
  assert.strictEqual(r.status, 'ambiguous');
  assert.deepStrictEqual(r.candidates.map(c => c.id).sort(), ['farm', 'ped']);
});
test('disambiguate: sem contexto nenhum → ambiguous', () => {
  const r = R.disambiguate([DAI_PED, DAIANA], {});
  assert.strictEqual(r.status, 'ambiguous');
});

// --- buildAmbiguityQuestion ---
test('buildAmbiguityQuestion: nomeia domínio de cada um', () => {
  const q = R.buildAmbiguityQuestion([DAI_PED, DAIANA]);
  assert.match(q, /Dai/);
  assert.match(q, /Pedagógico/);
  assert.match(q, /Daiana/);
  assert.match(q, /Recreio/);
});

// --- resolveCollaboratorByName (async, fetchActive injetado) ---
test('resolveCollaboratorByName: Farmer + "estoque" → Daiana', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: FARM_REQUESTER, subject: 'estoque da lojinha', fetchActive });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('resolveCollaboratorByName: neutro → ambiguous', async () => {
  const r = await R.resolveCollaboratorByName('Dai', { requester: NEUTRAL_REQUESTER, subject: '', fetchActive });
  assert.strictEqual(r.status, 'ambiguous');
});
test('resolveCollaboratorByName: qualificador "Dai Recreio" → Daiana mesmo sem contexto', async () => {
  const r = await R.resolveCollaboratorByName('Dai Recreio', { fetchActive });
  assert.strictEqual(r.collaborator.id, 'farm');
});
test('resolveCollaboratorByName: nome único Gabi → resolved', async () => {
  const r = await R.resolveCollaboratorByName('Gabi', { fetchActive });
  assert.strictEqual(r.collaborator.id, 'gabi');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /mnt/d/la-organizer/_remote && node --test src/services/collaborator-resolver.test.js`
Expected: FAIL — `Cannot find module './collaborator-resolver'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/services/collaborator-resolver.js`:

```js
// Resolve um colaborador por nome coloquial, desambiguando homônimos
// (ex.: "Dai" pedagógica vs "Daiana" Farmer) por contexto: domínio do
// requester (CONFIÁVEL — vem do phone) + assunto da mensagem (SOFT — texto do
// LLM, usado só para escolher entre candidatos do banco, nunca como identidade).
// Spec: docs/superpowers/specs/2026-05-30-desambiguacao-homonimos-design.md

function stripDiacritics(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function firstToken(s) { return stripDiacritics(s).split(/\s+/)[0]; }

// Keywords → token de domínio. Mesmo vocabulário que domainOf() emite.
const PED_KEYWORDS = ['aluno', 'aluna', 'turma', 'professor', 'prof', 'aula', 'matricula', 'pedagog', 'ensaio', 'repertorio', 'licao', 'prova', 'nota', 'responsavel', 'encarregado'];
const FARM_KEYWORDS = ['estoque', 'loja', 'lojinha', 'produto', 'inventario', 'farm', 'venda', 'caixa', 'mercadoria', 'reposicao', 'etiqueta', 'prateleira'];

function domainOf(collab) {
  const tags = new Set();
  if (!collab) return tags;
  if (collab.function_role) tags.add(stripDiacritics(collab.function_role));
  if (collab.pedagogical_role) tags.add('pedagogico');
  const unit = stripDiacritics(collab.unit || '');
  if (unit && unit !== 'all') tags.add('unit:' + unit);
  return tags;
}

function subjectDomainTokens(subject) {
  const tags = new Set();
  const s = stripDiacritics(subject);
  if (!s) return tags;
  for (const k of PED_KEYWORDS) if (s.includes(k)) { tags.add('pedagogico'); break; }
  for (const k of FARM_KEYWORDS) if (s.includes(k)) { tags.add('farmer'); break; }
  if (s.includes('recreio')) { tags.add('farmer'); tags.add('unit:recreio'); }
  return tags;
}

// Retorna { exact: collab|null, union: collab[] }.
function gatherCandidates(name, rows) {
  const result = { exact: null, union: [] };
  const norm = stripDiacritics(name);
  if (!norm) return result;
  const first = norm.split(/\s+/)[0];

  // 1) Match exato da string completa (full_name|preferred|alias) → qualificador.
  const exactMatches = rows.filter(c => {
    const fn = stripDiacritics(c.full_name || '');
    const pn = stripDiacritics(c.preferred_name || '');
    const als = Array.isArray(c.aliases) ? c.aliases : [];
    return fn === norm || (pn && pn === norm) || als.some(a => stripDiacritics(a) === norm);
  });
  if (exactMatches.length === 1) { result.exact = exactMatches[0]; return result; }

  // 2) União de tiers de token: full_name[0] ∪ preferred ∪ alias[0].
  const seen = new Set();
  const add = (c) => { if (!seen.has(c.id)) { seen.add(c.id); result.union.push(c); } };
  for (const c of rows) {
    if (firstToken(c.full_name || '') === first) { add(c); continue; }
    const pn = stripDiacritics(c.preferred_name || '');
    if (pn && (pn === first || pn.split(/\s+/)[0] === first)) { add(c); continue; }
    const als = Array.isArray(c.aliases) ? c.aliases : [];
    if (als.some(a => firstToken(a) === first)) { add(c); continue; }
  }

  // 3) Fallback prefixo (legado) só se a união veio vazia — não cria ambiguidade nova.
  if (result.union.length === 0) {
    for (const c of rows) if (stripDiacritics(c.full_name || '').startsWith(first)) add(c);
  }
  return result;
}

function scoreCandidate(c, subjTokens, reqDomain) {
  const dom = domainOf(c);
  let subjHits = 0;
  for (const t of subjTokens) if (dom.has(t)) subjHits++;
  let reqHit = 0;
  for (const t of reqDomain) if (dom.has(t)) { reqHit = 1; break; }
  return subjHits * 2 + reqHit; // assunto ("o quê") pesa mais que requester ("quem")
}

function disambiguate(candidates, { requester, subject } = {}) {
  if (!candidates || candidates.length === 0) return { status: 'not_found' };
  if (candidates.length === 1) return { status: 'resolved', collaborator: candidates[0] };
  const subjTokens = subjectDomainTokens(subject);
  const reqDomain = domainOf(requester);
  const scored = candidates.map(c => ({ c, score: scoreCandidate(c, subjTokens, reqDomain) }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tiedTop = scored.filter(s => s.score === top.score);
  if (top.score > 0 && tiedTop.length === 1) return { status: 'resolved', collaborator: top.c };
  return { status: 'ambiguous', candidates };
}

function firstName(collab) {
  return (collab.preferred_name || collab.full_name || '').split(/\s+/)[0];
}
function domainLabel(collab) {
  if (collab.pedagogical_role || stripDiacritics(collab.function_role || '') === 'pedagogico') return 'Pedagógico';
  const unit = (collab.unit || '').trim();
  if (unit && unit.toLowerCase() !== 'all') return unit.charAt(0).toUpperCase() + unit.slice(1);
  if (collab.function_role) return collab.function_role.charAt(0).toUpperCase() + collab.function_role.slice(1);
  return collab.full_name;
}
function buildAmbiguityQuestion(candidates) {
  const parts = candidates.map(c => `*${firstName(c)}* do ${domainLabel(c)}`);
  const list = parts.length === 2
    ? `${parts[0]} e ${parts[1]}`
    : parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
  return `Tem ${list} — é qual delas?`;
}

// fetchActive: () => Promise<rows[]> (colaboradores ativos com campos de domínio).
async function resolveCollaboratorByName(name, { requester = null, subject = null, fetchActive } = {}) {
  const rows = await fetchActive();
  if (!rows || !rows.length) return { status: 'not_found' };
  const { exact, union } = gatherCandidates(name, rows);
  if (exact) return { status: 'resolved', collaborator: exact };
  return disambiguate(union, { requester, subject });
}

module.exports = {
  stripDiacritics, domainOf, subjectDomainTokens, gatherCandidates,
  scoreCandidate, disambiguate, firstName, domainLabel, buildAmbiguityQuestion,
  resolveCollaboratorByName,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /mnt/d/la-organizer/_remote && node --test src/services/collaborator-resolver.test.js`
Expected: PASS — todos os testes verdes (0 fail).

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/la-organizer/_remote && git add src/services/collaborator-resolver.js src/services/collaborator-resolver.test.js && git commit -m "feat(resolver): módulo puro de desambiguação de homônimos por contexto"
```
(Observação: `D:\la-organizer\_remote` não é git repo no Windows; o commit roda no ambiente WSL do auto-deploy. Se `git` falhar aqui, pular — o Stop hook commita no fim do turno.)

---

## Task 2: Fiação no engine — wrapper + fetch

**Files:**
- Modify: `src/engine.js` (import no topo, perto de `const collaboratorService = require('./services/collaborator');` na linha ~7; e substituir o corpo de `findCollaboratorByName` nas linhas ~2966-3014)

- [ ] **Step 1: Adicionar o import**

Logo após a linha 7 (`const collaboratorService = require('./services/collaborator');`), inserir:

```js
const collabResolver = require('./services/collaborator-resolver');
```

- [ ] **Step 2: Substituir o corpo de `findCollaboratorByName`**

Trocar TODO o bloco da função atual (linhas ~2966-3014, de `async function findCollaboratorByName(name) {` até o `}` que fecha em `return null;`) por:

```js
// Busca colaboradores ativos com os campos necessários pra resolução + domínio.
async function _fetchActiveCollaborators() {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, role, unit, onboarding_completed, pedagogical_role, function_role, function_title, bio, preferred_name, aliases, has_coord_permissions')
    .eq('is_active', true);
  return data || [];
}

// Resolve por nome com desambiguação por contexto. Retorna
// { status: 'resolved'|'ambiguous'|'not_found', collaborator?|candidates? }.
async function resolveCollaboratorByName(name, opts = {}) {
  return collabResolver.resolveCollaboratorByName(name, {
    requester: opts.requester || null,
    subject: opts.subject || null,
    fetchActive: _fetchActiveCollaborators,
  });
}

// Back-compat: devolve o collaborator se resolvido, senão null (ambíguo → null).
// Callers sem contexto (requester/subject) continuam funcionando.
async function findCollaboratorByName(name) {
  const r = await resolveCollaboratorByName(name);
  return r.status === 'resolved' ? r.collaborator : null;
}
```

- [ ] **Step 3: Validar sintaxe**

Run: `cd /mnt/d/la-organizer/_remote && node --check src/engine.js`
Expected: sem saída (exit 0).

- [ ] **Step 4: Commit**

```bash
cd /mnt/d/la-organizer/_remote && git add src/engine.js && git commit -m "refactor(engine): findCollaboratorByName delega ao resolver + wrapper resolveCollaboratorByName"
```

---

## Task 3: Callsite COORDINATION (relay/cobrança) — pergunta se ambíguo

**Files:**
- Modify: `src/engine.js:1659-1667` (dentro de `applyCoordinationRequestAction`)

- [ ] **Step 1: Trocar o lookup pelo resolver com contexto**

Substituir as linhas 1659-1667:

```js
  // 1. Lookup recipient — sem row se falhar
  const recipient = await findCollaboratorByName(parsed.recipient_name);
  if (!recipient || !recipient.is_active) {
    return {
      ok: false,
      reason: 'recipient_not_found',
      replyText: `Não achei ninguém com o nome "${parsed.recipient_name}" ativo no sistema. Confere o nome completo, ou me avisa se a pessoa ainda não tá cadastrada que eu te oriento.`,
    };
  }
```

por:

```js
  // 1. Lookup recipient — desambigua homônimos por contexto (requester confiável
  //    via phone + assunto do recado). Ambíguo → pergunta 1x, não cria nada.
  const _recRes = await resolveCollaboratorByName(parsed.recipient_name, {
    requester: collab,
    subject: parsed.message_body,
  });
  if (_recRes.status === 'ambiguous') {
    return {
      ok: false,
      reason: 'ambiguous_recipient',
      replyText: collabResolver.buildAmbiguityQuestion(_recRes.candidates),
    };
  }
  const recipient = _recRes.status === 'resolved' ? _recRes.collaborator : null;
  if (!recipient || !recipient.is_active) {
    return {
      ok: false,
      reason: 'recipient_not_found',
      replyText: `Não achei ninguém com o nome "${parsed.recipient_name}" ativo no sistema. Confere o nome completo, ou me avisa se a pessoa ainda não tá cadastrada que eu te oriento.`,
    };
  }
```

- [ ] **Step 2: Validar sintaxe**

Run: `cd /mnt/d/la-organizer/_remote && node --check src/engine.js`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
cd /mnt/d/la-organizer/_remote && git add src/engine.js && git commit -m "feat(coordination): pergunta de desambiguação quando recipient é homônimo"
```

---

## Task 4: Callsites TASK (create-for-other + delegate) + render da pergunta

**Files:**
- Modify: `src/engine.js:1619` (`_buildIntegrityConfirmText` — guard novo)
- Modify: `src/engine.js:3777-3778` (task create-for-other)
- Modify: `src/engine.js:4226-4233` (task delegate)

- [ ] **Step 1: Guard no `_buildIntegrityConfirmText`**

Logo após a linha 1619 (`function _buildIntegrityConfirmText(payload) {`), inserir como PRIMEIRA instrução:

```js
  // Desambiguação de homônimos: payload carrega os candidatos; pergunta direta.
  if (payload && payload.type === 'ambiguous_recipient') {
    return collabResolver.buildAmbiguityQuestion(payload.candidates);
  }
```

- [ ] **Step 2: Task create-for-other — resolver com contexto + early-return se ambíguo**

Substituir as linhas 3777-3778:

```js
          if (a.to_phone) recipient = await findCollaboratorByPhone(a.to_phone);
          else recipient = await findCollaboratorByName(a.to_name);
```

por:

```js
          if (a.to_phone) {
            recipient = await findCollaboratorByPhone(a.to_phone);
          } else {
            const _r = await resolveCollaboratorByName(a.to_name, {
              requester: collaborator,
              subject: `${a.title || ''} ${a.description || ''}`,
            });
            if (_r.status === 'ambiguous') {
              // Espelha o padrão dup_task: não insere, sinaliza payload pro caller.
              return {
                okCount,
                failCount: failCount + 1,
                integrityPayload: {
                  severity: 'soft',
                  type: 'ambiguous_recipient',
                  candidates: _r.candidates,
                  candidateTitle: a.title,
                },
              };
            }
            recipient = _r.status === 'resolved' ? _r.collaborator : null;
          }
```

- [ ] **Step 3: Task delegate — resolver com contexto + early-return se ambíguo**

Substituir as linhas 4226-4228:

```js
        let recipient = null;
        if (a.to_phone) recipient = await findCollaboratorByPhone(a.to_phone);
        else if (a.to_name) recipient = await findCollaboratorByName(a.to_name);
```

por:

```js
        let recipient = null;
        if (a.to_phone) {
          recipient = await findCollaboratorByPhone(a.to_phone);
        } else if (a.to_name) {
          const _r = await resolveCollaboratorByName(a.to_name, {
            requester: collaborator,
            subject: t.title,
          });
          if (_r.status === 'ambiguous') {
            return {
              okCount,
              failCount: failCount + 1,
              integrityPayload: {
                severity: 'soft',
                type: 'ambiguous_recipient',
                candidates: _r.candidates,
                candidateTitle: t.title,
              },
            };
          }
          recipient = _r.status === 'resolved' ? _r.collaborator : null;
        }
```

- [ ] **Step 4: Validar sintaxe**

Run: `cd /mnt/d/la-organizer/_remote && node --check src/engine.js`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/la-organizer/_remote && git add src/engine.js && git commit -m "feat(task): desambiguação de homônimos em create-for-other e delegate"
```

---

## Task 5: Callsites EVENT (create-for-other + related_to)

**Files:**
- Modify: `src/engine.js:2238-2239` (event create-for-other)
- Modify: `src/engine.js:2299-2303` (related_to inference)

- [ ] **Step 1: Event create-for-other — resolver com contexto + payload se ambíguo**

Substituir as linhas 2238-2239:

```js
        if (e.to_phone) eventRecipient = await findCollaboratorByPhone(e.to_phone);
        else eventRecipient = await findCollaboratorByName(e.to_name);
```

por:

```js
        if (e.to_phone) {
          eventRecipient = await findCollaboratorByPhone(e.to_phone);
        } else {
          const _r = await resolveCollaboratorByName(e.to_name, {
            requester: collaborator,
            subject: `${e.title || ''} ${e.description || ''}`,
          });
          if (_r.status === 'ambiguous') {
            // Não cria; sinaliza payload (var integrityPayload do applyEventActions).
            integrityPayload = {
              severity: 'soft',
              type: 'ambiguous_recipient',
              candidates: _r.candidates,
              candidateTitle: e.title,
            };
            failCount++;
            continue;
          }
          eventRecipient = _r.status === 'resolved' ? _r.collaborator : null;
        }
```

- [ ] **Step 2: related_to — inferência ignora ambíguo (sem perguntar)**

Substituir as linhas 2299-2303:

```js
      } else if (typeof e.related_to_name === 'string' && e.related_to_name.trim()) {
        try {
          const inferred = await findCollaboratorByName(e.related_to_name.trim());
          if (inferred?.id) row.related_to_collaborator_id = inferred.id;
        } catch (_) { /* silent */ }
      }
```

por:

```js
      } else if (typeof e.related_to_name === 'string' && e.related_to_name.trim()) {
        try {
          // Inferência soft: usa contexto pra desambiguar; se ambíguo, deixa vazio.
          const _r = await resolveCollaboratorByName(e.related_to_name.trim(), {
            requester: collaborator,
            subject: `${e.title || ''} ${e.description || ''}`,
          });
          if (_r.status === 'resolved') row.related_to_collaborator_id = _r.collaborator.id;
        } catch (_) { /* silent */ }
      }
```

- [ ] **Step 3: Validar sintaxe**

Run: `cd /mnt/d/la-organizer/_remote && node --check src/engine.js`
Expected: exit 0.

- [ ] **Step 4: Rodar os testes unitários (garante que Task 1 segue verde)**

Run: `cd /mnt/d/la-organizer/_remote && node --test src/services/collaborator-resolver.test.js`
Expected: PASS (0 fail).

- [ ] **Step 5: Commit**

```bash
cd /mnt/d/la-organizer/_remote && git add src/engine.js && git commit -m "feat(event): desambiguação de homônimos em create-for-other e related_to"
```

---

## Task 6: Migration — aliases compartilhados/qualificadores

**Files:** Supabase MCP `apply_migration` (project `cesnbnrynvxvgdhfmaua`)

- [ ] **Step 1: Aplicar a migration (idempotente, dedup)**

`aliases` é `text[]`. Append + dedup via `unnest`/`distinct`. Chamar a tool `mcp__4c04bb52-...__apply_migration` com `name: "add_homonym_aliases_dai_daiana"` e o SQL:

```sql
update collaborators
set aliases = array(select distinct unnest(coalesce(aliases, '{}'::text[]) || array['Dai','Day','Dai do Pedagógico','Daiana do Pedagógico']))
where id = '4c5796ca-dea0-40ea-9d96-3b1fd3929bb7';

update collaborators
set aliases = array(select distinct unnest(coalesce(aliases, '{}'::text[]) || array['Dai','Day','Daiana do Recreio','Daiana Recreio']))
where id = 'e6afed0d-59af-432b-aec3-ce2427db7be2';
```

- [ ] **Step 2: Verificar o resultado**

Chamar `mcp__4c04bb52-...__execute_sql` com:

```sql
select full_name, aliases from collaborators
where id in ('4c5796ca-dea0-40ea-9d96-3b1fd3929bb7','e6afed0d-59af-432b-aec3-ce2427db7be2');
```
Expected: Dai-ped contém `Dai`, `Day`, `Dai do Pedagógico`, `Daiana do Pedagógico` (+ os antigos); Daiana contém `Dai`, `Day`, `Daiana do Recreio`, `Daiana Recreio` (+ os antigos). Sem duplicatas.

---

## Task 7: Smoke read-only contra o banco real (pré-deploy)

**Files:**
- Create: `scripts/smoke-homonimos.js`

- [ ] **Step 1: Criar o script de smoke**

Create `scripts/smoke-homonimos.js`:

```js
// Smoke read-only: valida a resolução de homônimos contra o banco real.
// Roda no VPS (tem .env). Não escreve nada. Sai 1 se algum cenário falhar.
const { createClient } = require('@supabase/supabase-js');
const R = require('../src/services/collaborator-resolver');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchActive() {
  const { data } = await supabase
    .from('collaborators')
    .select('id, full_name, phone, is_active, role, unit, pedagogical_role, function_role, preferred_name, aliases')
    .eq('is_active', true);
  return data || [];
}

const FARM = { function_role: 'farmer', pedagogical_role: null, unit: 'recreio' };
const PED = { function_role: 'pedagogico', pedagogical_role: 'teacher', unit: 'tijuca' };
const NEUTRAL = { function_role: 'director', pedagogical_role: null, unit: 'all' };
const PED_ID = '4c5796ca-dea0-40ea-9d96-3b1fd3929bb7';
const FARM_ID = 'e6afed0d-59af-432b-aec3-ce2427db7be2';

const cases = [
  { name: 'Dai', requester: FARM, subject: 'repor estoque da lojinha', expect: { status: 'resolved', id: FARM_ID } },
  { name: 'Dai', requester: PED, subject: 'aula do aluno João', expect: { status: 'resolved', id: PED_ID } },
  { name: 'Dai', requester: NEUTRAL, subject: '', expect: { status: 'ambiguous' } },
  { name: 'Dai Recreio', requester: NEUTRAL, subject: '', expect: { status: 'resolved', id: FARM_ID } },
  { name: 'Dai Ped', requester: NEUTRAL, subject: '', expect: { status: 'resolved', id: PED_ID } },
];

(async () => {
  let fail = 0;
  for (const c of cases) {
    const r = await R.resolveCollaboratorByName(c.name, { requester: c.requester, subject: c.subject, fetchActive });
    const gotId = r.collaborator ? r.collaborator.id : null;
    const ok = r.status === c.expect.status && (c.expect.id === undefined || gotId === c.expect.id);
    console.log(`${ok ? 'OK ' : 'XX '} name="${c.name}" req=${c.requester.function_role} subj="${c.subject}" → ${r.status}${gotId ? '/' + (gotId === PED_ID ? 'Dai-ped' : gotId === FARM_ID ? 'Daiana' : gotId) : ''}`);
    if (!ok) fail++;
  }
  console.log(fail === 0 ? '\\nSMOKE OK' : `\\nSMOKE FAIL (${fail})`);
  process.exit(fail === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: scp do módulo + script pro VPS e rodar (read-only)**

```bash
scp D:/la-organizer/_remote/src/services/collaborator-resolver.js tom:/opt/LA-Organizer/src/services/collaborator-resolver.js
scp D:/la-organizer/_remote/scripts/smoke-homonimos.js tom:/opt/LA-Organizer/scripts/smoke-homonimos.js
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && set +a && node scripts/smoke-homonimos.js"
```
Expected: 5 linhas `OK ` + `SMOKE OK` (exit 0). Se aparecer `XX`/`SMOKE FAIL`, NÃO prosseguir pro deploy — diagnosticar (systematic-debugging) e corrigir o módulo/keywords.

- [ ] **Step 3: Commit do script**

```bash
cd /mnt/d/la-organizer/_remote && git add scripts/smoke-homonimos.js && git commit -m "test(smoke): valida desambiguação de homônimos contra o banco real"
```

---

## Task 8: Deploy do engine + validação pós-deploy

**Files:** deploy (engine.js já editado; módulo já scp'd na Task 7)

- [ ] **Step 1: scp do engine + restart**

```bash
scp D:/la-organizer/_remote/src/engine.js tom:/opt/LA-Organizer/src/engine.js
ssh tom "pm2 restart tom"
```

- [ ] **Step 2: Confirmar que subiu sem erro**

Run: `ssh tom "pm2 logs tom --lines 30 --nostream"`
Expected: TOM iniciou normalmente, sem `Error`/stack trace no boot. Sem `Cannot find module './services/collaborator-resolver'`.

- [ ] **Step 3: Smoke pós-deploy (mesmo script, já no VPS)**

```bash
ssh tom "cd /opt/LA-Organizer && set -a && . ./.env && set +a && node scripts/smoke-homonimos.js"
```
Expected: `SMOKE OK` (exit 0).

- [ ] **Step 4: Validação funcional real (opcional, recomendada)**

Pedir ao Alf um teste real no WhatsApp: (a) de um contexto Farmer/Recreio "avisa a Dai que o estoque chegou" → vai pra Daiana; (b) de um contexto pedagógico "avisa a Dai sobre o aluno" → vai pra Dai-ped; (c) contexto neutro "manda recado pra Dai" → TOM pergunta "é qual delas?".

---

## Self-Review

**Spec coverage:**
- §1 Arquitetura do resolvedor → Task 1 (módulo) + Task 2 (wrapper). ✓
- §2 Coleta união + precedência qualificador → Task 1 `gatherCandidates` + testes. ✓
- §3 Desambiguação por contexto (domainOf/subject/score) → Task 1 `disambiguate`/`scoreCandidate` + testes. ✓
- §4 5 callsites → Task 3 (1660), Task 4 (3778, 4228), Task 5 (2239, 2301). ✓
- §5 Migration aliases (text[]) → Task 6. ✓
- §6 ASK stateless (pergunta + qualifier-aliases) → Task 3/4/5 (`buildAmbiguityQuestion`) + Task 6 (aliases). ✓
- §7 Smoke 5 cenários → Task 7. ✓
- §8 Segurança (requester via phone, subject soft) → comentários no módulo + uso de `collab`/`collaborator` (do phone) como requester nos callsites. ✓

**Type consistency:** `resolveCollaboratorByName` retorna `{status, collaborator?|candidates?}` em todos os usos; `gatherCandidates` retorna `{exact, union}`; `buildAmbiguityQuestion(candidates)` recebe array de rows com `full_name`/`preferred_name`/`function_role`/`pedagogical_role`/`unit` — os callsites de task/event passam `_r.candidates` (rows completas do fetch, que têm esses campos). ✓ `integrityPayload.type === 'ambiguous_recipient'` consistente entre Task 4/5 (set) e Task 4 Step 1 (`_buildIntegrityConfirmText` render). ✓

**Placeholders:** nenhum — todo código está completo.
```

