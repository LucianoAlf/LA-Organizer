# TOM-MEMORY-ARCHITECTURE — Sistema de Memória

**Documento:** TOM-MEMORY-ARCHITECTURE
**Versão:** 1.1
**Data:** 27 de abril de 2026
**Função:** Define como o TOM lembra, aprende, busca e esquece

---

## Visão geral

O TOM trabalha com 3 camadas de memória, da mais efêmera à mais estável:

```text
┌─────────────────────────────────────────┐
│ Camada 3: SOUL + AGENTS (estável)      │
│ Quem o TOM é e como opera.             │
├─────────────────────────────────────────┤
│ Camada 2: MEMÓRIA DE LONGO PRAZO       │
│ collaborator_memory + profiles         │
│ Fatos, padrões, lições e preferências. │
├─────────────────────────────────────────┤
│ Camada 1: MEMÓRIA DE CURTO PRAZO       │
│ conversation_history                   │
│ Continuidade conversacional recente.   │
└─────────────────────────────────────────┘
```

---

## Camada 1: Memória de curto prazo

### Tabela: `conversation_history`

Registro das mensagens trocadas entre o TOM e cada colaborador.

### Função
Dar continuidade à conversa.

Exemplo: se o colaborador manda "fiz a 2", o TOM precisa saber qual era a tarefa 2 no contexto recente.

### Carregamento
- últimas mensagens relevantes da pessoa
- suficiente para manter continuidade sem inchar o prompt

### Retenção
- retenção limitada por pessoa
- limpeza periódica via cron

### Uso
- continuidade conversacional
- insumo para consolidação semanal
- apoio a métricas como tempo de resposta e padrão de interação

### Privacidade
100% privado. Coordenador e diretor não veem o conteúdo bruto — no máximo métricas derivadas.

---

## Camada 2: Memória de longo prazo

### Tabela: `collaborator_memory`

Guarda fatos, decisões, lições, preferências e contexto relevante aprendidos sobre cada colaborador.

### Função
Dar profundidade e continuidade real.

Exemplo: se o TOM aprende que uma pessoa ignora fechamento em certo horário ou responde melhor de manhã, pode adaptar a abordagem sem que a pessoa precise repetir isso toda semana.

### Carregamento
- top memórias mais relevantes por pessoa
- relevância combinando importância, atualidade e contexto

---

## Tipos de memória

| Tipo | O que é | Exemplo | Expira? |
|---|---|---|---|
| `fact` | Fato concreto | "Joel dá aula de violino terça e quinta no Recreio" | Não |
| `decision` | Decisão tomada | "Juliana decidiu planejar a semana na segunda 7h30" | Não |
| `lesson` | Padrão observado | "Quando Joel fala 'depois vejo', é melhor pedir data concreta" | Não |
| `preference` | Preferência descoberta | "Eric prefere lembrete Emusys por texto" | Não |
| `context` | Contexto temporário | "Jordão está organizando o Sarau até junho" | Sim — é o tipo que mais expira |

### Regra prática
- `fact`, `decision`, `lesson` e `preference` tendem a durar
- `context` é o tipo mais propenso a expirar — sempre definir `decay_at`

---

## Busca e relevância

Quando o TOM monta o contexto de uma interação, ele não puxa toda a memória. Ele traz só o que é mais útil naquele momento.

### Critérios principais
- importância
- recência
- aderência ao tema da interação
- status ativo

### Busca textual
Quando precisa buscar memórias por tema, o sistema usa a busca textual nativa do PostgreSQL sobre memórias ativas da pessoa.

---

## Como memórias são criadas

Memórias surgem de 3 formas:

### 1. Explícita
A própria pessoa diz algo que vale lembrar.

Exemplo:
> "Dou aula particular em casa terça e quinta à noite."

### 2. Observação
O TOM percebe um padrão ao longo do tempo.

Exemplo:
> Depois de várias semanas, o TOM percebe que a pessoa não responde fechamento em certo horário e ajusta a abordagem.

### 3. Consolidação
O cron semanal revisa conversas recentes e extrai:
- fatos novos
- decisões
- padrões
- preferências
- contexto temporário relevante

---

## Decay (expiração)

Memórias temporárias podem ter `decay_at`.

Quando esse prazo passa:
- a memória não precisa ser apagada fisicamente
- ela deixa de ser considerada ativa para o contexto

Exemplo:
> "Jordão está organizando o Sarau até junho."

Depois do evento, isso perde relevância operacional.

---

## Camada 3: Identidade estável

### SOUL.md + AGENTS.md

Esses arquivos definem:
- quem o TOM é
- como fala
- quais princípios segue
- quais limites não cruza

### Importante
Eles não mudam com uso normal.
Só devem mudar por decisão explícita do Alf.

---

## Consolidação semanal

### Cron semanal
A consolidação periódica deve:
1. revisar conversas recentes por colaborador
2. extrair fatos, preferências, decisões e padrões
3. evitar duplicata
4. atualizar perfis quando houver padrão consistente
5. desativar memórias temporárias expiradas

### Objetivo
Transformar histórico bruto em memória útil.

---

## Fluxo de memória em uma interação

Exemplo:

> Quintela manda: "Fiz a entrevista do professor, o cara é bom."

Fluxo:
1. o TOM identifica a pessoa
2. carrega identidade estável
3. carrega perfil, memória relevante e histórico curto
4. carrega tarefas e contexto operacional
5. interpreta a mensagem
6. responde
7. registra a interação
8. atualiza o que precisa ser atualizado

O objetivo operacional é que isso aconteça rápido o suficiente para a conversa parecer natural.

---

## Volume e retenção

A memória do TOM deve crescer com controle.

### Princípios
- `conversation_history` cresce mais rápido e precisa de retenção
- `collaborator_memory` cresce devagar, mas com mais valor
- `collaborator_profiles` não cresce em volume; só amadurece

### Regra prática
Manter histórico bruto sob controle e investir em memória consolidada.

---

## O que diferencia o TOM de um chatbot genérico

| Chatbot genérico | TOM com memória |
|---|---|
| Começa quase do zero | Continua de onde a relação parou |
| Responde igual para todo mundo | Ajusta tom e abordagem por pessoa |
| Não aprende com padrão | Aprende com repetição e comportamento |
| Depende da pessoa repetir tudo | Leva contexto útil para a próxima interação |

---

## Princípio final

Memória não existe para acumular dado.
Memória existe para melhorar continuidade, contexto, adaptação e relação.

Sem memória, o TOM responde.
Com memória, o TOM acompanha.
