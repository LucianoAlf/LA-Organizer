# Hierarquia Explícita — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Adicionar `manager_id` à `collaborators` e injetar org chart compacto no contexto do TOM.

**Architecture:** Migration SQL via Supabase MCP + mudanças em `src/prompts/system.js` (nova query no Promise.all, novo parâmetro em buildContext, nova seção de renderização).

**Tech Stack:** Supabase PostgreSQL, Node.js CommonJS, `src/prompts/system.js`

---

## Task 1: Aplicar migration SQL

**Files:** Supabase production DB (project ID: cesnbnrynvxvgdhfmaua)

- [ ] **Step 1: Aplicar migration via Supabase MCP**

  SQL a executar:
  ```sql
  ALTER TABLE collaborators
    ADD COLUMN manager_id UUID REFERENCES collaborators(id) ON DELETE SET NULL;
  ```

- [ ] **Step 2: Verificar que a coluna foi criada**

  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name = 'collaborators' AND column_name = 'manager_id';
  ```

  Esperado: 1 linha com `manager_id | uuid | YES`.

---

## Task 2: Adicionar query `orgChart` em `fetchCollaboratorContext`

**Files:**
- Modify: `src/prompts/system.js` (função `fetchCollaboratorContext`, ~linhas 934-1108)

- [ ] **Step 1: Adicionar `orgChartRes` à lista de variáveis desestruturadas**

  Localizar o bloco de desestruturação do `Promise.all` que começa com:
  ```js
  const [
    profileRes,
    memoriesRes,
    ...
    pastDelegatedRes,
  ] = await Promise.all([
  ```

  Adicionar `orgChartRes,` APÓS `pastDelegatedRes,` na lista de variáveis:
  ```js
  const [
    profileRes,
    memoriesRes,
    ...
    pastDelegatedRes,
    orgChartRes,
  ] = await Promise.all([
  ```

- [ ] **Step 2: Adicionar a query no final do array do `Promise.all`**

  Localizar o fechamento do `Promise.all` — a última query antes do `]);` é a de `pastDelegatedRes`:
  ```js
    supabase.from('tasks')
      .select('id, title, context, completed_at, assignee:collaborators!tasks_assigned_to_fkey(full_name)')
      .eq('created_by', id).neq('assigned_to', id)
      .eq('status', 'done')
      .gte('completed_at', `${past7days}T00:00:00-03:00`)
      .order('completed_at', { ascending: false }).limit(15),
  ]);
  ```

  Inserir a nova query ANTES do `]);` (após a vírgula do pastDelegated):
  ```js
    // Hierarquia explícita — org chart para liderança responder "quem responde pra quem?".
    isLeadership
      ? supabase.from('collaborators')
          .select('id, full_name, unit, role, manager:collaborators!manager_id(id, full_name)')
          .eq('is_active', true)
          .order('full_name')
      : Promise.resolve({ data: [], error: null }),
  ]);
  ```

- [ ] **Step 3: Adicionar `orgChart` ao objeto de retorno de `fetchCollaboratorContext`**

  Localizar onde o ctx é montado e retornado (depois do `Promise.all`). Buscar pela linha que contém `pastDelegated:` no objeto de retorno e adicionar `orgChart: orgChartRes.data || [],` após ela.

  Exemplo do que buscar (trecho do retorno):
  ```js
    pastDelegated: pastDelegatedRes.data || [],
  ```

  Adicionar após:
  ```js
    pastDelegated: pastDelegatedRes.data || [],
    orgChart: orgChartRes.data || [],
  ```

- [ ] **Step 4: Validar sintaxe**

  ```bash
  node --check D:/la-organizer/_remote/src/prompts/system.js
  ```
  Esperado: sem output.

---

## Task 3: Adicionar `orgChart` em `buildContext` + renderização

**Files:**
- Modify: `src/prompts/system.js` (função `buildContext`, linha ~177 e seção de renderização)

- [ ] **Step 1: Adicionar `orgChart = []` como parâmetro em `buildContext`**

  Localizar a linha 177 (assinatura de `buildContext`). A assinatura atual termina com:
  ```js
  ..., doneFutureTasks = [], monthlyCtxBlock = null)
  ```

  Adicionar `orgChart = []` após `monthlyCtxBlock = null`:
  ```js
  ..., doneFutureTasks = [], monthlyCtxBlock = null, orgChart = [])
  ```

- [ ] **Step 2: Adicionar renderização do org chart em `buildContext`**

  Localizar a seção de `teamAdherence` dentro de `buildContext` (em torno das linhas 433-444):
  ```js
  // Sprint 22.37 — ADERÊNCIA DA EQUIPE (semana atual)
  if (teamAdherence && teamAdherence.length) {
  ```

  Inserir o bloco de org chart ANTES dessa seção:
  ```js
  // Hierarquia explícita — só renderiza para liderança quando há dados de manager_id.
  if (orgChart && orgChart.length) {
    const withManager = orgChart.filter(c => c.manager);
    if (withManager.length > 0) {
      lines.push('', '**Hierarquia da equipe:**');
      for (const c of withManager) {
        const firstName = (c.full_name || '').split(' ')[0];
        const managerFirst = (c.manager?.full_name || '—').split(' ')[0];
        const unit = c.unit || '—';
        lines.push(`• ${firstName} (${unit}) → ${managerFirst}`);
      }
    }
  }
  ```

- [ ] **Step 3: Atualizar o call site de `buildContext` (~linha 1992+)**

  Localizar a chamada `const baseCtx = buildContext(collaborator, ctx.memories, ..., ctx.doneFutureTasks || [], monthlyCtxBlock);`

  Adicionar `ctx.orgChart || []` como último argumento:
  ```js
  const baseCtx = buildContext(collaborator, ctx.memories, ctx.prefs, tasksForCtx, ctx.activeProjects, lastMsgAge, habitsForCtx, eventsForCtx, ctx.delegatedTasks || [], ctx.todayChecklists || [], ctx.teamAdherence || [], ctx.personalChecklists || [], ctx.teamTodayChecklists || [], ctx.teamExpectedTemplates || [], ctx.schoolEvents || [], ctx.eventTypes || [], ctx.doneFutureTasks || [], monthlyCtxBlock, ctx.orgChart || []);
  ```

- [ ] **Step 4: Validar sintaxe**

  ```bash
  node --check D:/la-organizer/_remote/src/prompts/system.js
  ```
  Esperado: sem output.

---

## Task 4: Deploy e validação

- [ ] **Step 1: SCP**

  ```bash
  scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
  ```

- [ ] **Step 2: Restart**

  ```bash
  ssh tom "pm2 restart tom && sleep 3 && pm2 logs tom --lines 8 --nostream"
  ```

  Esperado: `✅ TOM pronto. Aguardando mensagens...` sem erros.
