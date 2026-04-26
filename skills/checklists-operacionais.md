---
name: checklists-operacionais
description: Skill para enviar, acompanhar e medir aderência de checklists operacionais por função e turno. Use quando o cron disparar envio de checklist, quando o colaborador reportar itens feitos, ou quando coordenador+ pedir status de aderência.
---

# Checklists Operacionais

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Identificado pelo phone ou cron | Sim |
| function_role | text | collaborators.function_title mapeado | Sim |
| shift | text | Determinado pelo horário atual | Sim |
| unit | text | collaborators.unit | Sim |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| mensagem checklist | WhatsApp | Colaborador via UAZAPI |
| op_checklist_completion | record | Supabase |
| op_checklist_item_completions | record[] | Supabase |
| alerta não preenchido | WhatsApp | Colaborador (20h) |
| relatório aderência | record | Coordenador (semanal) |

## Fases de Execução

### Fase 1 — Identificar checklist aplicável
```sql
SELECT oc.id, oc.name, oci.id as item_id, oci.description, oci.sort_order
FROM op_checklists oc
JOIN op_checklist_items oci ON oci.checklist_id = oc.id
WHERE oc.function_role = $function_role
  AND oc.shift = $shift
  AND (oc.unit = $unit OR oc.unit = 'all')
  AND oc.is_active = true
ORDER BY oci.sort_order;
```

### Fase 2 — Enviar via WhatsApp
```
Bom dia, [nome]. Checklist de [nome do checklist]:

1. [item 1]
2. [item 2]
3. [item 3]
4. [item 4]
5. [item 5]
6. [item 6]

Me avisa quando terminar tudo ou vai ticando: "fiz 1, 2, 3"
```

Criar op_checklist_completion com started_at = null (preenchido quando primeiro item for marcado).

### Fase 3 — Processar respostas

| Resposta do colaborador | Ação |
|---|---|
| "fiz tudo" / "pronto" / "completo" | Marcar todos os itens como is_checked = true, completed_at = now() |
| "fiz 1, 2, 3" / "1 até 4" | Marcar itens específicos |
| "fiz tudo, mas [observação]" | Marcar tudo + registrar notes no último item |
| "sala 3 com problema" | Registrar notes + sugerir criação de tarefa |

```sql
-- Marcar item
UPDATE op_checklist_item_completions
SET is_checked = true, checked_at = NOW(), notes = $notes
WHERE completion_id = $completion_id AND item_id = $item_id;

-- Verificar se todos foram marcados
UPDATE op_checklist_completions
SET completed_at = NOW()
WHERE id = $completion_id
  AND NOT EXISTS (
    SELECT 1 FROM op_checklist_item_completions
    WHERE completion_id = $completion_id AND is_checked = false
  );
```

### Fase 4 — Observações que viram tarefas
Se o colaborador reporta problema:
```
Registrei: "[observação]". Quer que eu crie uma tarefa pra manutenção?
```
Se sim → criar task com category='operational', source='system'.

### Fase 5 — Alerta de não preenchimento (cron 20h)
```sql
-- Checklists esperados hoje que não foram completados
SELECT c.full_name, oc.name
FROM op_checklists oc
CROSS JOIN collaborators c
LEFT JOIN op_checklist_completions occ 
  ON occ.checklist_id = oc.id AND occ.collaborator_id = c.id AND occ.reference_date = CURRENT_DATE
WHERE oc.function_role = c.function_title_mapped
  AND oc.is_active = true
  AND c.is_active = true
  AND occ.id IS NULL;
```

Enviar: "[nome], o checklist '[nome]' de hoje não foi preenchido. Já fez e esqueceu de marcar?"

### Fase 6 — Cálculo de aderência (cron semanal sexta 18h)
```
Aderência = checklists completados (completed_at NOT NULL) / checklists esperados × 100
```

Incluir no resumo do coordenador com código de cor:
- 🟢 ≥ 90%
- 🟡 70-89%
- 🔴 < 70%

## Veto Conditions — NUNCA
- NUNCA pular envio de checklist no horário programado
- NUNCA aceitar "fiz tudo" sem registrar todos os itens como marcados
- NUNCA ignorar observação com problema reportado
- NUNCA expor aderência individual publicamente (só pro coordenador)
- NUNCA enviar checklist fora do turno configurado
- NUNCA criar checklist template sem aprovação do coordenador+

## Checklist de Conclusão
- [ ] Checklist correto identificado (função + turno + unidade)
- [ ] Mensagem enviada com todos os itens
- [ ] Respostas processadas (itens marcados no banco)
- [ ] Observações registradas como notes
- [ ] Tarefas de manutenção criadas quando necessário
- [ ] Alerta de não preenchimento enviado às 20h
- [ ] Aderência calculada semanalmente

## Integrações
- **Supabase** — op_checklists, op_checklist_items, op_checklist_completions, op_checklist_item_completions, tasks
- **UAZAPI** — envio de checklists e alertas
- **pg_cron** — dispatch_op_checklists (15 min), check_op_checklists_pending (20h), calculate_op_adherence (sexta 18h)
