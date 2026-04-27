# TOM-USER-TEMPLATE — Perfil Evolutivo por Colaborador

**Documento:** TOM-USER-TEMPLATE
**Versão:** 1.1
**Data:** 27 de abril de 2026
**Função:** Define a estrutura do perfil que o TOM constrói sobre cada colaborador ao longo do tempo

---

## O que é

No OpenClaw, cada agente pode manter um `USER.md` com contexto profundo sobre a pessoa com quem conversa.

O TOM atende dezenas de pessoas. O equivalente conceitual desse `USER.md` é o conjunto de dados estruturados em `collaborator_profiles` + `user_preferences` + memória relevante por colaborador.

Ou seja:
- no OpenClaw, o contexto de pessoa tende a viver em arquivo
- no TOM, o contexto de pessoa vive principalmente no banco

A ideia é a mesma: o sistema não conversa com alguém como se fosse a primeira vez toda vez.

---

## Quando o perfil nasce

O perfil começa no onboarding com um núcleo mínimo.

No início, quase tudo está vazio. O TOM vai preenchendo esse perfil com base em uso real, padrões observados, preferências identificadas e métricas acumuladas.

---

## Estrutura do perfil

### Campos que o TOM aprende com o tempo

| Campo | O que representa | Exemplo |
|---|---|---|
| `communication_style` | Como a pessoa costuma se comunicar | "Direto, responde com poucas palavras. Prefere áudio." |
| `response_pattern` | Quando e como a pessoa costuma responder | "Responde rápido de manhã. Ignora mais depois das 19h." |
| `best_coaching_approach` | Qual abordagem tende a funcionar melhor | "Responde melhor a dado do que a apelo emocional." |
| `strengths` | Padrões positivos recorrentes | "Organizado quando o prazo está claro." |
| `growth_areas` | Pontos de dificuldade recorrentes | "Esquece de fechar o dia. Assume mais do que cabe." |
| `personal_context` | Contexto pessoal relevante mencionado voluntariamente | "Leva os filhos na escola pela manhã." |
| `vocabulary_notes` | Expressões e sinais úteis para interpretação | "'Show' = confirmou. 'Tô vendo' = provavelmente vai adiar." |
| `profile_notes` | Observações operacionais consolidadas | "Fechamento às 19h pega mal porque geralmente ainda está em trânsito." |
| `maturity_level` | Nível de maturidade no sistema (heurística) | `beginner`, `developing`, `proficient`, `advanced` |
| `total_interactions` | Volume de interação acumulada | `147` |
| `avg_response_time_min` | Tendência de resposta | `12.4` |
| `completion_rate_30d` | Entrega recente | `65.2` |

### Campos que a pessoa configura

Esses campos pertencem a `user_preferences`, não ao perfil analítico:

| Campo | Exemplo |
|---|---|
| `briefing_time` | `08:00` |
| `personal_briefing_time` | `07:00` |
| `closing_time` | `19:00` |
| `planning_day` | `0` (domingo) |
| `planning_time` | `19:00` |
| `coaching_intensity` | `normal` |

---

## Como o TOM usa esse perfil

Antes de responder, o TOM monta um contexto da pessoa combinando:
1. identidade e regras estáveis (`SOUL.md` + `AGENTS.md`)
2. perfil evolutivo (`collaborator_profiles`)
3. preferências explícitas (`user_preferences`)
4. memórias relevantes (`collaborator_memory`)
5. contexto operacional do momento

O efeito prático é simples:
- o TOM parece conhecer a pessoa
- adapta tom e cobrança
- evita repetir explicação desnecessária
- conversa com continuidade real

---

## Exemplo de perfil montado no contexto

```markdown
## Quem você está atendendo agora

**Nome:** Marcos Quintela
**Role:** Coordenador Pedagógico
**Intensidade de cobrança:** hard
**Maturidade:** developing

**Como funciona melhor:**
- responde rápido de manhã
- prefere mensagem curta com dado
- costuma ignorar fechamento quando está em deslocamento
- "tô vendo" geralmente significa "não vai fazer agora"

**Performance recente:**
- conclusão 30d: 65%
- rituais respondidos: 85%
- principal fragilidade: fechamento
```

Esse tipo de contexto não é mostrado ao colaborador. É usado internamente para calibrar a resposta.

---

## Evolução do maturity_level

O `maturity_level` é uma heurística operacional, não uma verdade absoluta.

| Nível | Tendência observada | Como o TOM ajusta |
|---|---|---|
| `beginner` | pessoa ainda entendendo o sistema | explica mais, orienta mais, celebra pequenas vitórias |
| `developing` | já usa o sistema, mas ainda oscila | cobra mais consistência e reduz explicação |
| `proficient` | responde bem e mantém ritmo | vai mais direto ao ponto |
| `advanced` | usa o sistema com autonomia alta | comunicação mínima e objetiva |

A transição pode ser apoiada por critérios de uso, mas continua sendo uma interpretação do sistema — não um carimbo definitivo sobre a pessoa.

---

## Como o perfil evolui

### Fontes de evolução
- interações do dia a dia
- padrões observados ao longo do tempo
- consolidação periódica das conversas
- métricas operacionais acumuladas

### Exemplos
- se a pessoa sempre responde rápido de manhã, isso vira padrão
- se reage melhor a cobrança com número, isso vira abordagem preferida
- se muda claramente de comportamento, o perfil precisa acompanhar

---

## Privacidade

O perfil é interno.

### Quem pode ver o quê
| Quem | O que vê |
|---|---|
| Colaborador | Suas preferências explícitas |
| Coordenador | Métricas e dados operacionais necessários |
| Diretor | Panorama operacional e métricas |
| TOM / service role | Perfil completo, memória e preferências |

### Princípio
O colaborador não precisa ver as notas analíticas do TOM sobre ele.

Exemplo:
- "quando fala 'tô na correria', normalmente não entrega hoje"

Isso é observação operacional do TOM, não feedback para ser exibido diretamente.

---

## Exemplo de perfil completo

```json
{
  "communication_style": "Direto, responde com poucas palavras. Prefere texto curto e usa áudio quando está na rua.",
  "response_pattern": "Responde rápido antes das 10h. Depois das 15h costuma demorar mais.",
  "best_coaching_approach": "Responde melhor a dados e números do que a cobrança emocional.",
  "strengths": "Organizado quando tem prazo claro. Bom em delegar quando lembrado disso.",
  "growth_areas": "Esquece o fechamento do dia. Assume mais tarefas do que cabe na semana.",
  "personal_context": "Leva filhos à escola pela manhã e costuma ficar em trânsito no fim do dia.",
  "vocabulary_notes": "'Show' = confirmou. 'Tô vendo' = provavelmente vai adiar.",
  "profile_notes": "Fechamento às 19h tende a falhar quando ainda está em deslocamento.",
  "maturity_level": "developing",
  "total_interactions": 147,
  "avg_response_time_min": 12.4,
  "completion_rate_30d": 65.2
}
```

---

## O que diferencia o TOM de um bot genérico

| Bot genérico | TOM com perfil evolutivo |
|---|---|
| Responde igual para todo mundo | Ajusta abordagem por pessoa |
| Depende da pessoa repetir contexto | Carrega contexto útil ao longo do tempo |
| Não aprende com padrão | Aprende com uso e recorrência |
| Trata todo mundo como usuário abstrato | Trata cada colaborador como relação contínua |

---

## Princípio final

O perfil não existe para rotular a pessoa.
Ele existe para o TOM se adaptar melhor a ela.

Sem perfil, o TOM responde.
Com perfil, o TOM acompanha de forma personalizada.
