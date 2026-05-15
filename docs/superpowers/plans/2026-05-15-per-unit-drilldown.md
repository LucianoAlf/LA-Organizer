# Per-Unit Drilldown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Agrupar `teamTodayChecklists` por unidade quando o TOM está em contexto de liderança com múltiplas unidades.

**Architecture:** Duas mudanças no mesmo arquivo `src/prompts/system.js`: (1) adicionar `unit` ao select do join `op_checklists`; (2) substituir renderização flat por renderização agrupada por unidade.

**Tech Stack:** Node.js CommonJS, `src/prompts/system.js`

---

## Task 1: Adicionar `unit` ao select de `teamTodayChecklists`

**Files:**
- Modify: `src/prompts/system.js` (~linha 1055, dentro de `fetchCollaboratorContext`)

- [ ] **Step 1: Localizar o select de `teamTodayChecklists`**

  Buscar a linha com `.select('id, completed_at, collaborator_id, collaborators(full_name), op_checklists(name),`. Está em torno das linhas 1052-1058.

- [ ] **Step 2: Adicionar `unit` ao join `op_checklists`**

  Mudar:
  ```js
  .select('id, completed_at, collaborator_id, collaborators(full_name), op_checklists(name), op_checklist_item_completions(is_checked)')
  ```
  Para:
  ```js
  .select('id, completed_at, collaborator_id, collaborators(full_name), op_checklists(name, unit), op_checklist_item_completions(is_checked)')
  ```

- [ ] **Step 3: Validar sintaxe**

  ```bash
  node --check D:/la-organizer/_remote/src/prompts/system.js
  ```
  Esperado: sem output.

---

## Task 2: Atualizar renderização de `teamTodayChecklists` em `buildContext`

**Files:**
- Modify: `src/prompts/system.js` (dentro de `buildContext`, ~linhas 459-480)

- [ ] **Step 1: Localizar o bloco de renderização**

  Buscar `Status real (já dispatched):` ou `byCollab.get(first).push` dentro de `buildContext`. A seção começa com:
  ```js
  if (teamTodayChecklists && teamTodayChecklists.length) {
    const byCollab = new Map();
  ```

- [ ] **Step 2: Substituir todo o bloco `if (teamTodayChecklists && teamTodayChecklists.length)` pelo novo código**

  **Código atual** (remover):
  ```js
  if (teamTodayChecklists && teamTodayChecklists.length) {
    const byCollab = new Map();
    for (const c of teamTodayChecklists) {
      const name = (Array.isArray(c.collaborators) ? c.collaborators[0] : c.collaborators)?.full_name || c.collaborator_id;
      const first = name.split(' ')[0];
      if (!byCollab.has(first)) byCollab.set(first, []);
      const items = c.op_checklist_item_completions || [];
      const done = items.filter(i => i.is_checked).length;
      const total = items.length || 1;
      const pct = Math.round((done / total) * 100);
      const tplName = (Array.isArray(c.op_checklists) ? c.op_checklists[0] : c.op_checklists)?.name || '?';
      const tag = c.completed_at ? '✅' : (pct >= 70 ? '🟡' : '🔴');
      byCollab.get(first).push(`${tag} ${tplName} (${done}/${total})`);
    }
    lines.push('Status real (já dispatched):');
    for (const [name, entries] of byCollab) {
      lines.push(`• ${name}: ${entries.join(' · ')}`);
    }
  } else {
    lines.push('Status real: 0 dispatched, 0 completed.');
  }
  ```

  **Código novo** (inserir no lugar):
  ```js
  if (teamTodayChecklists && teamTodayChecklists.length) {
    // Per-unit drilldown: agrupa por unidade → colaborador.
    // Se só uma unidade (manager), renderiza flat (sem header de unidade).
    const byUnit = new Map();
    for (const c of teamTodayChecklists) {
      const tplObj = Array.isArray(c.op_checklists) ? c.op_checklists[0] : c.op_checklists;
      const unit = tplObj?.unit || 'sem unidade';
      const name = (Array.isArray(c.collaborators) ? c.collaborators[0] : c.collaborators)?.full_name || c.collaborator_id;
      const first = name.split(' ')[0];
      const items = c.op_checklist_item_completions || [];
      const done = items.filter(i => i.is_checked).length;
      const total = items.length || 1;
      const pct = Math.round((done / total) * 100);
      const tplName = tplObj?.name || '?';
      const tag = c.completed_at ? '✅' : (pct >= 70 ? '🟡' : '🔴');
      if (!byUnit.has(unit)) byUnit.set(unit, new Map());
      const byCollab = byUnit.get(unit);
      if (!byCollab.has(first)) byCollab.set(first, []);
      byCollab.get(first).push(`${tag} ${tplName} (${done}/${total})`);
    }
    lines.push('Status real (já dispatched):');
    if (byUnit.size === 1) {
      // Manager com uma unidade: renderização flat (sem header).
      const [[, byCollab]] = byUnit;
      for (const [name, entries] of byCollab) {
        lines.push(`• ${name}: ${entries.join(' · ')}`);
      }
    } else {
      // Diretor com múltiplas unidades: agrupa com header de unidade.
      for (const [unit, byCollab] of byUnit) {
        lines.push(`📍 ${unit}:`);
        for (const [name, entries] of byCollab) {
          lines.push(`  • ${name}: ${entries.join(' · ')}`);
        }
      }
    }
  } else {
    lines.push('Status real: 0 dispatched, 0 completed.');
  }
  ```

- [ ] **Step 3: Validar sintaxe**

  ```bash
  node --check D:/la-organizer/_remote/src/prompts/system.js
  ```
  Esperado: sem output.

---

## Task 3: Deploy e validação

- [ ] **Step 1: SCP para VPS**

  ```bash
  scp D:/la-organizer/_remote/src/prompts/system.js tom:/opt/LA-Organizer/src/prompts/system.js
  ```

- [ ] **Step 2: Restart**

  ```bash
  ssh tom "pm2 restart tom"
  ```

- [ ] **Step 3: Verificar startup**

  ```bash
  ssh tom "pm2 logs tom --lines 15 --nostream"
  ```
  Esperado: `✅ TOM pronto. Aguardando mensagens...` sem erros.
