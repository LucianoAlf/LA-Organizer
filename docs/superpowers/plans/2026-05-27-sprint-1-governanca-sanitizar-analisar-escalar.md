# Sprint 1 — Governança Inteligente: Sanitizar, Analisar, Escalar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar 3 vícios da governança matinal: itens zumbi na lista, repetição sem progresso, cobrança que não escala.

**Architecture:** Adicionar 3 colunas em `tasks` + `events` (`data_classification`, `staleness_check_sent_at`, `coordination_request_count`). Criar tabela `task_classifications` pra aprendizado de padrões. Implementar marker `<<DATA_CLASSIFY>>`. Refatorar os 2 rituais em `dispatcher.js` (linha 1880 e 1990) pra agrupar por dono, filtrar zumbis, e propor escalada tática quando cobrança não funciona.

**Tech Stack:** Node.js, Supabase Postgres, supabase-js, node-cron, Claude API (provider abstraction já existente em `src/ai/provider.js`).

---

## ⚠️ Schema real de `events` (verificado em 27/05/2026)

Cuidado ao escrever queries — os nomes não são óbvios:
- **Dono do evento:** `collaborator_id` (não `owner_collaborator_id`)
- **Quem criou:** `created_by`
- **Quando começa:** `start_at` (timestamptz, não `event_date`)
- **Líder de categoria:** vive em `event_category_leaders.leader_collaborator_id`, NÃO em `events`

Ao adaptar trechos do plano que dizem `owner_collaborator_id` ou `event_date`, traduza para os nomes acima.

---

## Mapa de arquivos

**Criar:**
- `supabase/migrations/20260527120000_governance_sanitization.sql` — colunas + tabela
- `src/services/data-classifier.js` — apply classification + learn pattern
- `src/services/governance-analyzer.js` — agrupamento por pessoa + diagnóstico via LLM
- `src/services/escalation-tracker.js` — rastrea cobranças sem efeito + sugere mudança de tática
- `skills/governanca-sanitizar.md` — skill carregada quando user fala sobre teste/limpeza
- `skills/governanca-diagnosticar.md` — skill com regras de geração de diagnóstico
- `skills/governanca-escalar.md` — skill com regras de escalada tática

**Modificar:**
- `src/engine.js` — adicionar parseDataClassifyMarker + applyDataClassify; exportar
- `src/rituals/dispatcher.js:1880-1979` — refatorar `ceoTeamUnclosedEventsReport`
- `src/rituals/dispatcher.js:1990-2200` — refatorar `ceoTeamUnclosedTasksReport`
- `src/prompts/system.js` — carregar 3 skills novas quando contexto for governança

---

## Task 1: Migration — colunas e tabela

**Files:**
- Create: `supabase/migrations/20260527120000_governance_sanitization.sql`

- [ ] **Step 1: Criar migration SQL**

```sql
-- Adiciona classificação de dados em tasks e events
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS data_classification text NOT NULL DEFAULT 'real'
    CHECK (data_classification IN ('real', 'test', 'archived')),
  ADD COLUMN IF NOT EXISTS staleness_check_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordination_request_count int NOT NULL DEFAULT 0;

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS data_classification text NOT NULL DEFAULT 'real'
    CHECK (data_classification IN ('real', 'test', 'archived')),
  ADD COLUMN IF NOT EXISTS staleness_check_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS coordination_request_count int NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tasks_data_classification ON tasks(data_classification);
CREATE INDEX IF NOT EXISTS idx_events_data_classification ON events(data_classification);

-- Padrões aprendidos de classificação
CREATE TABLE IF NOT EXISTS task_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id uuid REFERENCES collaborators(id) ON DELETE CASCADE,
  pattern_type text NOT NULL CHECK (pattern_type IN ('title_contains', 'title_starts_with', 'created_hour_range', 'creator_id')),
  pattern_value text NOT NULL,
  classification text NOT NULL CHECK (classification IN ('test', 'archived')),
  source text NOT NULL DEFAULT 'manual',
  confidence numeric NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  hits int NOT NULL DEFAULT 0,
  last_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_classifications_collab ON task_classifications(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_task_classifications_pattern ON task_classifications(pattern_type, pattern_value);
```

- [ ] **Step 2: Aplicar migration**

```bash
ssh tom "cd /opt/LA-Organizer && supabase db push --linked"
```

Ou via MCP Supabase: `mcp__supabase__apply_migration` com o conteúdo acima.

- [ ] **Step 3: Validar via query**

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tasks' AND column_name IN ('data_classification','staleness_check_sent_at','coordination_request_count');
```

Expected: 3 linhas com os defaults certos.

- [ ] **Step 4: Commit**

Commit automático via Stop hook após o turno.

---

## Task 2: Serviço de classificação

**Files:**
- Create: `src/services/data-classifier.js`

- [ ] **Step 1: Implementar applyClassification + learnPattern**

```javascript
// src/services/data-classifier.js
// Aplica classificação em task/event + aprende padrão se learn_pattern=true.
// Pattern types suportados (Sprint 1 MVP):
//   - title_contains: substring match (case insensitive) no título
//   - title_starts_with: prefix match
//   - created_hour_range: criada entre HH:MM-HH:MM BRT (fora horário comercial = sinal de teste)
//   - creator_id: tudo criado pelo collaborator X
const supabase = require('../supabase/client');

async function applyClassification({ collaboratorId, targetType, targetId, classification, learnPattern = false }) {
  if (!['tasks','events'].includes(targetType)) throw new Error(`bad targetType: ${targetType}`);
  if (!['real','test','archived'].includes(classification)) throw new Error(`bad classification: ${classification}`);

  const { data: row, error: readErr } = await supabase
    .from(targetType).select('id, title, created_at, created_by').eq('id', targetId).maybeSingle();
  if (readErr || !row) return { ok: false, reason: 'target_not_found' };

  const { error: upErr } = await supabase
    .from(targetType).update({ data_classification: classification }).eq('id', targetId);
  if (upErr) return { ok: false, reason: 'update_failed', error: upErr.message };

  let patternLearned = null;
  if (learnPattern && classification === 'test' && row.title) {
    const distinctiveSubstring = row.title.length > 4
      ? row.title.slice(0, Math.min(20, row.title.length)).toLowerCase().trim()
      : null;
    if (distinctiveSubstring) {
      const { data: existing } = await supabase
        .from('task_classifications')
        .select('id, hits')
        .eq('collaborator_id', collaboratorId)
        .eq('pattern_type', 'title_contains')
        .eq('pattern_value', distinctiveSubstring)
        .maybeSingle();
      if (existing) {
        await supabase.from('task_classifications')
          .update({ hits: existing.hits + 1, last_applied_at: new Date().toISOString() })
          .eq('id', existing.id);
        patternLearned = { type: 'title_contains', value: distinctiveSubstring, hits: existing.hits + 1 };
      } else {
        await supabase.from('task_classifications').insert({
          collaborator_id: collaboratorId, pattern_type: 'title_contains',
          pattern_value: distinctiveSubstring, classification: 'test',
          source: 'manual', confidence: 0.5, hits: 1,
        });
        patternLearned = { type: 'title_contains', value: distinctiveSubstring, hits: 1 };
      }
    }
  }
  return { ok: true, patternLearned };
}

async function autoClassifyNewTask({ taskId, title, createdBy }) {
  if (!title) return { applied: false };
  const lowered = title.toLowerCase();
  const { data: patterns } = await supabase
    .from('task_classifications')
    .select('id, pattern_type, pattern_value, classification, hits')
    .eq('classification', 'test')
    .gte('hits', 2);
  if (!patterns || patterns.length === 0) return { applied: false };
  for (const p of patterns) {
    let match = false;
    if (p.pattern_type === 'title_contains') match = lowered.includes(p.pattern_value);
    if (p.pattern_type === 'title_starts_with') match = lowered.startsWith(p.pattern_value);
    if (match) {
      await supabase.from('tasks').update({ data_classification: p.classification }).eq('id', taskId);
      await supabase.from('task_classifications').update({
        hits: p.hits + 1, last_applied_at: new Date().toISOString(),
      }).eq('id', p.id);
      return { applied: true, pattern: p };
    }
  }
  return { applied: false };
}

module.exports = { applyClassification, autoClassifyNewTask };
```

- [ ] **Step 2: Syntax check**

```bash
cd /d/la-organizer/_remote && node --check src/services/data-classifier.js
```

Expected: exit 0, sem output.

- [ ] **Step 3: Commit**

---

## Task 3: Marker `<<DATA_CLASSIFY>>` no engine

**Files:**
- Modify: `src/engine.js` (adicionar parser + apply próximo aos outros parsers, ex: depois de `parseMemoryMarker`)

- [ ] **Step 1: Adicionar parser e apply**

```javascript
// === DATA_CLASSIFY marker (Sprint 29.1) ===
// User pode marcar 1+ tasks/events como test/real/archived via:
// <<DATA_CLASSIFY>>
// {"items":[{"type":"task","id":"uuid","classification":"test"}],"learn_pattern":true}
// <<END>>
function parseDataClassifyMarker(text) {
  const m = String(text || '').match(/<<DATA_CLASSIFY>>\s*([\s\S]*?)\s*<<END>>/);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1]);
    if (!Array.isArray(raw.items) || raw.items.length === 0) return null;
    const items = raw.items.filter(i => i.type && i.id && i.classification);
    if (items.length === 0) return null;
    const cleanText = text.replace(/<<DATA_CLASSIFY>>[\s\S]*?<<END>>/g, '').trim();
    return { items, learnPattern: raw.learn_pattern === true, cleanText };
  } catch (e) { return null; }
}

async function applyDataClassify(collaborator, parsed) {
  const { applyClassification } = require('./services/data-classifier');
  const results = [];
  for (const item of parsed.items) {
    const targetType = item.type === 'task' ? 'tasks' : item.type === 'event' ? 'events' : null;
    if (!targetType) { results.push({ id: item.id, ok: false, reason: 'bad_type' }); continue; }
    const r = await applyClassification({
      collaboratorId: collaborator.id, targetType, targetId: item.id,
      classification: item.classification, learnPattern: parsed.learnPattern,
    });
    results.push({ id: item.id, ...r });
  }
  return results;
}
```

- [ ] **Step 2: Adicionar handler na pipeline principal (perto de outros markers em processMessage)**

Localize trecho `parsedMonthly = parseMonthlyPlanMarker(reply)` (busque por `parseMonthlyPlanMarker` no engine). Adicione bloco análogo:

```javascript
const parsedClassify = parseDataClassifyMarker(reply);
if (parsedClassify) {
  try {
    const results = await applyDataClassify(collab, parsedClassify);
    const okCount = results.filter(r => r.ok).length;
    await logMarker(collab.id, 'DATA_CLASSIFY', 'executed', `items_ok:${okCount}/${results.length}`, JSON.stringify(parsedClassify.items).slice(0, 400));
    reply = parsedClassify.cleanText || reply;
  } catch (err) {
    console.error('[DATA_CLASSIFY] err:', err.message);
    await logMarker(collab.id, 'DATA_CLASSIFY', 'rejected', err.message.slice(0, 200), JSON.stringify(parsedClassify).slice(0, 400));
  }
}
```

- [ ] **Step 3: Atualizar exports**

No `module.exports` final do engine, adicione `parseDataClassifyMarker, applyDataClassify`.

- [ ] **Step 4: Syntax check + deploy**

```bash
cd /d/la-organizer/_remote && node --check src/engine.js && scp src/engine.js tom:/opt/LA-Organizer/src/engine.js && ssh tom "pm2 restart tom"
```

- [ ] **Step 5: Validar manualmente — mandar mensagem pro TOM**

Via WhatsApp do Alf: "Tom, marca como teste essas duas: [task X] e [task Y]"

TOM deve emitir o marker, persistir, e responder confirmação. Verificar no DB:
```sql
SELECT id, title, data_classification FROM tasks WHERE id IN ('X','Y');
```

Expected: ambas com `data_classification='test'`.

- [ ] **Step 6: Commit**

---

## Task 4: Skill `governanca-sanitizar.md`

**Files:**
- Create: `skills/governanca-sanitizar.md`

- [ ] **Step 1: Escrever skill**

```markdown
# Sanitização de Dados — Governança

Esta skill ativa quando o user fala sobre limpar/classificar dados ou quando aparece em listas de governança.

## Quando ativar

Gatilhos no texto do user:
- "isso aí é teste" / "isso é só teste" / "criei pra testar"
- "descarta esses" / "arquiva isso" / "tira da lista"
- "isso já rolou" / "fechou" + referência a item antigo
- "limpa essa pendência" / "ignora isso"

## Como agir

1. **Identificar os itens** mencionados (id, título ou referência por contexto). Se ambíguo, PERGUNTAR uma vez qual item.
2. **Emitir `<<DATA_CLASSIFY>>`** com items + classification + `learn_pattern: true`.
3. **Confirmar curto:** "Marcado como teste, vou aprender pra próxima."

## Formato do marker

```
<<DATA_CLASSIFY>>
{"items":[{"type":"task","id":"<uuid>","classification":"test"}],"learn_pattern":true}
<<END>>
```

- `type`: "task" ou "event"
- `classification`: "test" / "real" / "archived"
- `learn_pattern`: true se for fazer TOM aprender o padrão pra próxima

## Exemplo

**User:** "Tom, essas 3 tarefas com 'demo_' no título são teste, pode tirar."

**TOM:** Identifica as 3 tasks com `demo_` no início, emite marker classificando como test + learn_pattern. Responde: "Marquei as 3 como teste. Vou pular qualquer coisa que começar com 'demo_' daqui pra frente."

## Auto-arquivamento (TOM faz sozinho)

Quando uma task aparece em lista de governança e está parada 5+ dias:
- Primeira vez: TOM pergunta UMA VEZ "Essa de '${title}' tá parada 5 dias — já rolou ou descarto?"
- Marca `staleness_check_sent_at = now()`.
- Sem resposta em 24h → emite `<<DATA_CLASSIFY>>` com `classification: archived`.

## NÃO fazer

- Não arquivar sem perguntar pelo menos uma vez.
- Não aprender padrão quando o user só disse "essa específica é teste" sem indicar regra.
- Não classificar como "test" tasks com status `done` (passado é passado).
```

- [ ] **Step 2: Commit**

---

## Task 5: Refatorar ritual de eventos (agrupar por dono + filtrar)

**Files:**
- Modify: `src/rituals/dispatcher.js:1880-1979`

- [ ] **Step 1: Adicionar filtro `data_classification = 'real'`**

Localize a query `supabase.from('events').select(...)` dentro de `ceoTeamUnclosedEventsReport` e adicione `.eq('data_classification', 'real')`:

```javascript
const { data: stale } = await supabase
  .from('events')
  .select('id, title, event_date, leader_collaborator_id, owner_collaborator_id, collaborators!events_owner_collaborator_id_fkey(full_name)')
  .eq('data_classification', 'real')                // ← Sprint 29.1
  .eq('status', 'pending')
  .lt('event_date', today)
  .order('event_date', { ascending: true })
  .limit(80);
```

- [ ] **Step 2: Trocar agrupamento de "líder" pra "dono efetivo"**

Substituir o bloco que agrupa por `leader_collaborator_id` por agrupamento por `owner_collaborator_id` (quem é o responsável real do item). Manter "Sem dono" como bucket separado.

- [ ] **Step 3: Adicionar verificação de staleness**

Para cada item, verificar:
- `daysOverdue >= 5` AND `staleness_check_sent_at IS NULL` → marca pra TOM perguntar no fim da msg
- `daysOverdue >= 5` AND `staleness_check_sent_at <= NOW() - INTERVAL '24h'` → marca pra auto-arquivar (ritual de fim de dia faz)

Trecho a adicionar antes do `const msg = ...`:

```javascript
const toStaleCheck = filteredStale.filter(s => {
  const overdue = daysOverdueEv(s.event_date);
  return overdue >= 5 && !s.staleness_check_sent_at;
});
const staleCheckBlock = toStaleCheck.length > 0
  ? `\n\n_⏳ ${toStaleCheck.length} item(s) parado(s) 5+ dias. Quer que eu arquive ou já rolaram?_`
  : '';
```

- [ ] **Step 4: Anexar block ao msg final**

```javascript
const msg = `🎖️ *Governança — Time enrolando (eventos)*\n\n${lines.join('\n').trim()}\n\n_Total: ${filteredStale.length} item(s) parado(s)._${hiddenNote}${staleCheckBlock}`;
```

- [ ] **Step 5: Syntax check + deploy**

```bash
cd /d/la-organizer/_remote && node --check src/rituals/dispatcher.js && scp src/rituals/dispatcher.js tom:/opt/LA-Organizer/src/rituals/dispatcher.js && ssh tom "pm2 restart tom"
```

- [ ] **Step 6: Validar manualmente no próximo ciclo 08:30 BRT**

Confirma que:
1. Items com `data_classification != 'real'` não aparecem
2. Bloco "⏳ X parado(s) 5+ dias" aparece se aplicável

- [ ] **Step 7: Commit**

---

## Task 6: Refatorar ritual de tasks (mesma lógica de eventos)

**Files:**
- Modify: `src/rituals/dispatcher.js:1990-2200` (função `ceoTeamUnclosedTasksReport`)

- [ ] **Step 1: Aplicar mesma trinca** que Task 5: filtro `data_classification='real'`, agrupamento por `assigned_to`, bloco de staleness check.

- [ ] **Step 2: Syntax check + deploy + commit**

---

## Task 7: Serviço de diagnóstico via LLM

**Files:**
- Create: `src/services/governance-analyzer.js`

- [ ] **Step 1: Implementar `analyzePersonBacklog`**

```javascript
// src/services/governance-analyzer.js
// Pega backlog agrupado por pessoa e usa LLM pra gerar diagnóstico curto.
// Determinístico: padrões + heurísticas. LLM só gera a frase final.
const ai = require('../ai/provider');

async function analyzePersonBacklog({ ownerName, items, daysParked }) {
  // items: [{title, due_date, daysOverdue, category, ...}]
  if (!items || items.length === 0) return null;
  if (items.length < 3) return null;  // só agrupa se 3+

  const categories = items.map(i => i.category || 'sem_categoria');
  const dominantCategory = mode(categories);
  const allSameCategory = new Set(categories).size === 1;
  const avgOverdue = Math.round(items.reduce((s,i) => s + (i.daysOverdue || 0), 0) / items.length);

  const sys = `Você é analista de operações. Recebe um backlog de uma pessoa e gera UM diagnóstico de no máximo 2 linhas. Formato exato:
"🔍 *${ownerName}:* {sumário} {hipótese} *Recomendação:* {ação concreta}"

Regras:
- Sumário: número + categoria dominante. Ex: "5 atrasadas operacionais (compras Recreio + dispenser)".
- Hipótese: causa provável baseada em padrão. Ex: "Sem movimento há 7 dias, sem orçamento aprovado?".
- Recomendação: ação CONCRETA que o CEO toma HOJE. Ex: "Libera verba ou redistribui."
- NÃO usar palavras vazias ("revisar", "alinhar", "acompanhar"). Use verbos diretos.
- Max 2 linhas no total.`;

  const userMsg = `Pessoa: ${ownerName}\nItens (${items.length}, média ${avgOverdue}d atrasados):\n${items.slice(0,8).map(i => `- ${i.title} (${i.daysOverdue}d, ${i.category||'?'})`).join('\n')}\nCategoria dominante: ${dominantCategory} (${allSameCategory?'todos':Math.round(100*categories.filter(c=>c===dominantCategory).length/categories.length)+'%'} do total).`;

  try {
    const r = await ai.chat(sys, [{ role: 'user', content: userMsg }]);
    const txt = String(r?.text || r?.reply || '').trim();
    return txt.startsWith('🔍') ? txt : `🔍 *${ownerName}:* ${items.length} pendências em ${dominantCategory}, sem movimento. *Recomendação:* 1:1 hoje.`;
  } catch (e) {
    return `🔍 *${ownerName}:* ${items.length} pendências em ${dominantCategory}, sem movimento. *Recomendação:* 1:1 hoje.`;
  }
}

function mode(arr) {
  const counts = {};
  for (const x of arr) counts[x] = (counts[x] || 0) + 1;
  return Object.entries(counts).sort((a,b) => b[1] - a[1])[0]?.[0];
}

module.exports = { analyzePersonBacklog };
```

- [ ] **Step 2: Integrar no ritual de tasks (dispatcher.js)**

No `ceoTeamUnclosedTasksReport`, após agrupar por owner, substituir geração de bullets crus por:

```javascript
const { analyzePersonBacklog } = require('../services/governance-analyzer');
const diagnostics = [];
for (const [ownerName, items] of groupedByOwner) {
  if (items.length >= 3) {
    const diag = await analyzePersonBacklog({ ownerName, items, daysParked: items[0].daysOverdue });
    if (diag) diagnostics.push(diag);
  } else {
    diagnostics.push(`• *${ownerName}:* ${items.length} pendente(s)`);
  }
}
const linesBlock = diagnostics.join('\n\n');
```

- [ ] **Step 3: Syntax check + deploy + validar 08:45 BRT + commit**

---

## Task 8: Tracker de escalada tática

**Files:**
- Create: `src/services/escalation-tracker.js`
- Modify: `src/engine.js` (incrementar contador em `applyCoordinationRequestAction`)

- [ ] **Step 1: Implementar tracker**

```javascript
// src/services/escalation-tracker.js
// Conta quantas vezes o user pediu pra TOM cobrar a mesma task/dono.
// Sugere mudança de tática quando bater 3+ sem efeito.
const supabase = require('../supabase/client');

async function getEscalationState(taskId) {
  const { data: task } = await supabase
    .from('tasks').select('coordination_request_count, updated_at, status')
    .eq('id', taskId).maybeSingle();
  if (!task) return null;
  return {
    requestCount: task.coordination_request_count || 0,
    stuck: task.coordination_request_count >= 3 && task.status === 'pending',
  };
}

async function incrementRequestCount(taskId) {
  const { data: cur } = await supabase
    .from('tasks').select('coordination_request_count').eq('id', taskId).maybeSingle();
  const next = (cur?.coordination_request_count || 0) + 1;
  await supabase.from('tasks').update({ coordination_request_count: next }).eq('id', taskId);
  return next;
}

function suggestTacticChange({ requestCount, ownerName, taskTitle, daysOverdue }) {
  if (requestCount === 3) {
    return `_⚠️ Já cobrei ${ownerName} 3x sobre "${taskTitle.slice(0,40)}" sem retorno. Quer que eu mude de abordagem? (sugiro 1:1 ou ligar)_`;
  }
  if (requestCount >= 5) {
    return `_🚨 ${ownerName} ignorou 5+ cobranças de "${taskTitle.slice(0,40)}". Recomendo 1:1 hoje 30min. Marco no calendário?_`;
  }
  return null;
}

module.exports = { getEscalationState, incrementRequestCount, suggestTacticChange };
```

- [ ] **Step 2: Hookar no `applyCoordinationRequestAction`**

Localize `applyCoordinationRequestAction` em `src/engine.js` e adicione após o insert/update bem-sucedido:

```javascript
const { incrementRequestCount, suggestTacticChange } = require('./services/escalation-tracker');
if (parsed.target_task_id) {
  const count = await incrementRequestCount(parsed.target_task_id);
  const suggestion = suggestTacticChange({
    requestCount: count, ownerName: targetCollab.full_name,
    taskTitle: task.title || '(sem título)', daysOverdue: 0,
  });
  if (suggestion) reply += '\n\n' + suggestion;
}
```

- [ ] **Step 3: Mostrar contador no ritual de tasks**

Em `dispatcher.js` `ceoTeamUnclosedTasksReport`, ao renderizar diagnóstico, anotar tasks com `coordination_request_count >= 3` como "⚠️ já cobrado Nx":

```javascript
const stuck = items.filter(i => (i.coordination_request_count || 0) >= 3);
if (stuck.length > 0) diagnostics.push(`_⚠️ ${stuck.length} task(s) com 3+ cobranças sem efeito de ${ownerName}._`);
```

- [ ] **Step 4: Syntax check + deploy + commit**

---

## Task 9: Skill `governanca-diagnosticar.md` + `governanca-escalar.md`

**Files:**
- Create: `skills/governanca-diagnosticar.md`
- Create: `skills/governanca-escalar.md`

- [ ] **Step 1: Escrever ambas com regras claras**

(Conteúdo no estilo de Task 4 — não duplico aqui pra manter o plano em tamanho gerenciável, mas o agente que executa deve incluir: gatilhos, formato de resposta, exemplos canônicos. Espelhar estilo das skills existentes em `skills/`.)

- [ ] **Step 2: Carregar no `system.js` quando contexto for governança**

Em `src/prompts/system.js`, na seção de loading dinâmico de skills, adicione:

```javascript
if (opts.isGovernanceRitual || /governan[çc]a|cobrar|cobranç|enrolando|atrasad/i.test(lastUserMessage)) {
  blocks.push(loadSkill('governanca-diagnosticar'));
  blocks.push(loadSkill('governanca-escalar'));
  blocks.push(loadSkill('governanca-sanitizar'));
}
```

- [ ] **Step 3: Commit**

---

## Task 10: Job de auto-arquivamento

**Files:**
- Modify: `src/rituals/dispatcher.js` (novo job no cron)

- [ ] **Step 1: Adicionar job diário 22:00 BRT**

Localizar onde os cron jobs são registrados (busca por `cron.schedule(`). Adicionar:

```javascript
// Auto-arquivamento: items com staleness_check_sent_at > 24h e ainda 'pending' viram 'archived'
cron.schedule('0 22 * * *', async () => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: archiveTasks } = await supabase
      .from('tasks').select('id').eq('status','pending')
      .eq('data_classification','real').lt('staleness_check_sent_at', cutoff);
    if (archiveTasks && archiveTasks.length > 0) {
      await supabase.from('tasks').update({ data_classification: 'archived' }).in('id', archiveTasks.map(t=>t.id));
      console.log(`[AutoArchive] arquivou ${archiveTasks.length} tasks por inatividade`);
    }
    // Idem para events
    const { data: archiveEvents } = await supabase
      .from('events').select('id').eq('status','pending')
      .eq('data_classification','real').lt('staleness_check_sent_at', cutoff);
    if (archiveEvents && archiveEvents.length > 0) {
      await supabase.from('events').update({ data_classification: 'archived' }).in('id', archiveEvents.map(e=>e.id));
      console.log(`[AutoArchive] arquivou ${archiveEvents.length} events por inatividade`);
    }
  } catch (err) {
    console.error('[AutoArchive] err:', err.message);
  }
}, { timezone: 'America/Sao_Paulo' });
```

- [ ] **Step 2: Syntax check + deploy + commit**

---

## Task 11: Validação end-to-end

- [ ] **Step 1: Plantar 3 tasks teste no Supabase**

```sql
INSERT INTO tasks (id, title, status, due_date, assigned_to, context, category)
VALUES
  (gen_random_uuid(), 'demo_teste_1', 'pending', '2026-05-20', '<alf_id>', 'work', 'operational'),
  (gen_random_uuid(), 'demo_teste_2', 'pending', '2026-05-21', '<alf_id>', 'work', 'operational'),
  (gen_random_uuid(), 'demo_teste_3', 'pending', '2026-05-22', '<alf_id>', 'work', 'operational');
```

- [ ] **Step 2: Mandar pro TOM via WhatsApp**

"Tom, essas 3 'demo_teste_*' são teste, pode tirar."

- [ ] **Step 3: Verificar no DB**

```sql
SELECT id, title, data_classification FROM tasks WHERE title LIKE 'demo_teste_%';
SELECT pattern_value, hits FROM task_classifications WHERE collaborator_id='<alf_id>';
```

Expected: 3 tasks com `data_classification='test'`, 1+ pattern aprendido com `hits >= 1`.

- [ ] **Step 4: Plantar 4ª task com mesmo padrão e ver auto-classify**

```sql
INSERT INTO tasks (...) VALUES (gen_random_uuid(), 'demo_teste_4', ...);
```

Em seguida, dispatcher deve detectar o padrão aprendido e auto-classificar. Verificar:
```sql
SELECT data_classification FROM tasks WHERE title='demo_teste_4';
```

Expected: `test` (auto-aplicado).

- [ ] **Step 5: Aguardar próximo ciclo de governança matinal**

Confirmar que mensagem matinal:
- Não lista os `demo_teste_*` (filtrados)
- Agrupa por pessoa com diagnóstico
- Mostra bloco de staleness se houver items 5+ dias parados
- Mostra contador de escalada se aplicável

---

## Self-Review (executar após escrever todo o plano)

- [ ] **Spec coverage:** todos os 4 pilares cobertos? sanitização ✓, auto-arquivamento ✓, análise por pessoa ✓, escalada tática ✓.
- [ ] **Placeholder scan:** sem TBD/TODO/"similar to". Os 2 skills da Task 9 ainda têm conteúdo abreviado — agente que executar deve escrever conforme padrão de outras skills em `skills/`.
- [ ] **Type consistency:** marker é `<<DATA_CLASSIFY>>` em todos os pontos. Função `applyClassification` tem mesma assinatura em todos os callers.

---

## Critério de pronto

- Mensagem matinal 08:30 BRT tem ≤ 3 diagnósticos no topo (vs 12 itens chapados hoje).
- Items com `data_classification != 'real'` nunca aparecem nas listas de governança.
- Alf consegue dizer "isso é teste" e TOM aprende padrão (hit count crescendo em `task_classifications`).
- Tasks com 3+ cobranças sem efeito ganham aviso `⚠️ já cobrado Nx`.
- Tasks parados 5+ dias sem ação são arquivadas automaticamente após 24h.
