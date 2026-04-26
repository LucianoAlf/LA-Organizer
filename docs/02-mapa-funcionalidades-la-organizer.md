# Mapa de Funcionalidades — LA Organizer

**Documento:** 02  
**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Referência:** Documento de Conceito v2.0

---

## Estrutura deste documento

Funcionalidades organizadas por **persona** (quem usa) e por **canal** (onde usa). Cada funcionalidade indica se é do TOM, do PWA, ou de ambos.

---

## Persona 1: Colaborador

*Professor, assistente pedagógico, mentor. Não gerencia ninguém. Tem entregas em projetos.*

### Via TOM (WhatsApp)

**Rituais automáticos (agente inicia)**

| Funcionalidade | Frequência | Descrição |
|---|---|---|
| Briefing pessoal | Diário 7h (configurável) | Compromissos pessoais do dia: academia, médico, contas a pagar, hábitos. 100% privado |
| Briefing trabalho | Diário 8h (configurável) | 3 tarefas priorizadas do dia + pendências de ontem + alertas de prazo |
| Fechamento do dia | Diário 19h | TOM pergunta o que foi feito (pessoal + trabalho separados), registra, reagenda pendências |
| Planejamento semanal | Domingo | TOM puxa projetos e tarefas pendentes, colaborador define 5 entregas da semana e distribui nos dias |
| Alerta de prazo | Automático | Notificação quando checkpoint ou tarefa vence em 1-2 dias |
| Alerta de atraso | Automático | Notificação quando tarefa está atrasada, com sugestão de ação (reagendar, delegar, comunicar líder) |
| Lembrete Emusys (professor) | Após cada aula | "Aula com João terminou. Já lançou presença e conteúdo no Emusys?" |
| Checklist operacional | Início/fim do turno | TOM envia checklist da função: abertura de escola, fiscalização de salas, fechamento, etc. |

**Ações sob demanda (colaborador inicia)**

| Funcionalidade | Descrição |
|---|---|
| Ticar tarefa | "Fiz a tarefa X" → TOM marca como concluída |
| Pedir mais prazo | "Preciso de mais prazo pra X" → TOM registra e notifica coordenador |
| Reportar problema | "Tive um problema com X" → TOM registra e alerta coordenador |
| Reagendar tarefa | "Muda X pra quinta" → TOM move a tarefa |
| Ver minhas tarefas | "O que tenho pra hoje/semana?" → TOM lista |
| Ver meu projeto | "Como tá o Projeto da Turminha?" → TOM mostra progresso e próximos checkpoints |
| Registrar demanda nova | "Surgiu uma coisa: preciso fazer X" → TOM cadastra e coloca num dia |
| Criar tarefa pessoal | "Me lembra de pagar a conta de luz sexta" → tarefa pessoal, 100% privada |
| Criar hábito | "Quero criar o hábito de ler 30 min por dia" → TOM configura rotina recorrente com lembrete |
| Ver templates de hábitos | "Que hábitos posso criar?" → TOM mostra templates prontos (academia, leitura, meditação, etc.) |

### Via PWA

| Funcionalidade | Descrição |
|---|---|
| Tela "Hoje" | 3 tarefas do dia com checkbox interativo, progresso, pendências de ontem |
| Tela "Semana" | Visão dos 7 dias com entregas distribuídas, status por dia (feito/pendente/atrasado) |
| Tela "Projetos" | Lista de projetos em que está envolvido, com roadmap visual e checkpoints |
| Checklist interativo | Ticar tarefas direto na tela, ver status em tempo real |
| Histórico | Ver dias anteriores: o que foi feito, o que atrasou, taxa de conclusão pessoal |
| Hábitos pessoais | Hábitos ativos com streak (dias consecutivos), progresso, templates pra criar novos |
| Configurações | Horário do briefing, fechamento e planejamento semanal. Intensidade da cobrança. Notificações on/off |
| Google Calendar | Conectar/desconectar conta Google. Ver status da sincronização |
| Checklist operacional | Checklist diário da função (abertura, fiscalização, fechamento). Ticar itens na tela. Ver aderência pessoal |
| Agenda Emusys (professor) | Ver agenda de aulas do dia puxada do Emusys. Status de presença/conteúdo lançado por aula |

**Onboarding (primeira interação — via WhatsApp)**

| Etapa | O que o TOM pergunta | O que configura |
|---|---|---|
| 1 | "Que horas você costuma começar o dia de trabalho?" | Horário do briefing |
| 2 | "Que horas você costuma sair da escola?" | Horário do fechamento |
| 3 | "Prefere planejar a semana no domingo ou na segunda?" | Dia do planejamento semanal |
| 4 | "Quer que eu te cobre leve, normal ou duro?" | Intensidade da cobrança |
| 5 | "Quer conectar seu Google Calendar pra ver suas tarefas na agenda?" | Integração Google Calendar (link OAuth) |

**Integração Google Calendar**

| Funcionalidade | Descrição |
|---|---|
| Sincronização de tarefas | Tarefa criada com data → evento no Google Calendar automaticamente |
| Sincronização de checkpoints | Checkpoint de projeto → evento no Google Calendar |
| Sincronização de reuniões | Reunião marcada pelo coordenador → evento no calendário de todos os envolvidos |
| Sincronização bidirecional | Mover evento no Google Calendar → tarefa reagendada no sistema |
| Visão unificada | Colaborador vê vida pessoal + trabalho no mesmo calendário do celular |

---

## Persona 2: Coordenador

*Juliana, Quintela. Gerenciam equipe. Criam projetos. Acompanham entregas.*

### Herda tudo do Colaborador +

### Via TOM (WhatsApp)

**Rituais automáticos**

| Funcionalidade | Frequência | Descrição |
|---|---|---|
| Resumo do time | Diário 19h30 (após fechamentos) | Resumo: quem completou, quem não respondeu, tarefas atrasadas do time |
| Alerta de pedido de prazo | Automático | Colaborador pediu mais prazo → coordenador recebe e pode aprovar/negar |
| Alerta de projeto em risco | Automático | Checkpoint vencendo sem tarefas concluídas → alerta ao coordenador |
| Retrospectiva semanal do time | Domingo (após planejamentos) | Resumo semanal: taxa de conclusão por pessoa, projetos em dia ou atrasados |

**Ações sob demanda**

| Funcionalidade | Descrição |
|---|---|
| Criar projeto | Conversa guiada pelo TOM (5W2H invisível): o quê, por quê, onde, quando, quem, como, quanto |
| Criar checkpoint | "Adiciona checkpoint no Projeto X: roteiros prontos até 02/mai, responsável Quintela" |
| Criar tarefa pra alguém | "Cria tarefa pro Joel: imprimir partituras até sexta" |
| Delegar tarefa | "Passa a tarefa X do Joel pro Eric" |
| Ver status do time | "Como tá meu time?" → TOM lista por pessoa: feitas/pendentes/atrasadas |
| Ver status de projeto | "Como tá o Projeto da Turminha?" → TOM mostra roadmap, checkpoints, quem tá devendo |
| Cobrar colaborador | "Manda lembrete pro Joel sobre a tarefa X" → TOM envia mensagem personalizada |
| Aprovar/negar prazo | "Aprova o prazo do Joel" ou "Não, ele precisa entregar até sexta" |
| Broadcast com follow-up | "Avisa todos os assistentes que teremos reunião sexta 9h, preciso de confirmação em 24h" → TOM envia pra cada um, cobra de hora em hora, gera relatório |
| Ver confirmações de broadcast | "Quem confirmou a reunião de sexta?" → TOM lista confirmados e pendentes |
| Atribuir líder de projeto | "O Jordão vai liderar o Sarau de Violinos" → TOM registra role_in_project = 'leader' |
| Ver Emusys do time | "Quem não lançou presença hoje?" → TOM lista professores com presença pendente |
| Ver checklists operacionais | "Como tá a aderência dos checklists?" → TOM mostra por função/pessoa |

### Via PWA

| Funcionalidade | Descrição |
|---|---|
| Dashboard do time | Cards por colaborador: nome, tarefas feitas/pendentes/atrasadas, taxa de conclusão semanal |
| Visão de projetos | Todos os projetos com roadmap, checkpoints, progresso, alertas |
| Criação de projeto (formulário) | Formulário estruturado com os 7 campos do 5W2H (sem chamar de 5W2H) |
| Criação de checkpoint | Adicionar checkpoints com data, responsável, descrição |
| Criação de tarefa | Criar tarefa com título, responsável, prazo, prioridade, projeto vinculado |
| Relatório de aderência | Quem tá usando o sistema, quem responde os rituais, taxa de conclusão |
| Aderência Emusys | Relatório por professor: aulas dadas × presença lançada × conteúdo registrado. Código de cor (verde/amarelo/vermelho) |
| Aderência checklists operacionais | Relatório por função: checklists preenchidos × esperados. Aderência % por pessoa |
| Gestão de checklists | Criar/editar templates de checklists operacionais por função (quais itens, frequência, turno) |
| Broadcast | Criar broadcast, selecionar grupo-alvo, definir timeout, ver status de confirmação em tempo real |
| Filtros | Por pessoa, por projeto, por status, por período |

---

## Persona 3: Diretor

*Alf. Visão estratégica. Não opera no dia a dia, mas precisa de panorama completo.*

### Herda tudo do Coordenador +

### Via Alfredo (WhatsApp)

| Funcionalidade | Descrição |
|---|---|
| Panorama geral | "Alfredo, como tá o LA Organizer?" → taxa de conclusão geral, projetos em dia, alertas |
| Status de pessoa | "Como tá a Juliana essa semana?" → tarefas, projetos, taxa de conclusão, resposta aos rituais |
| Status de projeto | "Como tá o Projeto da Turminha?" → roadmap completo, quem tá entregando, o que tá atrasado |
| Alerta de inatividade | "Quem não tá usando o sistema?" → lista de quem não respondeu rituais nos últimos X dias |
| Comparativo | "Compara Juliana e Quintela essa semana" → lado a lado: tarefas, conclusão, projetos |
| Emusys geral | "Quem não tá lançando presença?" → lista de professores com aderência baixa |
| Checklists geral | "Como tá a aderência operacional?" → aderência por departamento/função |

### Via PWA

| Funcionalidade | Descrição |
|---|---|
| Dashboard executivo | Métricas consolidadas: taxa geral, projetos ativos/atrasados/concluídos, ranking de conclusão |
| Visão de todas as pessoas | Grid com todos os colaboradores, status resumido, alertas |
| Visão de todos os projetos | Roadmap geral com todos os projetos da escola |
| Histórico mensal | Evolução das métricas ao longo do tempo |

---

## Funcionalidades do sistema (não ligadas a persona)

### Motor de priorização (Eisenhower invisível)

| Regra | Classificação | Ação |
|---|---|---|
| Prazo ≤ 2 dias + projeto estratégico | Urgente + Importante | Aparece primeiro no briefing, alerta vermelho |
| Prazo ≤ 2 dias + tarefa operacional | Urgente + Não importante | Sugestão de delegação |
| Prazo > 2 dias + projeto estratégico | Não urgente + Importante | Agenda pra esta semana, lembrete preventivo |
| Prazo > 2 dias + tarefa operacional | Não urgente + Não importante | Pode ser adiada ou eliminada |
| Tarefa atrasada (qualquer) | Urgente por default | Alerta ao colaborador + coordenador |

### Motor de cadastro de projeto (5W2H invisível)

| Etapa da conversa | Campo estruturado | Obrigatório |
|---|---|---|
| "Qual é o projeto?" | nome + descrição | Sim |
| "Por que é importante?" | justificativa | Sim |
| "Onde vai acontecer?" | unidade / local | Não |
| "Quando precisa estar pronto?" | data_inicio + data_fim | Sim |
| "Quem vai trabalhar nisso?" | responsaveis[] | Sim |
| "Como vai ser feito? Quais as etapas?" | checkpoints[] | Sim |
| "Quanto tempo por semana vai demandar?" | horas_estimadas | Não |

### Motor de rituais (pg_cron com horários personalizados)

O cron roda a cada 15 minutos e consulta a tabela de preferências do usuário. Só dispara pra quem está no horário configurado. Escalável sem criar crons adicionais.

| Cron | Ação | Canal |
|---|---|---|
| A cada 15 min | Verifica quem tem planejamento semanal no horário atual → dispara | WhatsApp |
| A cada 15 min | Verifica quem tem briefing no horário atual → dispara | WhatsApp |
| A cada 15 min | Verifica quem tem fechamento no horário atual → dispara | WhatsApp |
| 30 min após último fechamento do dia | Dispara resumo do time pra coordenadores | WhatsApp |
| Domingo (após planejamentos) | Dispara retrospectiva semanal pra coordenadores | WhatsApp |
| Diário 6h | Marca tarefas vencidas como "atrasada" | Sistema |
| Diário 7h | Envia alertas de prazo (vence hoje ou amanhã) | WhatsApp |
| A cada 15 min | Sincroniza tarefas/checkpoints novos ou alterados → Google Calendar | Google Calendar API |
| A cada 30 min | Consulta endpoint Emusys: verifica aulas finalizadas sem presença/conteúdo lançado → dispara lembrete | WhatsApp + Emusys API |
| Início de cada turno | Dispara checklist operacional da função para colaboradores do turno | WhatsApp |
| Diário 20h | Verifica checklists operacionais não preenchidos no dia → alerta ao colaborador | WhatsApp |
| Semanal (sexta 18h) | Calcula aderência de checklists operacionais e Emusys → inclui no resumo do coordenador | Sistema |

### Notificações automáticas

| Evento | Quem recebe | Mensagem |
|---|---|---|
| Tarefa atrasada | Colaborador + coordenador | "Tarefa X está atrasada Y dias" |
| Checkpoint vencendo | Responsável do checkpoint | "Checkpoint X vence em Y dias" |
| Pedido de prazo | Coordenador | "Joel pediu mais prazo pra X. Aprovar?" |
| Colaborador inativo (2+ dias sem responder) | Coordenador | "Joel não respondeu os rituais há 2 dias" |
| Projeto em risco (50%+ checkpoints atrasados) | Coordenador + Diretor | "Projeto X está em risco: 3 de 5 checkpoints atrasados" |
| Emusys presença não lançada | Professor | "Aula com João (14h) terminou. Presença e conteúdo pendentes no Emusys." |
| Emusys aderência baixa | Coordenador | "Prof. Caio não lançou presença em 3 aulas essa semana." |
| Checklist operacional não preenchido | Colaborador da função | "Checklist 'Abertura da Escola' de hoje não foi preenchido." |
| Aderência operacional baixa | Coordenador | "Aderência do checklist 'Fiscalização de Salas' caiu pra 60% essa semana." |

---

## Mapa resumido: o que cada canal faz

| Capacidade | WhatsApp | PWA | Google Calendar |
|---|---|---|---|
| Rituais diários (briefing/fechamento) | Motor principal | Visualização do histórico | — |
| Planejamento semanal | Motor principal | Visualização e edição | — |
| Ticar tarefas | Via resposta ao TOM | Checkbox interativo | — |
| Criar projeto | Via conversa guiada (5W2H) | Via formulário estruturado | — |
| Criar tarefa | Via mensagem livre | Via formulário | — |
| Ver roadmap | Via consulta ao TOM | Visualização gráfica (timeline) | — |
| Ver status do time | Via consulta ao TOM | Dashboard com cards | — |
| Alertas e cobranças | Notificação push | Badge e indicadores visuais | — |
| Relatórios | Via consulta ao TOM | Telas de métricas | — |
| Agenda integrada | — | — | Tarefas, checkpoints e reuniões sincronizados |
| Configurações pessoais | Via onboarding (1ª conversa) | Tela de configurações | Conectar/desconectar via OAuth |
| Onboarding | Conversa guiada de setup | — | — |

---

**Próximo passo:** Documento 03 — Esquema de banco de dados (tabelas, relações, RLS).
