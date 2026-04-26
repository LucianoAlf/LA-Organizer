---
name: rituais-diarios
description: Skill para conduzir os 3 rituais fixos do TOM — briefing pessoal, briefing de trabalho, fechamento do dia e planejamento semanal. Use sempre que um cron disparar um ritual ou quando o colaborador pedir para planejar/fechar o dia manualmente.
---

# Rituais Diários

## Entrada
| Campo | Tipo | Origem | Obrigatório |
|-------|------|--------|-------------|
| collaborator_id | uuid | Identificado pelo phone | Sim |
| ritual_type | enum (personal_briefing, work_briefing, daily_closing, weekly_planning) | Cron ou pedido manual | Sim |
| user_preferences | record | Supabase (user_preferences) | Sim |
| collaborator_profile | record | Supabase (collaborator_profiles) | Sim |
| tasks_today | record[] | Supabase (tasks WHERE scheduled_date = today) | Sim |
| tasks_pending_yesterday | record[] | Supabase (daily_plan_items não concluídos de ontem) | Sim |
| habits_today | record[] | Supabase (habits ativos pra hoje) | Para personal_briefing |
| projects_active | record[] | Supabase (projects via project_members) | Para work_briefing e weekly_planning |
| weekly_plan | record | Supabase (weekly_plans da semana atual) | Para weekly_planning |

## Saída
| Campo | Tipo | Destino |
|-------|------|---------|
| mensagem enviada | WhatsApp | Colaborador via UAZAPI |
| daily_plan | record | Supabase (daily_plans) |
| daily_plan_items | record[] | Supabase (daily_plan_items) |
| weekly_plan | record | Supabase (weekly_plans) — se planejamento semanal |
| ritual_log | record | Supabase (ritual_logs) |

## Fases de Execução

### Ritual: Briefing Pessoal (default 7h)

#### Fase 1 — Montar conteúdo pessoal
Puxar do banco:
- Hábitos ativos do dia (habits WHERE is_active AND frequency inclui hoje)
- Tarefas pessoais (tasks WHERE context='personal' AND scheduled_date = today)
- Streaks atuais dos hábitos

#### Fase 2 — Formatar mensagem
```
Bom dia, [nome]. Pessoal de hoje:

- 💪 Academia (6h30) — streak: 12 dias
- 💰 Pagar conta de luz
- 📚 Leitura 30 min antes de dormir

Bora manter o streak?
```

Regras de formatação:
- Hábitos primeiro (com emoji e streak)
- Tarefas pessoais depois
- Máximo: max_daily_tasks do user_preferences (padrão 3, configurável)
- Nunca incluir tarefas de trabalho aqui

#### Fase 3 — Enviar e registrar
- Enviar via UAZAPI
- Criar daily_plan com context='personal'
- Criar daily_plan_items pra cada item
- Registrar ritual_log (type='personal_briefing', status='sent')

---

### Ritual: Briefing de Trabalho (default 8h)

#### Fase 1 — Montar conteúdo de trabalho
Puxar do banco:
- Tarefas de trabalho do dia (tasks WHERE context='work' AND scheduled_date = today), ordenadas por eisenhower_quadrant ASC
- Pendências de ontem (daily_plan_items de ontem não concluídos)
- Checkpoints vencendo essa semana (project_checkpoints WHERE due_date BETWEEN today AND today+7)
- Limitar a max_daily_tasks (padrão 3)

#### Fase 2 — Auto-verificação antes de enviar
Checklist interno (NÃO mostra pro colaborador):
- [ ] Priorização faz sentido? (Q1 antes de Q2, Q2 antes de Q3)
- [ ] Carga é realista? (não mais que max_daily_tasks)
- [ ] Tem conflito de horário? (duas tarefas no mesmo horário)
- [ ] Pendência de ontem foi incluída?
- [ ] Tom tá adequado ao coaching_intensity da pessoa?

#### Fase 3 — Formatar mensagem por intensidade

**Light:**
```
Bom dia, [nome]! Hoje você tem [N] coisas planejadas:

1. [tarefa mais importante]
2. [tarefa 2]
3. [tarefa 3]

Qualquer coisa, me chama.
```

**Normal:**
```
Bom dia, [nome]. Suas [N] coisas de hoje:

1. 🔴 [tarefa Q1] (atrasada X dias)
2. [tarefa Q2] (14h)
3. [tarefa Q3]

A pior é a primeira. Bora?
```

**Hard:**
```
[nome], 8h. Suas [N] coisas de hoje:

1. 🔴 [tarefa Q1] — atrasada X dias, tá ficando feio
2. [tarefa Q2] — 14h, não pode atrasar
3. [tarefa Q3] — vence amanhã

Ontem você fez [X] de [Y]. Hoje precisa melhorar. A primeira agora.
```

#### Fase 4 — Incluir pendências de ontem (se houver)
Se tem item não concluído de ontem, perguntar ANTES de listar o dia:
```
Ontem ficou pendente: [tarefa]. Quer manter pra hoje ou mover pra outro dia?
```
Aguardar resposta antes de enviar o briefing completo.

#### Fase 5 — Enviar e registrar
- Enviar via UAZAPI
- Criar daily_plan com context='work'
- Criar daily_plan_items ordenados por eisenhower_quadrant
- Registrar ritual_log

---

### Ritual: Fechamento do Dia (default 19h)

#### Fase 1 — Puxar itens do dia
- daily_plan_items de hoje (pessoal + trabalho)
- Separar por contexto

#### Fase 2 — Perguntar o que foi feito
```
Fechamento do dia, [nome]. Das suas [N] coisas:

1. [tarefa 1] — fez?
2. [tarefa 2] — fez?
3. [tarefa 3] — fez?

Me diz quais fez. Pode ser número: "1 e 2" ou "fiz tudo" ou "só a 1".
```

#### Fase 3 — Processar resposta
- Marcar itens como is_completed = true, completed_at = now()
- Pra cada item NÃO concluído, perguntar: "Vai pra quando?"
- Criar tarefa reagendada com nova scheduled_date

#### Fase 4 — Capturar demandas novas
```
Surgiu alguma coisa nova hoje?
```
Se sim: criar tarefa com source='agent_closing', pedir dia e prioridade.

#### Fase 5 — Celebrar ou motivar
- Se fez tudo: "Mandou bem. [N] de [N]. Descansa."
- Se fez parcial: "[X] de [N], tá no caminho. Amanhã fecha."
- Se não fez nada (hard): "[nome], 0 de [N]. O que travou hoje?"

#### Fase 6 — Registrar
- Atualizar daily_plan (items_completed, completion_rate, closed_at)
- Registrar ritual_log (type='daily_closing', status='responded')

---

### Ritual: Planejamento Semanal (default domingo 19h)

#### Fase 1 — Retrospectiva da semana anterior
```
Fala, [nome]. Hora de planejar a semana.
Da semana passada ficou pendente:
- [tarefa 1] (atrasada X dias)
- [tarefa 2]

Quer trazer pra essa semana ou deixar morrer?
```

#### Fase 2 — Mostrar projetos ativos
```
Seus projetos ativos:
- [Projeto 1] — próximo checkpoint: [nome] ([data])
- [Projeto 2] — [status]

Quais são suas entregas dessa semana? Máximo [max_daily_tasks × 5].
```

#### Fase 3 — Distribuir nos dias
Perguntar dia por dia: "Segunda você consegue fazer o quê?"
Aceitar distribuição em bloco ou dia a dia.
Sexta fica como buffer (sugerir, não obrigar).

#### Fase 4 — Confirmar e salvar
```
Sua semana:
- Seg: [tarefa 1] + [tarefa 2]
- Ter: [tarefa 3]
- Qua: [tarefa 4]
- Qui: [tarefa 5]
- Sex: Buffer

Tá bom assim?
```

Se confirmado: criar weekly_plan + tasks com scheduled_date.

## Veto Conditions — NUNCA
- NUNCA misturar pessoal e trabalho na mesma mensagem
- NUNCA enviar mais tarefas que max_daily_tasks no briefing
- NUNCA reenviar ritual se ignorado em 30 min (registrar como 'ignored')
- NUNCA reenviar planejamento semanal mais de 1 vez
- NUNCA pular a auto-verificação antes de enviar briefing de trabalho
- NUNCA começar briefing com cobrança — reconhecer antes
- NUNCA julgar se o colaborador fez pouco — oferecer reagendamento

## Checklist de Conclusão
- [ ] Conteúdo montado com dados reais do banco (não inventados)
- [ ] Auto-verificação passou (priorização, carga, conflitos)
- [ ] Tom adequado à intensidade e perfil da pessoa
- [ ] Mensagem enviada via UAZAPI
- [ ] daily_plan/weekly_plan criado no Supabase
- [ ] daily_plan_items criados com sort_order correto
- [ ] ritual_log registrado com status e timestamp

## Integrações
- **Supabase** — tasks, daily_plans, daily_plan_items, weekly_plans, habits, ritual_logs, user_preferences, collaborator_profiles
- **UAZAPI** — envio de mensagem WhatsApp
