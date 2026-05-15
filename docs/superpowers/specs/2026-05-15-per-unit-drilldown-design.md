# Per-Unit Drilldown — Design Spec

**Goal:** Agrupar checklists da equipe por unidade no contexto do TOM, para que diretores com múltiplas unidades vejam a aderência organizada por local — sem misturar Clayton (Campo Grande) com Jereh (Barra).

**Architecture:** Mudança puramente de renderização em `src/prompts/system.js`. Adicionar `unit` ao join de `op_checklists` na query de `teamTodayChecklists`, e agrupar por unidade na renderização de `buildContext`. Zero novas queries, zero DB, zero frontend.

**Scope:**
- ✅ `teamTodayChecklists` — agrupa por unidade quando há > 1 unidade presente
- ❌ `teamAdherence` — fora do escopo (RPC não retorna `unit`)
- ❌ `teamExpectedTemplates` — já mostra `unit` inline, sem mudança

**Backward compat:** Quando há apenas 1 unidade (manager vendo sua própria unidade), renderização permanece flat — mesmo comportamento de hoje.

---

## Mudança 1 — Query (`fetchCollaboratorContext`, linha ~1055)

**Antes:**
```js
.select('id, completed_at, collaborator_id, collaborators(full_name), op_checklists(name), op_checklist_item_completions(is_checked)')
```

**Depois:**
```js
.select('id, completed_at, collaborator_id, collaborators(full_name), op_checklists(name, unit), op_checklist_item_completions(is_checked)')
```

---

## Mudança 2 — Renderização (`buildContext`, linhas ~459-480)

**Lógica:**
1. Iterar sobre `teamTodayChecklists`, extraindo `unit` de `op_checklists.unit`
2. Construir estrutura `byUnit: Map<unit, Map<firstName, entries[]>>`
3. Se `byUnit.size === 1`: renderiza flat (sem header de unidade) — compatível com managers
4. Se `byUnit.size > 1`: renderiza com `📍 {unit}:` como header de grupo

**Formato com múltiplas unidades:**
```
Status real (já dispatched):
📍 Campo Grande:
  • Clayton: ✅ Fechamento (7/7) · 🔴 Limpeza (2/5)
📍 Barra:
  • Jereh: 🟡 Abertura (4/5)
```

**Formato com uma unidade (inalterado):**
```
Status real (já dispatched):
• Clayton: ✅ Fechamento (7/7) · 🔴 Limpeza (2/5)
```
