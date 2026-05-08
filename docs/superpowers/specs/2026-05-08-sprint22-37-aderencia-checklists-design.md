# Sprint 22.37 — Aderência Operacional de Checklists

**Data:** 2026-05-08
**Origem:** débito da auditoria original do checklist (Sprint C). PRD §4 + skill subfluxo 7 já documentam aderência 🟢🟡🔴 mas sem implementação no PWA. Sprint 22.36 entregou 100% dos checklists individuais; falta a visão agregada pra liderança operacional.

## 1. Goal

Tela nova `/mais/aderencia-checklists` que mostra aderência semanal/mensal de checklists operacionais por colaborador, visível pra liderança operacional (`director` + `manager`). Drilldown por colaborador com breakdown por template, observações capturadas e escalações. Coordinator (Quintela/Juliana, pedagogical_role='lead') NÃO acessa.

## 2. Architecture

Camadas afetadas:
- **PWA** (`web/`): 2 telas novas (`AderenciaChecklists.tsx` lista + `AderenciaChecklistDetalhe.tsx` drilldown), entrada no menu `/mais`, gating de role.
- **Engine TOM** (`src/`): skill subfluxo 7 reforçada — query real ao invés de placeholder.
- **DB** (Supabase): migration nova com policies RLS pra liderança operacional ler completions de toda equipe (com restrição por unidade pra manager).

Tela é leitura pura (zero CRUD novo). Toda complexidade está em queries de agregação e RLS.

## 3. Tech Stack

- React 18 + Vite + TypeScript
- TanStack Query
- Supabase RLS + RPC
- Routing existente (react-router-dom)

---

## 4. Acesso e RBAC

### Quem entra na tela
- `role='director'` (Alf, Anne) → vê todas as unidades
- `role='manager'` AND `unit != 'all'` (Jereh, Clayton, Krissya) → vê só sua unidade
- Outros (`coordinator` Quintela/Juliana, `manager unit='all'` Yuri/Marketing, `collaborator`) → NÃO entram

### Implementação
1. Link no `Mais.tsx` com `requireRoles: ['director', 'manager']`
2. Rota com `<ProtectedRoute requireRoles={['director', 'manager']} />` wrapper
3. Yuri (`unit='all'`) tecnicamente é `role='manager'` — vai conseguir abrir a tela. Como ele é Marketing e não tem operação de unidade, a tela mostra empty state quando `currentCollab.unit === 'all'` para manager (não tem unidade pra agregar).

---

## 5. Janela temporal

3 toggles no topo (chips): **Hoje** / **Semana** / **Mês**. Default = Semana.

| Janela | Range |
|---|---|
| Hoje | `reference_date = today` |
| Semana | `reference_date BETWEEN startOfWeek(monday) AND today` |
| Mês | `reference_date BETWEEN startOfMonth AND today` |

Estado da janela em `useState`, sem persistência (cada visit volta pra Semana).

---

## 6. Fórmula de aderência

**Completion rate simples por colaborador:**

```
% = count(completions onde completed_at IS NOT NULL) / count(completions despachadas) * 100
```

**Cor baseada em PRD §4:**
- 🟢 ≥ 90%
- 🟡 70 — 89%
- 🔴 < 70%

**Atraso (annotation, não afeta o número):**
- Conta `count(item_completions WHERE late=true)` separado
- Mostra como "X com atraso" abaixo do contador principal

**Despachado mas vazio:** completion sem nenhum item checked, fora da janela 6h, conta como NÃO fechado (denominador inclui, numerador exclui).

**Cron domingos / folga:** dispatcher só cria completions pros colabs cujo template bate `dayOfWeek + role`. Domingo sem template = nenhum despacho = não pesa.

---

## 7. Tela: Lista (`/mais/aderencia-checklists`)

### Layout (mobile-first, mesmo padrão de /projetos /agenda /checklists)

```
[← Mais]                        Aderência operacional

[Hoje] [Semana ▪] [Mês]              [Todas ▾]
                                     ↑ director-only
                                       chips: Todas / Barra / Recreio / Campo Grande

┌─ Resumo da equipe ─────────────────┐
│  Geral 78%   |   3 abaixo de 70%   │
└────────────────────────────────────┘

┌─ Joel — Recreio · sec_morning ────────┐
│  [JO]  🟢  95%                        │
│        ████████████████░ 19/20        │
│        • 1 com atraso                  │
└────────────────────────────────────────┘
┌─ Jereh — Campo Grande · gerente ──────┐
│  [JE]  🟡  75%                        │
│        ████████████░░░░░ 15/20        │
└────────────────────────────────────────┘
┌─ Krissya — Barra · gerente ───────────┐
│  [KR]  🔴  62%                        │
│        ████████░░░░░░░░░ 12/19        │
│        • 4 com atraso · 2 escaladas   │
└────────────────────────────────────────┘
```

### Componentes
- `<UnitFilterChips />` — visível só pra director. Estado em URLSearchParams (`?unit=barra`).
- `<TimeWindowChips />` — Hoje/Semana/Mês. Estado em URLSearchParams (`?window=week`).
- `<TeamSummaryCard />` — agregado da seleção atual (todos os colabs filtrados).
- `<AdherenceCard />` — 1 por colab, click navega pro drilldown.
- Card usa `bg-tom` na barra (token /projetos), border-left 🟢🟡🔴 pra accent visual.

### Query
```ts
// Server-side aggregate via RPC ou inline
const { data } = await supabase.rpc('get_adherence_by_collab', {
  start_date: startYmd,
  end_date: endYmd,
  unit_filter: unit ?? null
});
// Retorna [{ collab_id, full_name, role, unit, dispatched, completed, late_count, escalated_count }]
```

Alternativa sem RPC: 1 query SELECT com group by no PWA (ok pra ≤ 50 colabs).

### Empty states
- `noResults` (filtro unidade vazio): "Nenhum colaborador nessa unidade."
- `noDispatch` (semana sem despacho): "Sem checklists despachados nessa janela."
- Manager `unit='all'` (Yuri): "Você não tem unidade operacional atribuída. Fale com a direção."

---

## 8. Tela: Drilldown (`/mais/aderencia-checklists/:colabId`)

### Layout

```
[← Aderência]                  Krissya — Barra

┌─ Header ──────────────────────────────┐
│  [KR]  Krissya · gerente · Barra      │
│        🔴 62%   |   semana             │
└────────────────────────────────────────┘

POR CHECKLIST
┌─ Abertura Escola ────────────┐
│  🟢 5/5 (100%)                │
│  ████████████████████        │
└──────────────────────────────┘
┌─ Fiscalização Salas ─────────┐
│  🟡 3/5 (60%)                 │
│  ████████████░░░░░░░░        │
│  • 1 com atraso               │
└──────────────────────────────┘
┌─ Fechamento Escola ──────────┐
│  🔴 2/5 (40%)                 │
│  ████████░░░░░░░░░░░░        │
│  • 2 escaladas · 1 com atraso │
└──────────────────────────────┘

OBSERVAÇÕES CAPTURADAS (esta semana)
┌─ porta da sala 2 travou       ─┐
│  Fiscalização Salas · 06/05    │
└────────────────────────────────┘
┌─ ar não ligou na sala 3       ─┐
│  Abertura Escola · 04/05       │
└────────────────────────────────┘
```

### Componentes
- `<CollabHeaderCard />` — avatar grande + nome + role/unidade + % geral
- `<TemplateBreakdownCard />` — 1 por template, mesmo formato do AdherenceCard
- `<ObservationCard />` — 1 por nota capturada, com template + data

### Queries
```ts
// 1. Header (dado do colab + agregado)
const collab = await fetch('/api/collaborator', { id });
const overall = await rpc('get_adherence_for_collab', { collab_id, start, end });

// 2. Por template
const breakdown = await rpc('get_adherence_by_template', { collab_id, start, end });
// [{ template_id, template_name, dispatched, completed, late_count, escalated_count }]

// 3. Observações
const notes = await supabase.from('op_checklist_item_completions')
  .select('notes, op_checklists(name), reference_date, ...')
  .eq('completion.collaborator_id', collab_id)
  .not('notes', 'is', null)
  .gte('reference_date', start)
  .lte('reference_date', end)
  .limit(20);
```

---

## 9. RLS

### Estado atual (Sprint 22.1)
Policies em `op_checklist_completions` e `op_checklist_item_completions` permitem só `current_collab_id() = collaborator_id` (cada user vê só os seus). Liderança não consegue.

### Mudanças necessárias
Novas policies SELECT permitindo:
- **Director:** SELECT all (sem filtro)
- **Manager (`unit != 'all'`):** SELECT onde a completion é de um colab da mesma unidade

```sql
-- Helper opcional (se não tiver):
CREATE OR REPLACE FUNCTION current_collab_unit()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT unit FROM collaborators WHERE id = current_collab_id();
  $$;

CREATE OR REPLACE FUNCTION current_collab_role()
  RETURNS text LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT role FROM collaborators WHERE id = current_collab_id();
  $$;

-- op_checklist_completions: leadership SELECT
CREATE POLICY leadership_read_completions
  ON op_checklist_completions FOR SELECT
  USING (
    current_collab_role() = 'director'
    OR (
      current_collab_role() = 'manager'
      AND current_collab_unit() != 'all'
      AND EXISTS (
        SELECT 1 FROM collaborators c
        WHERE c.id = op_checklist_completions.collaborator_id
          AND c.unit = current_collab_unit()
      )
    )
  );

-- op_checklist_item_completions: idem (via join)
CREATE POLICY leadership_read_item_completions
  ON op_checklist_item_completions FOR SELECT
  USING (
    current_collab_role() = 'director'
    OR (
      current_collab_role() = 'manager'
      AND current_collab_unit() != 'all'
      AND EXISTS (
        SELECT 1 FROM op_checklist_completions c
        JOIN collaborators k ON k.id = c.collaborator_id
        WHERE c.id = op_checklist_item_completions.completion_id
          AND k.unit = current_collab_unit()
      )
    )
  );

-- op_checklists (templates) — manager precisa ler templates pra labels
CREATE POLICY leadership_read_templates
  ON op_checklists FOR SELECT
  USING (
    current_collab_role() IN ('director', 'manager')
  );
```

### Não confundir
- Policies novas só permitem **SELECT**. INSERT/UPDATE continua restrito ao próprio user (Sprint 22.1).
- Director CRUD em templates já existe via `/mais/checklists-templates` — sem mudança aí.

---

## 10. RPCs (recomendado, mas opcional)

Pra evitar 1 query agregada complexa no PWA, criar 2 RPCs:

```sql
CREATE OR REPLACE FUNCTION get_adherence_by_collab(
  start_date date,
  end_date date,
  unit_filter text DEFAULT NULL
)
RETURNS TABLE (
  collab_id uuid,
  full_name text,
  role text,
  unit text,
  dispatched int,
  completed int,
  late_items int,
  escalated_count int,
  pct numeric
) LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    k.id, k.full_name, k.role, k.unit,
    count(c.id)::int as dispatched,
    count(c.completed_at)::int as completed,
    (SELECT count(*) FROM op_checklist_item_completions ic
     JOIN op_checklist_completions cc ON cc.id = ic.completion_id
     WHERE cc.collaborator_id = k.id
       AND cc.reference_date BETWEEN start_date AND end_date
       AND ic.late = true)::int as late_items,
    count(c.escalated_at)::int as escalated_count,
    CASE WHEN count(c.id) = 0 THEN 0
         ELSE round(count(c.completed_at)::numeric / count(c.id) * 100, 0)
    END as pct
  FROM collaborators k
  LEFT JOIN op_checklist_completions c
    ON c.collaborator_id = k.id
    AND c.reference_date BETWEEN start_date AND end_date
  WHERE k.is_active = true
    AND (unit_filter IS NULL OR k.unit = unit_filter)
  GROUP BY k.id, k.full_name, k.role, k.unit
  HAVING count(c.id) > 0  -- só inclui quem teve despacho
  ORDER BY pct ASC, k.full_name ASC;
$$;
```

`SECURITY INVOKER` respeita RLS — manager filtra automaticamente sua unidade.

```sql
CREATE OR REPLACE FUNCTION get_adherence_by_template(
  collab_id uuid,
  start_date date,
  end_date date
)
RETURNS TABLE (
  template_id uuid,
  template_name text,
  dispatched int,
  completed int,
  late_items int,
  escalated_count int,
  pct numeric
) LANGUAGE sql SECURITY INVOKER STABLE AS $$
  SELECT
    t.id, t.name,
    count(c.id)::int,
    count(c.completed_at)::int,
    (SELECT count(*) FROM op_checklist_item_completions ic
     WHERE ic.completion_id IN (SELECT id FROM op_checklist_completions
                                 WHERE collaborator_id = $1
                                   AND reference_date BETWEEN $2 AND $3
                                   AND checklist_id = t.id)
       AND ic.late = true)::int,
    count(c.escalated_at)::int,
    CASE WHEN count(c.id) = 0 THEN 0
         ELSE round(count(c.completed_at)::numeric / count(c.id) * 100, 0)
    END
  FROM op_checklists t
  LEFT JOIN op_checklist_completions c
    ON c.checklist_id = t.id
    AND c.collaborator_id = $1
    AND c.reference_date BETWEEN $2 AND $3
  GROUP BY t.id, t.name
  HAVING count(c.id) > 0
  ORDER BY pct ASC;
$$;
```

---

## 11. Engine TOM — skill subfluxo 7 reforçada

Hoje a skill `checklists-operacionais` subfluxo 7 documenta o formato da resposta ("📋 Aderência da semana: 🟢 Joel 100% ...") mas o engine não tem dado real. TOM responde só baseado em contexto do system prompt (Sprint 22.36 Fatia 2 já injeta `todayChecklists` mas só do próprio user).

### Solução
Adicionar em `system.js` `buildContext()` quando o user é `director` ou `manager`:

```ts
// Se liderança, injeta aderência da equipe (semana atual)
if (collab.role === 'director' || collab.role === 'manager') {
  const teamAderencia = await fetchTeamAderencia(collab); // chama RPC
  // renderiza bloco "ADERÊNCIA DA EQUIPE (semana)"
}
```

Bloco do prompt:
```
ADERÊNCIA DA EQUIPE (esta semana, segunda → hoje):
🟢 Joel: 95% (19/20 fechados)
🟡 Jereh: 75% (15/20)
🔴 Krissya: 62% (12/19) — 2 escaladas
```

Quando user perguntar "como tá a aderência?" no Zap, TOM tem o dado e responde formatado conforme skill subfluxo 7.

---

## 12. Arquivos afetados

### PWA
- `web/src/screens/AderenciaChecklists.tsx` (NOVO) — lista
- `web/src/screens/AderenciaChecklistDetalhe.tsx` (NOVO) — drilldown
- `web/src/components/AdherenceCard.tsx` (NOVO) — card de colab
- `web/src/components/TemplateBreakdownCard.tsx` (NOVO) — card de template breakdown
- `web/src/components/UnitFilterChips.tsx` (NOVO) — filtro chips, director-only
- `web/src/components/TimeWindowChips.tsx` (NOVO) — Hoje/Semana/Mês toggle
- `web/src/components/TeamSummaryCard.tsx` (NOVO) — agregado equipe
- `web/src/screens/Mais.tsx` — adicionar item de menu
- `web/src/App.tsx` — adicionar 2 routes (lista + drilldown), gated por `requireRoles: ['director', 'manager']`
- `web/src/types.ts` — tipos `AdherenceByCollab`, `AdherenceByTemplate`

### Engine
- `src/prompts/system.js` — `buildContext()` injeta `teamAderencia` quando director/manager
- (sem mudança em `engine.js` ou `dispatcher.js`)

### Migrations
- `migrations/2026-05-08-sprint22-37-adherence-rls.sql`
  - `current_collab_unit()` + `current_collab_role()` helpers
  - 3 policies SELECT (completions + item_completions + templates)
  - 2 RPCs `get_adherence_by_collab` + `get_adherence_by_template`

### Documentação
- `docs/06-prd-la-organizer-v3.md` — bump v3.10 com changelog
- `docs/05-mapa-telas-pwa-v3.md` — Tela 19+20 (lista + drilldown)
- `docs/TOM-SKILLS-CATALOG.md` — reforço skill `checklists-operacionais` subfluxo 7

---

## 13. Critérios de sucesso

- [ ] Director (Alf/Anne) abre `/mais/aderencia-checklists` e vê todos os colabs ativos com despacho na janela
- [ ] Director vê chips de filtro de unidade (Todas / Barra / Recreio / Campo Grande)
- [ ] Manager unit-específica (Jereh/Clayton/Krissya) abre a tela e vê SÓ colabs da própria unidade. Sem chips de filtro.
- [ ] Manager `unit='all'` (Yuri) abre a tela e vê empty state explicativo.
- [ ] Coordinator (Quintela/Juliana) e collaborator não veem o link no Mais e ProtectedRoute bloqueia acesso direto.
- [ ] Cor baseada em fechados/despachados: 🟢 ≥90, 🟡 70-89, 🔴 <70.
- [ ] Toggle Hoje/Semana/Mês funcional, default Semana.
- [ ] Resumo da equipe no topo: % geral + count de colabs <70%.
- [ ] Atraso aparece como annotation ("• X com atraso"), não afeta %.
- [ ] Escalação aparece como annotation ("• X escaladas").
- [ ] Click num card abre drilldown `/mais/aderencia-checklists/:colabId`.
- [ ] Drilldown: header + breakdown por template + observações capturadas.
- [ ] TOM no Zap responde "como tá a aderência da equipe?" com dado real (formato skill subfluxo 7).

---

## 14. Não-escopo (Sprint 22.38+)

- Sort options (alfabético, % asc/desc)
- Broadcast manual ("mandar Zap pros 🔴")
- Histórico/tendência (mês a mês comparativo)
- Date range custom
- Drilldown comparativo (colab vs equipe)
- Export CSV
- Notificação automática pra direção quando equipe inteira <70%
- Aderência por departamento (em vez de unidade)
- Personal Checklists (Sprint 22.38 separada — independente de Sprint C)

---

## 15. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Policy RLS lenta com `current_collab_unit()` em cada row | Marcar STABLE, Postgres cacheia. Adicionar índice em `collaborators(id)` se necessário (já existe como PK) |
| Yuri (`manager unit='all'`) abre tela e vê empty | Empty state explicativo; UX dirige pra direção |
| Cron domingos enche denominador com 0 | Query usa `HAVING count(c.id) > 0` — colabs sem despacho não aparecem |
| Manager vê dado de outra unidade via RPC | RPC `SECURITY INVOKER` respeita RLS, filtra automático |
| Performance da query agregada com 100+ colabs | Manager filtra por unit (poucos colabs); director vê todos mas RPC roda 1 vez (não N) |
| Item-completion observation expor PII via RLS | Notes viram visíveis pra liderança operacional. OK pelo design (eles já recebem escalações). Documentar em TOM-LIMITES.md |

---

## 16. Ordem de execução proposta

1. **Migration** (15min) — RLS policies + RPCs
2. **Types + queries** (30min) — `useAdherence` hook
3. **Lista screen** (1.5h) — AderenciaChecklists.tsx + componentes filhos
4. **Drilldown screen** (1.5h) — AderenciaChecklistDetalhe.tsx + componentes
5. **Mais menu + routes** (10min)
6. **Engine context (TOM)** (45min) — `buildContext()` injeta aderência da equipe
7. **Docs + commit + deploy** (30min)

Total estimado: ~5h em sessões de 2h.

---

## 17. Decisões registradas

| Decisão | Valor escolhido | Justificativa |
|---|---|---|
| Quem vê | `director` + `manager` (operacional, `unit != 'all'`) | Pedagogical coords não viram operação |
| Janela default | Semana | Ritmo operacional natural |
| Fórmula | Completion rate simples (fechados/despachados) | PRD §4 alinhado, simples |
| Atraso | Annotation, não afeta % | Não pune duplo |
| Layout lista | Cards verticais com border-left 🟢🟡🔴 | Mirror /projetos /agenda /checklists |
| Drilldown | Tela cheia `/mais/aderencia-checklists/:id` | Mirror PessoaDetalhe, espaço pra info |
| Toolbar | Resumo equipe + filtro unidade (director-only) | Sinal alto sem clutter |
| TOM context | Bloco aderência equipe injetado pra liderança | Skill subfluxo 7 ganha dado real |
| Sort/broadcast/CSV | Out-of-scope Sprint 22.37 | Nice-to-have, validar uso real antes |
