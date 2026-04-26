# TOM-MEMORY-ARCHITECTURE — Sistema de Memória

**Documento:** TOM-MEMORY-ARCHITECTURE  
**Versão:** 1.0  
**Data:** 25 de abril de 2026  
**Função:** Define como o TOM lembra, aprende, busca e esquece

---

## Visão geral

O TOM tem 3 camadas de memória, do mais efêmero ao mais permanente:

```
┌─────────────────────────────────────────┐
│  Camada 3: SOUL + AGENTS (imutável)     │
│  Quem o TOM é. Nunca muda.             │
├─────────────────────────────────────────┤
│  Camada 2: MEMÓRIA DE LONGO PRAZO       │
│  collaborator_memory + profiles         │
│  Fatos, padrões, lições. Dura meses.   │
├─────────────────────────────────────────┤
│  Camada 1: MEMÓRIA DE CURTO PRAZO       │
│  conversation_history                   │
│  Últimas mensagens. Dura 30 dias.      │
└─────────────────────────────────────────┘
```

---

## Camada 1: Memória de curto prazo

### Tabela: `conversation_history`

Registro de todas as mensagens trocadas entre o TOM e cada colaborador.

**Função:** dar continuidade à conversa. Quando o colaborador manda "fiz a 2", o TOM precisa saber qual é "a 2" — isso vem do histórico recente.

**Carregamento:** últimas 20 mensagens da pessoa são injetadas no prompt a cada interação.

**Retenção:** máximo 500 mensagens por pessoa. Cron mensal arquiva as mais antigas.

**Uso:**
- Continuidade conversacional (saber do que estavam falando)
- Input pra consolidação semanal (extrair fatos → memória de longo prazo)
- Cálculo de métricas (tempo de resposta, padrão de comportamento)

**Privacidade:** 100% privado. Só o service_role (TOM) lê. Coordenador vê métricas derivadas, nunca o conteúdo.

---

## Camada 2: Memória de longo prazo

### Tabela: `collaborator_memory`

Fatos, decisões, lições e contexto que o TOM aprendeu sobre cada pessoa ao longo do tempo.

**Função:** dar profundidade. Quando o TOM sabe que "Quintela ignora fechamento quando tá na escola à tarde", ele pode ajustar o horário ou mudar a abordagem — sem o Quintela ter que repetir isso toda semana.

**Carregamento:** top 10 memórias mais relevantes (por importance + recência) injetadas no prompt a cada interação.

### Tipos de memória

| Tipo | O que é | Exemplo | Decai? |
|---|---|---|---|
| `fact` | Fato concreto aprendido | "Joel dá aula de violino terça e quinta no Recreio" | Não |
| `decision` | Decisão registrada pelo colaborador ou coordenador | "Juliana decidiu que planejamento semanal é segunda 7h30" | Não |
| `lesson` | Padrão comportamental observado pelo TOM | "Quando Joel fala 'depois vejo', nunca faz. Melhor sugerir data concreta." | Não |
| `preference` | Preferência descoberta | "Eric prefere receber lembrete Emusys por texto, não por áudio" | Não |
| `context` | Contexto temporário | "Jordão tá organizando o Sarau até junho" | Sim (decay_at = data do evento) |

### Relevância e busca

Quando o TOM precisa montar o contexto pra uma interação, ele busca memórias assim:

```sql
-- Top 10 memórias mais relevantes pra essa pessoa
SELECT content, memory_type, importance
FROM collaborator_memory
WHERE collaborator_id = $1
  AND is_active = true
ORDER BY
  CASE importance
    WHEN 'critical' THEN 1
    WHEN 'high' THEN 2
    WHEN 'normal' THEN 3
    WHEN 'low' THEN 4
  END,
  updated_at DESC
LIMIT 10;
```

Pra buscas por tema, usa FTS5 (Full-Text Search):

```sql
-- Buscar memórias sobre um tema específico
SELECT content, memory_type
FROM collaborator_memory
WHERE collaborator_id = $1
  AND is_active = true
  AND to_tsvector('portuguese', content) @@ plainto_tsquery('portuguese', $2)
ORDER BY ts_rank(to_tsvector('portuguese', content), plainto_tsquery('portuguese', $2)) DESC
LIMIT 5;
```

### Criação de memórias

Memórias são criadas de 3 formas:

**1. Explícita — o colaborador diz algo que o TOM deve lembrar:**
> "TOM, eu dou aula particular em casa terça e quinta à noite"

→ TOM cria memória: type='fact', content='Dá aula particular em casa terça e quinta à noite', importance='normal', source='explicit'

**2. Observação — o TOM percebe um padrão:**
Após 4 semanas observando que o Joel não responde fechamento nas sextas:

→ TOM cria memória: type='lesson', content='Joel não responde fechamento nas sextas — provavelmente já saiu da escola. Considerar enviar às 17h em vez de 19h nas sextas.', importance='normal', source='observation'

**3. Consolidação — cron semanal extrai fatos do conversation_history:**
O cron de domingo 22h varre as conversas da semana e extrai:
- Fatos novos mencionados
- Decisões tomadas
- Padrões repetidos
- Contexto que vale guardar

→ TOM cria memórias com source='conversation'

### Decay (expiração)

Memórias com `decay_at` são temporárias. Quando a data passa, o cron marca `is_active = false`.

Exemplo: "Jordão tá organizando o Sarau até junho" → decay_at = 2026-07-01. Após julho, essa memória desaparece do contexto.

Memórias sem decay_at são permanentes (facts, decisions, preferences). Podem ser desativadas manualmente se ficarem obsoletas.

---

## Camada 3: Identidade (imutável)

### SOUL.md + AGENTS.md

Carregados em toda interação. Não mudam com o uso — só mudam se o Alf autorizar.

**SOUL.md:** quem o TOM é, como fala, princípios, anti-patterns.

**AGENTS.md:** o que pode fazer, permissões por role, protocolos, red lines.

Esses arquivos ficam na VPS, não no banco. São lidos do filesystem a cada startup de interação.

---

## Consolidação semanal

### Cron: domingo 22h — `fn_consolidate_memory()`

**Pra cada colaborador ativo:**

```
1. Ler conversation_history dos últimos 7 dias
2. Chamar Sonnet 4.6 com prompt de consolidação:
   "Analise estas conversas e extraia:
    - Fatos novos sobre esta pessoa
    - Padrões comportamentais observados
    - Decisões tomadas
    - Preferências descobertas
    - Contexto temporal relevante
    Retorne em JSON."
3. Pra cada item extraído:
   - Verificar se já existe em collaborator_memory (evitar duplicata)
   - Se novo, criar registro com type, importance, source='conversation'
   - Se já existe mas com informação atualizada, fazer UPDATE
4. Atualizar collaborator_profiles com padrões observados
5. Marcar memórias com decay_at expirado como is_active = false
6. Calcular maturity_level com base em métricas acumuladas
```

### Custo estimado

- ~40 colaboradores × ~50 mensagens/semana = ~2.000 mensagens pra processar
- Cada consolidação = ~1 chamada ao Sonnet 4.6 por pessoa (com contexto reduzido)
- ~40 chamadas por semana = custo mínimo dentro da assinatura Max

---

## Fluxo completo de memória em uma interação

```
Quintela manda: "Fiz a entrevista do professor, o cara é bom"

1. TOM recebe a mensagem via UAZAPI
2. Identifica: Quintela (pelo phone)
3. Carrega SOUL.md + AGENTS.md (VPS)
4. Carrega collaborator_profiles do Quintela (Supabase)
5. Carrega top 10 collaborator_memory do Quintela (Supabase)
6. Carrega últimas 20 conversation_history do Quintela (Supabase)
7. Carrega contexto: tarefas do dia, projetos, checkpoints
8. Monta o prompt completo e chama Sonnet 4.6
9. Modelo responde: "Show, Quintela. Entrevista feita ✅. Faltam 2 pro dia."
10. Registra a mensagem do Quintela em conversation_history (inbound)
11. Registra a resposta do TOM em conversation_history (outbound)
12. Marca a tarefa "Entrevista professor" como done
13. Atualiza daily_plan_items
14. Incrementa total_interactions no collaborator_profiles
```

Tudo isso em < 3 segundos.

---

## Volume e performance

| Tabela | Registros por mês (40 pessoas) | Crescimento | Retenção |
|---|---|---|---|
| conversation_history | 4.000-8.000 | Alto | Max 500/pessoa. Cron mensal limpa |
| collaborator_memory | 200-400 novos | Médio | Sem limite. Decay marca is_active=false |
| collaborator_profiles | 40 (atualizações, não novos) | Nenhum | Permanente |

**PostgreSQL lida com isso sem suar.** A tabela mais pesada (conversation_history) é limitada por retenção. As buscas FTS5 são nativas do PostgreSQL e não precisam de serviço externo.

---

## O que diferencia de um chatbot

| Chatbot genérico | TOM com memória |
|---|---|
| "Olá! Como posso ajudar?" | "E aí, Quintela. Ontem fez 2 de 3. Falta o material do teatro — quer manter pra hoje?" |
| Não sabe quem é a pessoa | Sabe o nome, o role, o estilo, os padrões |
| Toda conversa começa do zero | Continuidade total — lembra do que foi falado ontem, semana passada, mês passado |
| Responde igual pra todo mundo | Adapta tom, intensidade e abordagem por pessoa |
| Não aprende | Aprende com cada interação e melhora com o tempo |

---

_Memória é o que transforma interação em relacionamento. Sem ela, o TOM é só um bot. Com ela, o TOM é um copiloto que te conhece._
