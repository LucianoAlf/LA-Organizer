---
name: priorizacao-eisenhower
description: Skill para classificar automaticamente tarefas nos 4 quadrantes de Eisenhower com base em prazo e importância estratégica. Executada via trigger no banco ao criar/atualizar task. O colaborador nunca vê os quadrantes — só recebe as tarefas na ordem certa.
---

# Priorização Eisenhower

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| task_id | uuid | Trigger (INSERT/UPDATE em tasks) | Sim |
| due_date | date | tasks.due_date | Sim |
| priority | text | tasks.priority (critical/high/medium/low) | Sim |
| project_id | uuid | tasks.project_id (null se avulsa) | Não |
| status | text | tasks.status | Sim |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| eisenhower_quadrant | int (1-4) | tasks.eisenhower_quadrant |

## Lógica de Classificação

### Matriz

| | Urgente (prazo ≤ 2 dias ou atrasada) | Não urgente (prazo > 2 dias) |
|---|---|---|
| **Importante** (vinculada a projeto OU priority critical/high) | **Q1 — FAZER AGORA** | **Q2 — AGENDAR** |
| **Não importante** (sem projeto E priority medium/low) | **Q3 — DELEGAR** | **Q4 — ELIMINAR/ADIAR** |

### Function SQL

```sql
CREATE OR REPLACE FUNCTION fn_calculate_eisenhower()
RETURNS TRIGGER AS $$
BEGIN
  NEW.eisenhower_quadrant = CASE
    -- Q1: Urgente + Importante
    WHEN (NEW.due_date - CURRENT_DATE <= 2 OR NEW.status = 'overdue')
         AND (NEW.project_id IS NOT NULL OR NEW.priority IN ('critical', 'high'))
    THEN 1

    -- Q2: Não urgente + Importante
    WHEN (NEW.due_date - CURRENT_DATE > 2)
         AND (NEW.project_id IS NOT NULL OR NEW.priority IN ('critical', 'high'))
    THEN 2

    -- Q3: Urgente + Não importante
    WHEN (NEW.due_date - CURRENT_DATE <= 2 OR NEW.status = 'overdue')
         AND (NEW.project_id IS NULL AND NEW.priority IN ('medium', 'low'))
    THEN 3

    -- Q4: Não urgente + Não importante
    ELSE 4
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calculate_eisenhower
BEFORE INSERT OR UPDATE OF due_date, priority, project_id, status
ON tasks
FOR EACH ROW
EXECUTE FUNCTION fn_calculate_eisenhower();
```

## Como o TOM Usa os Quadrantes

### No briefing diário
Tarefas ordenadas por eisenhower_quadrant ASC → Q1 primeiro, Q4 por último.
Mostra apenas max_daily_tasks itens (padrão 3).

### Sugestão de delegação (Q3)
Se uma tarefa cai no Q3, o TOM sugere:
"Essa tarefa é urgente mas não é estratégica. Não precisa ser você. Quer delegar pra alguém?"

### Sugestão de eliminação (Q4)
Se uma tarefa fica no Q4 por mais de 7 dias sem ser tocada:
"[Tarefa] tá no radar há [N] dias e não é urgente nem estratégica. Quer cancelar ou manter?"

### Recálculo automático
O quadrante recalcula toda vez que:
- due_date muda (reagendamento)
- priority muda
- project_id muda (tarefa vinculada/desvinculada de projeto)
- status muda (overdue força Q1)

## Veto Conditions — NUNCA
- NUNCA mostrar os nomes dos quadrantes pro colaborador ("Quadrante 1", "Eisenhower")
- NUNCA permitir que o colaborador classifique manualmente — é automático
- NUNCA ignorar tarefas atrasadas — sempre Q1 independente de importância
- NUNCA priorizar tarefa pessoal sobre tarefa de trabalho no briefing de trabalho (são mensagens separadas)

## Checklist de Conclusão
- [ ] Trigger criado no banco (INSERT e UPDATE)
- [ ] Function calcula corretamente os 4 quadrantes
- [ ] Briefing ordena por quadrante
- [ ] Q3 gera sugestão de delegação
- [ ] Q4 gera sugestão de eliminação após 7 dias
- [ ] Recálculo funciona ao mudar due_date, priority, project_id ou status

## Integrações
- **Supabase** — trigger em tasks, field eisenhower_quadrant
- **Rituais diários** — usa quadrante pra ordenar briefing
