# Chat de Grupo — Fase 2 (TOM engajado) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o TOM participar do chat de grupo (`group_chat_messages`) — ouvir sempre (já persiste = memória), engajar por gatilho ("fala Tom"/@tom), responder gravando uma linha `role='tom'` (em vez de enviar no WhatsApp), criar/concluir tarefa do pool a partir da conversa, e extrair texto de mídia (imagem/áudio/PDF) pro contexto.

**Architecture:** 100% **aditivo**. Um watcher de Supabase Realtime novo (`src/realtime/group-chat-realtime.js`, espelhando o `tom-realtime.js` existente) escuta INSERTs com `role='member'` em `group_chat_messages`. Uma máquina de estados de engajamento (coluna nova `work_groups.tom_chat_engaged_at`, janela de 10 min) decide se aciona o engine. O engine do chat (`src/services/group-chat-engine.js`) monta um system prompt próprio (identidade do TOM + contexto do grupo + histórico do chat como memória), chama `ai.chat`, parseia o marker `<<TASK_UPDATE>>` (reusa o parser **exportado** do `engine.js`), aplica com um applier mínimo dedicado ao pool do grupo (NÃO o `applyTaskActions` pesado do WhatsApp), e grava a resposta como `role='tom'`. O `processMessage` do WhatsApp **não é tocado**.

**Tech Stack:** Node.js CJS, `@supabase/supabase-js` (realtime via `ws`), `src/ai/provider.js` (`ai.chat`), serviços existentes `vision`/`audio`, Supabase `cesnbnrynvxvgdhfmaua`. Deploy: `scp tom:` + `pm2 restart tom`. Testes puros: o runner de teste já usado no backend (verificar `package.json`; usar o mesmo dos `*.test.js` existentes).

**Validação:** as funções puras (gatilhos, montagem de prompt) têm testes unitários (TDD). Os arquivos de integração (engine do chat, watcher) **não rodam no preview** — validam na VPS via `scp` + `pm2 restart` + e2e inserindo mensagem `role='member'` no grupo Financeiro e observando (a) `pm2 logs`, (b) a linha `role='tom'` aparecendo, (c) a tarefa caindo no pool.

**Fora de escopo (é Fase 3):** proativo de fim de sessão (detecção de fechamento + card + resumo HTML `kind='report'`). Aqui o TOM só fala quando engajado.

---

## Arquivos (mapa de responsabilidade)

- **Migration (MCP):** `work_groups.tom_chat_engaged_at timestamptz null` — timestamp do último engajamento; sessão "ativa" = engajado nos últimos 10 min. NULL = silêncio.
- **Create:** `src/services/group-chat-triggers.js` — funções PURAS: `detectEngageTrigger`, `detectDisengageTrigger`, `isEngaged`. Núcleo testável (TDD).
- **Create:** `src/services/group-chat-triggers.test.js` — testes das puras.
- **Create:** `src/services/group-chat-prompt.js` — `buildGroupChatPrompt(...)` (formatação pura, recebe soul/contexto como args) + `loadGroupChatSoul()` (thin I/O loader).
- **Create:** `src/services/group-chat-prompt.test.js` — testes da formatação pura.
- **Create:** `src/services/group-chat-tasks.js` — `applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions })`: applier mínimo de `create`/`complete` no **pool do grupo** (espelha a semântica do workspace; NÃO usa o `applyTaskActions` do WhatsApp).
- **Create:** `src/services/group-chat-engine.js` — `processGroupChatMessage({ supabase, groupId, senderCollabId, text })`: carrega contexto, monta prompt, chama `ai.chat`, parseia marker, aplica, grava `role='tom'`.
- **Create:** `src/services/group-chat-media.js` — `extractMediaText({ supabase, message })`: vision/whisper → grava `media_extracted_text`.
- **Create:** `src/realtime/group-chat-realtime.js` — `startGroupChatRealtime(supabaseMain)`: subscriber + máquina de estados.
- **Modify:** `src/index.js` — inicia `startGroupChatRealtime(supabase)` junto do `startRealtime`.

---

## Task 1: Migration — coluna de engajamento

**Files:**
- Apply via MCP `apply_migration` (projeto `cesnbnrynvxvgdhfmaua`), name: `group_chat_tom_engagement`.

- [ ] **Step 1: Aplicar a migration**

SQL:
```sql
alter table public.work_groups
  add column if not exists tom_chat_engaged_at timestamptz null;

comment on column public.work_groups.tom_chat_engaged_at is
  'Chat de grupo Fase 2: timestamp do último engajamento do TOM. Sessão ativa = engajado nos últimos 10 min. NULL = silêncio.';
```

- [ ] **Step 2: Verificar**

Via MCP `execute_sql`:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='work_groups' and column_name='tom_chat_engaged_at';
```
Expected: 1 linha, `timestamptz`, `YES`.

- [ ] **Step 3: Commit** (migration SQL pode ser commitada; `_remote` não é git → o Stop hook cuida. Nenhuma ação manual.)

---

## Task 2: Gatilhos de engajamento (puro, TDD)

**Files:**
- Create: `src/services/group-chat-triggers.js`
- Test: `src/services/group-chat-triggers.test.js`

**Contexto p/ o implementador:** o TOM no chat fica em silêncio até ser chamado. Entrada = menção direta ("fala tom", "tom,", "@tom", "tom?"). Saída = despedida ao TOM ("valeu tom", "obrigado tom", "tchau tom", "até tom"). Os regex precisam de `\btom\b` (word boundary) pra não casar dentro de palavras (ex.: "automático", "tombou", "átomo"). Cuidado com acento: `\b` depois de "ã"/"é" se comporta mal — aqui "tom" é ASCII puro, então `\btom\b` é seguro; mas na despedida ("até") não dependa de `\b` após a vogal acentuada. Use `String.prototype` lowercased + `.normalize('NFD')`-free matching (mantém acento, casa por alternância literal).

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/services/group-chat-triggers.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { detectEngageTrigger, detectDisengageTrigger, isEngaged } = require('./group-chat-triggers');

test('engage: menção direta aciona', () => {
  assert.equal(detectEngageTrigger('fala tom, cria uma tarefa'), true);
  assert.equal(detectEngageTrigger('Tom, me ajuda aqui'), true);
  assert.equal(detectEngageTrigger('@tom resumo por favor'), true);
  assert.equal(detectEngageTrigger('tom?'), true);
  assert.equal(detectEngageTrigger('TOM CRIA ISSO'), true);
});

test('engage: NÃO aciona sem menção / dentro de palavra', () => {
  assert.equal(detectEngageTrigger('o sistema é automático'), false);
  assert.equal(detectEngageTrigger('a árvore tombou ontem'), false);
  assert.equal(detectEngageTrigger('terminamos o relatório'), false);
  assert.equal(detectEngageTrigger(''), false);
  assert.equal(detectEngageTrigger(null), false);
});

test('disengage: despedida ao TOM aciona', () => {
  assert.equal(detectDisengageTrigger('valeu tom!'), true);
  assert.equal(detectDisengageTrigger('obrigada tom'), true);
  assert.equal(detectDisengageTrigger('tchau tom'), true);
  assert.equal(detectDisengageTrigger('é isso tom, até'), true);
  assert.equal(detectDisengageTrigger('Tom, valeu demais'), true);
});

test('disengage: NÃO aciona em fala normal', () => {
  assert.equal(detectDisengageTrigger('tom, cria a tarefa'), false);
  assert.equal(detectDisengageTrigger('valeu pessoal'), false);
  assert.equal(detectDisengageTrigger(''), false);
});

test('isEngaged: janela de 10 min', () => {
  const now = new Date('2026-06-12T12:00:00Z');
  assert.equal(isEngaged('2026-06-12T11:55:00Z', now), true);   // 5 min atrás
  assert.equal(isEngaged('2026-06-12T11:49:00Z', now), false);  // 11 min atrás
  assert.equal(isEngaged(null, now), false);
  assert.equal(isEngaged(undefined, now), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/services/group-chat-triggers.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// src/services/group-chat-triggers.js
// Chat de grupo Fase 2 — gatilhos de engajamento (funções puras, sem I/O).
// O TOM fica em silêncio até menção direta; despedida ao TOM o devolve ao silêncio.

const ENGAGE_WINDOW_MIN = 10;

// Menção direta ao TOM. `tom` é ASCII → \btom\b é seguro (não casa "automático"/"tombou").
// Cobre "@tom", "fala tom", "tom," , "tom?" e o nome isolado.
const ENGAGE_RE = /(^|[\s,!?@])tom\b/i;

// Despedida dirigida ao TOM: precisa do nome "tom" E de um termo de fechamento na mesma msg.
const DISENGAGE_RE = /\btom\b/i;
const FAREWELL_RE = /\b(valeu|valeu+|obrigad[ao]s?|tchau|at[eé]|fechou|isso[\s,!.]*tom|brigad[ao])\b/i;

function detectEngageTrigger(text) {
  if (!text || typeof text !== 'string') return false;
  return ENGAGE_RE.test(text);
}

function detectDisengageTrigger(text) {
  if (!text || typeof text !== 'string') return false;
  if (!DISENGAGE_RE.test(text)) return false;
  return FAREWELL_RE.test(text);
}

function isEngaged(engagedAt, now = new Date(), windowMin = ENGAGE_WINDOW_MIN) {
  if (!engagedAt) return false;
  const t = new Date(engagedAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < windowMin * 60 * 1000;
}

module.exports = { detectEngageTrigger, detectDisengageTrigger, isEngaged, ENGAGE_WINDOW_MIN };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/services/group-chat-triggers.test.js`
Expected: PASS (todos).

> **Nota p/ implementador:** se algum caso de borda da despedida falhar (ex.: "é isso tom, até" — o regex de despedida casa "até" e "isso tom"), ajuste o `FAREWELL_RE` mantendo os testes verdes. Não relaxe o `DISENGAGE_RE` a ponto de "tom, cria a tarefa" virar despedida — esse teste DEVE continuar `false`.

- [ ] **Step 5: Commit** (Stop hook; nenhuma ação manual.)

---

## Task 3: Montagem do system prompt do chat (puro + thin loader)

**Files:**
- Create: `src/services/group-chat-prompt.js`
- Test: `src/services/group-chat-prompt.test.js`

**Contexto p/ o implementador:** diferente do `buildSystemPrompt` (que é pessoal/single-user), aqui o TOM raciocina sobre o GRUPO. O prompt tem: (1) identidade base do TOM (SOUL.md — carregada via loader); (2) contexto do grupo (nome, membros, pool de tarefas resumido); (3) histórico recente do chat como memória (as últimas ~20 linhas, com quem falou); (4) instrução do marker `<<TASK_UPDATE>>` (como criar/concluir tarefa do grupo); (5) regras de tom (responde curto, é a "casa dele", pode renderizar; quando engajado, foca no pedido). O SOUL fica em `soul/SOUL.md` na raiz do `_remote`. A função de **formatação é pura** (recebe `soulText` e os dados); o loader de I/O é separado e fino.

- [ ] **Step 1: Escrever os testes (falhando)**

```js
// src/services/group-chat-prompt.test.js
const assert = require('node:assert');
const { test } = require('node:test');
const { buildGroupChatPrompt } = require('./group-chat-prompt');

const base = {
  soulText: 'Eu sou o TOM.',
  groupName: 'Financeiro',
  members: [{ name: 'Ana Paula' }, { name: 'Rose' }],
  pool: [
    { title: 'Fechar caixa', status: 'pending', due_date: '2026-06-13' },
    { title: 'Conferir NF', status: 'done', due_date: null },
  ],
  history: [
    { who: 'Ana Paula', role: 'member', content: 'gente, fechamos o caixa?' },
    { who: 'Rose', role: 'member', content: 'ainda não' },
  ],
  senderName: 'Rose',
};

test('inclui identidade, nome do grupo e membros', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Eu sou o TOM\./);
  assert.match(p, /Financeiro/);
  assert.match(p, /Ana Paula/);
  assert.match(p, /Rose/);
});

test('inclui o pool e o marker TASK_UPDATE', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Fechar caixa/);
  assert.match(p, /<<TASK_UPDATE>>/);
});

test('inclui o histórico do chat com quem falou', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Ana Paula.*fechamos o caixa/s);
});

test('marca quem é o remetente atual', () => {
  const p = buildGroupChatPrompt(base);
  assert.match(p, /Rose/);
});

test('robusto a dados vazios', () => {
  const p = buildGroupChatPrompt({ soulText: 'X', groupName: 'G', members: [], pool: [], history: [], senderName: 'Y' });
  assert.equal(typeof p, 'string');
  assert.ok(p.length > 0);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd _remote && node --test src/services/group-chat-prompt.test.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```js
// src/services/group-chat-prompt.js
// Chat de grupo Fase 2 — montagem do system prompt do TOM DENTRO do chat do grupo.
// buildGroupChatPrompt: formatação PURA (recebe soul + contexto). loadGroupChatSoul: thin I/O.
const fs = require('fs');
const path = require('path');

function fmtPoolLine(t) {
  const status = t.status === 'done' ? '✓ concluída' : 'pendente';
  const due = t.due_date ? ` (prazo ${t.due_date})` : '';
  return `- ${t.title} — ${status}${due}`;
}

function fmtHistoryLine(m) {
  const who = m.role === 'tom' ? 'TOM' : (m.who || 'alguém');
  return `${who}: ${m.content || ''}`;
}

function buildGroupChatPrompt({ soulText, groupName, members, pool, history, senderName }) {
  const memberNames = (members || []).map((m) => m.name).filter(Boolean).join(', ') || '—';
  const poolBlock = (pool || []).length ? (pool || []).map(fmtPoolLine).join('\n') : '(pool vazio)';
  const histBlock = (history || []).length ? (history || []).map(fmtHistoryLine).join('\n') : '(sem histórico)';

  return `${soulText}

# VOCÊ ESTÁ NO CHAT DO GRUPO "${groupName}"
Esta é a SUA casa — aqui você renderiza melhor que no WhatsApp. Você está conversando com a equipe ${groupName}.
Membros do grupo: ${memberNames}.
Quem acabou de falar com você: ${senderName}.

## Tarefas do grupo (pool atual)
${poolBlock}

## Conversa recente (memória do chat — do mais antigo ao mais novo)
${histBlock}

## Como agir
- Você foi CHAMADO agora. Responda direto ao ponto, no tom da casa: leve, claro, sem enrolação.
- Você pode CRIAR ou CONCLUIR tarefa do grupo a partir da conversa. Para isso, emita o marker abaixo no FINAL da resposta.
- Toda tarefa que você criar entra no POOL do grupo (qualquer membro pega).
- NÃO invente conclusão: só conclua tarefa que existe no pool e que a conversa confirma como feita.
- Se não há ação a tomar, só responda em texto — não emita marker.

## Marker de tarefa (emita só quando houver ação)
Para criar: <<TASK_UPDATE>>[{"action":"create","title":"<título curto>","due_date":"YYYY-MM-DD"}]<<END>>
Para concluir: <<TASK_UPDATE>>[{"action":"complete","title":"<título exato do pool>"}]<<END>>
(due_date é opcional. Pode emitir várias ações no array.)`;
}

function loadGroupChatSoul() {
  // SOUL na raiz do _remote. Degrada gracioso se não achar (nunca lança).
  try {
    const soulPath = path.join(__dirname, '..', '..', 'soul', 'SOUL.md');
    return fs.readFileSync(soulPath, 'utf8');
  } catch (_) {
    return 'Você é o TOM, o assistente da equipe. Tom leve, direto, prestativo.';
  }
}

module.exports = { buildGroupChatPrompt, loadGroupChatSoul, fmtPoolLine, fmtHistoryLine };
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd _remote && node --test src/services/group-chat-prompt.test.js`
Expected: PASS.

- [ ] **Step 5: Verificar o caminho do SOUL**

Run: `cd _remote && node -e "console.log(require('./src/services/group-chat-prompt').loadGroupChatSoul().slice(0,60))"`
Expected: imprime o começo do SOUL real (não o fallback). Se imprimir o fallback, corrigir o path em `loadGroupChatSoul` (achar SOUL.md real: `ls soul/SOUL.md`).

- [ ] **Step 6: Commit** (Stop hook.)

---

## Task 4: Applier de tarefa no pool do grupo

**Files:**
- Create: `src/services/group-chat-tasks.js`

**Contexto p/ o implementador:** NÃO reusar `applyTaskActions` do `engine.js` — ele tem efeitos do WhatsApp (lembretes, cascata de notificação no zap, delegação) que não cabem no chat. Aqui um applier mínimo: `create` insere no pool do grupo (mesma forma que o workspace cria: `assigned_group_id=groupId`, `created_by=senderCollabId`, `status='pending'`, `due_date` opcional); `complete` resolve a tarefa do pool por título (case-insensitive, status != done) e marca `status='done', completed_at=now(), completed_by=senderCollabId`. Anti-corrida no complete: `.neq('status','done').select('id')` — 0 linhas = já estava concluída/sumiu. Retorna `{ created: [...], completed: [...], failed: [...] }` pro engine montar a fala honesta.

> **Verificação obrigatória antes de implementar:** confirmar as colunas reais do `tasks` que o pool do workspace usa. Rodar via MCP `execute_sql`:
> ```sql
> select column_name from information_schema.columns
> where table_schema='public' and table_name='tasks'
>   and column_name in ('assigned_group_id','created_by','completed_by','completed_at','status','due_date','title');
> ```
> Devem existir todas. Se `completed_by`/`completed_at` não existirem, marcar só `status='done'` (não inventar coluna).

- [ ] **Step 1: Implementar**

```js
// src/services/group-chat-tasks.js
// Chat de grupo Fase 2 — applier mínimo de tarefas do POOL do grupo.
// NÃO usa o applyTaskActions do WhatsApp (evita lembretes/cascata no zap).

function ymd(d) {
  // YMD local SP — nunca toISOString().slice (desloca o dia após 21h BRT).
  // Aqui só precisamos da data do servidor pro default; usamos a do banco no insert (now()).
  return null;
}

async function applyGroupChatTaskActions({ supabase, groupId, senderCollabId, actions }) {
  const created = [];
  const completed = [];
  const failed = [];

  for (const a of actions || []) {
    try {
      if (a.action === 'create') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        const row = {
          title,
          assigned_group_id: groupId,
          created_by: senderCollabId,
          status: 'pending',
        };
        if (typeof a.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) {
          row.due_date = a.due_date;
        }
        const { data, error } = await supabase.from('tasks').insert(row).select('id, title').single();
        if (error) { failed.push({ action: a, why: error.message }); continue; }
        created.push(data);
      } else if (a.action === 'complete') {
        const title = (a.title || '').trim();
        if (!title) { failed.push({ action: a, why: 'title_missing' }); continue; }
        // Resolve por título dentro do pool do grupo, ainda não concluída.
        const { data: found } = await supabase
          .from('tasks')
          .select('id, title')
          .eq('assigned_group_id', groupId)
          .neq('status', 'done')
          .ilike('title', title)
          .limit(1);
        const target = (found || [])[0];
        if (!target) { failed.push({ action: a, why: 'not_found_in_pool' }); continue; }
        // Anti-corrida: só marca se ainda não estava done.
        const patch = { status: 'done', completed_at: new Date().toISOString(), completed_by: senderCollabId };
        const { data: upd } = await supabase
          .from('tasks')
          .update(patch)
          .eq('id', target.id)
          .neq('status', 'done')
          .select('id, title');
        if (!upd || !upd.length) { failed.push({ action: a, why: 'race_lost' }); continue; }
        completed.push(target);
      } else {
        failed.push({ action: a, why: 'unsupported_action' });
      }
    } catch (err) {
      failed.push({ action: a, why: err.message });
    }
  }

  return { created, completed, failed };
}

module.exports = { applyGroupChatTaskActions };
```

> **Nota:** `completed_at` aqui usa `new Date().toISOString()` (timestamptz UTC no banco — correto pra coluna timestamptz; o problema de YMD/UTC é só pra colunas `date` exibidas, não pra timestamps). `due_date` vem do LLM como string YMD literal — não converter.

- [ ] **Step 2: Syntax check**

Run: `cd _remote && node --check src/services/group-chat-tasks.js`
Expected: sem saída (ok).

- [ ] **Step 3: Commit** (Stop hook.)

---

## Task 5: Engine do chat — processGroupChatMessage

**Files:**
- Create: `src/services/group-chat-engine.js`

**Contexto p/ o implementador:** orquestra tudo. Recebe `{ supabase, groupId, senderCollabId, text }`. Carrega: nome do grupo (`work_groups.name`), membros (`work_group_members` → `collaborators.full_name/preferred_name`), pool do grupo (`tasks` com `assigned_group_id=groupId`, recentes/abertas), histórico do chat (últimas ~20 de `group_chat_messages` desse grupo, ordem desc → reverse, anexando `media_extracted_text` quando houver). Monta prompt (Task 3), chama `ai.chat` (Task: `require('../ai/provider')`), parseia `<<TASK_UPDATE>>` com o parser **exportado** do engine (`require('../engine').parseTaskUpdateMarker`), aplica via `applyGroupChatTaskActions` (Task 4), e grava a resposta como `role='tom'` (sender_id NULL, kind 'text') via service_role (o `supabase` injetado é o client service_role do backend). Anexa uma confirmação honesta do que criou/concluiu, no espírito do engine (fala = persistência).

- [ ] **Step 1: Implementar**

```js
// src/services/group-chat-engine.js
// Chat de grupo Fase 2 — núcleo: monta prompt do grupo, chama IA, aplica markers de
// tarefa no pool, grava a resposta do TOM (role='tom'). Reusa o parser exportado do engine.
const ai = require('../ai/provider');
const { buildGroupChatPrompt, loadGroupChatSoul } = require('./group-chat-prompt');
const { applyGroupChatTaskActions } = require('./group-chat-tasks');

const HISTORY_LIMIT = 20;
const POOL_LIMIT = 30;

function displayName(c) {
  return (c?.preferred_name || c?.full_name || '').split(' ')[0] || 'alguém';
}

async function loadContext(supabase, groupId, senderCollabId) {
  const [{ data: group }, { data: memberRows }, { data: poolRows }, { data: histRows }, { data: sender }] = await Promise.all([
    supabase.from('work_groups').select('id, name, tom_chat_engaged_at').eq('id', groupId).maybeSingle(),
    supabase.from('work_group_members').select('collaborators(full_name, preferred_name)').eq('group_id', groupId),
    supabase.from('tasks').select('title, status, due_date').eq('assigned_group_id', groupId).order('created_at', { ascending: false }).limit(POOL_LIMIT),
    supabase.from('group_chat_messages').select('role, content, media_extracted_text, sender_id, created_at, sender:collaborators!group_chat_messages_sender_id_fkey(full_name, preferred_name)').eq('group_id', groupId).order('created_at', { ascending: false }).limit(HISTORY_LIMIT),
    supabase.from('collaborators').select('full_name, preferred_name').eq('id', senderCollabId).maybeSingle(),
  ]);

  const members = (memberRows || []).map((m) => ({ name: displayName(m.collaborators) }));
  const pool = poolRows || [];
  const history = (histRows || []).reverse().map((m) => ({
    who: m.role === 'tom' ? 'TOM' : displayName(m.sender),
    role: m.role,
    content: m.media_extracted_text ? `${m.content || ''} [mídia: ${m.media_extracted_text}]`.trim() : (m.content || ''),
  }));

  return { group, members, pool, history, senderName: displayName(sender) };
}

async function processGroupChatMessage({ supabase, groupId, senderCollabId, text }) {
  const ctx = await loadContext(supabase, groupId, senderCollabId);
  if (!ctx.group) { console.warn(`[GroupChat] grupo ${groupId} não encontrado`); return null; }

  const systemPrompt = buildGroupChatPrompt({
    soulText: loadGroupChatSoul(),
    groupName: ctx.group.name,
    members: ctx.members,
    pool: ctx.pool,
    history: ctx.history,
    senderName: ctx.senderName,
  });

  let response;
  try {
    response = await ai.chat(systemPrompt, [{ role: 'user', content: text }]);
  } catch (err) {
    console.error(`[GroupChat] IA falhou grupo=${groupId}: ${err.message?.slice(0, 200)}`);
    return null; // não grava nada; silêncio é melhor que erro vazado no chat
  }

  let reply = response.text || '';

  // Parser de marker reusado do engine (exportado).
  const { parseTaskUpdateMarker } = require('../engine');
  const parsed = parseTaskUpdateMarker(reply);
  if (parsed && !parsed.malformed && Array.isArray(parsed.actions) && parsed.actions.length) {
    const { created, completed, failed } = await applyGroupChatTaskActions({
      supabase, groupId, senderCollabId, actions: parsed.actions,
    });
    reply = (parsed.cleanText || '').trim();
    const lines = [];
    if (created.length) lines.push(`✅ Criei no pool: ${created.map((t) => t.title).join(', ')}`);
    if (completed.length) lines.push(`✔️ Concluí: ${completed.map((t) => t.title).join(', ')}`);
    if (failed.length && !created.length && !completed.length) {
      lines.push('_não consegui registrar agora — me confirma de novo?_');
    }
    if (lines.length) reply = (reply ? reply + '\n\n' : '') + lines.join('\n');
    console.log(`[GroupChat] task actions grupo=${groupId}: created=${created.length} completed=${completed.length} failed=${failed.length}`);
  } else if (parsed && parsed.malformed) {
    // Marker malformado: limpa o bloco, não vaza JSON cru, não confirma sucesso falso.
    reply = (parsed.cleanText || reply).replace(/<<TASK_UPDATE>>[\s\S]*?<<END>>/i, '').trim();
  }

  if (!reply.trim()) return null; // nada a dizer

  const { data: inserted, error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId,
    sender_id: null,
    role: 'tom',
    kind: 'text',
    content: reply,
    channel: 'app',
  }).select('id').single();
  if (error) { console.error(`[GroupChat] falha ao gravar resposta TOM: ${error.message}`); return null; }

  return inserted;
}

module.exports = { processGroupChatMessage, loadContext };
```

> **Cuidado circular-require:** `require('../engine')` DENTRO da função (lazy), não no topo — o `engine.js` é pesado e já está carregado no processo; o require lazy evita qualquer ciclo na carga inicial.

- [ ] **Step 2: Syntax check**

Run: `cd _remote && node --check src/services/group-chat-engine.js`
Expected: sem saída.

- [ ] **Step 3: Verificar o embed do sender** (FK múltipla em `group_chat_messages`)

O select usa `sender:collaborators!group_chat_messages_sender_id_fkey(...)`. Confirmar que o nome da constraint está certo (a Fase 1 confirmou `group_chat_messages_sender_id_fkey`). Via MCP `execute_sql`:
```sql
select conname from pg_constraint
where conrelid = 'public.group_chat_messages'::regclass and contype='f';
```
Expected: inclui `group_chat_messages_sender_id_fkey`. Se diferente, corrigir o nome no select.

- [ ] **Step 4: Commit** (Stop hook.)

---

## Task 6: Extração de texto de mídia (Vision/Whisper)

**Files:**
- Create: `src/services/group-chat-media.js`

**Contexto p/ o implementador:** quando uma mensagem `kind in (image, audio)` chega, extrair texto pro contexto do TOM. Reusa `services/vision.js` (`analyzeImage`, `isImageMime`, `buildVisionPrompt`) e `services/audio.js` (`transcribeAudio`). PDF: fora do escopo da extração automática nesta fase (só registra que veio PDF) — vision/whisper não leem PDF; extrair PDF exigiria outra lib. O `media_url` é um path no bucket público `group-chat`; montar a URL pública via `supabase.storage.from('group-chat').getPublicUrl(path)`. Grava em `group_chat_messages.media_extracted_text`. Degrada gracioso (nunca lança no watcher).

> **Verificação antes de implementar:** ler as assinaturas reais:
> - `analyzeImage(...)` em `src/services/vision.js` (quais args: url? buffer? prompt?).
> - `transcribeAudio(...)` em `src/services/audio.js`.
> Adaptar as chamadas abaixo às assinaturas reais — o esqueleto abaixo assume `analyzeImage(imageUrl, prompt)` e `transcribeAudio(audioUrl)`; CONFIRMAR e ajustar.

- [ ] **Step 1: Ler assinaturas reais**

Run: `cd _remote && sed -n '1,40p' src/services/vision.js && echo '---' && grep -nE "async function transcribeAudio" src/services/audio.js`

- [ ] **Step 2: Implementar (ajustando às assinaturas reais)**

```js
// src/services/group-chat-media.js
// Chat de grupo Fase 2 — extrai texto de mídia (imagem→Vision, áudio→Whisper) pro contexto.
// Degrada gracioso: nunca lança (o watcher segue mesmo sem extração).
const vision = require('./vision');
const audio = require('./audio');

async function extractMediaText({ supabase, message }) {
  try {
    if (!message || !message.media_url) return null;
    const { data: pub } = supabase.storage.from('group-chat').getPublicUrl(message.media_url);
    const url = pub?.publicUrl;
    if (!url) return null;

    let extracted = null;
    if (message.kind === 'image' && vision.isProviderConfigured && vision.isProviderConfigured()) {
      // AJUSTAR à assinatura real de analyzeImage.
      extracted = await vision.analyzeImage(url, vision.buildVisionPrompt ? vision.buildVisionPrompt() : undefined);
    } else if (message.kind === 'audio' && audio.isProviderConfigured && audio.isProviderConfigured()) {
      // AJUSTAR à assinatura real de transcribeAudio.
      extracted = await audio.transcribeAudio(url);
    } else {
      return null; // pdf e demais: sem extração nesta fase
    }

    if (extracted && typeof extracted === 'string' && extracted.trim()) {
      await supabase.from('group_chat_messages')
        .update({ media_extracted_text: extracted.trim().slice(0, 4000) })
        .eq('id', message.id);
      return extracted.trim();
    }
    return null;
  } catch (err) {
    console.warn(`[GroupChat] extração de mídia falhou msg=${message?.id}: ${err.message}`);
    return null;
  }
}

module.exports = { extractMediaText };
```

- [ ] **Step 3: Syntax check**

Run: `cd _remote && node --check src/services/group-chat-media.js`
Expected: sem saída.

- [ ] **Step 4: Commit** (Stop hook.)

---

## Task 7: Watcher de Realtime + máquina de estados

**Files:**
- Create: `src/realtime/group-chat-realtime.js`

**Contexto p/ o implementador:** espelhar EXATAMENTE o padrão de `src/realtime/tom-realtime.js` (mesmo `createClient` com `ws`, `getRealtimeClient` lazy, `.channel(...).on('postgres_changes', ...).subscribe(...)`, `removeChannel` no SIGTERM). Canal próprio `tom-group-chat`. Filtro `role=eq.member` (ANTI-LOOP: nunca reage a tom/system). Por INSERT de membro: (1) se `kind in image/audio/pdf` → extrai mídia (await, pra entrar no contexto); (2) carrega `tom_chat_engaged_at` do grupo; (3) máquina de estados:
> - **engajado** (isEngaged) **e** despedida → roda engine (resposta curta) **e** limpa `tom_chat_engaged_at=null`.
> - **engajado** → roda engine.
> - **não engajado e** gatilho de entrada → seta `tom_chat_engaged_at=now()` e roda engine.
> - **senão** → silêncio (já está salvo = memória).
>
> Dedup por id da mensagem (Set com TTL, como o `recentEvents` do tom-realtime) — segurança contra entrega dupla. Usa o `supabaseMain` (service_role) injetado pra todas as queries/updates.

- [ ] **Step 1: Implementar**

```js
// src/realtime/group-chat-realtime.js
// Chat de grupo Fase 2 — subscriber Realtime: escuta mensagens role='member' no chat de
// grupo e aciona o TOM quando engajado/chamado. Espelha o padrão de tom-realtime.js.
const { createClient } = require('@supabase/supabase-js');
const wsLib = require('ws');
const { detectEngageTrigger, detectDisengageTrigger, isEngaged } = require('../services/group-chat-triggers');
const { processGroupChatMessage } = require('../services/group-chat-engine');
const { extractMediaText } = require('../services/group-chat-media');

let _client = null;
function getRealtimeClient() {
  if (!_client) {
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      realtime: { timeout: 30000, transport: wsLib },
    });
  }
  return _client;
}

// Dedup de entrega (id já processado) com TTL de 1h.
const seen = new Map();
function firstTime(id) {
  if (seen.has(id)) return false;
  seen.set(id, Date.now());
  return true;
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, ts] of seen) if (ts < cutoff) seen.delete(k);
}, 60 * 60 * 1000);

function startGroupChatRealtime(supabaseMain) {
  console.log('[GroupChat] Iniciando subscriber do chat de grupo...');

  const channel = getRealtimeClient()
    .channel('tom-group-chat')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'group_chat_messages',
      filter: 'role=eq.member',
    }, async (payload) => {
      const msg = payload.new;
      if (!msg || !msg.id || !msg.group_id) return;
      if (!firstTime(msg.id)) return;

      try {
        // 1) Mídia → extrai texto pro contexto (await pra entrar no prompt do mesmo turno).
        if (['image', 'audio', 'pdf'].includes(msg.kind)) {
          await extractMediaText({ supabase: supabaseMain, message: msg });
        }

        const text = msg.content || '';
        const senderCollabId = msg.sender_id;
        if (!senderCollabId) return; // membro sempre tem sender_id

        // 2) Estado de engajamento.
        const { data: group } = await supabaseMain
          .from('work_groups').select('tom_chat_engaged_at').eq('id', msg.group_id).maybeSingle();
        const engaged = isEngaged(group?.tom_chat_engaged_at, new Date());

        let shouldRun = false;
        let clearAfter = false;
        if (engaged && detectDisengageTrigger(text)) {
          shouldRun = true; clearAfter = true;
        } else if (engaged) {
          shouldRun = true;
        } else if (detectEngageTrigger(text)) {
          shouldRun = true;
          await supabaseMain.from('work_groups')
            .update({ tom_chat_engaged_at: new Date().toISOString() }).eq('id', msg.group_id);
        }

        if (!shouldRun) return; // silêncio — já está salvo (memória)

        await processGroupChatMessage({
          supabase: supabaseMain, groupId: msg.group_id, senderCollabId, text,
        });

        if (clearAfter) {
          await supabaseMain.from('work_groups')
            .update({ tom_chat_engaged_at: null }).eq('id', msg.group_id);
          console.log(`[GroupChat] desengajado do grupo ${msg.group_id}`);
        }
      } catch (e) {
        console.error('[GroupChat] erro ao processar mensagem:', e.message);
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') console.log('[GroupChat] Conectado ao Realtime do chat de grupo');
      else if (status === 'CHANNEL_ERROR') console.warn(`[GroupChat] canal instável: ${(err && (err.message || String(err))) || 'reconectando'}`);
      else if (status === 'TIMED_OUT') console.warn('[GroupChat] timeout — reconectando');
      else if (status === 'CLOSED') console.log('[GroupChat] Canal fechado');
    });

  process.on('SIGTERM', () => { try { getRealtimeClient().removeChannel(channel); } catch {} });
  return channel;
}

module.exports = { startGroupChatRealtime };
```

- [ ] **Step 2: Syntax check**

Run: `cd _remote && node --check src/realtime/group-chat-realtime.js`
Expected: sem saída.

- [ ] **Step 3: Commit** (Stop hook.)

---

## Task 8: Ligar o watcher no index.js

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Adicionar o import (topo, junto dos outros requires)**

Localizar:
```js
const { startRealtime } = require('./realtime/tom-realtime');
```
Adicionar logo abaixo:
```js
const { startGroupChatRealtime } = require('./realtime/group-chat-realtime');
```

- [ ] **Step 2: Iniciar o watcher (dentro do `app.listen`, após `startRealtime`)**

Localizar:
```js
    startRealtime((phone, msg) => whatsapp.sendMessage(phone, msg), supabase);
```
Adicionar logo abaixo:
```js
    // Fase 2 — TOM engaja no chat de grupo (escuta role='member', responde role='tom')
    startGroupChatRealtime(supabase);
```

- [ ] **Step 3: Syntax check**

Run: `cd _remote && node --check src/index.js`
Expected: sem saída.

- [ ] **Step 4: Commit** (Stop hook.)

---

## Task 9: Deploy + validação e2e na VPS

**Files:** nenhum (deploy + verificação).

> **Esta task roda na sessão principal (controller), não num subagente.** Toca a produção; valida no banco real + logs do pm2.

- [ ] **Step 1: SCP dos arquivos novos + index.js**

```bash
scp D:/la-organizer/_remote/src/services/group-chat-triggers.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/services/group-chat-prompt.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/services/group-chat-tasks.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/services/group-chat-engine.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/services/group-chat-media.js tom:/opt/LA-Organizer/src/services/
scp D:/la-organizer/_remote/src/realtime/group-chat-realtime.js tom:/opt/LA-Organizer/src/realtime/
scp D:/la-organizer/_remote/src/index.js tom:/opt/LA-Organizer/src/index.js
```

- [ ] **Step 2: Restart + confirmar boot**

```bash
ssh tom "pm2 restart tom && sleep 3 && pm2 logs tom --lines 30 --nostream"
```
Expected: ver `[GroupChat] Iniciando subscriber...` e `[GroupChat] Conectado ao Realtime do chat de grupo`. Sem stack trace no boot.

- [ ] **Step 3: e2e — adicionar Alf ao Financeiro temporariamente e simular**

Via MCP `execute_sql` (grupo Financeiro — confirmar o id):
```sql
select id, name from work_groups where name ilike '%financeiro%';
```
Inserir uma mensagem de membro que chama o TOM (usar um sender_id real membro do grupo — Ana ou Rose):
```sql
insert into group_chat_messages (group_id, sender_id, role, kind, content, channel)
values ('<grupo_financeiro_id>', '<ana_ou_rose_collab_id>', 'member', 'text',
        'fala tom, cria uma tarefa: conferir o caixa de sexta', 'app');
```

- [ ] **Step 4: Verificar a resposta do TOM + a tarefa**

```bash
ssh tom "pm2 logs tom --lines 40 --nostream"
```
Expected nos logs: `[GroupChat] Conectado...` já estava; agora `[AI] Claude respondeu` + `[GroupChat] task actions grupo=... created=1`.

Via MCP `execute_sql`:
```sql
-- resposta do TOM gravada?
select role, kind, left(content, 120) as content, created_at
from group_chat_messages where group_id='<grupo_financeiro_id>' order by created_at desc limit 4;
-- tarefa entrou no pool?
select title, status, assigned_group_id, created_by, due_date
from tasks where assigned_group_id='<grupo_financeiro_id>' order by created_at desc limit 3;
```
Expected: uma linha `role='tom'` com a confirmação; uma `task` nova no pool com `assigned_group_id` do grupo.

- [ ] **Step 5: e2e — engajamento + desengajamento**

Inserir (mesmo grupo): `'tom, qual o status do pool?'` → TOM responde (engajado). Depois `'valeu tom!'` → TOM responde curto e `tom_chat_engaged_at` volta a NULL:
```sql
select tom_chat_engaged_at from work_groups where id='<grupo_financeiro_id>';
```
Expected após a despedida: NULL.

- [ ] **Step 6: e2e — silêncio (anti-intromissão)**

Inserir `'gente, alguém viu o relatório?'` (sem mencionar TOM, grupo NÃO engajado). Expected: NENHUMA linha `role='tom'` nova; nos logs nada além da entrega. Confirma que o TOM não se intromete.

- [ ] **Step 7: Limpeza dos dados de teste**

> Deletar dados de produção exige só este OK explícito do plano (são dados de teste que EU criei nesta validação).
```sql
delete from group_chat_messages where group_id='<grupo_financeiro_id>' and created_at > now() - interval '30 min';
delete from tasks where assigned_group_id='<grupo_financeiro_id>' and title ilike '%conferir o caixa de sexta%';
update work_groups set tom_chat_engaged_at=null where id='<grupo_financeiro_id>';
```
Confirmar Financeiro = Ana+Rose (sem Alf de teste, se foi adicionado).

- [ ] **Step 8: Registrar known issue de referência (não-bug, marco)**

Não é bug — pular o INSERT em `tom_known_issues`. Em vez disso, atualizar a spec: STATUS Fase 2 ENTREGUE + validada.

---

## Task 10: Atualizar a spec + radar

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-chat-grupo-design.md`

- [ ] **Step 1: Atualizar o bloco STATUS** no topo da spec: marcar "Fase 2 ENTREGUE + validada na VPS" com data, resumindo o que entrou (watcher, engage state, task no pool, extração de mídia) e o que fica pra Fase 3 (proativo de fim de sessão).

- [ ] **Step 2: Commit** (Stop hook.)

---

## Self-Review (feito ao escrever)

**Cobertura da spec (seção "TOM no chat (Fase 2)"):**
- ✅ Watcher subscreve INSERTs role='member' → Task 7.
- ✅ Entrada por menção / engajado / saída por despedida → Tasks 2 + 7.
- ✅ `tom_chat_engaged_at` → Task 1 + 7.
- ✅ "Engine reusado" — reusa o **parser** exportado (`parseTaskUpdateMarker`); o applier é dedicado ao pool (decisão consciente de reduzir raio de impacto vs. reusar `applyTaskActions` do WhatsApp) → Tasks 4 + 5.
- ✅ Resposta = INSERT role='tom' (não WhatsApp) → Task 5.
- ✅ Anexos → Vision/Whisper → `media_extracted_text` → Task 6 + 7.
- ✅ Anti-loop (só role='member') → Task 7.
- ✅ Custo: regex barata antes da IA → Task 7 (só chama engine se shouldRun).

**Decisões registradas (a confirmar com Alf):**
1. Applier dedicado ao pool em vez de reusar `applyTaskActions` do WhatsApp (mais seguro, menos efeito colateral).
2. Janela de engajamento = 10 min.
3. PDF não tem extração automática nesta fase (Vision/Whisper não leem PDF).
4. Tarefa criada no chat: `created_by=remetente`, `assigned_group_id=grupo`, vai pro pool (igual ao workspace).

**Consistência de tipos:** `parseTaskUpdateMarker` retorna `{ actions, cleanText, malformed }` (confirmado no engine.js:374). `applyGroupChatTaskActions` retorna `{ created, completed, failed }` — usado fielmente no engine (Task 5).

**Sem placeholders:** todo arquivo tem código completo; os 2 pontos de "AJUSTAR à assinatura real" (Task 6, mídia) estão explicitamente marcados com o comando pra ler a assinatura antes (Step 1 da Task 6) — não é placeholder de lógica, é adaptação de I/O a confirmar.
