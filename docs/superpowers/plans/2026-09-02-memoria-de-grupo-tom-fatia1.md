# Memória de grupo do TOM — Fatia 1 (escrever sem ler) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o TOM passa a guardar memória estruturada de cada grupo de trabalho, consolidada toda noite pelo Dream — sem ainda ler nada de volta.

**Architecture:** tabela `group_memory` espelhando `collaborator_memory` (mesmo vocabulário, mesmo `embedding`), com o *código* compartilhado num módulo único (`agent-memory.js`). A consolidação entra no laço de grupos que o Dream **já percorre** às 3h — hoje ele só chama o auditor. O caminho 1:1 não é reescrito: apenas o helper `looksLikeMemory` sai do `engine.js` para o módulo, e o engine passa a importá-lo (uma implementação, dois consumidores, zero drift).

**Tech Stack:** Node 22 (CommonJS), `node:test`, Supabase JS (service role), pgvector `vector(1536)`, `getEmbedding` de `src/services/embeddings.js`.

**Spec:** `docs/superpowers/specs/2026-09-02-memoria-de-grupo-tom-design.md`

## Global Constraints

- **Repo vive na VPS.** Todo comando roda via `ssh tom` com `cd /opt/LA-Organizer`. Não há checkout local.
- **Suíte:** `node --env-file=.env --test src/`. O baseline tem **3 falhas pré-existentes** em `system-loadout` — elas NÃO contam como regressão. Sem `--env-file=.env` o resultado é lixo.
- **Esta fatia NÃO toca no prompt.** Nada em `group-chat-prompt.js` nem em `group-chat-engine.js`. O TOM guarda e não lê. Ler é a Fatia 2.
- **Não reescrever o caminho 1:1.** A única mudança em `engine.js` permitida aqui é remover a definição local de `looksLikeMemory` e importá-la do módulo novo.
- **Memória é isolada por grupo.** Nenhuma consulta pode cruzar `group_id`.
- **`lesson` nasce `is_active = false` e `approved_at = null`.** `fact`, `decision`, `context` e `preference` nascem `is_active = true`.
- **Teto de 8 candidatas por grupo por noite.** Janela de **24 horas**.
- **Piso:** só consolida grupo com mensagem nas últimas 24h.
- **Nunca gravar credencial.** Candidata cujo `content` menciona senha/token/API key é descartada. `evidence` é truncado em 200 chars.
- **Anti-vacuidade:** dia sem conteúdo real devolve zero candidatas. Nunca inventar memória para justificar a rodada.
- **Sensor obrigatório:** toda rodada registra o que aconteceu. Zero por falha não pode ser indistinguível de zero por dia tranquilo.
- **Commits em português**, no estilo do repo (`feat(...)`, `fix(...)`), terminando com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Estrutura de arquivos

| arquivo | responsabilidade |
|---|---|
| `migrations/2026-09-02-group-memory.sql` (criar) | tabela `group_memory` + índices |
| `src/services/agent-memory.js` (criar) | lógica compartilhada e **table-agnostic**: semelhança de memória, filtro de credencial, teto, defaults por tipo |
| `src/services/agent-memory.test.js` (criar) | testes puros do módulo |
| `src/services/group-memory.js` (criar) | extrator com prompt de GRUPO + `consolidateGroupMemoryFor` |
| `src/services/group-memory.test.js` (criar) | testes do consolidador com dublês |
| `src/engine.js` (modificar, ~14380) | remove `looksLikeMemory` local, importa do módulo |
| `src/rituals/dispatcher.js` (modificar, ~3944) | chama o consolidador no laço de grupos que já existe |
| `scripts/dry-run-memoria-grupo.js` (criar) | prova contra histórico real, sem gravar |

---

## Task 1: Tabela `group_memory`

**Files:**
- Create: `migrations/2026-09-02-group-memory.sql`

**Interfaces:**
- Consumes: nada.
- Produces: tabela `public.group_memory` com as colunas usadas pelas Tasks 3 e 5.

- [ ] **Step 1: Escrever a migration**

Crie `migrations/2026-09-02-group-memory.sql`:

```sql
-- group_memory — memória do TOM por GRUPO de trabalho.
-- Espelha collaborator_memory (mesmo vocabulário de memory_type/importance/decay_at/embedding)
-- e acrescenta occurred_on (o dia da conversa), evidence (o trecho literal que originou) e
-- approved_at (o gate das lições: lesson nasce is_active=false e só entra no prompt aprovada).
create table if not exists public.group_memory (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid not null references public.work_groups(id) on delete cascade,
  memory_type  text not null check (memory_type in ('fact','decision','lesson','preference','context')),
  content      text not null,
  importance   text not null default 'normal' check (importance in ('critical','high','normal','low')),
  decay_at     timestamptz,
  is_active    boolean not null default true,
  approved_at  timestamptz,
  occurred_on  date not null,
  evidence     text,
  source       text,
  embedding    vector(1536),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_group_memory_group_active on public.group_memory (group_id, is_active);
create index if not exists idx_group_memory_group_type   on public.group_memory (group_id, memory_type);
create index if not exists idx_group_memory_occurred     on public.group_memory (group_id, occurred_on desc);
create index if not exists idx_group_memory_fts          on public.group_memory using gin (to_tsvector('portuguese', content));
create index if not exists idx_group_memory_embedding    on public.group_memory using ivfflat (embedding vector_cosine_ops) with (lists = '10');

alter table public.group_memory enable row level security;
```

- [ ] **Step 2: Aplicar a migration**

Aplique o conteúdo do arquivo no projeto Supabase `cesnbnrynvxvgdhfmaua` (via MCP `apply_migration`, nome `group_memory_fatia1`).

- [ ] **Step 3: Verificar o schema**

Rode:

```sql
select column_name, data_type from information_schema.columns
where table_schema='public' and table_name='group_memory' order by ordinal_position;
```

Esperado: 14 colunas, incluindo `occurred_on` (date), `evidence` (text), `approved_at` (timestamp with time zone) e `embedding` (USER-DEFINED).

- [ ] **Step 4: Commit**

```bash
git add migrations/2026-09-02-group-memory.sql
git commit -m "feat(memoria): tabela group_memory — espelho da collaborator_memory com dia, evidencia e gate de licao"
```

---

## Task 2: Módulo compartilhado `agent-memory.js`

**Files:**
- Create: `src/services/agent-memory.js`
- Create: `src/services/agent-memory.test.js`
- Modify: `src/engine.js` (~14380, onde `looksLikeMemory` é definida)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `looksLikeMemory(a, b, threshold = 0.6) -> boolean`
  - `pareceCredencial(texto) -> boolean`
  - `defaultsPorTipo(memory_type) -> { is_active: boolean }`
  - `prepararCandidatas(candidatas, existentes, { teto = 8 }) -> { aceitas, descartadas: { duplicata, credencial, invalida, teto } }`

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/services/agent-memory.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  looksLikeMemory, pareceCredencial, defaultsPorTipo, prepararCandidatas,
} = require('./agent-memory');

// looksLikeMemory saiu do engine.js VERBATIM — estes testes congelam o comportamento
// que o caminho 1:1 já dependia, pra extração não mudar nada por acidente.
test('looksLikeMemory: mesma ideia com outras palavras de ligação casa', () => {
  assert.strictEqual(looksLikeMemory('prefere reuniões curtas de manhã', 'prefere reunioes curtas manha'), true);
});
test('looksLikeMemory: assuntos diferentes não casam', () => {
  assert.strictEqual(looksLikeMemory('mora em Campo Grande', 'toca violão desde 2019'), false);
});
test('looksLikeMemory: vazio nunca casa', () => {
  assert.strictEqual(looksLikeMemory('', 'qualquer coisa'), false);
});

// Memória entra em prompt. Credencial não pode virar memória — vira ficha com campo secreto.
test('pareceCredencial pega senha/token/api key', () => {
  for (const t of ['a senha do Zoho é 1234', 'token de acesso do sistema', 'API key da integração', 'guardar credencial nova']) {
    assert.strictEqual(pareceCredencial(t), true, t);
  }
});
test('pareceCredencial NÃO pega conversa normal', () => {
  for (const t of ['contrato do Kaique não sai', 'a Daiana faz a matrícula', 'reunião toda segunda']) {
    assert.strictEqual(pareceCredencial(t), false, t);
  }
});

// O gate do Alf: lição vira REGRA de comportamento, então nasce desligada.
test('lesson nasce inativa; os outros tipos nascem ativos', () => {
  assert.strictEqual(defaultsPorTipo('lesson').is_active, false);
  for (const t of ['fact', 'decision', 'context', 'preference']) {
    assert.strictEqual(defaultsPorTipo(t).is_active, true, t);
  }
});

test('prepararCandidatas descarta duplicata, credencial e inválida, e respeita o teto', () => {
  const candidatas = [
    { memory_type: 'fact', content: 'a Daiana faz as matrículas', importance: 'normal' },
    { memory_type: 'fact', content: 'A DAIANA FAZ AS MATRICULAS', importance: 'high' },
    { memory_type: 'fact', content: 'a senha do Zoho mudou', importance: 'high' },
    { memory_type: 'invalido', content: 'tipo que não existe', importance: 'normal' },
    { memory_type: 'decision', content: 'sem conteúdo válido', importance: 'normal' },
  ];
  const r = prepararCandidatas(candidatas, ['a daiana faz as matriculas'], { teto: 8 });
  assert.strictEqual(r.descartadas.duplicata, 2, 'a existente e a repetida entre si');
  assert.strictEqual(r.descartadas.credencial, 1);
  assert.strictEqual(r.descartadas.invalida, 1);
  assert.deepStrictEqual(r.aceitas.map((c) => c.content), ['sem conteúdo válido']);
});

test('prepararCandidatas corta no teto e conta o corte', () => {
  const muitas = Array.from({ length: 12 }, (_, i) => ({ memory_type: 'fact', content: `assunto distinto numero ${i}`, importance: 'normal' }));
  const r = prepararCandidatas(muitas, [], { teto: 8 });
  assert.strictEqual(r.aceitas.length, 8);
  assert.strictEqual(r.descartadas.teto, 4);
});

test('anti-vacuidade: lista vazia devolve vazio sem inventar', () => {
  const r = prepararCandidatas([], [], { teto: 8 });
  assert.deepStrictEqual(r.aceitas, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/agent-memory.test.js 2>&1 | tail -5"
```

Esperado: FAIL — `Cannot find module './agent-memory'`.

- [ ] **Step 3: Escrever o módulo**

Crie `src/services/agent-memory.js`:

```js
'use strict';
// agent-memory.js — a lógica de memória que NÃO depende de tabela.
// Serve o sujeito PESSOA (collaborator_memory) e o sujeito GRUPO (group_memory).
// Nasceu extraindo `looksLikeMemory` do engine.js: uma implementação, dois consumidores,
// zero drift — que é a doença crônica deste repo quando duas superfícies copiam a mesma regra.

const TIPOS_VALIDOS = new Set(['fact', 'decision', 'lesson', 'preference', 'context']);

// VERBATIM do engine.js (~14380). Não mexer sem atualizar os testes de congelamento.
function looksLikeMemory(a, b, threshold = 0.6) {
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/)
    .filter((w) => w.length >= 4);
  const wa = new Set(norm(a));
  const wb = new Set(norm(b));
  if (!wa.size || !wb.size) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const union = wa.size + wb.size - inter;
  return union > 0 && inter / union >= threshold;
}

// Memória entra em PROMPT. O chat de grupo carrega senha e token; isso é ficha com campo
// secreto, nunca memória. Filtro conservador por palavra-chave: falso positivo aqui só custa
// uma memória a menos, falso negativo custa credencial vazando pro contexto do modelo.
const CREDENCIAL_RE = /\b(senhas?|passwords?|passwd|tokens?|api[\s_-]?keys?|secret|credenciais?|credencial|cvv)\b/i;
function pareceCredencial(texto) {
  return CREDENCIAL_RE.test(String(texto || ''));
}

// O freio do Alf: `lesson` vira REGRA de comportamento, então nasce DESLIGADA e só entra no
// prompt com aprovação. Os outros tipos são registro do que foi dito — risco baixo, entram.
function defaultsPorTipo(memoryType) {
  return { is_active: memoryType !== 'lesson' };
}

function prepararCandidatas(candidatas, existentes, opts = {}) {
  const teto = Number.isFinite(opts.teto) ? opts.teto : 8;
  const jaVistas = (existentes || []).map((e) => (e && e.content) || e).filter(Boolean);
  const descartadas = { duplicata: 0, credencial: 0, invalida: 0, teto: 0 };
  const aceitas = [];

  for (const c of (candidatas || [])) {
    const content = c && typeof c.content === 'string' ? c.content.trim() : '';
    if (!content || !TIPOS_VALIDOS.has(c.memory_type)) { descartadas.invalida++; continue; }
    if (pareceCredencial(content)) { descartadas.credencial++; continue; }
    if (jaVistas.some((t) => looksLikeMemory(content, t))) { descartadas.duplicata++; continue; }
    if (aceitas.length >= teto) { descartadas.teto++; continue; }
    aceitas.push(c);
    jaVistas.push(content); // a próxima candidata compara contra esta também
  }
  return { aceitas, descartadas };
}

module.exports = { looksLikeMemory, pareceCredencial, defaultsPorTipo, prepararCandidatas, TIPOS_VALIDOS };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/agent-memory.test.js 2>&1 | grep -E '^# (tests|pass|fail)'"
```

Esperado: `pass 8`, `fail 0`.

- [ ] **Step 5: Engine passa a importar (remove a cópia)**

> A spec previa um *teste de paridade* entre o módulo e a lógica 1:1. Este passo faz melhor e
> torna o teste desnecessário: em vez de duas implementações que precisam ser comparadas, passa
> a existir **uma só**, e o engine a consome. Os testes de congelamento do Step 1 é que guardam
> o comportamento herdado.

Em `src/engine.js`, apague **inteira** a função `looksLikeMemory` (começa em `function looksLikeMemory(a, b, threshold = 0.6) {`, ~linha 14380, e termina no `}` da linha ~14392) e ponha no lugar:

```js
// looksLikeMemory mora em services/agent-memory.js desde 02/09 — a mesma regra serve a memória
// de PESSOA e a de GRUPO. Duas cópias é como nasce drift.
const { looksLikeMemory } = require('./services/agent-memory');
```

- [ ] **Step 6: Provar que o 1:1 não mudou**

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/engine.js && grep -c 'looksLikeMemory' src/engine.js && timeout 560 node --env-file=.env --test src/ 2>&1 | grep -E '^# (tests|pass|fail)'"
```

Esperado: sintaxe ok; `looksLikeMemory` aparece **3** vezes (1 require + 2 usos); suíte com as mesmas 3 falhas de `system-loadout` e nenhuma nova.

- [ ] **Step 7: Commit**

```bash
git add src/services/agent-memory.js src/services/agent-memory.test.js src/engine.js
git commit -m "feat(memoria): modulo agent-memory compartilhado — looksLikeMemory sai do engine, filtro de credencial e gate de licao"
```

---

## Task 3: Consolidador de grupo

**Files:**
- Create: `src/services/group-memory.js`
- Create: `src/services/group-memory.test.js`

**Interfaces:**
- Consumes: `prepararCandidatas`, `defaultsPorTipo` de `./agent-memory`; `getEmbedding` de `./embeddings`.
- Produces:
  - `montarHistorico(mensagens) -> string`
  - `extrairMemoriaDeGrupo({ groupName, historyText, existentes, chat }) -> Promise<Array<{memory_type, content, importance, decay_at, evidence}>>`
  - `consolidateGroupMemoryFor({ supabase, group, chat, getEmbedding, agora }) -> Promise<{ mensagens, candidatas, salvas, descartadas, erro }>`

- [ ] **Step 1: Escrever os testes que falham**

Crie `src/services/group-memory.test.js`:

```js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { montarHistorico, extrairMemoriaDeGrupo, consolidateGroupMemoryFor } = require('./group-memory');

const GRUPO = { id: 'g1', name: 'Administração Recreio' };

function fakeSupabase({ mensagens = [], existentes = [], insertErro = null } = {}) {
  const inseridas = [];
  return {
    _inseridas: inseridas,
    from(tbl) {
      const q = {
        select: () => q, eq: () => q, gte: () => q, order: () => q, is: () => q,
        insert: async (row) => { inseridas.push(row); return { error: insertErro }; },
        then: (ok) => ok({ data: tbl === 'group_chat_messages' ? mensagens : existentes, error: null }),
      };
      return q;
    },
  };
}

const semEmbedding = async () => { throw new Error('sem embedding no teste'); };

test('montarHistorico identifica quem falou e ignora linha vazia', () => {
  const txt = montarHistorico([
    { role: 'member', content: 'Tom, temos 6 contratos', sender: { full_name: 'Clayton' } },
    { role: 'tom', content: 'Criei os lembretes' },
    { role: 'member', content: '   ', sender: { full_name: 'Fefê' } },
  ]);
  assert.match(txt, /Clayton: Tom, temos 6 contratos/);
  assert.match(txt, /TOM: Criei os lembretes/);
  assert.doesNotMatch(txt, /Fefê/);
});

test('PISO: grupo sem mensagem em 24h não chama LLM nem grava', async () => {
  const sb = fakeSupabase({ mensagens: [] });
  let chamou = false;
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO, chat: async () => { chamou = true; return '[]'; },
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.strictEqual(chamou, false, 'não pode gastar LLM em grupo parado');
  assert.strictEqual(r.salvas, 0);
  assert.strictEqual(sb._inseridas.length, 0);
});

test('ANTI-VACUIDADE: LLM devolve lista vazia → zero memórias, sem inventar', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'bom dia', sender: { full_name: 'Fefê' } }] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO, chat: async () => '[]',
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.strictEqual(r.salvas, 0);
  assert.strictEqual(sb._inseridas.length, 0);
  assert.strictEqual(r.erro, null);
});

test('grava com occurred_on do DIA da conversa e source do dia da rodada', async () => {
  // A conversa foi 02/09 17h BRT; a rodada do Dream é 03/09 03h BRT. occurred_on tem que ser
  // o dia da CONVERSA — senão toda memória nasce datada da madrugada seguinte.
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'o contrato do Kaique não sai', created_at: '2026-09-02T20:00:00Z', sender: { full_name: 'Clayton' } }] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([{ memory_type: 'decision', content: 'contrato do Kaique nao sai: aluno em aviso previo', importance: 'high', evidence: 'o contrato do Kaique não sai' }]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  const row = sb._inseridas[0];
  assert.strictEqual(row.group_id, 'g1');
  assert.strictEqual(row.occurred_on, '2026-09-02', 'o dia da CONVERSA, não o da rodada');
  assert.strictEqual(row.source, 'dream:2026-09-03');
  assert.strictEqual(row.evidence, 'o contrato do Kaique não sai');
});

test('GATE: lesson entra inativa; decision entra ativa', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'x', sender: { full_name: 'Clayton' } }] });
  await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([
      { memory_type: 'lesson', content: 'nao cobrar contrato de aluno em aviso previo', importance: 'high' },
      { memory_type: 'decision', content: 'ficam 5 contratos para assinar nesta semana', importance: 'normal' },
    ]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  const licao = sb._inseridas.find((r) => r.memory_type === 'lesson');
  const decisao = sb._inseridas.find((r) => r.memory_type === 'decision');
  assert.strictEqual(licao.is_active, false);
  assert.strictEqual(licao.approved_at, null);
  assert.strictEqual(decisao.is_active, true);
});

test('SEM SEGREDO: candidata com senha não é gravada', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'x', sender: { full_name: 'Clayton' } }] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO,
    chat: async () => JSON.stringify([{ memory_type: 'fact', content: 'a senha do Zoho e 1234', importance: 'high' }]),
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.strictEqual(sb._inseridas.length, 0);
  assert.strictEqual(r.descartadas.credencial, 1);
});

test('SENSOR: LLM que quebra devolve erro, não silêncio', async () => {
  const sb = fakeSupabase({ mensagens: [{ role: 'member', content: 'x', sender: { full_name: 'Clayton' } }] });
  const r = await consolidateGroupMemoryFor({
    supabase: sb, group: GRUPO, chat: async () => { throw new Error('provider caiu'); },
    getEmbedding: semEmbedding, agora: new Date('2026-09-03T06:00:00Z'),
  });
  assert.match(r.erro, /provider caiu/);
  assert.strictEqual(r.salvas, 0);
});

test('extrairMemoriaDeGrupo devolve [] quando o modelo responde prosa', async () => {
  const out = await extrairMemoriaDeGrupo({
    groupName: 'X', historyText: 'oi', existentes: [], chat: async () => 'não consegui, desculpa',
  });
  assert.deepStrictEqual(out, []);
});
```

- [ ] **Step 2: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/group-memory.test.js 2>&1 | tail -5"
```

Esperado: FAIL — `Cannot find module './group-memory'`.

- [ ] **Step 3: Escrever o consolidador**

Crie `src/services/group-memory.js`:

```js
'use strict';
// group-memory.js — o TOM guarda o que o GRUPO conversou.
//
// Por que existe: a memória semântica do TOM (collaborator_memory + Dream das 3h) sempre teve
// sujeito PESSOA. O Dream JÁ percorre os grupos no mesmo laço, mas só chama o auditor — ele
// julga o grupo e não guarda nada dele. Esta é a metade que faltava.
//
// Fatia 1: só ESCREVE. Nada aqui entra no prompt — ler é a Fatia 2, depois de o Alf conferir
// o que foi guardado.

const { prepararCandidatas, defaultsPorTipo } = require('./agent-memory');

const JANELA_HORAS = 24;   // grupo de trabalho conversa todo dia (o 1:1 usa 7d por outro motivo)
const TETO_POR_NOITE = 8;  // grupo movimentado não pode afogar a memória em uma noite
const EVIDENCE_MAX = 200;

function ymdEmSaoPaulo(date) {
  return new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function montarHistorico(mensagens) {
  return (mensagens || [])
    .map((m) => {
      const texto = String((m && m.content) || '').trim();
      if (!texto) return null;
      const quem = m.role === 'tom' ? 'TOM' : ((m.sender && (m.sender.full_name || m.sender.preferred_name)) || 'alguém');
      return `${quem}: ${texto}`;
    })
    .filter(Boolean)
    .join('\n');
}

async function extrairMemoriaDeGrupo({ groupName, historyText, existentes, chat }) {
  const jaSei = (existentes || []).slice(0, 30)
    .map((m) => `[${m.memory_type}/${m.importance}] ${m.content}`).join('\n') || '(nada ainda)';

  const sys = `Você extrai memória durável do grupo de trabalho "${groupName}".
Recebe a conversa do dia e o que já está guardado. Identifique até 5 itens NOVOS que valham a pena lembrar daqui a meses.

Tipos (use exatamente um):
- fact: dado concreto e duradouro do grupo (quem faz o quê, como funciona)
- decision: decisão tomada pelo time
- lesson: padrão/combinado de como agir (vira REGRA — só use quando o time corrigiu ou combinou algo)
- preference: forma de trabalhar do grupo
- context: situação temporária (SEMPRE defina decay_at)

Importance: critical | high | normal | low

REGRAS:
- NÃO invente. Se o dia não teve nada digno, devolva [].
- NUNCA guarde senha, token, chave ou credencial.
- Cada item traz "evidence": o trecho LITERAL da conversa que originou. Sem trecho, não é memória.
- Não repita o que já está guardado.

O que já está guardado:
${jaSei}

Saída OBRIGATÓRIA: array JSON puro, sem texto antes ou depois. Vazio se nada digno:
[{"memory_type":"decision","content":"...","importance":"high","evidence":"...","decay_at":null}]`;

  let raw;
  try {
    raw = await chat(sys, [{ role: 'user', content: historyText }]);
  } catch (e) {
    throw e; // quem chama registra — silêncio aqui vira zero indistinguível de dia tranquilo
  }
  const texto = (raw && typeof raw === 'object') ? (raw.text != null ? raw.text : JSON.stringify(raw)) : raw;
  if (!texto) return [];
  try {
    const m = String(texto).match(/\[[\s\S]*\]/);
    const arr = JSON.parse(m ? m[0] : texto);
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return []; // prosa em vez de JSON = nada extraído (nunca inventar)
  }
}

async function consolidateGroupMemoryFor({ supabase, group, chat, getEmbedding, agora = new Date() }) {
  const desde = new Date(agora.getTime() - JANELA_HORAS * 3600 * 1000).toISOString();
  const out = { mensagens: 0, candidatas: 0, salvas: 0, descartadas: null, erro: null };

  const { data: msgs } = await supabase.from('group_chat_messages')
    .select('role, content, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .eq('group_id', group.id).gte('created_at', desde).order('created_at', { ascending: true });

  const mensagens = msgs || [];
  out.mensagens = mensagens.length;
  if (!mensagens.length) return out; // PISO: grupo parado não gasta LLM

  const historyText = montarHistorico(mensagens);
  if (!historyText) return out;

  const { data: exist } = await supabase.from('group_memory')
    .select('content, memory_type, importance').eq('group_id', group.id).eq('is_active', true);
  const existentes = exist || [];

  let candidatas = [];
  try {
    candidatas = await extrairMemoriaDeGrupo({ groupName: group.name, historyText, existentes, chat });
  } catch (e) {
    out.erro = e.message;
    return out;
  }
  out.candidatas = candidatas.length;

  const { aceitas, descartadas } = prepararCandidatas(candidatas, existentes, { teto: TETO_POR_NOITE });
  out.descartadas = descartadas;

  const diaRodada = ymdEmSaoPaulo(agora);
  const diaConversa = ymdEmSaoPaulo(new Date(mensagens[mensagens.length - 1].created_at || agora));

  for (const c of aceitas) {
    let embedding = null;
    try { embedding = await getEmbedding(c.content); }
    catch (e) { console.warn('[GroupMemory] embedding err (grava sem):', e.message); }

    const { error } = await supabase.from('group_memory').insert({
      group_id: group.id,
      memory_type: c.memory_type,
      content: c.content,
      importance: c.importance || 'normal',
      decay_at: c.decay_at || null,
      occurred_on: diaConversa,
      evidence: c.evidence ? String(c.evidence).slice(0, EVIDENCE_MAX) : null,
      source: `dream:${diaRodada}`,
      is_active: defaultsPorTipo(c.memory_type).is_active,
      approved_at: null,
      ...(embedding ? { embedding } : {}),
    });
    if (error) { out.erro = error.message; console.error('[GroupMemory] insert err:', error.message); }
    else out.salvas++;
  }
  return out;
}

module.exports = { montarHistorico, extrairMemoriaDeGrupo, consolidateGroupMemoryFor, JANELA_HORAS, TETO_POR_NOITE };
```

- [ ] **Step 4: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/group-memory.test.js 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'"
```

Esperado: `pass 8`, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/services/group-memory.js src/services/group-memory.test.js
git commit -m "feat(memoria): consolidador de memoria de grupo — janela 24h, teto 8, licao inativa, sem credencial"
```

---

## Task 4: Prova em dry-run contra o Recreio

**Files:**
- Create: `scripts/dry-run-memoria-grupo.js`

**Interfaces:**
- Consumes: `montarHistorico`, `extrairMemoriaDeGrupo` de `../src/services/group-memory`.
- Produces: script CLI que imprime o que SERIA gravado. Não escreve nada.

- [ ] **Step 1: Escrever o script**

Crie `scripts/dry-run-memoria-grupo.js`:

```js
'use strict';
// Roda o extrator contra a conversa REAL de um grupo e imprime o que SERIA gravado.
// Não escreve nada. Uso:
//   node --env-file=.env scripts/dry-run-memoria-grupo.js <group_id> [horas]
const { createClient } = require('@supabase/supabase-js');
const { montarHistorico, extrairMemoriaDeGrupo } = require('../src/services/group-memory');
const { prepararCandidatas } = require('../src/services/agent-memory');

(async () => {
  const groupId = process.argv[2];
  const horas = Number(process.argv[3] || 24);
  if (!groupId) { console.error('uso: node --env-file=.env scripts/dry-run-memoria-grupo.js <group_id> [horas]'); process.exit(1); }

  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data: group } = await sb.from('work_groups').select('id, name').eq('id', groupId).maybeSingle();
  if (!group) { console.error('grupo não encontrado'); process.exit(1); }

  const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString();
  const { data: msgs } = await sb.from('group_chat_messages')
    .select('role, content, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)')
    .eq('group_id', groupId).gte('created_at', desde).order('created_at', { ascending: true });

  const historyText = montarHistorico(msgs || []);
  console.log(`grupo: ${group.name} | mensagens na janela de ${horas}h: ${(msgs || []).length}`);
  if (!historyText) { console.log('(nada a extrair)'); process.exit(0); }

  const { data: exist } = await sb.from('group_memory')
    .select('content, memory_type, importance').eq('group_id', groupId).eq('is_active', true);

  const chat = require('../src/ai/claude').chat;
  const candidatas = await extrairMemoriaDeGrupo({ groupName: group.name, historyText, existentes: exist || [], chat });
  const { aceitas, descartadas } = prepararCandidatas(candidatas, exist || [], { teto: 8 });

  console.log(`\ncandidatas: ${candidatas.length} | aceitas: ${aceitas.length} | descartadas:`, descartadas);
  for (const c of aceitas) {
    const gate = c.memory_type === 'lesson' ? '  [CANDIDATA — precisa do seu ok]' : '';
    console.log(`\n- [${c.memory_type}/${c.importance}]${gate}\n  ${c.content}\n  evidência: "${String(c.evidence || '').slice(0, 200)}"`);
  }
  console.log('\n(dry-run: NADA foi gravado)');
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
```

- [ ] **Step 2: Rodar contra o Recreio e mostrar ao Alf**

```bash
ssh tom "cd /opt/LA-Organizer && timeout 180 node --env-file=.env scripts/dry-run-memoria-grupo.js d7150e99-e16f-4240-8a9d-4a5b6060dd6a 24"
```

Esperado: lista as candidatas da conversa real de 02/09 (os 5 contratos, o Kaique, o pedido do Clayton) e termina em `(dry-run: NADA foi gravado)`.

**PARE AQUI e mostre a saída ao Alf.** Se o extrator estiver tirando bobagem, ajuste o prompt em `extrairMemoriaDeGrupo` e rode de novo — custo zero, nenhuma linha no banco. Só siga para a Task 5 com o ok dele.

- [ ] **Step 3: Commit**

```bash
git add scripts/dry-run-memoria-grupo.js
git commit -m "feat(memoria): dry-run do extrator de grupo — prova contra conversa real sem gravar"
```

---

## Task 5: Ligar no Dream

**Files:**
- Modify: `src/rituals/dispatcher.js` (~3944, o laço `for (const g of (grupos || []))` que hoje só audita)

**Interfaces:**
- Consumes: `consolidateGroupMemoryFor` de `../services/group-memory`.
- Produces: consolidação diária às 03:00, com idempotência por (grupo, dia) e sensor em `ritual_logs`.

- [ ] **Step 1: Ler o laço atual**

```bash
ssh tom "cd /opt/LA-Organizer && sed -n 3940,3960p src/rituals/dispatcher.js"
```

O laço já busca `work_groups` com `active = true` e chama `auditGroupConversation`.

- [ ] **Step 2: Escrever o teste do gate de idempotência**

Adicione em `src/services/group-memory.test.js`:

```js
const { deveConsolidarGrupo } = require('./group-memory');

test('gate: só consolida grupo ativo, com conversa, que ainda não rodou hoje', () => {
  assert.strictEqual(deveConsolidarGrupo({ jaRodouHoje: false }), true);
  assert.strictEqual(deveConsolidarGrupo({ jaRodouHoje: true }), false, 'idempotência: 1x por dia por grupo');
});
```

- [ ] **Step 3: Rodar e ver falhar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/group-memory.test.js 2>&1 | grep -E '^not ok|^# fail'"
```

Esperado: FAIL — `deveConsolidarGrupo is not a function`.

- [ ] **Step 4: Implementar o gate**

Em `src/services/group-memory.js`, antes do `module.exports`:

```js
// Idempotência: o Dream pode ser re-disparado no mesmo dia (force, restart). O piso de
// mensagens já está dentro do consolidador; aqui é só o "já rodou hoje".
function deveConsolidarGrupo({ jaRodouHoje }) {
  return !jaRodouHoje;
}
```

E acrescente `deveConsolidarGrupo` ao `module.exports`.

- [ ] **Step 5: Rodar e ver passar**

```bash
ssh tom "cd /opt/LA-Organizer && node --env-file=.env --test src/services/group-memory.test.js 2>&1 | grep -E '^# (tests|pass|fail)'"
```

Esperado: `pass 9`, `fail 0`.

- [ ] **Step 6: Plugar no laço do Dream**

Dentro do `for (const g of (grupos || []))` em `src/rituals/dispatcher.js`, **depois** da chamada de `auditGroupConversation`, acrescente:

```js
        // MEMÓRIA DE GRUPO (02/09). O Dream já passava por aqui só pra JULGAR o grupo; agora
        // ele também guarda. Fatia 1: escreve e não lê — nada disso entra no prompt ainda.
        //
        // ⚠️ NÃO usar `ritual_logs`/`alreadySent`/`logRitualEvent` aqui: `ritual_logs.collaborator_id`
        // é NOT NULL e o sujeito deste ritual é um GRUPO. O insert falharia em silêncio (o
        // logRitualEvent engole erro), o sensor ficaria morto e a idempotência nunca gravaria —
        // ou seja, exatamente a doença que este sensor existe pra evitar. `marker_logs` aceita
        // linha sem colaborador e já é a fonte que o painel de grupos do laudo lê.
        try {
          const { consolidateGroupMemoryFor, deveConsolidarGrupo } = require('../services/group-memory');
          const { getEmbedding } = require('../services/embeddings');
          const chaveDia = `group_memory:${g.id}:${now.ymd}`;

          const { data: jaTem } = await supabase.from('marker_logs')
            .select('id').eq('marker_type', 'GROUP_MEMORY').like('reason', `${chaveDia}%`).limit(1);

          if (deveConsolidarGrupo({ jaRodouHoje: !!(jaTem && jaTem.length) })) {
            const r = await consolidateGroupMemoryFor({ supabase, group: g, chat: aiChat, getEmbedding });
            // SENSOR: zero por falha não pode ser igual a zero por dia tranquilo — foi o que
            // cegou a auditoria de 29/08 a 01/09.
            await supabase.from('marker_logs').insert({
              marker_type: 'GROUP_MEMORY',
              result: r.erro ? 'fallback' : 'executed',
              reason: `${chaveDia} msgs=${r.mensagens} cand=${r.candidatas} salvas=${r.salvas}${r.erro ? ' erro=' + r.erro : ''}`.slice(0, 120),
            });
            if (r.salvas) console.log(`[GroupMemory] ${g.name}: ${r.salvas} memória(s) de ${r.candidatas} candidata(s)`);
            if (r.erro) console.error(`[GroupMemory] ${g.name}: ${r.erro}`);
          }
        } catch (mErr) {
          console.error(`[GroupMemory] falha no grupo ${g.name}:`, mErr.message);
        }
```

- [ ] **Step 7: Verificar sintaxe e suíte inteira**

```bash
ssh tom "cd /opt/LA-Organizer && node --check src/rituals/dispatcher.js && timeout 560 node --env-file=.env --test src/ 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'"
```

Esperado: sintaxe ok; suíte com as mesmas 3 falhas de `system-loadout` e nenhuma nova.

- [ ] **Step 8: Disparo controlado e conferência no banco**

```bash
ssh tom "cd /opt/LA-Organizer && timeout 300 node --env-file=.env -e \"require('./src/rituals/dispatcher').run({ force: 'dream' })\" 2>&1 | grep -E 'GroupMemory|ConvAudit' | head -20"
```

Depois confira o que entrou:

```sql
select g.name, m.memory_type, m.importance, m.is_active, m.occurred_on, left(m.content,80) conteudo
from group_memory m join work_groups g on g.id = m.group_id order by m.created_at desc limit 20;
```

Esperado: linhas dos grupos que conversaram nas últimas 24h; toda `lesson` com `is_active = false`.

- [ ] **Step 9: Commit e restart**

```bash
git add src/rituals/dispatcher.js src/services/group-memory.js src/services/group-memory.test.js
git commit -m "feat(memoria): Dream passa a consolidar memoria dos grupos — idempotente por dia, com sensor"
git push origin HEAD
pm2 restart tom
```

---

## Fora desta fatia (não implementar aqui)

- **Leitura** — bloco fixo no prompt e busca sob gatilho. É a Fatia 2, depois de o Alf ler o que foi guardado.
- **Aprovação de lições no laudo** — Fatia 3.
- **Migrar o 1:1 para o módulo** — só depois de o módulo rodar semanas em grupo.
- **Supersede/versionamento** e **camada compartilhada entre grupos** — cortados na spec por YAGNI.
