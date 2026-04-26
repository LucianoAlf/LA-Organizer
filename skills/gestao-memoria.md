---
name: gestao-memoria
description: Skill para consolidar, buscar, criar e expirar memórias do TOM sobre cada colaborador. Use no cron semanal de consolidação (domingo 22h), quando o colaborador mencionar fato pessoal/profissional, ou quando o TOM identificar padrão recorrente.
---

# Gestão de Memória

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Contexto da interação ou cron | Sim |
| action | enum (consolidate, create, search, expire) | Sistema ou observação | Sim |
| content | text | Fato, padrão ou lição observada | Pra create |
| search_query | text | Termo de busca | Pra search |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| collaborator_memory | record | Supabase (criada ou atualizada) |
| collaborator_profiles | record | Supabase (campos atualizados) |
| search_results | record[] | Prompt do TOM (contexto enriquecido) |

## Fases de Execução

### Criação explícita de memória
Quando o colaborador diz algo que o TOM deve lembrar:

> "TOM, eu dou aula particular em casa terça e quinta à noite"

```sql
INSERT INTO collaborator_memory (collaborator_id, memory_type, content, source, importance)
VALUES ($1, 'fact', 'Dá aula particular em casa terça e quinta à noite', 'explicit', 'normal');
```

Confirmar: "Anotado. Vou levar isso em conta no planejamento."

### Criação por observação
Quando o TOM percebe um padrão após múltiplas interações:

Exemplo: após 4 semanas, Joel não responde fechamento nas sextas.

```sql
INSERT INTO collaborator_memory (collaborator_id, memory_type, content, source, importance)
VALUES ($joel_id, 'lesson', 
  'Joel não responde fechamento nas sextas — provavelmente já saiu da escola. Considerar enviar às 17h nas sextas.',
  'observation', 'normal');
```

### Busca de memórias (a cada interação)
Antes de responder, o TOM busca as memórias mais relevantes:

```sql
-- Top 10 por importância e recência
SELECT content, memory_type, importance, updated_at
FROM collaborator_memory
WHERE collaborator_id = $1 AND is_active = true
ORDER BY
  CASE importance WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 END,
  updated_at DESC
LIMIT 10;
```

Pra busca por tema específico (FTS5):
```sql
SELECT content, memory_type, ts_rank(to_tsvector('portuguese', content), query) as rank
FROM collaborator_memory, plainto_tsquery('portuguese', $search_query) query
WHERE collaborator_id = $1 AND is_active = true
  AND to_tsvector('portuguese', content) @@ query
ORDER BY rank DESC
LIMIT 5;
```

### Consolidação semanal (cron domingo 22h)

Para cada colaborador ativo:

```
1. Puxar conversation_history dos últimos 7 dias
2. Montar prompt de consolidação:

   "Analise estas conversas entre o TOM e [nome].
    Extraia:
    - Fatos novos (coisas que a pessoa mencionou sobre si, horários, preferências)
    - Padrões comportamentais (quando responde, quando ignora, como reage a cobrança)
    - Decisões tomadas (mudanças de preferência, reagendamentos recorrentes)
    - Contexto temporal (eventos, projetos, prazos mencionados)
    
    Retorne em JSON:
    [
      {type: 'fact|lesson|preference|context', content: '...', importance: 'critical|high|normal|low', decay_at: null|'YYYY-MM-DD'}
    ]"

3. Pra cada item retornado:
   - Verificar se já existe (busca por similaridade no content)
   - Se novo → INSERT
   - Se similar mas com info atualizada → UPDATE
   - Se conflita com memória existente → UPDATE (mais recente ganha)

4. Atualizar collaborator_profiles:
   - communication_style (baseado em padrões de resposta)
   - response_pattern (baseado em ritual_logs)
   - best_coaching_approach (baseado no que gerou mais conclusão)
   - avg_response_time_min (cálculo direto dos ritual_logs)
   - completion_rate_30d (cálculo direto dos daily_plans)
   - maturity_level (avaliação baseada em métricas acumuladas)

5. Expirar memórias:
   UPDATE collaborator_memory SET is_active = false
   WHERE decay_at IS NOT NULL AND decay_at < CURRENT_DATE;
```

### Tipos de memória e exemplos

| Tipo | Exemplo | Expira? |
|---|---|---|
| fact | "Mora em Campo Grande, leva 1h pra chegar no Recreio" | Não |
| decision | "Decidiu que planejamento semanal é segunda 7h30, não domingo" | Não |
| lesson | "Quando fala 'tô vendo', geralmente não faz. Melhor sugerir data concreta" | Não |
| preference | "Prefere receber lembrete Emusys por texto, não por lista" | Não |
| context | "Organizando o Sarau de Violinos até junho 2026" | Sim (01/07/2026) |

## Veto Conditions — NUNCA
- NUNCA expor memórias do TOM pro colaborador ("eu sei que você não responde nas sextas")
- NUNCA compartilhar memória de uma pessoa com outra
- NUNCA fabricar memória — só registrar o que foi observado ou dito explicitamente
- NUNCA deletar memória sem marcar como is_active=false primeiro (soft delete)
- NUNCA carregar mais de 10 memórias no prompt (performance)
- NUNCA usar memórias pessoais pra julgar performance de trabalho

## Checklist de Conclusão
- [ ] Memórias explícitas registradas quando colaborador menciona fatos
- [ ] Padrões observados registrados como 'lesson' após confirmação interna
- [ ] Consolidação semanal rodando no cron domingo 22h
- [ ] Perfis atualizados com métricas e padrões
- [ ] Memórias expiradas marcadas como is_active=false
- [ ] Busca FTS5 funcionando pra consultas por tema
- [ ] Top 10 memórias carregadas em cada interação

## Integrações
- **Supabase** — collaborator_memory, collaborator_profiles, conversation_history, ritual_logs, daily_plans
- **Claude Sonnet 4.6** — prompt de consolidação (extração de fatos e padrões)
- **pg_cron** — fn_consolidate_memory() domingo 22h
