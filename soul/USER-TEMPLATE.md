# TOM-USER-TEMPLATE — Perfil Evolutivo por Colaborador

**Documento:** TOM-USER-TEMPLATE  
**Versão:** 1.0  
**Data:** 25 de abril de 2026  
**Função:** Define a estrutura do perfil que o TOM constrói sobre cada colaborador ao longo do tempo

---

## O que é

No OpenClaw, cada agente tem um USER.md — um arquivo markdown com tudo sobre a pessoa com quem conversa. É um documento único pra um usuário único.

O TOM atende 40+ pessoas. O equivalente do USER.md é a tabela `collaborator_profiles` no Supabase — um registro estruturado por pessoa, montado no prompt antes de cada interação. O TOM "lê o USER" toda vez que alguém manda mensagem, exatamente como o OpenClaw faz, mas puxando do banco em vez de ler arquivo.

A diferença fundamental: no OpenClaw, o USER.md é escrito pelo humano ou pelo agente manualmente. No TOM, o perfil evolui automaticamente com base nas interações. O TOM observa, aprende, e atualiza.

---

## Quando o perfil é criado

No momento do **onboarding** (primeira conversa), o TOM cria o perfil com defaults:

```sql
INSERT INTO collaborator_profiles (
  collaborator_id,
  maturity_level,
  total_interactions,
  created_at
) VALUES (
  $1,
  'beginner',
  0,
  now()
);
```

Tudo começa vazio. O perfil se preenche conforme o TOM interage com a pessoa.

---

## Estrutura do perfil

### Dados preenchidos pelo TOM automaticamente

| Campo | Tipo | Quando atualiza | Exemplo |
|---|---|---|---|
| communication_style | text | Após ~10 interações | "Direto, responde com 1-2 palavras. Prefere áudio." |
| response_pattern | text | Após ~10 interações | "Responde rápido de manhã (avg 4 min). Ignora após 19h." |
| best_coaching_approach | text | Após ~20 interações | "Responde melhor a dados. Não gosta de pressão emocional." |
| strengths | text | Observação contínua | "Muito organizado quando tem prazo claro. Bom em delegar." |
| growth_areas | text | Observação contínua | "Esquece de fechar o dia. Tende a aceitar mais tarefas do que cabe." |
| personal_context | text | Quando o colaborador menciona | "Tem 2 filhos, leva na escola de manhã. Toca em banda sexta à noite." |
| vocabulary_notes | text | Observação contínua | "Usa 'show' pra confirmar. 'Tô na correria' = não vai fazer hoje." |
| maturity_level | enum | A cada 30 dias | beginner → developing → proficient → advanced |
| total_interactions | int | A cada interação | Incrementa automaticamente |
| avg_response_time_min | numeric | Calculado em ritual_logs | Média dos últimos 30 dias |
| completion_rate_30d | numeric | Calculado em daily_plans | Taxa de conclusão dos últimos 30 dias |

### Dados configurados pelo colaborador (via onboarding ou configurações)

Estes ficam na tabela `user_preferences`, não no perfil:

| Campo | Configurado por | Default |
|---|---|---|
| briefing_time | Colaborador | 08:00 |
| personal_briefing_time | Colaborador | 07:00 |
| closing_time | Colaborador | 19:00 |
| planning_day | Colaborador | 0 (domingo) |
| planning_time | Colaborador | 19:00 |
| coaching_intensity | Colaborador | normal |

---

## Como o TOM usa o perfil

### Montagem do prompt (a cada interação)

Antes de chamar o modelo (Sonnet 4.6), o TOM monta o system prompt assim:

```
1. SOUL.md (fixo — quem o TOM é)
2. AGENTS.md (fixo — regras operacionais)
3. [PERFIL DA PESSOA] — montado do collaborator_profiles:
   - Nome: Marcos Quintela
   - Role: Coordenador Pedagógico
   - Intensidade: hard
   - Estilo: "Direto, responde com poucas palavras"
   - Padrão: "Responde rápido de manhã, ignora à noite"
   - Abordagem: "Responde melhor a dados e números"
   - Maturidade: developing
   - Conclusão 30d: 65%
4. [MEMÓRIAS RELEVANTES] — top 10 de collaborator_memory
5. [CONTEXTO DO DIA] — tarefas de hoje, pendências, projetos ativos
6. [MENSAGEM DO COLABORADOR]
```

O modelo recebe tudo isso e responde como se conhecesse a pessoa de longa data. Pro Quintela, a experiência é: "o TOM me conhece, sabe como eu funciono, e fala do jeito que eu entendo."

### Exemplo de perfil montado no prompt

```markdown
## Quem você está atendendo agora

**Nome:** Marcos Quintela
**Role:** Coordenador Pedagógico — supervisiona 8 colaboradores
**Unidade:** Todas
**Intensidade de cobrança:** Dura (ele escolheu)
**No sistema desde:** Abril 2026
**Maturidade:** Developing (2º mês)

**Como ele funciona:**
- Responde rápido de manhã (avg 4 min antes das 10h)
- Depois das 15h, tempo de resposta sobe pra 45 min (tá em escola)
- Prefere mensagens curtas com números. Não gosta de texto longo
- Usa "show" pra confirmar. "Tô vendo" = vai fazer depois
- Quando fala "tô na correria" geralmente não vai fazer naquele dia — ofereça reagendar

**Performance recente:**
- Conclusão 30d: 65% (abaixo da meta de 70%)
- Rituais respondidos: 85% (bom)
- Ponto fraco: fechamento — ignora 40% das vezes

**Contexto atual:**
- Liderando Projeto da Turminha (checkpoint: Roteiros, vence 02/mai)
- Lidando com transição do Renan (professor que saiu)
- Entrevistando professores candidatos essa semana
```

---

## Evolução do maturity_level

| Nível | Critério | O que muda no TOM |
|---|---|---|
| **beginner** | Primeiras 2 semanas ou < 20 interações | TOM é mais explicativo, manda dicas de como usar, celebra pequenas conquistas |
| **developing** | 2-8 semanas, > 20 interações, conclusão > 50% | TOM reduz explicações, assume que sabe usar, foca em produtividade |
| **proficient** | 2-4 meses, conclusão > 70%, rituais > 80% respondidos | TOM é conciso, vai direto ao ponto, menos hand-holding |
| **advanced** | 4+ meses, conclusão > 85%, rituais > 90% | TOM é mínimo — só o essencial. Pessoa já internalizou os rituais |

A transição é automática (calculada no cron semanal) mas pode ser ajustada manualmente pelo coordenador ou pelo Alf.

---

## Atualização do perfil

### Frequência
| Tipo de atualização | Quando |
|---|---|
| total_interactions | A cada interação (incremento) |
| avg_response_time_min | Calculado no cron semanal com base em ritual_logs |
| completion_rate_30d | Calculado no cron semanal com base em daily_plans |
| maturity_level | Avaliado no cron semanal |
| communication_style, response_pattern, vocabulary_notes | Consolidação semanal (domingo 22h) — TOM analisa conversation_history e atualiza |
| best_coaching_approach, strengths, growth_areas | Consolidação mensal ou após mudança significativa de performance |
| personal_context | Quando o colaborador menciona algo pessoal voluntariamente |

### Quem atualiza
- **O TOM (via consolidação automática):** campos de comportamento e performance
- **O colaborador (via configurações):** preferências de horário e intensidade
- **O coordenador (via PWA, se necessário):** maturity_level (override manual)

---

## Privacidade

O perfil é **100% privado**. Nenhum coordenador ou diretor vê o `collaborator_profiles` de outra pessoa.

| Quem | O que vê |
|---|---|
| Colaborador | Pode ver e editar suas preferências (user_preferences). NÃO vê o perfil que o TOM construiu sobre ele |
| Coordenador | Vê métricas agregadas (taxa de conclusão, aderência). NÃO vê perfil, memórias ou conversas |
| Diretor | Mesmo que coordenador — métricas, não perfil |
| Service role (TOM) | Vê tudo — é o único que lê e escreve o perfil |

**Por que o colaborador não vê o perfil do TOM sobre ele?**
Porque o perfil contém observações do TOM que seriam estranhas de ler sobre si mesmo ("tende a aceitar mais do que cabe", "quando fala 'tô vendo' geralmente não vai fazer"). São notas operacionais do TOM, não avaliação de desempenho. O colaborador vê suas métricas — não as notas.

---

## Exemplo completo de perfil (como fica no banco)

```json
{
  "id": "uuid",
  "collaborator_id": "uuid-do-quintela",
  "communication_style": "Direto, responde com poucas palavras. Prefere texto curto. Não gosta de mensagem longa. Usa áudio quando tá na rua.",
  "response_pattern": "Responde rápido antes das 10h (avg 4 min). Depois das 15h sobe pra 45 min — geralmente tá em escola. Sexta à tarde costuma não responder.",
  "best_coaching_approach": "Dados e números funcionam melhor. Quando recebe '65% essa semana' reage mais do que quando recebe 'precisa melhorar'. Não gosta de pressão emocional.",
  "strengths": "Organizado quando tem prazo claro. Bom em delegar quando lembrado que pode. Proativo em projetos que gosta.",
  "growth_areas": "Esquece o fechamento do dia (ignora 40%). Aceita mais tarefas do que cabe na semana. Não pede prazo quando deveria.",
  "personal_context": "Mora em Campo Grande. Tem aula de terça e quinta na escola do Recreio. Toca em banda às vezes no fim de semana.",
  "vocabulary_notes": "'Show' = confirmou. 'Tô vendo' = vai fazer depois (talvez). 'Tô na correria' = não vai fazer hoje. 'Bora' = tá motivado.",
  "maturity_level": "developing",
  "total_interactions": 147,
  "avg_response_time_min": 12.4,
  "completion_rate_30d": 65.2,
  "last_profile_update": "2026-04-20T22:00:00Z",
  "profile_notes": "Melhorou bastante no planejamento semanal desde a semana 3. Fechamento ainda é o calcanhar. Considerar mudar a cobrança de fechamento pra 18h em vez de 19h — ele sai da escola às 18h30."
}
```

---

_O perfil é o que transforma o TOM de chatbot em copiloto. Sem ele, todo mundo recebe a mesma mensagem genérica. Com ele, cada pessoa sente que o TOM a conhece de verdade._
