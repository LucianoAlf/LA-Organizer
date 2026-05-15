# Janela Temporal Mensal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Injetar bloco de stats mensais (tarefas + eventos + hábitos + checklists) no contexto do TOM, ativado por keyword ou pelos últimos 7 dias do mês.

**Architecture:** Duas novas funções em `system.js` (`fetchMonthlyStats` + `buildMonthlyContextBlock`) + trigger no `buildSystemPrompt` + novo param em `buildContext`. Zero mudança em DB, frontend ou dispatcher.

**Tech Stack:** Node.js CommonJS, Supabase JS Client, America/Sao_Paulo TZ

---

## Arquivo modificado

- **Modify:** `D:\la-organizer\_remote\src\prompts\system.js`
  - Adicionar `fetchMonthlyStats()` após `fetchPeriodStats` (~linha 1661)
  - Adicionar `buildMonthlyContextBlock()` após `fetchMonthlyStats`
  - Atualizar assinatura de `buildContext()` (adicionar `monthlyCtxBlock = null` como último param) (~linha 177)
  - Injetar `monthlyCtxBlock` em `buildContext` (após bloco `doneFutureTasks`, antes de eventos)
  - Em `buildSystemPrompt()` (~linha 1738): detectar keywords + isEndOfMonth, chamar `buildMonthlyContextBlock`, passar para `buildContext`
  - Atualizar call site de `buildContext` (~linha 1852) para passar `monthlyCtxBlock`

---

## Task 1: Adicionar `fetchMonthlyStats()`

**Files:**
- Modify: `src/prompts/system.js` (após linha 1661, dentro do bloco das funções `brtMonthRange`/`fetchPeriodStats`)

- [ ] **Step 1: Localizar o fim de `fetchPeriodStats`**

  Buscar a linha que contém `return { total, done, pending, cancelled, pct, events: events.length };` e a chave `}` de fechamento logo abaixo. A nova função vai imediatamente após essa chave.

- [ ] **Step 2: Inserir `fetchMonthlyStats` imediatamente após `fetchPeriodStats`**

```js
// Busca stats completos (todas contexts) para bloco de contexto mensal.
// Diferença de fetchPeriodStats: sem filtro context='work', inclui habit_logs e op_checklist_completions.
async function fetchMonthlyStats(collabId, from, to) {
  const [tasksRes, eventsRes, habitsRes, checklistsRes] = await Promise.all([
    supabase.from('tasks')
      .select('id, status')
      .eq('assigned_to', collabId)
      .gte('due_date', from)
      .lte('due_date', to),
    supabase.from('events')
      .select('id')
      .eq('collaborator_id', collabId)
      .gte('start_at', `${from}T00:00:00-03:00`)
      .lte('start_at', `${to}T23:59:59-03:00`)
      .neq('status', 'cancelled'),
    supabase.from('habit_logs')
      .select('id, is_completed')
      .eq('collaborator_id', collabId)
      .gte('log_date', from)
      .lte('log_date', to),
    supabase.from('op_checklist_completions')
      .select('id, completed_at')
      .eq('collaborator_id', collabId)
      .gte('reference_date', from)
      .lte('reference_date', to),
  ]);
  const tasks = tasksRes.data || [];
  const events = eventsRes.data || [];
  const habits = habitsRes.data || [];
  const checklists = checklistsRes.data || [];
  return {
    tasks: {
      total: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      pending: tasks.filter(t => !['done', 'cancelled'].includes(t.status)).length,
      cancelled: tasks.filter(t => t.status === 'cancelled').length,
    },
    events: events.length,
    habits: {
      total: habits.length,
      done: habits.filter(h => h.is_completed).length,
    },
    checklists: {
      total: checklists.length,
      done: checklists.filter(c => c.completed_at !== null).length,
    },
  };
}
```

- [ ] **Step 3: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/prompts/system.js
```

Esperado: sem output (sem erros).

---

## Task 2: Adicionar `buildMonthlyContextBlock()`

**Files:**
- Modify: `src/prompts/system.js` (imediatamente após `fetchMonthlyStats`)

- [ ] **Step 1: Inserir `buildMonthlyContextBlock` imediatamente após `fetchMonthlyStats`**

```js
/**
 * Monta bloco compacto de stats do mês atual + comparativo com mês anterior.
 * Ativado por keyword ou nos últimos 7 dias do mês.
 * Retorna string formatada ou null em caso de erro.
 */
async function buildMonthlyContextBlock(collabId) {
  try {
    const cur  = brtMonthRange(0);
    const prev = brtMonthRange(-1);
    const today = brtYmd();
    // Se ainda estamos dentro do mês, vai só até hoje; se mês virou, vai ao fim.
    const toDate = today <= cur.to ? today : cur.to;

    const [curStats, prevStats] = await Promise.all([
      fetchMonthlyStats(collabId, cur.from, toDate),
      fetchMonthlyStats(collabId, prev.from, prev.to),
    ]);

    const dayNow   = parseInt(toDate.slice(8), 10);
    const totalDays = parseInt(cur.to.slice(8), 10);
    const dayLabel = today < cur.to ? `1–${dayNow} de ${totalDays}` : `1–${totalDays}`;

    const lines = [`📅 *${cur.label} (${dayLabel}):*`];

    if (curStats.tasks.total > 0) {
      const pct = Math.round((curStats.tasks.done / curStats.tasks.total) * 100);
      lines.push(
        `• Tarefas: ${curStats.tasks.done} ✅ | ${curStats.tasks.pending} ⏳` +
        (curStats.tasks.cancelled ? ` | ${curStats.tasks.cancelled} canceladas` : '') +
        ` (${pct}% concluído)`
      );
    }

    if (curStats.events > 0) {
      lines.push(`• Compromissos: ${curStats.events} no mês`);
    }

    if (curStats.habits.total > 0) {
      const pct = Math.round((curStats.habits.done / curStats.habits.total) * 100);
      lines.push(`• Hábitos: ${curStats.habits.done}/${curStats.habits.total} registros (${pct}%)`);
    }

    if (curStats.checklists.total > 0) {
      const pct = Math.round((curStats.checklists.done / curStats.checklists.total) * 100);
      lines.push(`• Checklists: ${curStats.checklists.done}/${curStats.checklists.total} cumpridos (${pct}%)`);
    }

    // Comparativos: só se mês anterior tem dados mínimos (≥ 3 itens por categoria).
    const comparatives = [];
    if (prevStats.tasks.total >= 3) {
      const diff = curStats.tasks.done - prevStats.tasks.done;
      comparatives.push(`tarefas ${diff >= 0 ? '+' : ''}${diff}`);
    }
    if (prevStats.habits.total >= 3) {
      const diff = curStats.habits.done - prevStats.habits.done;
      comparatives.push(`hábitos ${diff >= 0 ? '+' : ''}${diff} registros`);
    }
    if (prevStats.checklists.total >= 3) {
      const curPct  = Math.round((curStats.checklists.done  / curStats.checklists.total)  * 100);
      const prevPct = Math.round((prevStats.checklists.done / prevStats.checklists.total) * 100);
      const diff = curPct - prevPct;
      comparatives.push(`checklists ${diff >= 0 ? '+' : ''}${diff}%`);
    }

    if (comparatives.length > 0) {
      lines.push(`📊 vs ${prev.label}: ${comparatives.join(' | ')}`);
    }

    return lines.join('\n');
  } catch (err) {
    console.warn('[Prompt] buildMonthlyContextBlock err:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/prompts/system.js
```

Esperado: sem output.

---

## Task 3: Atualizar `buildContext()` — novo param + injeção

**Files:**
- Modify: `src/prompts/system.js` (~linha 177, função `buildContext`)

- [ ] **Step 1: Localizar a assinatura de `buildContext`**

  A linha atual é:
  ```js
  function buildContext(collab, memories, prefs, tasks, projects, lastMsgAge, habits, events, delegatedTasks, todayChecklists, teamAdherence, personalChecklists, teamTodayChecklists, teamExpectedTemplates, schoolEvents = [], eventTypes = [], doneFutureTasks = []) {
  ```

- [ ] **Step 2: Adicionar `monthlyCtxBlock = null` como último parâmetro**

  Substituir a assinatura por:
  ```js
  function buildContext(collab, memories, prefs, tasks, projects, lastMsgAge, habits, events, delegatedTasks, todayChecklists, teamAdherence, personalChecklists, teamTodayChecklists, teamExpectedTemplates, schoolEvents = [], eventTypes = [], doneFutureTasks = [], monthlyCtxBlock = null) {
  ```

- [ ] **Step 3: Localizar o ponto de injeção — bloco `doneFutureTasks`**

  Dentro de `buildContext`, localizar o bloco:
  ```js
  if (doneFutureTasks && doneFutureTasks.length) {
    lines.push('', `**Concluído (prazo amanhã ou futuro, ${doneFutureTasks.length}):**`);
    // ...
  }
  ```

  Imediatamente **após** o fechamento desse `if`, inserir:
  ```js
  // Bloco mensal (injetado quando keyword mensal detectada ou últimos 7 dias do mês).
  if (monthlyCtxBlock) {
    lines.push('', monthlyCtxBlock);
  }
  ```

- [ ] **Step 4: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/prompts/system.js
```

Esperado: sem output.

---

## Task 4: Atualizar `buildSystemPrompt()` — trigger + wiring

**Files:**
- Modify: `src/prompts/system.js` (função `buildSystemPrompt` ~linha 1738 e call site ~linha 1852)

- [ ] **Step 1: Localizar `buildSystemPrompt` e adicionar detecção de keyword após `const lastUserMessage`**

  A função começa:
  ```js
  async function buildSystemPrompt(collaborator, opts = {}) {
    const lastUserMessage = opts.lastUserMessage || '';
    const ctx = await fetchCollaboratorContext(collaborator);
  ```

  Inserir entre `lastUserMessage` e `fetchCollaboratorContext`:
  ```js
  // Janela Temporal Mensal: ativa por keyword ou nos últimos 7 dias do mês.
  const _monthlyKeywordRe = /\b(esse\s+m[eê]s|este\s+m[eê]s|no\s+m[eê]s|do\s+m[eê]s|m[eê]s\s+atual|m[eê]s\s+passado|ao\s+longo\s+do\s+m[eê]s|mensal|balan[çc]o|resumo\s+do\s+m[eê]s|como\s+(?:foi|est[áa]|fui|estou)\s+(?:esse|este|o)\s+m[eê]s|o\s+que\s+fiz\s+esse\s+m[eê]s|produtividade|meta\s+do\s+m[eê]s)\b/i;
  const _todayForMonth = brtYmd();
  const _dayOfMonth = parseInt(_todayForMonth.slice(8), 10);
  const _daysInMonth = new Date(parseInt(_todayForMonth.slice(0, 4)), parseInt(_todayForMonth.slice(5, 7)), 0).getDate();
  const _isEndOfMonth = _dayOfMonth >= (_daysInMonth - 6);
  const _includeMonthly = _monthlyKeywordRe.test(lastUserMessage) || _isEndOfMonth;
  let monthlyCtxBlock = null;
  if (_includeMonthly && collaborator) {
    monthlyCtxBlock = await buildMonthlyContextBlock(collaborator.id);
  }
  ```

- [ ] **Step 2: Localizar o call site de `buildContext` (~linha 1852)**

  A linha atual é:
  ```js
  const baseCtx = buildContext(collaborator, ctx.memories, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || [], ctx.teamAdherence || [], ctx.personalChecklists || [], ctx.teamTodayChecklists || [], ctx.teamExpectedTemplates || [], ctx.schoolEvents || [], ctx.eventTypes || [], ctx.doneFutureTasks || []);
  ```

  Adicionar `monthlyCtxBlock` como último argumento:
  ```js
  const baseCtx = buildContext(collaborator, ctx.memories, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || [], ctx.teamAdherence || [], ctx.personalChecklists || [], ctx.teamTodayChecklists || [], ctx.teamExpectedTemplates || [], ctx.schoolEvents || [], ctx.eventTypes || [], ctx.doneFutureTasks || [], monthlyCtxBlock);
  ```

- [ ] **Step 3: Validar sintaxe**

```bash
node --check D:/la-organizer/_remote/src/prompts/system.js
```

Esperado: sem output.

---

## Task 5: Deploy e validação

**Files:** nenhum novo

- [ ] **Step 1: SCP do arquivo modificado para a VPS**

```bash
scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
```

- [ ] **Step 2: Restart do TOM**

```bash
ssh tom "pm2 restart tom"
```

- [ ] **Step 3: Verificar startup limpo**

```bash
ssh tom "pm2 logs tom --lines 20 --nostream"
```

Esperado: sem `SyntaxError` ou `ReferenceError`. TOM deve inicializar normalmente.

- [ ] **Step 4: Smoke test — testar keyword trigger**

Enviar para o TOM (via WhatsApp do Alf): `"como foi esse mês?"`

Esperado: TOM responde com bloco `📅 *Maio 2026 (1–XX de 31):*` contendo tarefas, compromissos e/ou hábitos. Sem crash.

- [ ] **Step 5: Smoke test — testar mensagem normal (sem keyword)**

Enviar para o TOM: `"oi, tudo bem?"`

Esperado: TOM responde normalmente SEM bloco mensal. O bloco só aparece quando keyword está presente.

- [ ] **Step 6: Verificar logs após os testes**

```bash
ssh tom "pm2 logs tom --lines 30 --nostream"
```

Esperado: sem `[Prompt] buildMonthlyContextBlock err` nos logs.
