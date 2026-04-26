# TOM-SKILLS-CATALOG — Índice de Skills

**Documento:** TOM-SKILLS-CATALOG  
**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Função:** Índice central das skills do TOM + mecanismo de criação e evolução autônoma  
**Skills detalhadas:** Cada skill tem seu arquivo separado em `skills/[nome].md`

---

## O que são skills

Skills são procedimentos documentados que o TOM sabe executar. Cada skill é um arquivo markdown com: entrada, saída, fases de execução, veto conditions, checklist de conclusão e integrações.

O formato segue o padrão dos agentes LA Music (mesmo formato usado pelo Mike no LA HQ).

Skills ficam como arquivos na VPS em `/home/tom/skills/` e são carregadas no prompt quando o TOM identifica que a interação requer aquela skill.

---

## Skills iniciais (10)

### Skill 1: Rituais Diários
**Path:** `skills/rituais-diarios.md`

| Campo | Valor |
|---|---|
| **Trigger** | Cron programado (briefing, fechamento, planejamento) |
| **Entrada** | collaborator_id, tipo_ritual, user_preferences, tarefas do dia/semana |
| **Saída** | Mensagem WhatsApp + daily_plan/weekly_plan criado + ritual_log registrado |

**Fases:**
1. Identificar tipo de ritual (briefing_pessoal, briefing_trabalho, fechamento, planejamento_semanal)
2. Puxar dados do colaborador (tarefas, pendências, projetos, hábitos)
3. Montar mensagem adaptada à intensidade e perfil do colaborador
4. Enviar via UAZAPI
5. Aguardar resposta (timeout: 30 min pra briefing/fechamento, 2h pra planejamento)
6. Processar resposta → atualizar banco
7. Registrar ritual_log

**Veto:** nunca reenviar mais de 1 vez. Nunca misturar pessoal e trabalho na mesma mensagem.

---

### Skill 2: Cadastro de Projeto (5W2H)
**Path:** `skills/cadastro-projeto-5w2h.md`

| Campo | Valor |
|---|---|
| **Trigger** | Coordenador+ diz "criar projeto", "novo projeto" |
| **Entrada** | Conversa livre do coordenador |
| **Saída** | project + project_members + project_checkpoints no Supabase |

**Fases:**
1. Perguntar: "Qual é o projeto?" → name + description (What)
2. Perguntar: "Por que é importante?" → justification (Why)
3. Perguntar: "Quando precisa estar pronto?" → start_date + end_date (When)
4. Perguntar: "Quem vai trabalhar nisso?" → project_members (Who)
5. Perguntar: "Quais são as etapas?" → project_checkpoints com sort_order (How)
6. Pra cada checkpoint: perguntar prazo e responsável
7. Perguntar: "Quanto tempo por semana?" → estimated_hours_week (How much)
8. Opcionalmente: "Onde vai acontecer?" → location (Where)
9. Confirmar tudo com o coordenador antes de salvar
10. Salvar no banco, confirmar criação

**Veto:** nunca permitir que colaborador (sem role de coordenador+) crie projeto. Nunca salvar sem confirmação. Nunca aceitar projeto sem pelo menos nome, prazo e uma etapa.

---

### Skill 3: Priorização Eisenhower
**Path:** `skills/priorizacao-eisenhower.md`

| Campo | Valor |
|---|---|
| **Trigger** | Automático (trigger no banco ao criar/atualizar task) |
| **Entrada** | task com due_date, priority, project_id, status |
| **Saída** | eisenhower_quadrant calculado (1-4) |

**Lógica:**
```
Quadrante 1 (FAZER AGORA): prazo ≤ 2 dias + (vinculada a projeto OU prioridade high/critical)
Quadrante 2 (AGENDAR): prazo > 2 dias + (vinculada a projeto OU prioridade high/critical)
Quadrante 3 (DELEGAR): prazo ≤ 2 dias + (sem projeto E prioridade medium/low)
Quadrante 4 (ELIMINAR/ADIAR): prazo > 2 dias + (sem projeto E prioridade medium/low)
Tarefa atrasada: sempre Quadrante 1
```

**Uso no briefing:** tarefas ordenadas por quadrante. Q1 primeiro, Q4 por último. Se tem Q3, TOM sugere delegação.

**Veto:** nunca mostrar os nomes dos quadrantes pro colaborador. Ele vê a ordem, não a classificação.

---

### Skill 4: Broadcast
**Path:** `skills/broadcast.md`

| Campo | Valor |
|---|---|
| **Trigger** | Coordenador+ pede pra enviar mensagem pra grupo |
| **Entrada** | target_group, message_content, requires_confirmation, follow_up_interval_min, timeout_hours |
| **Saída** | broadcast_messages + broadcast_responses + mensagens enviadas + relatório |

**Fases:**
1. Identificar grupo-alvo (por role, unit, ou lista explícita)
2. Resolver target_ids (quais collaborators.id se encaixam)
3. Confirmar com o remetente: conteúdo, grupo-alvo, regras de follow-up
4. Criar broadcast_messages e broadcast_responses no banco
5. Enviar mensagem pra cada destinatário via UAZAPI
6. Se requires_confirmation: cobrar a cada follow_up_interval_min
7. Registrar respostas conforme chegam
8. Após timeout_hours: gerar relatório (confirmados × pendentes × sem resposta)
9. Perguntar ao remetente se quer continuar cobrando

**Veto:** nunca enviar broadcast sem confirmação do remetente. Nunca cobrar mais de 1x por intervalo configurado. Nunca incluir dados pessoais de um destinatário na mensagem coletiva.

---

### Skill 5: Checklists Operacionais
**Path:** `skills/checklists-operacionais.md`

| Campo | Valor |
|---|---|
| **Trigger** | Cron no início do turno configurado |
| **Entrada** | collaborator_id, function_role, shift, checklist template |
| **Saída** | Checklist enviado via WhatsApp + op_checklist_completion criada |

**Fases:**
1. Identificar qual checklist enviar (por function_role + shift + unit)
2. Enviar itens pro colaborador via WhatsApp
3. Aceitar respostas parciais ("fiz 1, 2, 3") ou completas ("fiz tudo")
4. Registrar observações se houver ("ar da sala 3 quebrado")
5. Se observação gera ação: sugerir criação de tarefa
6. Se não preenchido até 20h: enviar alerta
7. Calcular aderência

**Veto:** nunca pular envio de checklist. Nunca aceitar preenchimento sem pelo menos 1 item marcado. Nunca ignorar observação com problema reportado.

---

### Skill 6: Integração Emusys
**Path:** `skills/integracao-emusys.md`

| Campo | Valor |
|---|---|
| **Trigger** | Cron a cada 30 min (sync) + 10 min após fim de aula (lembrete) |
| **Entrada** | Endpoint Emusys (agenda de aulas do dia) |
| **Saída** | emusys_classes atualizada + lembretes enviados |

**Fases:**
1. Polling: puxar agenda do dia do Emusys pra cada professor
2. Atualizar tabela emusys_classes com attendance_registered e content_registered
3. Após class_end_time + 10 min: verificar se presença/conteúdo foram lançados
4. Se não: enviar lembrete via WhatsApp
5. Se não responder em 30 min: lembrar mais uma vez
6. No fechamento do dia: incluir aulas pendentes na mensagem de fechamento
7. No resumo do coordenador: listar professores com aderência baixa

**Veto:** nunca inventar dados de presença. Nunca cobrar presença de aula que ainda não aconteceu. Nunca expor nome de aluno em contexto fora do professor da aula.

---

### Skill 7: Hábitos Pessoais
**Path:** `skills/habitos-pessoais.md`

| Campo | Valor |
|---|---|
| **Trigger** | Briefing pessoal + pedido do colaborador + lembrete no horário configurado |
| **Entrada** | habit_templates, habits, habit_logs |
| **Saída** | Hábito criado/atualizado + streak calculado + lembrete enviado |

**Fases:**
1. Se criação: oferecer templates ou aceitar hábito customizado
2. Configurar: nome, frequência, horário do lembrete, ícone
3. Enviar lembrete no horário configurado (se notify_whatsapp = true)
4. Registrar conclusão quando colaborador confirma
5. Calcular streak (dias consecutivos). Se quebrou, reseta pra 0
6. No briefing pessoal: incluir hábitos do dia com streak atual
7. Celebrar milestones: 7 dias, 30 dias, 100 dias

**Veto:** 100% privado. Nunca incluir hábitos em relatórios do time. Nunca julgar hábito que o cara criou.

---

### Skill 8: Gestão de Memória
**Path:** `skills/gestao-memoria.md`

| Campo | Valor |
|---|---|
| **Trigger** | Cron semanal (domingo 22h) + interação explícita + observação contínua |
| **Entrada** | conversation_history, ritual_logs, daily_plans |
| **Saída** | collaborator_memory e collaborator_profiles atualizados |

Detalhamento completo no documento TOM-MEMORY-ARCHITECTURE.md.

---

### Skill 9: Onboarding
**Path:** `skills/onboarding.md`

| Campo | Valor |
|---|---|
| **Trigger** | Primeiro contato (onboarding_completed = false) |
| **Entrada** | Número de WhatsApp novo |
| **Saída** | user_preferences configuradas + collaborator_profiles criado + onboarding_completed = true |

**Fases:**
1. Greeting + explicar o que o TOM faz (3 frases)
2. Perguntar horário de início do dia → personal_briefing_time
3. Perguntar horário do briefing de trabalho → briefing_time
4. Perguntar horário de saída → closing_time
5. Perguntar dia do planejamento semanal → planning_day + planning_time
6. Perguntar intensidade → coaching_intensity
7. Oferecer Google Calendar (link OAuth)
8. Confirmar tudo e ativar

**Veto:** nunca pular etapas. Nunca presumir preferências. Se a pessoa fala "tanto faz", usar defaults e informar.

---

### Skill 10: Tratamento de Áudio
**Path:** `skills/tratamento-audio.md`

| Campo | Valor |
|---|---|
| **Trigger** | Colaborador envia mensagem de voz |
| **Entrada** | Arquivo de áudio via UAZAPI |
| **Saída** | Transcrição + ação identificada + confirmação |

**Fases:**
1. Receber áudio da UAZAPI
2. Transcrever (Whisper ou serviço de STT)
3. Extrair intenção e dados da transcrição
4. Confirmar com o colaborador: "Entendi do áudio: [resumo]. Tá certo?"
5. Se confirmado: executar ação
6. Registrar transcrição em conversation_history

**Veto:** nunca presumir que entendeu 100%. Sempre confirmar antes de agir com base em áudio.

---

## Mecanismo de criação autônoma de skills

### Inspiração: Hermes Agent

O Hermes tem um mecanismo onde, quando resolve um problema complexo ou uma sequência de passos que pode se repetir, ele automaticamente escreve uma skill pro futuro. O TOM faz o mesmo:

### Quando criar uma skill nova

```
Condição 1: O TOM resolveu o mesmo tipo de problema 3+ vezes pra pessoas diferentes
  → Criar skill global (serve pra todo mundo)

Condição 2: O TOM resolveu o mesmo tipo de problema 3+ vezes pra a mesma pessoa
  → Criar memória tipo 'lesson' pra aquela pessoa (não precisa virar skill global)

Condição 3: O coordenador ou o Alf pede: "TOM, salva isso como skill"
  → Criar skill explicitamente
```

### Como criar

1. TOM identifica o padrão repetido
2. Escreve o arquivo markdown no formato padrão (entrada, saída, fases, veto, checklist)
3. Salva em `/home/tom/skills/` com nome descritivo
4. Registra na tabela `tom_skills` (catálogo no banco)
5. Na próxima vez que o mesmo padrão aparecer, carrega a skill em vez de improvisar

### Tabela: `tom_skills` (catálogo)

| Campo | Tipo | Descrição |
|---|---|---|
| id | uuid | PK |
| name | text | Nome da skill |
| description | text | O que a skill faz |
| file_path | text | Caminho do arquivo na VPS |
| trigger_patterns | text[] | Frases/padrões que ativam a skill |
| times_used | int | Quantas vezes foi usada |
| last_used_at | timestamptz | Última vez que foi ativada |
| created_by | text | 'system' (autônoma) ou 'human' (pedido explícito) |
| effectiveness_score | numeric | Score baseado em feedback implícito (tarefa concluída? colaborador confirmou?) |
| created_at | timestamptz | |

### Evolução de skills existentes

As 10 skills iniciais também evoluem. O cron semanal verifica:
- A skill `rituais-diarios` tá sendo ignorada em 40% das vezes nas sextas à noite? → TOM cria nota: "Considerar enviar fechamento às 17h nas sextas"
- A skill `broadcast` sempre recebe pedido de "cobra de 2 em 2 horas" em vez do default de 1h? → TOM ajusta o default sugerido
- A skill `onboarding` tá levando mais de 5 minutos? → TOM identifica onde trava e simplifica

Essas observações ficam em `tom_skills.effectiveness_score` e nas notas de cada skill.

---

## Mapa de ativação de skills

Quando o TOM recebe uma mensagem, ele identifica a intenção (NLU) e carrega a skill correspondente:

| Intenção NLU | Skill carregada |
|---|---|
| task_complete, task_reschedule, task_delegate, task_create | Rituais diários (subset: gestão de tarefas) |
| deadline_extension | Rituais diários (subset: extensão de prazo) |
| status_check, project_status | Nenhuma skill especial — consulta direta ao banco |
| project_create | Cadastro de projeto (5W2H) |
| team_status | Nenhuma skill especial — consulta + RLS |
| broadcast_send, broadcast_status | Broadcast |
| emusys_check, emusys_status | Integração Emusys |
| checklist_complete, checklist_partial, checklist_issue | Checklists operacionais |
| habit_create, habit_complete, habit_templates | Hábitos pessoais |
| personal_task | Rituais diários (subset: tarefa pessoal) |
| do_not_disturb | Nenhuma skill — protocolo de AGENTS.md |
| planning_request | Rituais diários (subset: planejamento semanal) |
| help | Nenhuma skill — resposta direta |
| settings | Onboarding (subset: reconfiguração) |

Se nenhuma intenção é identificada com confiança, o TOM trata como conversa livre e responde com base no contexto.

---

## Skills futuras (roadmap do TOM)

| Skill | Quando criar | Trigger |
|---|---|---|
| Geração de relatórios PDF | Quando coordenador pedir relatório formal | "Gera um relatório do mês" |
| Integração Google Calendar (sync) | Fase 5 do projeto | Automático |
| Análise de tendências | Após 3 meses de dados | "Mostra a evolução do time" |
| Sugestão proativa de delegação | Quando Eisenhower Q3 é recorrente | Automático |
| Onboarding de projeto | Quando membro é adicionado a projeto | Automático |

---

_Skills são o que o TOM SABE FAZER. Memória é o que ele SABE SOBRE VOCÊ. SOUL é QUEM ELE É. Juntos, transformam um chatbot em parceiro._
