# Hierarquia Explícita — Design Spec

**Goal:** Adicionar `manager_id` à tabela `collaborators` e injetar um org chart compacto no contexto do TOM, permitindo responder "quem responde pra quem?" e melhorar escalações.

**Architecture:** Migration SQL + nova query em `fetchCollaboratorContext` (liderança) + nova seção em `buildContext`. Zero mudança no frontend, zero mudança em RLS por enquanto.

**Tech Stack:** Supabase PostgreSQL, Supabase JS Client (service_role), `src/prompts/system.js`

---

## 1. Migration SQL

```sql
ALTER TABLE collaborators
  ADD COLUMN manager_id UUID REFERENCES collaborators(id) ON DELETE SET NULL;
```

- `manager_id` aponta para o colaborador que é o manager direto desta pessoa
- `NULL` = sem manager explícito (diretor, topo da hierarquia)
- `ON DELETE SET NULL` = se o manager for removido, o campo vira null em vez de cascade

---

## 2. Nova query em `fetchCollaboratorContext`

Adicionada ao `Promise.all` existente (liderança apenas):

```js
isLeadership
  ? supabase.from('collaborators')
      .select('id, full_name, unit, role, manager:collaborators!manager_id(id, full_name)')
      .eq('is_active', true)
      .order('full_name')
  : Promise.resolve({ data: [], error: null })
```

Retornada no ctx como `orgChart: orgChartRes.data || []`.

---

## 3. Renderização em `buildContext`

Nova seção adicionada **antes** do bloco de aderência da equipe:

```
**Hierarquia da equipe:**
• Clayton (Campo Grande) → Luciano
• Jereh (Barra) → Luciano
• Krissya (Barra) → Luciano
• Yuri (all) → Luciano
```

- Só renderiza se `orgChart.length > 0`
- Manager sem nome = `—`
- Colaboradores sem `manager_id` (topo) não aparecem na lista (são os managers)

---

## 4. Scope fora (próximas sprints)

- RLS fina por `manager_id`
- Frontend: campo "Manager" no formulário de colaboradores
- `leader_id` para segunda linha de reporte
- Skill TOM dedicada para "organograma" (por enquanto injeta no contexto base)
