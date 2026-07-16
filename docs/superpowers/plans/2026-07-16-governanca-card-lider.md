# Digest de governança — card por líder — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o digest diário de governança (4 blocos sobre 4 eixos, líder medido como executor) por **um card por líder** que mostra, num print só, se o atraso é do líder ou do liderado dele.

**Architecture:** Duas funções **puras** novas (`buildLeaderCards` monta a estrutura, `renderLeaderCard` vira texto) num módulo próprio, testadas com `node --test` sem tocar em banco nem LLM. O `dispatcher.js` continua dono de todo o I/O: busca, chama as puras, injeta o `💡` do LLM na estrutura pronta e entrega pro `assembleDigest` já existente.

**Tech Stack:** Node.js CommonJS (`node:test` + `node:assert`), Supabase JS, React/TS (Vite) no PWA.

**Spec:** `docs/superpowers/specs/2026-07-16-governanca-digest-card-lider-design.md` — aprovada pelo Alf em 16/07. As referências `§N` abaixo apontam pra ela.

## Global Constraints

- **`.deploy-hold` fica em `D:\la-organizer\.deploy-hold`** — o diretório **PAI** de `_remote`, **não** dentro dele. `auto-deploy.ps1:19` faz `Join-Path (Split-Path $srcRoot -Parent) ".deploy-hold"`. Criar em `_remote/.deploy-hold` gera um arquivo **inerte** e o deploy dispara mesmo assim.
- **NÃO commitar entre tasks** (`_remote/CLAUDE.md` → Commits). Trabalha tudo local; **1 commit bundle** na Task 8.
- **Guard de `null` obrigatório:** `closurePct !== null` antes de qualquer `<`. `null < 60` é `true` em JS.
- **Os DOIS relógios (§7.1):** `%` = SEMANAL (vem do scorecard). Contagem / `overdue` / `stuck` / `noTasks` = AO VIVO (contado de `tasks`). Nunca misturar.
- **Zero migration.** Nenhum campo novo. `closure_rate` já aceita `null` (sem `NOT NULL`).
- **Voz do TOM é sagrada.** Nada toca `soul/` nem `skills/`. O único texto de LLM é o `💡`, que já existe e **não muda de prompt**.
- **Deploy cirúrgico (Task 8):** só os hunks deste plano, sobre cópia FRESCA da VPS; `node --check`; `md5` VPS==local **antes** do `pm2 restart`.
- **Nunca `.sort()` em array recebido por parâmetro** — sempre sobre cópia (`[...arr]`, ou o array novo que `.map()`/`.filter()` já devolvem).
- **Baseline que não pode quebrar:** `node --test src/services/leader-routing.test.js` = **34 passando** hoje.
- Todos os comandos rodam a partir de `D:\la-organizer\_remote` (git-bash: `cd /d/la-organizer/_remote`).

## File Structure

| Arquivo | Responsabilidade | Task |
|---|---|---|
| `src/services/leader-routing.js` | resolve líderes de uma pessoa. **Ganha** desempate determinístico. | 1 |
| `src/services/leader-routing.test.js` | trava o roteamento (34 testes). **Ganha** o teste de determinismo. | 1 |
| `src/rituals/leader-cards.js` | **NOVO.** `buildLeaderCards` (estrutura) + `renderLeaderCard` (texto). Puras. | 2,3,4 |
| `src/rituals/leader-cards.test.js` | **NOVO.** TDD dos 11 casos da §10. | 2,3,4 |
| `src/services/scorecard-builder.js` | computa/persiste `leader_scorecards`. **Muda** escopo + `null`. | 5 |
| `src/rituals/dispatcher.js` | I/O + orquestração do digest. **Perde** o `ceoBucket` e os 4 blocos. | 6 |
| `web/src/lib/scorecard-classify.ts` | PORT da régua de cor pro PWA. **Muda** junto (§7.2). | 7 |
| `web/src/lib/scorecard-classify.test.ts` | paridade JS↔TS. | 7 |
| `web/src/components/team/TeamDrillPanel.tsx` | painel do time. **Muda** só o cabeçalho. | 7 |

---

### Task 1: Desempate determinístico no roteamento de liderança

**Por que primeiro:** é o alicerce. Todo o resto pendura no "líder principal" (1º da lista), e hoje essa ordem vem do heap do Postgres — muda sozinha após `UPDATE`/`VACUUM` (§3.2). Sem isto, o bloco do Peterson pularia da Juliana pro Quintela sem ninguém mexer em nada.

**Files:**
- Modify: `src/services/leader-routing.js:31-84` (`resolveLeadersOf`)
- Test: `src/services/leader-routing.test.js` (append)

**Interfaces:**
- Consumes: nada (primeira task).
- Produces: `resolveLeadersOf(collab, allCollabs) → Object[]` com **ordem estável**. Prioridade ENTRE tiers preservada (gerente-da-unidade → líder-de-grupo → aresta-explícita → CEO); empate DENTRO do tier resolvido por `full_name` e depois `id`. `resolveLeaderIdsOf(collab, allCollabs) → string[]` idem.

- [ ] **Step 1: Criar o HOLD de deploy (antes de tocar em `src/`)**

O Stop hook robocopia `_remote/` → commit → push → VPS `git reset --hard` + `pm2 restart`. Sem o hold, encerrar o turno no meio deste plano empacota trabalho pela metade em produção.

```bash
touch /d/la-organizer/.deploy-hold && ls -la /d/la-organizer/.deploy-hold
```

Esperado: o arquivo existe. **Atenção:** é em `/d/la-organizer/`, **não** em `/d/la-organizer/_remote/`.

- [ ] **Step 2: Registrar o baseline**

```bash
cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js 2>&1 | tail -5
```

Esperado: `pass 34` / `fail 0`. Se não for 34, **pare** — o baseline mudou e o plano precisa ser revisto.

- [ ] **Step 3: Escrever o teste que falha**

Append em `src/services/leader-routing.test.js`. **Não use o helper `ids()` existente** — ele faz `.sort()` e é cego à ordem, que é justamente o que estamos travando.

```js
// ── Determinismo (§3.2) ─────────────────────────────────────────────────────
// O loader real (governance-edges.js) não tem ORDER BY em NENHUMA query: a ordem que
// o Postgres devolve é a ordem física do heap e muda sozinha após UPDATE/VACUUM. O
// digest pendura o card inteiro no 1º líder da lista — sem desempate, o bloco do
// Peterson pula da Juliana pro Quintela sozinho. Estes testes NÃO podem sortear.
test('DETERMINISMO: ordem de group_leaders não muda o líder principal do Peterson', () => {
  const GL_ASC = [
    { group_key: 'pedagogico', unit: 'all', leader_id: 'juliana' },
    { group_key: 'pedagogico', unit: 'all', leader_id: 'quintela' },
  ];
  const GL_DESC = [...GL_ASC].reverse();
  const mk = (groupLeaders, collabs) => {
    const p = { ...PETERSON, group_leader_ids: groupLeaderIdsFor(PETERSON, groupLeaders) };
    return resolveLeaderIdsOf(p, collabs);
  };
  assert.deepStrictEqual(mk(GL_ASC, ALL), mk(GL_DESC, ALL), 'ordem de governance_leaders vazou');
  assert.strictEqual(mk(GL_DESC, ALL)[0], 'juliana', 'principal = Juliana (alfabético)');
});

test('DETERMINISMO: ordem de allCollabs não muda o líder principal do Peterson', () => {
  const p = { ...PETERSON, group_leader_ids: groupLeaderIdsFor(PETERSON, GROUP_LEADERS) };
  assert.deepStrictEqual(
    resolveLeaderIdsOf(p, ALL),
    resolveLeaderIdsOf(p, [...ALL].reverse()),
    'ordem de collaborators vazou',
  );
});

test('DETERMINISMO: prioridade ENTRE tiers sobrevive ao desempate (Leo: unidade antes de grupo)', () => {
  // Leo é pedagogico + barra. Tier 1 (gerente da unidade = Krissya) tem que vir ANTES
  // do tier 2 (grupo = Juliana/Quintela), mesmo com 'Juliana' < 'Krissya' no alfabeto.
  const leo = { ...LEO, group_leader_ids: groupLeaderIdsFor(LEO, GROUP_LEADERS) };
  assert.strictEqual(resolveLeaderIdsOf(leo, ALL)[0], 'krissya', 'tier 1 perdeu pro alfabeto');
});
```

- [ ] **Step 4: Rodar e ver falhar**

```bash
cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js 2>&1 | tail -8
```

Esperado: **`fail 1`** — `DETERMINISMO: ordem de group_leaders...` quebra em `principal = Juliana (alfabético)`, recebendo `'quintela'`. Os outros 2 podem passar por sorte (a ordem só muda se o heap mudar) — **isso é esperado e é exatamente o perigo**: o bug é silencioso até o dia em que não é.

- [ ] **Step 5: Implementar o desempate**

Em `src/services/leader-routing.js`, adicionar o comparador logo abaixo de `LEADER_ROLES` (linha 24):

```js
// Desempate DETERMINÍSTICO dentro de cada tier. O loader (governance-edges.js) não tem
// ORDER BY em nenhuma query → a ordem do Postgres é a do heap e muda após UPDATE/VACUUM.
// Sem isto o "líder principal" (1º da lista) troca sozinho e o card do digest muda de dono.
// NÃO mexe na prioridade ENTRE tiers — essa segue sendo a ordem de inserção no Map.
const byNameThenId = (a, b) =>
  String(a.full_name || '').localeCompare(String(b.full_name || ''), 'pt-BR') ||
  String(a.id).localeCompare(String(b.id));
```

Substituir os 4 loops de `add(...)` dentro de `resolveLeadersOf` (linhas 51-81) por versões ordenadas. `.filter()` e `.map()` já devolvem array novo, então o `.sort()` nunca mexe no parâmetro:

```js
  if (!isSelfLeader) {
    // 1) lotado numa unidade → gerente da unidade (líder "de chão" principal)
    if (UNITS.has(unit)) {
      for (const c of active.filter((c) => c.role === 'manager' && c.unit === unit).sort(byNameThenId)) add(c);
    }
    // 2) líderes do grupo vêm da tabela governance_leaders (group+unit), anexados no load
    // como group_leader_ids via groupLeaderIdsFor. Desacoplado do nível de acesso (uma
    // farmer pode liderar farmers da unidade dela sem ser gerente).
    const groupIds = Array.isArray(collab.group_leader_ids) ? collab.group_leader_ids : [];
    for (const L of groupIds.map((lid) => byId.get(lid)).filter(Boolean).sort(byNameThenId)) add(L);
  }

  // 4) override manual (matriz editável, governance_edges) — soma sem dominar a ordem.
  // O CEO PODE ser líder explícito (opt-in do Diretor: "Ana reporta a mim e à Rose").
  // As regras AUTOMÁTICAS (1-2) nunca adicionam o CEO; o ENVIO do digest por-líder
  // também o pula (dispatcher ~L.2610/2797), pois ele já tem o report completo.
  const explicitIds = Array.isArray(collab.explicit_leader_ids) ? collab.explicit_leader_ids : [];
  for (const L of explicitIds.map((lid) => byId.get(lid)).filter(Boolean).sort(byNameThenId)) add(L);

  // 5) fallback: ninguém resolveu (órfão ou ele-mesmo líder) → CEO
  if (leaders.size === 0) {
    for (const c of active.filter((c) => c.is_ceo).sort(byNameThenId)) add(c);
  }
```

- [ ] **Step 6: Rodar e ver passar — sem regressão**

```bash
cd /d/la-organizer/_remote && node --test src/services/leader-routing.test.js 2>&1 | tail -8
```

Esperado: `pass 37` / `fail 0` (34 antigos + 3 novos). **Se algum dos 34 antigos quebrou, pare** — eles usam `.sort()` e deveriam ser imunes à ordem; quebrar significa que o desempate mudou o *conjunto* de líderes, não só a ordem, e isso é um bug no comparador.

---

### Task 2: `buildLeaderCards` — agrupamento e conservação

**Por que separado da Task 3:** um revisor pode aceitar o agrupamento e rejeitar a régua de cor. O teste de **conservação** desta task é o guardião do zero-regressão: se uma tarefa sumir no agrupamento hierárquico, ele quebra.

**Files:**
- Create: `src/rituals/leader-cards.js`
- Create: `src/rituals/leader-cards.test.js`

**Interfaces:**
- Consumes: `resolveLeadersOf(collab, allCollabs) → Object[]` (ordem estável, Task 1) e `governanceViewerIdsOf(task, owner, allCollabs) → string[]` de `../services/leader-routing`.
- Produces: `buildLeaderCards({ tasks, events, collabs, scorecards, today }) → { cards, unassigned, ritmo }`. Nesta task, `dot`/`closurePct` saem como `null` (Task 3 preenche). Contratos completos na §5 da spec.

**Regra de posse — cada tarefa cai em EXATAMENTE 1 card:**
1. Dono **lidera alguém** (`hasTeam`, qualquer tier) → vai pro card **do próprio dono**, bloco `isSelf`.
2. Senão → vai pro card do **líder principal** (1º não-CEO de `governanceViewerIdsOf`), no bloco da pessoa.
3. Senão (só o CEO lidera) → balde `unassigned` ("Direto com você").

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/rituals/leader-cards.test.js`:

```js
// src/rituals/leader-cards.test.js
// Trava o card por líder (§10 da spec 2026-07-16). Rodar:
//   node --test src/rituals/leader-cards.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildLeaderCards } = require('./leader-cards');
const { groupLeaderIdsFor } = require('../services/leader-routing');

// ── Fixtures — espelham o org real (mesmas de leader-routing.test.js) ────────
const CEO      = { id: 'ceo',      full_name: 'Luciano Alf', role: 'director',     function_role: null,         unit: 'all',     is_ceo: true,  is_active: true };
const CLAYTON  = { id: 'clayton',  full_name: 'Clayton',     role: 'manager',      function_role: null,         unit: 'recreio', is_ceo: false, is_active: true };
const JULIANA  = { id: 'juliana',  full_name: 'Juliana',     role: 'coordinator',  function_role: 'pedagogico', unit: 'all',     is_ceo: false, is_active: true };
const QUINTELA = { id: 'quintela', full_name: 'Quintela',    role: 'coordinator',  function_role: 'pedagogico', unit: 'all',     is_ceo: false, is_active: true };
const PETERSON = { id: 'peterson', full_name: 'Peterson',    role: 'collaborator', function_role: 'pedagogico', unit: null,      is_ceo: false, is_active: true };
const DAIANA   = { id: 'daiana',   full_name: 'Daiana',      role: 'collaborator', function_role: 'farmer',     unit: 'recreio', is_ceo: false, is_active: true };
const FABI     = { id: 'fabi',     full_name: 'Fabi',        role: 'collaborator', function_role: 'farmer',     unit: 'all',     is_ceo: false, is_active: true };

const GROUP_LEADERS = [
  { group_key: 'pedagogico', unit: 'all', leader_id: 'juliana' },
  { group_key: 'pedagogico', unit: 'all', leader_id: 'quintela' },
];

function mkCollabs() {
  const all = [CEO, CLAYTON, JULIANA, QUINTELA, PETERSON, DAIANA, FABI].map((c) => ({ ...c }));
  for (const c of all) {
    c.group_leader_ids = groupLeaderIdsFor(c, GROUP_LEADERS);
    c.explicit_leader_ids = [];
  }
  return all;
}

const TODAY = '2026-07-17';
// due_date → days: 16/07 = 1d (🆕), 15/07 = 2d, 02/06 = 45d
const task = (id, assigned_to, due_date, extra = {}) =>
  ({ id, title: `T-${id}`, due_date, assigned_to, governance_owner_id: null,
     coordination_request_count: 0, ...extra });

const build = (tasks, opts = {}) => buildLeaderCards({
  tasks, events: [], collabs: mkCollabs(), scorecards: new Map(), today: TODAY, ...opts,
});

// ── §10.1 Conservação — o guardião do zero-regressão ────────────────────────
test('CONSERVAÇÃO: nenhuma tarefa some no agrupamento', () => {
  const tasks = [
    task('a', 'peterson', '2026-06-02'), task('b', 'peterson', '2026-07-16'),
    task('c', 'daiana',   '2026-07-15'), task('d', 'clayton',  '2026-07-15'),
    task('e', 'juliana',  '2026-07-16'), task('f', 'fabi',     '2026-07-15'),
  ];
  const { cards, unassigned } = build(tasks);
  const seen = [];
  for (const c of cards) for (const p of c.people) seen.push(...p.novo, ...p.arrastando);
  for (const p of unassigned) seen.push(...p.novo, ...p.arrastando);
  assert.strictEqual(seen.length, tasks.length, 'sumiu ou duplicou tarefa');
  assert.deepStrictEqual([...new Set(seen.map((i) => i.id))].sort(), ['a','b','c','d','e','f']);
});

// ── §10.2 O caso que HOJE falha ────────────────────────────────────────────
test('PETERSON: as 9 atrasadas de um collaborator entram no card da Juliana', () => {
  const tasks = Array.from({ length: 9 }, (_, i) => task(`p${i}`, 'peterson', '2026-07-15'));
  const { cards } = build(tasks);
  const jul = cards.find((c) => c.leader.id === 'juliana');
  assert.ok(jul, 'Juliana não ganhou card');
  assert.strictEqual(jul.totals.team, 9);
  assert.strictEqual(jul.totals.own, 0);
});

// ── §10.3 Sem duplicata mesmo com N líderes ────────────────────────────────
test('SEM DUPLICATA: Peterson tem 2 líderes e aparece em EXATAMENTE 1 card', () => {
  const { cards } = build([task('a', 'peterson', '2026-07-15')]);
  const comPeterson = cards.filter((c) => c.people.some((p) => p.person.id === 'peterson'));
  assert.strictEqual(comPeterson.length, 1);
  assert.strictEqual(comPeterson[0].leader.id, 'juliana');
});

// ── §5.1 co-líderes ────────────────────────────────────────────────────────
test('coLeaders: o card da Juliana nomeia o Quintela com o rótulo do vínculo', () => {
  const { cards } = build([task('a', 'peterson', '2026-07-15')]);
  const jul = cards.find((c) => c.leader.id === 'juliana');
  assert.deepStrictEqual(jul.coLeaders, [{ id: 'quintela', name: 'Quintela', label: 'pedagógico' }]);
});

// ── §7.6 / §10.10 / §10.11 quem cai onde ───────────────────────────────────
test('DIRETO COM VOCÊ: não-líder cujo único líder é o CEO cai no balde', () => {
  const { cards, unassigned } = build([task('a', 'fabi', '2026-07-15')]);
  assert.strictEqual(cards.some((c) => c.people.some((p) => p.person.id === 'fabi')), false);
  assert.strictEqual(unassigned.length, 1);
  assert.strictEqual(unassigned[0].person.id, 'fabi');
});

test('LÍDER NÃO CAI NO BALDE: as tarefas do Clayton vão pro isSelf do card dele', () => {
  const { cards, unassigned } = build([task('a', 'clayton', '2026-07-15')]);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.ok(cl, 'Clayton não ganhou card');
  assert.strictEqual(cl.totals.own, 1);
  assert.strictEqual(unassigned.length, 0);
});

test('isSelf POR ÚLTIMO: o bloco "Dele/Dela" fecha o card', () => {
  const tasks = [task('a', 'clayton', '2026-07-15'), task('b', 'daiana', '2026-07-15')];
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.people[cl.people.length - 1].isSelf, true);
  assert.strictEqual(cl.people[0].person.id, 'daiana');
});

// ── §7.4 faixas ────────────────────────────────────────────────────────────
test('FAIXAS: 1d cai em novo, 2d+ cai em arrastando (desc por days)', () => {
  const tasks = [
    task('novo', 'peterson', '2026-07-16'),
    task('velho', 'peterson', '2026-06-02'),
    task('medio', 'peterson', '2026-07-15'),
  ];
  const { cards } = build(tasks);
  const p = cards.find((c) => c.leader.id === 'juliana').people[0];
  assert.deepStrictEqual(p.novo.map((i) => i.id), ['novo']);
  assert.deepStrictEqual(p.arrastando.map((i) => i.id), ['velho', 'medio']);
  assert.strictEqual(p.arrastando[0].days, 45);
});

// ── §10.4 determinismo ponta a ponta ───────────────────────────────────────
test('DETERMINISMO: embaralhar a entrada produz a MESMA saída', () => {
  const tasks = [task('a', 'peterson', '2026-07-15'), task('b', 'daiana', '2026-07-16')];
  const a = buildLeaderCards({ tasks, events: [], collabs: mkCollabs(), scorecards: new Map(), today: TODAY });
  const b = buildLeaderCards({ tasks: [...tasks].reverse(), events: [], collabs: mkCollabs().reverse(), scorecards: new Map(), today: TODAY });
  assert.deepStrictEqual(JSON.stringify(a), JSON.stringify(b));
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /d/la-organizer/_remote && node --test src/rituals/leader-cards.test.js 2>&1 | tail -6
```

Esperado: falha total — `Cannot find module './leader-cards'`.

- [ ] **Step 3: Implementar `buildLeaderCards`**

Criar `src/rituals/leader-cards.js`:

```js
// src/rituals/leader-cards.js
// Fase 7 — CARD POR LÍDER. Substitui os 4 blocos do digest (idade / pessoa+LLM /
// cobrança / staleness), que organizavam as MESMAS tarefas em 4 eixos que não
// conversavam — e por isso liam como ruído. Aqui existe UM eixo: o líder.
//
// PURO e SÍNCRONO: sem banco, sem LLM. O 💡 (diagnostic) é injetado DEPOIS pelo
// dispatcher, que faz o I/O. Rodar: node --test src/rituals/leader-cards.test.js
'use strict';

const { resolveLeadersOf, governanceViewerIdsOf, LEADER_ROLES } = require('../services/leader-routing');

// §5.1 — rótulo do vínculo compartilhado com um co-líder.
const FUNCTION_LABELS = {
  pedagogico: 'pedagógico', farmer: 'farmers', marketing: 'marketing',
  ops_tecnicas: 'ops técnicas', financeiro: 'financeiro', sonoramente: 'Sonoramente', tech: 'tech',
};

const firstName = (c) => String(c.preferred_name || c.full_name || '').split(' ')[0] || '—';

// Dias de atraso a partir de YMDs — aritmética em UTC sobre componentes, NUNCA
// new Date(str) local nem toISOString().slice(0,10) (desloca o dia após 21h BRT).
function daysBetweenYmd(todayYmd, dueYmd) {
  const [y1, m1, d1] = String(todayYmd).split('-').map(Number);
  const [y2, m2, d2] = String(dueYmd).split('-').map(Number);
  return Math.max(1, Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86400000));
}

function buildLeaderCards({ tasks, events, collabs, scorecards, today }) {
  const list = Array.isArray(collabs) ? collabs : [];
  const byId = new Map(list.map((c) => [c.id, c]));

  // Quem é LÍDER = lidera >= 1 pessoa ativa por QUALQUER regra. Mesmo critério do
  // `hasTeam` que o dispatcher já usa (~L.2980) — uma fonte de verdade só.
  const leaderIds = new Set();
  for (const c of list) {
    for (const l of resolveLeadersOf(c, list)) if (l.id !== c.id) leaderIds.add(l.id);
  }
  const isLeader = (id) => leaderIds.has(id) && !(byId.get(id) || {}).is_ceo;

  // Líder principal de uma TAREFA: 1º viewer não-CEO. Delegada (governance_owner_id)
  // curto-circuita pro delegador — quem delegou é quem cobra.
  const primaryOf = (t, owner) => {
    for (const vid of governanceViewerIdsOf(t, owner, list)) {
      const v = byId.get(vid);
      if (v && !v.is_ceo) return v;
    }
    return null;
  };

  const cards = new Map();     // leaderId -> { leader, people: Map }
  const unassigned = new Map();// personId -> block
  const blank = (person, isSelf) => ({ person: { id: person.id, name: firstName(person) },
    isSelf, novo: [], arrastando: [], events: [], diagnostic: null, count: 0 });

  const cardFor = (leader) => {
    if (!cards.has(leader.id)) cards.set(leader.id, { leader, people: new Map() });
    return cards.get(leader.id);
  };
  const blockFor = (leader, person, isSelf) => {
    const bucket = leader ? cardFor(leader).people : unassigned;
    if (!bucket.has(person.id)) bucket.set(person.id, blank(person, isSelf));
    return bucket.get(person.id);
  };

  // Todo líder tem card, mesmo sem pendência (a Task 3 decide se ele aparece).
  for (const id of leaderIds) {
    const l = byId.get(id);
    if (l && !l.is_ceo) cardFor(l);
  }

  for (const t of (tasks || [])) {
    const owner = byId.get(t.assigned_to);
    if (!owner || !t.due_date) continue;   // sem dono/prazo não há a quem cobrar
    const item = { id: t.id, title: String(t.title || ''), days: daysBetweenYmd(today, t.due_date),
      stuck: (t.coordination_request_count || 0) >= 3 };
    // Posse: dono é líder → card DELE (isSelf). Senão → card do principal. Senão → balde.
    const self = isLeader(owner.id);
    const block = blockFor(self ? owner : primaryOf(t, owner), owner, self);
    (item.days === 1 ? block.novo : block.arrastando).push(item);
    block.count += 1;
  }

  // ⚠️ A tabela `events` usa `collaborator_id` (NÃO `owner_id`) e `start_at` (NÃO `starts_at`).
  // Ver dispatcher.js:2409. Errar o campo faz byId.get() devolver undefined pra TODO evento →
  // `continue` → os compromissos somem calados, com os testes verdes.
  for (const e of (events || [])) {
    const owner = byId.get(e.collaborator_id);
    if (!owner) continue;
    const self = isLeader(owner.id);
    const block = blockFor(self ? owner : primaryOf({ assigned_to: e.collaborator_id }, owner), owner, self);
    block.events.push({ id: e.id, title: String(e.title || ''), whenLabel: e.whenLabel || '' });
    block.count += 1;
  }

  const finishBlock = (b) => {
    b.arrastando.sort((x, y) => y.days - x.days || String(x.id).localeCompare(String(y.id)));
    b.novo.sort((x, y) => String(x.id).localeCompare(String(y.id)));
    return b;
  };

  const out = [];
  for (const { leader, people } of cards.values()) {
    const blocks = [...people.values()].map(finishBlock)
      .sort((a, b) => Number(a.isSelf) - Number(b.isSelf)     // self SEMPRE por último
        || b.count - a.count                                   // mais pendências primeiro
        || a.person.name.localeCompare(b.person.name, 'pt-BR'));
    const own = blocks.filter((b) => b.isSelf).reduce((s, b) => s + b.count, 0);
    const team = blocks.filter((b) => !b.isSelf).reduce((s, b) => s + b.count, 0);
    out.push({ leader: { id: leader.id, name: firstName(leader) },
      coLeaders: coLeadersOf(leader, blocks, list, byId),
      dot: null, closurePct: null, totals: { all: own + team, team, own }, people: blocks });
  }
  out.sort((a, b) => b.totals.all - a.totals.all || a.leader.name.localeCompare(b.leader.name, 'pt-BR'));

  return { cards: out, unassigned: [...unassigned.values()].map(finishBlock), ritmo: [] };
}

// §5.1 — união dos líderes NÃO-principais das pessoas do card, menos o CEO e menos o
// dono do card. `label` = function_role compartilhado, se for o mesmo pra todos; senão 'time'.
function coLeadersOf(leader, blocks, list, byId) {
  const acc = new Map();  // coLeaderId -> Set(function_role das pessoas compartilhadas)
  for (const b of blocks) {
    if (b.isSelf) continue;
    const person = byId.get(b.person.id);
    if (!person) continue;
    for (const l of resolveLeadersOf(person, list).slice(1)) {
      if (l.is_ceo || l.id === leader.id) continue;
      if (!acc.has(l.id)) acc.set(l.id, new Set());
      acc.get(l.id).add(person.function_role || null);
    }
  }
  return [...acc.entries()]
    .map(([id, roles]) => {
      const only = roles.size === 1 ? [...roles][0] : null;
      return { id, name: firstName(byId.get(id) || {}), label: (only && FUNCTION_LABELS[only]) || 'time' };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

module.exports = { buildLeaderCards, daysBetweenYmd, FUNCTION_LABELS, LEADER_ROLES };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd /d/la-organizer/_remote && node --test src/rituals/leader-cards.test.js 2>&1 | tail -8
```

Esperado: `pass 9` / `fail 0`. **O teste de CONSERVAÇÃO é o que importa** — se ele passar, nenhuma tarefa some no agrupamento hierárquico.

---

### Task 3: `buildLeaderCards` — cor, percentual e quem aparece

**Files:**
- Modify: `src/rituals/leader-cards.js`
- Modify: `src/rituals/leader-cards.test.js` (append)

**Interfaces:**
- Consumes: `buildLeaderCards(...)` da Task 2 (`dot`/`closurePct` ainda `null`).
- Produces: `classifyCard({ closurePct, overdueLive, stuckLive, closedLastWeek }) → '🔴'|'🟡'|'🟢'` exportada; `buildLeaderCards` passa a preencher `dot`, `closurePct` e `ritmo`.

- [ ] **Step 1: Escrever os testes que falham**

Append em `src/rituals/leader-cards.test.js`:

```js
// ── §7.2 régua de cor + §7.3 percentual ────────────────────────────────────
const { classifyCard } = require('./leader-cards');

test('GUARD DE NULL: sem nota e sem pendência → 🟢, NUNCA 🔴 (null < 60 é true em JS)', () => {
  assert.strictEqual(
    classifyCard({ closurePct: null, overdueLive: 0, stuckLive: 0, closedLastWeek: 0 }), '🟢');
});

test('GUARD DE NULL: sem nota mas COM pendência ao vivo → não usa o % pra decidir', () => {
  // 2 atrasadas e sem nota: 🟡 por overdueLive >= 1 — não 🔴 por "null < 60".
  assert.strictEqual(
    classifyCard({ closurePct: null, overdueLive: 2, stuckLive: 0, closedLastWeek: 0 }), '🟡');
});

test('100% DE ZERO: líder com conjunto vazio não imprime % (closurePct null) e fica 🟢', () => {
  const { cards } = build([]);
  const rose = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(rose.closurePct, null);
  assert.strictEqual(rose.dot, '🟢');
});

test('LÍDER AFOGADO: 8 próprias e time limpo → 🔴 (o buraco da opção A recusada)', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => task(`c${i}`, 'clayton', '2026-07-15'));
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.totals.own, 8);
  assert.strictEqual(cl.totals.team, 0);
  assert.strictEqual(cl.dot, '🔴');
});

test('RELÓGIOS: noTasks vem do AO VIVO, não do snapshot semanal', () => {
  // Snapshot diz "semana perfeita" (closed=0, rate null); ao vivo tem 3 atrasadas.
  // Se noTasks saísse do snapshot, isto viraria 🟢 com 3 pendências listadas.
  const sc = new Map([['clayton', { closure_rate: null, tasks_closed: 0 }]]);
  const tasks = Array.from({ length: 3 }, (_, i) => task(`c${i}`, 'clayton', '2026-07-15'));
  const { cards } = build(tasks, { scorecards: sc });
  assert.strictEqual(cards.find((c) => c.leader.id === 'clayton').dot, '🔴');
});

test('PERCENTUAL: closure_rate 0.4 do scorecard vira closurePct 40', () => {
  const sc = new Map([['clayton', { closure_rate: 0.4, tasks_closed: 2 }]]);
  const { cards } = build([task('a', 'clayton', '2026-07-15')], { scorecards: sc });
  assert.strictEqual(cards.find((c) => c.leader.id === 'clayton').closurePct, 40);
});

test('STUCK: 2 tarefas cobradas 3x pintam 🔴 e a flag chega no item', () => {
  const tasks = [
    task('s1', 'daiana', '2026-07-15', { coordination_request_count: 3 }),
    task('s2', 'daiana', '2026-07-15', { coordination_request_count: 4 }),
  ];
  const { cards } = build(tasks);
  const cl = cards.find((c) => c.leader.id === 'clayton');
  assert.strictEqual(cl.dot, '🔴');
  assert.strictEqual(cl.people[0].arrastando.every((i) => i.stuck), true);
});

test('QUEM APARECE: 🟢 sai de cards e entra em ritmo', () => {
  const { cards, ritmo } = build([task('a', 'peterson', '2026-07-15')]);
  assert.strictEqual(cards.every((c) => c.dot !== '🟢'), true, '🟢 vazou pros cards');
  assert.ok(ritmo.some((r) => r.id === 'clayton'), 'Clayton (limpo) não entrou no ritmo');
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /d/la-organizer/_remote && node --test src/rituals/leader-cards.test.js 2>&1 | tail -8
```

Esperado: `fail 8` — `classifyCard is not a function` e `dot` vindo `null`.

- [ ] **Step 3: Implementar a régua**

Em `src/rituals/leader-cards.js`, adicionar acima de `buildLeaderCards`:

```js
// §7.2 — régua de cor. Thresholds IDÊNTICOS aos de hoje (scorecard-builder.js:202-209);
// o que muda é o ESCOPO (líder + time, não `assigned_to = leaderId`) e a FONTE de cada
// termo (§7.1: % é SEMANAL, contagem é AO VIVO). Uma variável por vez.
// PORT espelhado em web/src/lib/scorecard-classify.ts — os dois mudam juntos.
function classifyCard({ closurePct, overdueLive, stuckLive, closedLastWeek }) {
  const noTasks = overdueLive === 0 && stuckLive === 0 && closedLastWeek === 0;
  // O guard de null é OBRIGATÓRIO, não estilo: `null < 60` é `true` em JS (null coage
  // pra 0), então sem ele TODO líder sem nota seria pintado de 🔴 — o bug exatamente
  // oposto ao "100% de zero" que viemos consertar.
  const badPct = closurePct !== null && closurePct < 60;
  const midPct = closurePct !== null && closurePct < 85;
  if (!noTasks && (badPct || overdueLive >= 3 || stuckLive >= 2)) return '🔴';
  if (!noTasks && (midPct || overdueLive >= 1)) return '🟡';
  return '🟢';
}
```

Em `buildLeaderCards`, trocar o `out.push(...)` e o `return` finais por:

```js
  const out = [];
  const ritmo = [];
  for (const { leader, people } of cards.values()) {
    const blocks = [...people.values()].map(finishBlock)
      .sort((a, b) => Number(a.isSelf) - Number(b.isSelf)
        || b.count - a.count
        || a.person.name.localeCompare(b.person.name, 'pt-BR'));
    const own = blocks.filter((b) => b.isSelf).reduce((s, b) => s + b.count, 0);
    const team = blocks.filter((b) => !b.isSelf).reduce((s, b) => s + b.count, 0);

    // §7.1 — o % é SEMANAL (vem do scorecard); a contagem é AO VIVO (dos blocks).
    const sc = (scorecards && scorecards.get(leader.id)) || {};
    const rate = sc.closure_rate;
    const closurePct = (rate === null || rate === undefined) ? null : Math.round(100 * rate);
    const stuckLive = blocks.reduce(
      (s, b) => s + b.novo.filter((i) => i.stuck).length + b.arrastando.filter((i) => i.stuck).length, 0);
    const dot = classifyCard({ closurePct, overdueLive: own + team, stuckLive,
      closedLastWeek: sc.tasks_closed || 0 });

    const card = { leader: { id: leader.id, name: firstName(leader) },
      coLeaders: coLeadersOf(leader, blocks, list, byId),
      dot, closurePct, totals: { all: own + team, team, own }, people: blocks };
    // §7.6 — 🟢 colapsa numa linha; só 🔴/🟡 ganham card.
    if (dot === '🟢') ritmo.push({ id: leader.id, name: firstName(leader) });
    else out.push(card);
  }
  out.sort((a, b) => b.totals.all - a.totals.all || a.leader.name.localeCompare(b.leader.name, 'pt-BR'));
  ritmo.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return { cards: out, unassigned: [...unassigned.values()].map(finishBlock), ritmo };
```

E adicionar `classifyCard` ao `module.exports`:

```js
module.exports = { buildLeaderCards, classifyCard, daysBetweenYmd, FUNCTION_LABELS, LEADER_ROLES };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd /d/la-organizer/_remote && node --test src/rituals/leader-cards.test.js 2>&1 | tail -8
```

Esperado: `pass 17` / `fail 0`.

**Atenção:** o teste de CONSERVAÇÃO da Task 2 varre só `cards`. Agora que 🟢 sai de `cards`, um líder 🟢 com tarefa é impossível por construção (`overdueLive >= 1` → no mínimo 🟡), então a conservação continua válida. Se ele quebrar, **a régua está errada**, não o teste.

---

### Task 4: `renderLeaderCard` — a estrutura vira texto

**Files:**
- Modify: `src/rituals/leader-cards.js`
- Modify: `src/rituals/leader-cards.test.js` (append)

**Interfaces:**
- Consumes: `Card` da Task 3.
- Produces: `renderLeaderCard(card) → string` e `renderUnassigned(blocks) → string`.

- [ ] **Step 1: Escrever os testes que falham**

Append em `src/rituals/leader-cards.test.js`:

```js
// ── §8 formato ─────────────────────────────────────────────────────────────
const { renderLeaderCard } = require('./leader-cards');

test('RENDER: cabeçalho traz dot, nome, % e a quebra time/dele', () => {
  const sc = new Map([['clayton', { closure_rate: 0.4, tasks_closed: 2 }]]);
  const tasks = [task('a', 'daiana', '2026-07-15'), task('b', 'clayton', '2026-07-16')];
  const { cards } = build(tasks, { scorecards: sc });
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /^🟡 \*Clayton\* — 40% · 2 pendências$/m);
  assert.match(txt, /^_1 do time · 1 dele_$/m);
});

test('RENDER: sem nota, o cabeçalho NÃO imprime % (nunca "0%")', () => {
  const { cards } = build([task('a', 'daiana', '2026-07-15')]);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /^🟡 \*Clayton\* — 1 pendência$/m);
  assert.strictEqual(/%/.test(txt), false, 'imprimiu % sem ter nota');
});

test('RENDER: stuck vira ⚠️ cobrada 3x na linha do item', () => {
  const { cards } = build([task('a', 'daiana', '2026-07-15', { coordination_request_count: 3 })]);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /⚠️ cobrada 3x/);
});

test('RENDER: faixa única não imprime rótulo; as duas imprimem', () => {
  const so = build([task('a', 'daiana', '2026-07-15')]);
  const um = renderLeaderCard(so.cards.find((c) => c.leader.id === 'clayton'));
  assert.strictEqual(/Caiu hoje|Arrastando/.test(um), false, 'rótulo com faixa única');

  const duas = build([task('a', 'daiana', '2026-07-15'), task('b', 'daiana', '2026-07-16')]);
  const dois = renderLeaderCard(duas.cards.find((c) => c.leader.id === 'clayton'));
  assert.match(dois, /🆕 \*Caiu hoje\*/);
  assert.match(dois, /⏳ \*Arrastando\*/);
});

test('RENDER §7.5: corta em 3 por faixa, mas stuck e 30d+ FURAM a fila', () => {
  const tasks = [
    task('n1', 'daiana', '2026-07-14'), task('n2', 'daiana', '2026-07-14'),
    task('n3', 'daiana', '2026-07-14'), task('n4', 'daiana', '2026-07-14'),
    task('velha', 'daiana', '2026-06-02'),                                        // 45d
    task('presa', 'daiana', '2026-07-14', { coordination_request_count: 3 }),     // stuck
  ];
  const { cards } = build(tasks);
  const txt = renderLeaderCard(cards.find((c) => c.leader.id === 'clayton'));
  assert.match(txt, /T-velha/, '45d não furou a fila');
  assert.match(txt, /T-presa/, 'stuck não furou a fila');
  assert.match(txt, /_\+3_/, 'não colapsou o resto');
});

test('RENDER: co-líder vira nota; card sem co-líder não imprime a linha', () => {
  const comCo = build([task('a', 'peterson', '2026-07-15')]);
  assert.match(renderLeaderCard(comCo.cards.find((c) => c.leader.id === 'juliana')),
    /^_pedagógico dividido com o Quintela_$/m);
  const semCo = build([task('a', 'daiana', '2026-07-15')]);
  assert.strictEqual(/dividido com/.test(
    renderLeaderCard(semCo.cards.find((c) => c.leader.id === 'clayton'))), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /d/la-organizer/_remote && node --test src/rituals/leader-cards.test.js 2>&1 | tail -6
```

Esperado: `fail 6` — `renderLeaderCard is not a function`.

- [ ] **Step 3: Implementar o render**

Adicionar em `src/rituals/leader-cards.js`, antes do `module.exports`:

```js
const MAX_POR_FAIXA = 3;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

// §7.5 — 3 itens por faixa, mas stuck e 30d+ FURAM a fila: são o motivo da cor,
// esconder eles seria repetir o defeito do `stuck` invisível que viemos matar.
function pickItems(items) {
  const fura = items.filter((i) => i.stuck || i.days >= 30);
  const resto = items.filter((i) => !(i.stuck || i.days >= 30));
  const mostra = [...fura, ...resto].slice(0, MAX_POR_FAIXA);
  const ordem = new Map(items.map((i, ix) => [i.id, ix]));   // devolve à ordem original
  return { mostra: mostra.sort((a, b) => ordem.get(a.id) - ordem.get(b.id)),
    resto: Math.max(0, items.length - mostra.length) };
}

const fmtItem = (i) => `    • ${i.title.slice(0, 55)} — ${i.days}d${i.stuck ? ' ⚠️ cobrada 3x' : ''}`;

function fmtFaixa(rotulo, items, comRotulo) {
  if (!items.length) return [];
  const { mostra, resto } = pickItems(items);
  const linhas = comRotulo ? [`   ${rotulo}`] : [];
  linhas.push(...mostra.map(fmtItem));
  if (resto > 0) linhas.push(`    _+${resto}_`);
  return linhas;
}

function fmtBlock(b) {
  const titulo = b.isSelf ? `*${_pronome()}* · ${b.count}` : `  *${b.person.name}* · ${b.count}`;
  // §7.4 — com as DUAS faixas, cada uma leva rótulo. Com uma só, o rótulo não vale 2 linhas.
  const duas = b.novo.length > 0 && b.arrastando.length > 0;
  return ['', `  ${titulo.trim()}`,
    ...fmtFaixa('🆕 *Caiu hoje*', b.novo, duas),
    ...fmtFaixa('⏳ *Arrastando*', b.arrastando, duas),
    ...b.events.flatMap((e) => [`   📅 ${e.title.slice(0, 45)} (${e.whenLabel})`, '      _sem devolutiva_']),
    ...(b.diagnostic ? [`   💡 _${b.diagnostic}_`] : []),
  ];
}

// "Dele"/"Dela" é o único lugar com gênero. Sem campo de gênero no banco, o TOM
// usa a forma neutra do bloco próprio — a decisão de voz fica com o Alf, não aqui.
const _pronome = () => 'Dele';

function renderLeaderCard(card) {
  const pct = card.closurePct === null ? '' : `${card.closurePct}% · `;
  const linhas = [`${card.dot} *${card.leader.name}* — ${pct}${plural(card.totals.all, 'pendência', 'pendências')}`];
  if (card.totals.all > 0) linhas.push(`_${card.totals.team} do time · ${card.totals.own} dele_`);
  for (const co of card.coLeaders) linhas.push(`_${co.label} dividido com o ${co.name}_`);
  for (const b of card.people) linhas.push(...fmtBlock(b));
  return linhas.join('\n');
}

function renderUnassigned(blocks) {
  if (!blocks.length) return '';
  const total = blocks.reduce((s, b) => s + b.count, 0);
  return [`❓ *Direto com você* — ${plural(total, 'pendência', 'pendências')}`,
    ...blocks.flatMap((b) => fmtBlock(b))].join('\n');
}
```

Atualizar o export:

```js
module.exports = { buildLeaderCards, classifyCard, renderLeaderCard, renderUnassigned,
  daysBetweenYmd, FUNCTION_LABELS, LEADER_ROLES };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
cd /d/la-organizer/_remote && node --test src/rituals/leader-cards.test.js 2>&1 | tail -8
```

Esperado: `pass 23` / `fail 0`.

---

### Task 5: `scorecard-builder` — escopo do conjunto e fim do "100% de zero"

**Files:**
- Modify: `src/services/scorecard-builder.js:41-91` (`computeScorecard`)
- Modify: `src/services/scorecard-builder.js:191-329` (`renderForDirector`, `renderForLeader` — guard de `null`)

**Interfaces:**
- Consumes: `resolveLeadersOf` (Task 1); `loadCollabsWithEdges(supabase) → Object[]` de `./governance-edges`.
- Produces: `computeScorecard(leaderId, weekStart, weekEnd, allCollabs) → { tasks_closed, tasks_overdue, tasks_stuck, closure_rate, top_bottlenecks }` com `closure_rate: number|null` e escopo = líder + time. **A assinatura ganha um 4º parâmetro.**

- [ ] **Step 1: Trocar o escopo de `computeScorecard`**

Substituir as linhas 41-71 de `src/services/scorecard-builder.js`:

```js
/**
 * Computa as métricas pra UM líder em UMA semana, no escopo do CONJUNTO:
 * o líder + as pessoas de quem ele é o líder PRINCIPAL (§3.3 da spec 16/07).
 *
 * Antes media `assigned_to = leaderId` — só o líder como EXECUTOR. O time nunca entrava
 * na conta: as 9 atrasadas do Peterson (collaborator) não pintavam a Juliana, que é a
 * líder dele. Era a informação que faltava no digest inteiro.
 */
async function computeScorecard(leaderId, weekStart, weekEnd, allCollabs) {
  const weekStartIso = `${weekStart}T00:00:00-03:00`;
  const weekEndIso   = `${weekEnd}T23:59:59-03:00`;

  // Conjunto = ele + quem tem ele como líder PRINCIPAL (1º não-CEO). O principal é
  // determinístico desde o desempate por tier em leader-routing.js.
  const list = Array.isArray(allCollabs) ? allCollabs : [];
  const scope = [leaderId];
  for (const c of list) {
    if (c.id === leaderId) continue;
    const principal = resolveLeadersOf(c, list).find((l) => !l.is_ceo);
    if (principal && principal.id === leaderId) scope.push(c.id);
  }

  // 1. Fechadas na semana (qualquer task fechada com completed_at dentro)
  const { data: closed } = await supabase
    .from('tasks')
    .select('id, title, category')
    .in('assigned_to', scope)
    .eq('status', 'done')
    .gte('completed_at', weekStartIso)
    .lte('completed_at', weekEndIso);

  // 2. Abertas (any time, mas relevante pra calcular overdue/stuck)
  const { data: open } = await supabase
    .from('tasks')
    .select('id, title, due_date, category, coordination_request_count, status')
    .in('assigned_to', scope)
    .eq('data_classification', 'real')
    .in('status', ['pending', 'in_progress', 'awaiting_confirmation']);

  // 3. Overdue: open com due_date <= weekEnd (passou ou vence até fim semana)
  const overdue = (open || []).filter(t => t.due_date && t.due_date <= weekEnd);

  // 4. Stuck: 3+ cobranças sem efeito
  const stuck = (open || []).filter(t => (t.coordination_request_count || 0) >= 3);

  // 5. Closure rate — §7.3: sem denominador NÃO é 100%, é SEM NOTA. `? 1.0` fazia a
  // Rose aparecer 🟢 100% liderando 4 pessoas e sem ter fechado nada.
  const closedCount = closed?.length || 0;
  const denominator = closedCount + overdue.length;
  const closure_rate = denominator === 0 ? null : closedCount / denominator;
```

E, logo abaixo, no `return`, trocar o arredondamento pra tolerar `null`:

```js
  return {
    tasks_closed: closedCount,
    tasks_overdue: overdue.length,
    tasks_stuck: stuck.length,
    closure_rate: closure_rate === null ? null : Math.round(closure_rate * 100) / 100,
    top_bottlenecks,
  };
}
```

Adicionar o import no topo do arquivo (depois da linha 16):

```js
const { resolveLeadersOf } = require('./leader-routing');
```

- [ ] **Step 2: Blindar os consumidores contra `null`**

`renderForDirector` (linhas ~202-209) e `renderForLeader` comparam `sc.closure_rate < 0.60`. **`null < 0.60` é `true`** → líder sem nota viraria "atenção". O guard `hasNoTasks` cobre a maioria dos casos, mas depende de 3 campos; o guard explícito é barato e não depende de ninguém.

Em `renderForDirector`, trocar o bloco de classificação (linhas 202-209):

```js
    const hasNoTasks = sc.tasks_closed === 0 && sc.tasks_overdue === 0 && sc.tasks_stuck === 0;
    // Guard de null OBRIGATÓRIO: `null < 0.60` é `true` em JS (null coage pra 0).
    const badPct = sc.closure_rate !== null && sc.closure_rate !== undefined && sc.closure_rate < 0.60;
    const midPct = sc.closure_rate !== null && sc.closure_rate !== undefined && sc.closure_rate < 0.85;
    if (!hasNoTasks && (badPct || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) {
      atencao.push({ sc, leader });
    } else if (!hasNoTasks && (midPct || sc.tasks_overdue >= 1)) {
      olhar.push({ sc, leader });
    } else {
      ritmo.push({ sc, leader });
    }
```

Nos dois renderers, `Math.round(sc.closure_rate * 100)` vira `null → 0` e imprimiria **"0%"** pra quem não tem nota. Adicionar o helper acima de `renderForDirector` (~linha 190):

```js
// Sem nota (§7.3) não imprime 0% — não imprime nada.
const pctOf = (rate) => (rate === null || rate === undefined) ? null : Math.round(rate * 100);
```

Trocar as 3 linhas que hoje fazem `Math.round(... * 100)`.

`renderForDirector`, bloco 🔴 ATENÇÃO (linhas ~228-232):

```js
      const pct = pctOf(sc.closure_rate);
      const bot = sc.top_bottlenecks?.[0];
      const botTxt = bot ? ` • ${CATEGORY_LABELS[bot.category] || bot.category}` : '';
      const stuck = sc.tasks_stuck >= 2 ? ` • ${sc.tasks_stuck} travadas 3+` : '';
      const pctTxt = pct === null ? '' : `${pct}% fechamento, `;
      lines.push(`• *${_name(leader)}* — ${pctTxt}${sc.tasks_overdue} atrasada${sc.tasks_overdue !== 1 ? 's' : ''}${stuck}${botTxt}`);
```

`renderForDirector`, bloco 🟡 OLHAR (linhas ~243-246):

```js
      const pct = pctOf(sc.closure_rate);
      const bot = sc.top_bottlenecks?.[0];
      const botTxt = bot ? ` • ${CATEGORY_LABELS[bot.category] || bot.category}` : '';
      const pctTxt = pct === null ? '' : `${pct}%, `;
      lines.push(`• *${_name(leader)}* — ${pctTxt}${sc.tasks_overdue} atrasada${sc.tasks_overdue !== 1 ? 's' : ''}${botTxt}`);
```

`renderForLeader` (linhas ~279 e ~291):

```js
  const pct = pctOf(scorecard.closure_rate);
```

```js
  lines.push(`✅ *${scorecard.tasks_closed}* fechada${scorecard.tasks_closed !== 1 ? 's' : ''}${pct === null ? '' : ` — *${pct}% de fechamento*`}`);
```

- [ ] **Step 3: Atualizar o chamador em `monday-scorecard.js`** ⚠️ o passo silencioso

`computeScorecard` ganhou o 4º parâmetro. **Se ele não for passado**, `resolveLeadersOf(c, [])` devolve `[]` pra todo mundo → `scope = [leaderId]` → o comportamento antigo volta **calado**, com todos os testes verdes e a mudança inteira virando no-op.

Adicionar o require no topo de `src/rituals/monday-scorecard.js`, depois da linha 12:

```js
const { loadCollabsWithEdges } = require('../services/governance-edges');
```

Carregar **uma vez, ANTES** do loop `for (const leader of eligible)` (linha 37) — nunca dentro dele, senão é 1 query por líder:

```js
  const allCollabs = await loadCollabsWithEdges(supabase);
  for (const leader of eligible) {
```

E passar na chamada (linha ~39):

```js
      const metrics = await builder.computeScorecard(leader.id, weekStart, weekEnd, allCollabs);
```

- [ ] **Step 4: Verificar sintaxe**

```bash
cd /d/la-organizer/_remote && node --check src/services/scorecard-builder.js && node --check src/rituals/monday-scorecard.js && echo "SINTAXE OK"
```

Esperado: `SINTAXE OK`.

---

### Task 6: `dispatcher` — matar os 4 blocos e o `ceoBucket`

**Files:**
- Modify: `src/rituals/dispatcher.js:2700-2820` (`ceoTeamUnclosedTasksReport`, modo `returnText`)

**Interfaces:**
- Consumes: `buildLeaderCards`, `renderLeaderCard`, `renderUnassigned` de `./leader-cards`; `analyzePersonBacklog({ ownerName, items }) → Promise<string|null>` de `../services/governance-analyzer` (**sem mudança de assinatura**).
- Produces: `ceoTeamUnclosedTasksReport(now, { returnText: true }) → { text, staleIds }` — mesmo contrato de hoje, texto novo.

- [ ] **Step 1: Substituir a montagem**

Preservar **intactos**: a query, o guard done-twin (`dropOpenWithDoneTwin`), o filtro "cobradas nas últimas 24h" (`cobradas24h`) e o `staleCheckBlock` (ele **marca** `staleness_check_sent_at` no banco, é efeito colateral real — só sai do TEXTO).

Trocar o bloco que hoje vai de `// Separa por idade: 3+ dias = bucket CEO` (linha ~2703) até o fim de `staleCheckBlock` (~linha 2779) por:

```js
    // Fase 7 — CARD POR LÍDER. Morre o `days >= 3 → ceoBucket` (a tarefa velha perdia o
    // líder: quanto pior, menos estrutura) e morrem os 4 blocos que organizavam as MESMAS
    // tarefas em 4 eixos (idade / pessoa+LLM / cobrança / staleness). Um eixo: o líder.
    const { buildLeaderCards, renderLeaderCard, renderUnassigned } = require('./leader-cards');
    const scMap = new Map();
    const { data: scLatest } = await supabase
      .from('leader_scorecards').select('week_start')
      .order('week_start', { ascending: false }).limit(1).maybeSingle();
    if (scLatest && scLatest.week_start) {
      const { data: scRows } = await supabase
        .from('leader_scorecards').select('leader_id, closure_rate, tasks_closed')
        .eq('week_start', scLatest.week_start);
      for (const r of (scRows || [])) scMap.set(r.leader_id, r);
    }

    const built = buildLeaderCards({
      tasks: filteredStale, events: [], collabs: allCollabs, scorecards: scMap, today: sp.ymd,
    });

    // §4 — a função é PURA: o 💡 do LLM é injetado DEPOIS, na estrutura já montada.
    // Mesma regra de hoje (3+ pendências por PESSOA) e mesmo prompt — a voz não muda.
    for (const card of built.cards) {
      for (const b of card.people) {
        if (b.count < 3) continue;
        try {
          b.diagnostic = await analyzePersonBacklog({
            ownerName: b.person.name,
            items: [...b.novo, ...b.arrastando].map((i) => ({
              title: i.title, daysOverdue: i.days, category: null,
              coordination_request_count: i.stuck ? 3 : 0,
            })),
          });
        } catch (e) { /* nunca quebra ritual */ }
      }
    }

    const corpo = [
      ...built.cards.map(renderLeaderCard),
      renderUnassigned(built.unassigned),
      built.ritmo.length ? `🟢 _No ritmo: ${built.ritmo.map((r) => r.name).join(' · ')}_` : '',
    ].filter(Boolean).join('\n───────────────────\n');
```

Substituir o `return` do modo `returnText` (~linha 2813) por:

```js
    if (opts.returnText) {
      const quantos = built.cards.length;
      return {
        text: `_${quantos === 1 ? '1 líder precisa' : `${quantos} líderes precisam`} de você_\n\n${corpo}`,
        staleIds: toStaleCheck.map(t => t.id),
      };
    }
```

E o `msg` do modo standalone (~linha 2821):

```js
    const _nT = filteredStale.length;
    const msg = `📋 *Governança — quem precisa de você*\n_${dateLabelT} · ${_nT} ${_nT === 1 ? 'atrasada' : 'atrasadas'}${hiddenSuffixT}_\n━━━━━━━━━━━━━━━━━━━━━\n\n${corpo}\n\n━━━━━━━━━━━━━━━━━━━━━\n_Pra cobrar: "cobra [nome] sobre [tarefa]"_`;
```

O `plural` mora em `leader-cards.js` e **não** é importado aqui — usá-lo direto quebraria em runtime.

Remover as variáveis agora órfãs: `ceoBucket`, `byLeader`, `sortedKeys`, `lines`, `fmtItem`, `CATEGORY_LABELS` (o local desta função), `diagnostics`, `byOwner`, `diagnosticsBlock`, `diagSection`, `stuckTasks`, `stuckBlock`, `stuckSection`, `staleCheckBlock`. **Manter** `toStaleCheck` — ele alimenta o `staleIds` e a marcação no banco.

`stuckBlock` (linha 2801) já era **código morto** hoje: definido e nunca usado (quem entra na `msg` é `stuckSection`). Some junto.

- [ ] **Step 2: Verificar sintaxe e caçar órfãs**

```bash
cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js && echo "SINTAXE OK"
grep -n "ceoBucket\|diagnosticsBlock\|stuckBlock\|stuckSection\|sortedKeys" src/rituals/dispatcher.js || echo "ZERO ÓRFÃS"
```

Esperado: `SINTAXE OK` e `ZERO ÓRFÃS`.

- [ ] **Step 3: Rodar a suíte inteira do backend**

```bash
cd /d/la-organizer/_remote && node --test src/ 2>&1 | tail -8
```

Esperado: `fail 0`. Qualquer teste que quebrar aqui é regressão real — **pare e investigue**, não ajuste o teste.

---

### Task 7: Compromissos entram no card e o digest vira UMA seção

**Por que existe:** sem esta task, a **decisão #4 do Alf morre calada**. As Tasks 2 e 4 tratam evento na estrutura e no render, mas a Task 6 passa `events: []` e o `sendGovernanceDigest` segue montando 3 seções (`scorecardSec`, `eventsSec`, `tasksSec`) — a Daiana continuaria aparecendo em 2 lugares e o Clayton num terceiro, que é o fatiamento que este redesenho existe pra matar. Testes todos verdes, feature ausente.

**Files:**
- Modify: `src/rituals/dispatcher.js:2375-2440` (`ceoTeamUnclosedEventsReport` ganha modo `returnData`)
- Modify: `src/rituals/dispatcher.js` (`ceoTeamUnclosedTasksReport` — alimentar `events`)
- Modify: `src/rituals/dispatcher.js:3045-3057` (`sendGovernanceDigest` — 3 seções viram 1)

**Interfaces:**
- Consumes: `buildLeaderCards({ tasks, events, collabs, scorecards, today })` (Task 2); `daysBetweenYmd(todayYmd, dueYmd) → number` de `./leader-cards`.
- Produces: `ceoTeamUnclosedEventsReport(now, { returnData: true }) → Array<{ id, title, collaborator_id, whenLabel }>`.

- [ ] **Step 1: Modo `returnData` no relatório de compromissos**

Não duplicar a query — reaproveitar a que existe. Inserir **logo depois** do guard `if (filteredStale.length === 0) { ... continue; }` (~linha 2440), **antes** do loop `enriched`:

```js
    // Fase 7 — modo DADO: o card por líder agrupa compromisso JUNTO da tarefa, na linha
    // da pessoa (decisão do Alf 16/07: "tudo no card do líder"). Devolve as linhas cruas;
    // quem agrupa é buildLeaderCards. Reaproveita esta query — não duplica.
    if (opts.returnData) {
      return filteredStale.map((ev) => ({
        id: ev.id,
        title: ev.title,
        collaborator_id: ev.collaborator_id,   // ⚠️ NÃO é owner_id
        whenLabel: _evWhenLabel(ev.start_at, sp),
      }));
    }
```

E o helper, acima de `ceoTeamUnclosedEventsReport` (~linha 2374):

```js
// "ontem 14h" (1d) | "seg 10h" (<=7d) | "12/07 10h" (>7d). Sempre America/Sao_Paulo.
// `sv-SE` devolve YYYY-MM-DD já convertido pro fuso — NUNCA toISOString().slice(0,10),
// que desloca o dia depois das 21h BRT.
function _evWhenLabel(startAtIso, sp) {
  const { daysBetweenYmd } = require('./leader-cards');
  const d = new Date(startAtIso);
  const tz = { timeZone: 'America/Sao_Paulo' };
  const hhmm = d.toLocaleTimeString('pt-BR', { ...tz, hour: '2-digit', minute: '2-digit' })
    .replace(':00', 'h').replace(':', 'h');
  const dias = daysBetweenYmd(sp.ymd, d.toLocaleDateString('sv-SE', tz));
  if (dias === 1) return `ontem ${hhmm}`;
  if (dias <= 7) return `${d.toLocaleDateString('pt-BR', { ...tz, weekday: 'short' }).replace('.', '')} ${hhmm}`;
  return `${d.toLocaleDateString('pt-BR', { ...tz, day: '2-digit', month: '2-digit' })} ${hhmm}`;
}
```

- [ ] **Step 2: Alimentar os compromissos no card**

Em `ceoTeamUnclosedTasksReport`, trocar a chamada da Task 6 que passa `events: []`:

```js
    // `force: true` pula o portão de horário do relatório de eventos — quem decide o
    // horário é o orquestrador (sendGovernanceDigest), igual ao modo returnText.
    const evData = await ceoTeamUnclosedEventsReport(now, { returnData: true, force: true });
    const built = buildLeaderCards({
      tasks: filteredStale, events: evData || [], collabs: allCollabs, scorecards: scMap, today: sp.ymd,
    });
```

- [ ] **Step 3: Colapsar as 3 seções em 1**

Em `sendGovernanceDigest` (~linhas 3045-3057), substituir:

```js
    // Fase 7 — UMA seção. O scorecard virou o CABEÇALHO de cada card e os compromissos
    // entraram na linha da pessoa. As 3 seções fatiavam a MESMA pessoa em lugares
    // diferentes (Daiana em 2, Clayton num terceiro) — era isso que lia como desorganizado.
    // Os toggles por pessoa seguem valendo, agora pelas ENTRADAS do card:
    //   show_compromissos=false → events: []  ·  show_scorecard=false → sem % no cabeçalho
    const tasksR = prefs.show_tarefas
      ? await ceoTeamUnclosedTasksReport(now, {
          returnText: true,
          withEvents: prefs.show_compromissos,
          withScorecard: prefs.show_scorecard,
        })
      : null;
    const cardsSec = (tasksR && tasksR.text) || '';
    if (!cardsSec) continue;
```

E o `assembleDigest`:

```js
    const { messages, parts } = assembleDigest({
      header,
      sections: [{ text: cardsSec }],
      footer,
    });
```

Honrar os 2 opts novos dentro de `ceoTeamUnclosedTasksReport` — é o que mantém os toggles vivos sem código extra:

```js
    const evData = opts.withEvents === false
      ? []
      : (await ceoTeamUnclosedEventsReport(now, { returnData: true, force: true })) || [];
    const built = buildLeaderCards({
      tasks: filteredStale,
      events: evData,
      collabs: allCollabs,
      scorecards: opts.withScorecard === false ? new Map() : scMap,  // sem scorecard → closurePct null → sem %
      today: sp.ymd,
    });
```

`buildScorecardDigestSection` e `formatScorecardSection` ficam **órfãos** neste caminho. **Não apagar:** `sendLeaderGovernanceDigest` (~L.3151) ainda usa `formatScorecardSection` pro "🏆 Seu scorecard". Mexer nele está fora de escopo (spec §11).

- [ ] **Step 4: Verificar**

```bash
cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js && echo "SINTAXE OK"
grep -n "eventsSec\|scorecardSec" src/rituals/dispatcher.js
```

Esperado: `SINTAXE OK`. O grep **não pode** achar `eventsSec`/`scorecardSec` dentro de `sendGovernanceDigest` — se achar, a seção velha sobreviveu e a decisão #4 não embarcou.

```bash
cd /d/la-organizer/_remote && node --test src/ 2>&1 | tail -6
```

Esperado: `fail 0`.

---

### Task 8: PWA — o PORT da régua (mesmo commit)

**Por que junto:** `scorecard-classify.ts:2` diz, em comentário, ser PORT de `scorecard-builder.js:202-209`. Mudar um lado sem o outro faz o app e o WhatsApp discordarem sobre a cor da mesma pessoa. Ver `project_governance_viewer_single_source`.

**Files:**
- Modify: `web/src/lib/scorecard-classify.ts`
- Modify: `web/src/lib/scorecard-classify.test.ts`
- Modify: `web/src/components/team/TeamDrillPanel.tsx:79-100`
- Modify: `web/src/hooks/useLeaderScorecards.ts:12` (tipo)

**Interfaces:**
- Consumes: a régua da Task 3 (`classifyCard`) — mesma semântica, tipos TS.
- Produces: `classifyScorecard(sc: ScoreLite) → ScoreBucket` com `closure_rate: number | null`.

- [ ] **Step 1: Escrever os testes que falham**

Append em `web/src/lib/scorecard-classify.test.ts`:

```ts
// Paridade com src/rituals/leader-cards.js → classifyCard. Os dois mudam juntos.
it('guard de null: sem nota e sem pendência → ritmo, NUNCA atencao', () => {
  expect(classifyScorecard({
    closure_rate: null, tasks_closed: 0, tasks_overdue: 0, tasks_stuck: 0,
  })).toBe('ritmo');
});

it('guard de null: sem nota mas com pendência → olhar (não atencao por null < 0.60)', () => {
  expect(classifyScorecard({
    closure_rate: null, tasks_closed: 0, tasks_overdue: 2, tasks_stuck: 0,
  })).toBe('olhar');
});

it('líder afogado nas próprias com time limpo → atencao', () => {
  expect(classifyScorecard({
    closure_rate: 0.2, tasks_closed: 2, tasks_overdue: 8, tasks_stuck: 0,
  })).toBe('atencao');
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
cd /d/la-organizer/_remote/web && npx vitest run src/lib/scorecard-classify.test.ts 2>&1 | tail -8
```

Esperado: falha de tipo (`null` não é `number`) e/ou `atencao` onde devia ser `ritmo`.

- [ ] **Step 3: Implementar o PORT**

Substituir `web/src/lib/scorecard-classify.ts` inteiro:

```ts
// web/src/lib/scorecard-classify.ts
// PORT de src/rituals/leader-cards.js → classifyCard — MESMA régua do digest do TOM.
// Escopo = líder + time (§3.3); % é SEMANAL, contagem é AO VIVO (§7.1).
//   🔴 Atenção: closure < 0.60 OU 3+ atrasadas OU 2+ travadas (precisa ter tarefas)
//   🟡 Olhar:   closure < 0.85 OU 1+ atrasadas (precisa ter tarefas)
//   🟢 Ritmo:   todos os demais (incluindo sem tarefas registradas)

export interface ScoreLite {
  closure_rate: number | null;   // null = SEM NOTA (§7.3). Nunca 1.0 por falta de denominador.
  tasks_closed: number;
  tasks_overdue: number;
  tasks_stuck: number;
}

export type ScoreBucket = 'atencao' | 'olhar' | 'ritmo';

export function classifyScorecard(sc: ScoreLite): ScoreBucket {
  const hasNoTasks = sc.tasks_closed === 0 && sc.tasks_overdue === 0 && sc.tasks_stuck === 0;
  // Guard de null OBRIGATÓRIO: `null < 0.60` é `true` em JS (null coage pra 0) — sem ele
  // todo líder sem nota viraria 'atencao'.
  const badPct = sc.closure_rate !== null && sc.closure_rate < 0.60;
  const midPct = sc.closure_rate !== null && sc.closure_rate < 0.85;
  if (!hasNoTasks && (badPct || sc.tasks_overdue >= 3 || sc.tasks_stuck >= 2)) return 'atencao';
  if (!hasNoTasks && (midPct || sc.tasks_overdue >= 1)) return 'olhar';
  return 'ritmo';
}

// Sem nota não imprime 0% — não imprime nada.
export function pctOf(rate: number | null): number | null {
  return rate === null ? null : Math.round(rate * 100);
}

export const BUCKET_META: Record<ScoreBucket, { dot: string; label: string }> = {
  atencao: { dot: '#ef5b5b', label: 'Atenção' },
  olhar: { dot: '#f5a623', label: 'Olhar de perto' },
  ritmo: { dot: '#3ECF8E', label: 'No ritmo' },
};
```

Em `web/src/hooks/useLeaderScorecards.ts:12`, trocar `closure_rate: number;` por `closure_rate: number | null;`.

- [ ] **Step 4: Consertar os consumidores do `?? 0`**

`TeamDrillPanel.tsx:82` e `LeaderSemaphoreRow.tsx:31` fazem `Math.round((sc.closure_rate ?? 0) * 100)` → o `?? 0` imprime **"0%"** pra quem não tem nota, que é dizer o oposto da verdade.

Em `LeaderSemaphoreRow.tsx`, trocar o import (linha 6) e a linha 31:

```tsx
import { classifyScorecard, BUCKET_META, pctOf } from '../../lib/scorecard-classify';
```

```tsx
  const pct = pctOf(sc.closure_rate);
```

E a célula do `%` (linha 54) passa a mostrar `—` quando não há nota:

```tsx
      <span className="tabular-nums text-fg-secondary shrink-0 w-12 text-right">
        {pct === null ? '—' : `${pct}%`}
      </span>
```

Em `TeamDrillPanel.tsx`, o cabeçalho (linhas 79-97) passa a dizer de que conjunto fala — hoje mostra "Clayton 100%, 0 atrasadas" com o time dele pegando fogo na lista logo abaixo:

```tsx
        {sc ? (
          <div className="flex flex-wrap items-center gap-x-md gap-y-1 text-body-sm">
            {pctOf(sc.closure_rate) !== null && (
              <span className="tabular-nums">
                <span className="text-fg font-semibold">{pctOf(sc.closure_rate)}%</span>
                <span className="text-fg-muted"> fechamento (time + próprias)</span>
              </span>
            )}
            <span className="tabular-nums">
              <span className={sc.tasks_overdue ? 'text-danger font-semibold' : 'text-fg-muted'}>
                {sc.tasks_overdue}
              </span>
              <span className="text-fg-muted"> atrasadas no conjunto</span>
            </span>
            {sc.tasks_stuck > 0 && (
              <span className="tabular-nums">
                <span className="text-warning font-semibold">{sc.tasks_stuck}</span>
                <span className="text-fg-muted"> travadas</span>
              </span>
            )}
          </div>
        ) : (
          <p className="text-body-sm text-fg-muted">Sem scorecard desta semana pra este líder.</p>
        )}
```

Importar `pctOf` junto de `classifyScorecard` nos dois arquivos.

- [ ] **Step 5: Rodar tudo**

```bash
cd /d/la-organizer/_remote/web && npx vitest run src/lib/ 2>&1 | tail -6 && npx tsc --noEmit && npx vite build 2>&1 | tail -3
```

Esperado: vitest `fail 0`, `tsc` sem saída (0 erros), build OK.

---

### Task 9: Dry-run, deploy cirúrgico e commit bundle

**Files:** nenhum novo — validação e deploy.

**Interfaces:**
- Consumes: tudo das Tasks 1-8.
- Produces: produção rodando o card por líder; hold removido.

- [ ] **Step 1: Dry-run contra o dado REAL**

O `sendGovernanceDigest` tem `opts.dryRun` — monta e **retorna sem enviar**. Ninguém recebe nada.

```bash
cd /d/la-organizer/_remote && node -e "
require('dotenv').config();
const d = require('./src/rituals/dispatcher');
d.sendGovernanceDigest(new Date(), { dryRun: true, force: true })
  .then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => { console.error('ERR', e); process.exit(1); });
" 2>&1 | head -80
```

**Conferir na saída, item por item:**
1. A Juliana aparece 🔴 com o Peterson e as 9 atrasadas dele — **é o caso que hoje falha**.
2. O Clayton aparece com a Daiana no time **e** as 4 próprias no bloco "Dele".
3. Ninguém tem `100%` sem ter fechado nada.
4. Nenhuma pessoa aparece em dois cards (varrer os nomes).
5. `parts` = 1 ou 2. Se for 3+, o corte da §7.5 não está segurando — **pare e ajuste antes do deploy**.

- [ ] **Step 2: Contar as tarefas — conservação em produção**

O teste unitário prova a conservação nas fixtures. Isto prova no dado real:

```bash
cd /d/la-organizer/_remote && node -e "
require('dotenv').config();
const sb = require('./src/supabase/client');
sb.from('tasks').select('id', { count: 'exact', head: true })
  .eq('context','work').eq('data_classification','real').eq('status','pending')
  .lt('due_date', new Date().toISOString().slice(0,10))
  .then(r => console.log('atrasadas no banco:', r.count));
"
```

Somar os `· N` de todos os cards + o "Direto com você" da saída do Step 1. A soma **não pode ser maior** que o total do banco (duplicata) — pode ser menor, pelo filtro de "cobradas nas últimas 24h", que é comportamento de hoje e é intencional.

- [ ] **Step 3: Deploy cirúrgico sobre cópia FRESCA**

O `_remote/src` local pode ter divergido da VPS (outro chat). Nunca sobrescrever a VPS às cegas.

```bash
cd /d/la-organizer/_remote && for f in src/services/leader-routing.js src/rituals/leader-cards.js \
  src/services/scorecard-builder.js src/rituals/dispatcher.js src/rituals/monday-scorecard.js; do
  ssh tom "md5sum /opt/LA-Organizer/$f 2>/dev/null || echo 'AUSENTE $f'"; done
```

Para cada arquivo **que este plano NÃO criou** (`leader-cards.js` é novo): se o md5 da VPS não bater com o md5 do arquivo **antes** das minhas mudanças, outro chat mexeu — **pare** e refaça os hunks sobre a cópia fresca da VPS.

```bash
cd /d/la-organizer/_remote && for f in src/services/leader-routing.js src/rituals/leader-cards.js \
  src/services/scorecard-builder.js src/rituals/dispatcher.js src/rituals/monday-scorecard.js; do
  scp "$f" "tom:/opt/LA-Organizer/$f"; done
ssh tom "cd /opt/LA-Organizer && for f in src/services/leader-routing.js src/rituals/leader-cards.js \
  src/services/scorecard-builder.js src/rituals/dispatcher.js src/rituals/monday-scorecard.js; do
  node --check \$f && echo \"OK \$f\"; done"
```

Esperado: `OK` nos 5.

- [ ] **Step 4: md5 VPS == local ANTES do restart**

```bash
cd /d/la-organizer/_remote && md5sum src/services/leader-routing.js src/rituals/leader-cards.js \
  src/services/scorecard-builder.js src/rituals/dispatcher.js src/rituals/monday-scorecard.js
ssh tom "cd /opt/LA-Organizer && md5sum src/services/leader-routing.js src/rituals/leader-cards.js \
  src/services/scorecard-builder.js src/rituals/dispatcher.js src/rituals/monday-scorecard.js"
```

Esperado: os 5 hashes **idênticos** nos dois lados. Divergiu → **não reinicia**. Investiga.

- [ ] **Step 5: Restart e log limpo**

```bash
ssh tom "pm2 restart tom && sleep 3 && pm2 logs tom --lines 30 --nostream" 2>&1 | tail -20
```

Esperado: boot sem exceção. O log REAL do TOM é `/opt/LA-Organizer/logs/` — `/root/.pm2/logs` está MORTO e daria um falso-zero:

```bash
ssh tom "tail -30 /opt/LA-Organizer/logs/*.log 2>/dev/null | grep -i 'error\|leader-cards\|GovDigest' | tail -10"
```

- [ ] **Step 6: Remover o hold e commitar o bundle**

O hold sai **por último**. Enquanto ele existir, o Stop hook não commita nada (`auto-deploy.ps1:20-23` → `exit 0`).

```bash
rm /d/la-organizer/.deploy-hold && ls /d/la-organizer/.deploy-hold 2>&1 | head -1
```

Esperado: `No such file or directory`. Encerrar o turno: o Stop hook commita `_remote/` (inclusive `web/`), pusha, e a Vercel builda o PWA em ~2min.

- [ ] **Step 7: Registrar o known-issue**

Todo bug corrigido termina registrado (`CLAUDE.md` → Protocolo de bugs).

```sql
INSERT INTO tom_known_issues
  (codigo, titulo, area, severidade, status, causa_raiz, fix_resumo, sinal_tipo, sinal_padrao,
   colaboradores_afetados, primeira_vez, ultima_vez, ocorrencias, corrigido_em)
VALUES
  ('GOVDIGEST-SCORECARD-EXECUTOR', 'Scorecard de governança media o líder como executor, não como gestor',
   'dispatcher', 'alto', 'corrigido',
   'scorecard-builder.js:49/58 filtravam .eq(assigned_to, leaderId): o time NUNCA entrava na conta. As 9 atrasadas do Peterson (collaborator, sem scorecard) não pintavam a Juliana, líder dele. Somado a dispatcher.js:2705 (days>=3 -> ceoBucket), que jogava fora o vínculo com o líder justamente nas tarefas graves, e a 4 blocos organizando as MESMAS tarefas em 4 eixos (idade/pessoa/cobrança/staleness) -> o CEO parou de ler o relatório.',
   'Card por líder (leader-cards.js, puro+TDD): 1 eixo só. Escopo do scorecard = líder + time do líder principal. closure_rate null (não 1.0) quando sem denominador. Desempate determinístico em resolveLeadersOf (o loader não tem ORDER BY -> o líder principal trocava sozinho).',
   'manual', 'scorecard mostra % do líder divergente da soma do card; líder 100% com time atrasado',
   ARRAY['Alf','Juliana','Quintela','Clayton','Yuri'], '2026-06-01', '2026-07-16', 1, now());
```

- [ ] **Step 8: Confirmar a entrega de verdade**

O digest sai às 9h. No dia seguinte, checar que o Alf **recebeu** (não só que o cron rodou):

```bash
ssh tom "grep -i 'GovDigest\|governance_digest' /opt/LA-Organizer/logs/*.log | tail -10"
```

E perguntar ao Alf se o card do Clayton está printável como ele queria. **A prova é ele conseguir printar e mandar** — não o teste verde.

---

## Notas de risco

- **Ordem das tasks importa.** A Task 5 depende do desempate da Task 1: sem ele, o `scope` do `computeScorecard` muda sozinho a cada `VACUUM` e o scorecard oscila sem ninguém mexer em nada.
- **Task 5 Step 3 é o silencioso.** Se `allCollabs` não for passado, `resolveLeadersOf(c, [])` devolve `[]`, `scope` volta a ser só o líder e **a mudança inteira vira no-op** — com todos os testes verdes. Conferir no dry-run que a Juliana aparece com o time, não só com as 2 próprias.
- **A mensagem de segunda dos 10 líderes muda** (`monday-scorecard.js` bebe do mesmo `leader_scorecards`). O Alf **já aprovou** em 16/07: hoje ela diz "Juliana, 2 atrasadas" enquanto o time dela tem 11 — ela está sendo elogiada pelo errado.
- **`_pronome()` devolve "Dele" fixo.** Não há campo de gênero no banco. Isso é decisão de VOZ e a voz é do Alf: se ele quiser "Dela" pra Juliana/Krissya/Rose, o campo tem que existir antes. Não inventar heurística por nome.
