# Documento de Conceito — LA Organizer

**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Autor:** Luciano Alf + Claude  
**Status:** Validado  
**Agente:** TOM

---

## O que é

O LA Organizer é o sistema operacional de vida e trabalho dos colaboradores da LA Music. O **TOM** — agente inteligente com identidade própria, memória evolutiva e skills que se aprimoram com o uso — organiza o dia a dia completo de cada colaborador via WhatsApp: vida pessoal e profissional, rituais diários, gestão de projetos com roadmap e checkpoints, checklists operacionais por departamento, hábitos pessoais, broadcasts de comunicação interna, e integração com Emusys para controle pedagógico. O espelho visual é um PWA mobile-first onde cada pessoa interage com suas tarefas e o gestor tem visão panorâmica (apenas do trabalho — o pessoal é privado).

O TOM segue a arquitetura de agentes inteligentes inspirada em OpenClaw e Hermes: SOUL (identidade imutável), USER profiles (perfil evolutivo por pessoa), MEMORY (memória de curto e longo prazo com busca semântica), e SKILLS (procedimentos reutilizáveis que se aprimoram com o uso). É um motor centralizado — um único TOM que carrega o contexto de cada pessoa do banco antes de responder, gerando uma experiência individualizada sem precisar de uma instância por cabeça.

É uma metodologia de desenvolvimento pessoal e profissional proprietária da LA Music, transformada em software. Replicável para qualquer escola mentorada. O colaborador não vê como "ferramenta que o chefe mandou usar" — vê como app que organiza a vida dele e de quebra conecta com o trabalho.

## Qual problema resolve

Os colaboradores da LA Music — professores, assistentes pedagógicos, coordenadores — são músicos que trabalham muito, mas não têm hábito nem metodologia de planejamento. As consequências são claras: projetos sem prazo, tarefas que passam batido, demandas que subscrevem outras, e coordenação sem visibilidade do que está acontecendo. O sistema de gestão de projetos já existe, mas está vazio por dentro porque ninguém alimenta.

Além disso, rotinas operacionais básicas não são cumpridas de forma consistente: professores esquecem de lançar presença e conteúdo no Emusys, assistentes não fazem a fiscalização diária das salas, relatórios do dia não são enviados. Cada departamento opera no improviso — sem checklist, sem registro, sem visibilidade pro gestor.

O problema não é falta de ferramenta. É falta de ritual. E o ritual precisa estar onde eles já vivem: no WhatsApp.

## Para quem serve

**Colaborador** (professor, assistente pedagógico, mentor)  
Recebe lembretes, organiza seu dia, tica suas tarefas, acompanha suas entregas de projeto. Não precisa aprender nada — só responde mensagens no WhatsApp e tica checklists no app.

**Coordenador** (Juliana, Quintela)  
Vê o panorama do time, sabe quem tá entregando e quem tá devendo, cria e distribui tarefas de roadmap. Usa o WhatsApp para gestão rápida e o PWA para visão estratégica. Recebe alertas quando alguém pede mais prazo ou tá atrasado.

**Diretor** (Alf)  
Acessa via Alfredo ou PWA. Pergunta "como tá a Juliana?" e recebe um diagnóstico real com dados: taxa de conclusão, projetos atrasados, tarefas pendentes. Não precisa cobrar no escuro.

**Todo colaborador** — do Alf à Anne, dos coordenadores aos gerentes. Todos seguem a mesma metodologia. É uma cultura de trabalho, não uma ferramenta opcional.

---

## Arquitetura conceitual: 3 pilares + 3 camadas

### Os 3 pilares

| Pilar | O que é | Função | Visibilidade |
|---|---|---|---|
| **Agenda** | Planejamento semanal + briefing diário + fechamento (pessoal + trabalho separados) | Organiza o tempo completo do colaborador | Pessoal: só o próprio. Trabalho: hierarquia |
| **Roadmap** | Projetos com timeline, checkpoints e responsáveis | Organiza os projetos da escola com visão macro | Hierarquia |
| **Checklist de Tarefas** | Tarefas concretas com status, prazo e prioridade | Organiza a execução do dia a dia | Pessoal: só o próprio. Trabalho: hierarquia |
| **Checklist Operacional** | Rotinas diárias por departamento/função | Padroniza a operação da escola | Hierarquia |
| **Hábitos Pessoais** | Rotinas pessoais com templates prontos (academia, leitura, afirmações, contas a pagar) | Desenvolve a pessoa, não só o profissional | Só o próprio — 100% privado |
| **Broadcast** | Comunicações em massa com follow-up automático, confirmação e relatório | Coordenadores comunicam time com rastreamento | Hierarquia |
| **Integração Emusys** | Agenda de aulas, presença, conteúdo — puxados via endpoint | Monitora se o professor tá cumprindo o básico | Hierarquia |

### As 3 camadas (fluxo de cima pra baixo)

```
PROJETO
  → cadastrado via conversa com TOM (5W2H invisível)
  → gera roadmap com timeline e checkpoints

ROADMAP + CHECKPOINTS
  → cada checkpoint se desdobra em tarefas concretas
  → tarefas têm dono, prazo, prioridade

CHECKLIST + PRIORIZAÇÃO
  → tarefas do dia priorizadas automaticamente (Eisenhower invisível)
  → colaborador tica conforme executa
  → TOM cobra, sugere delegação, alerta atrasos
  → rituais diários fecham o ciclo
```

### Ciclo completo

```
Domingo (planejamento) → Seg-Sex (briefing 8h → execução → fechamento 19h) → Domingo (retrospectiva)
```

Dentro de cada dia:
```
Briefing do dia → tarefas priorizadas → execução com checklist → interceptação de urgências → fechamento → reagendamento
```

---

## Frameworks invisíveis (motor interno)

### 5W2H — Cadastro de projeto

Quando alguém cria um projeto, o TOM conduz uma conversa natural que preenche os 7 campos sem o usuário saber que está respondendo um framework:

| Pergunta do TOM | Campo 5W2H | Exemplo |
|---|---|---|
| "Qual é o projeto?" | What (O quê) | Projeto da Turminha 2026 |
| "Por que é importante fazer isso?" | Why (Por quê) | Levar pro CAEM, posicionar a escola |
| "Onde vai acontecer?" | Where (Onde) | Todas as unidades |
| "Quando precisa estar pronto?" | When (Quando) | 20 de junho |
| "Quem vai trabalhar nisso?" | Who (Quem) | Quintela + Juliana + Yuri |
| "Como vai ser feito?" | How (Como) | Gravar aulas, editar, subir na plataforma |
| "Quanto tempo vai demandar por semana?" | How much (Quanto) | ~10h/semana entre todos |

### Eisenhower — Priorização automática de tarefas

O sistema classifica internamente cada tarefa com base em dois eixos:

| | Urgente | Não urgente |
|---|---|---|
| **Importante** | Faz agora (aparece primeiro no briefing) | Agenda pra esta semana |
| **Não importante** | Delega (TOM sugere delegação) | Elimina ou adia |

Critérios automáticos:
- **Urgente:** prazo em ≤ 2 dias ou status "atrasada"
- **Importante:** vinculada a projeto estratégico ou marcada como prioridade alta
- O colaborador nunca vê os quadrantes. Ele vê suas tarefas já na ordem certa.

### TOM ativo (não passivo)

O TOM não espera ser acionado. Ele analisa o cenário e age:
- "Você tem 6 tarefas pra essa semana e já é quarta. Fez 1. Quer reagendar, delegar ou pedir prazo?"
- "Essa tarefa tá atrasada 3 dias. Quer resolver agora ou comunicar o coordenador?"
- "Essa tarefa é simples e não precisa ser você. Quer delegar?"
- "Checkpoint do Projeto da Turminha vence sexta. Roteiros prontos?"

---

## Hierarquia dupla (fixa + por projeto)

### Hierarquia fixa (organizacional)
Definida por `role` e `supervisor_id` na tabela `collaborators`. Permanente.

```
Director (Alf)
  └── Manager (gerentes)
       └── Coordinator (Juliana, Quintela)
            └── Collaborator (Joel, Jordão, Eric...)
```

### Hierarquia dinâmica (por projeto)
Definida por `role_in_project` na tabela `project_members`. Transitória — vive e morre com o projeto.

Exemplo: Jordão é `collaborator` na hierarquia fixa (subordinado à Juliana), mas é `leader` no Sarau de Violinos. Nesse projeto, ele coordena o Joel. Quando o Sarau acaba, essa liderança morre junto.

O TOM reconhece ambas: se Jordão cobra status do Joel no Sarau, TOM permite — ele é líder daquele projeto. Se Jordão tenta ver tarefas do Joel fora do Sarau, TOM bloqueia — não tem permissão na hierarquia fixa.

Roles possíveis em projeto: `owner` (criou o projeto), `leader` (lidera uma frente), `member` (executa tarefas).

---

## Arquitetura de identidade do TOM

Inspirada em OpenClaw (SOUL + USER + MEMORY) e Hermes (skills evolutivas + user modeling), adaptada pro modelo multi-usuário.

| Componente | Equivalente OpenClaw | Implementação TOM |
|---|---|---|
| SOUL.md | SOUL.md | Arquivo único na VPS — quem o TOM é, como fala, regras. Imutável. |
| USER.md | USER.md (1 por pessoa) | Tabela `collaborator_profiles` no Supabase — perfil evolutivo por pessoa. Montado no prompt a cada interação. |
| MEMORY.md | MEMORY.md + sessions/ | Tabelas `collaborator_memory` + `conversation_history` no Supabase — fatos aprendidos, busca semântica. |
| Skills | Skills directory | Arquivos markdown na VPS + registros no banco — procedimentos reutilizáveis que evoluem com uso. |
| AGENTS.md | AGENTS.md | Arquivo único na VPS — regras operacionais, permissões, protocolos. |

### Evolução contínua
O TOM aprende com o uso: ajusta o perfil de cada pessoa (como responde, quando ignora, que tom funciona melhor), cria skills novas quando resolve problemas recorrentes, e consolida memória periodicamente. Quanto mais o time usa, mais inteligente o TOM fica.

---

## Broadcast (comunicação em massa)

Coordenadores e líderes podem pedir ao TOM para enviar mensagens para grupos de pessoas com follow-up automático.

**Fluxo:**
1. Coordenador pede: "Avisa todos os assistentes que teremos reunião sexta 9h, preciso de confirmação"
2. TOM identifica o grupo-alvo (assistentes pedagógicos)
3. TOM envia mensagem personalizada pra cada um
4. TOM monitora confirmações — cobra de hora em hora enquanto não confirmar
5. Após 24h (configurável), TOM gera relatório: quem confirmou, quem não, e pergunta ao coordenador se quer continuar cobrando

**Rastreamento:** tabela `broadcast_messages` (a mensagem mãe) + `broadcast_responses` (resposta de cada destinatário com timestamp).

---

## Rituais (metodologia de superfície)

Todos os horários são **configuráveis por colaborador**. Os valores abaixo são defaults sugeridos no onboarding.

### Ritual 1 — Planejamento semanal (default: domingo 19h, 15 min)
- TOM puxa projetos ativos, tarefas pendentes, checkpoints da semana
- Colaborador define máximo 5 entregas da semana
- Distribui nos dias (respeitando agenda real: dias de escola, aulas, etc.)
- Sexta fica como buffer de emergência
- **Configurável:** dia da semana (domingo ou segunda) + horário

### Ritual 2 — Briefing do dia (default: 8h, 3 min)
- TOM manda as 3 coisas do dia (já priorizadas por Eisenhower)
- Mostra pendências de ontem
- Alerta prazos próximos
- Regra: a pior tarefa aparece primeiro
- **Configurável:** horário de envio

### Ritual 3 — Fechamento do dia (default: 19h, 5 min)
- TOM pergunta o que foi feito (checklist)
- O que não foi feito ganha novo dia imediatamente
- Demandas novas que surgiram são registradas
- Cobranças e comunicações pendentes são lembradas
- **Configurável:** horário de envio

---

## Fluxo de comunicação hierárquica

```
Colaborador pede mais prazo
  → TOM registra
  → Coordenador recebe notificação automática
  → Coordenador aprova, nega ou ajusta

Coordenador quer ver o time
  → Pergunta ao TOM ou abre PWA
  → Vê: quem tá ticando, quem tá devendo, qual projeto tá atrasado

Diretor quer panorama geral
  → Pergunta ao Alfredo
  → Alfredo consulta banco do LA Organizer
  → Responde com dados reais: taxa de conclusão, projetos, alertas
```

---

## Stack técnico

| Componente | Tecnologia |
|---|---|
| TOM (WhatsApp) | Motor centralizado (Node/Python) na VPS Hostinger, conectado via UAZAPI |
| Inteligência | Claude Sonnet 4.6 via assinatura Max (custo fixo, sem token) |
| Banco de dados | Supabase PostgreSQL com RLS por colaborador/hierarquia |
| Lembretes programados | pg_cron no Supabase (a cada 15 min) → consulta preferências do usuário → Edge Function → UAZAPI |
| PWA | React/TypeScript, hospedado em Vercel ou Supabase |
| Integração Alfredo | Acesso de leitura ao banco para consultas do diretor |
| Google Calendar | API Google Calendar via OAuth. Sincronização bidirecional de tarefas, checkpoints e eventos |
| Integração Emusys | Endpoint API do Emusys para puxar agenda de aulas, status de presença e conteúdo registrado |

---

## Personalização por colaborador

Cada colaborador configura suas preferências no onboarding (via TOM no WhatsApp) e pode ajustar a qualquer momento no PWA (tela de configurações).

### Preferências configuráveis

| Preferência | Opções | Default |
|---|---|---|
| Horário do briefing pessoal | Qualquer hora entre 5h–9h | 7h |
| Horário do briefing trabalho | Qualquer hora entre 6h–10h | 8h |
| Horário do fechamento | Qualquer hora entre 17h–21h | 19h |
| Dia do planejamento semanal | Domingo ou segunda-feira | Domingo |
| Horário do planejamento semanal | Qualquer hora entre 17h–21h | 19h |
| Intensidade da cobrança | Leve, normal ou dura | Normal |
| Notificações de alerta de prazo | Ligado/desligado | Ligado |
| Notificações de atraso | Ligado/desligado | Ligado |
| Google Calendar conectado | Sim/não | Não (configurável no onboarding ou depois) |

### Onboarding (primeira conversa com o TOM)

Na primeira interação, o TOM conduz uma conversa curta de configuração:

1. "Que horas você costuma começar o dia de trabalho?" → define horário do briefing
2. "Que horas você costuma sair da escola?" → define horário do fechamento
3. "Prefere planejar a semana no domingo ou na segunda?" → define dia do planejamento
4. "Quer que eu te cobre leve, normal ou duro?" → define intensidade
5. "Quer conectar seu Google Calendar pra ver suas tarefas na agenda?" → integração opcional

### Integração Google Calendar

- Colaborador conecta via OAuth (login com Google, um clique)
- A partir da conexão, o sistema sincroniza automaticamente:
  - Tarefas com data → evento no calendário
  - Checkpoints de projeto → evento no calendário
  - Reuniões criadas pelo coordenador → evento no calendário
- O colaborador abre o Google Calendar do celular e vê tudo junto (vida pessoal + trabalho)
- Sincronização bidirecional: se ele mover um evento no calendário, a tarefa é reagendada no sistema

### Como funciona o cron com horários personalizados

O pg_cron não roda um job por pessoa. Ele roda a cada 15 minutos e consulta a tabela de preferências:

```
Cron roda às 8:00
  → Consulta: quem tem briefing_time = '08:00'?
  → Resultado: Quintela, Joel, Eric
  → Dispara briefing pra esses 3

Cron roda às 8:15
  → Consulta: quem tem briefing_time = '08:15'?
  → Resultado: ninguém
  → Não dispara nada

Cron roda às 8:30
  → Consulta: quem tem briefing_time entre '08:16' e '08:30'?
  → Resultado: Juliana
  → Dispara briefing pra Juliana
```

Escalável pra 40, 100, 500 pessoas sem criar crons adicionais.

---

## Hierarquia de acesso (RLS)

| Nível | Vê o quê | Faz o quê |
|---|---|---|
| Colaborador | Suas tarefas, seus projetos, seu histórico | Tica checklist, responde rituais, pede prazo |
| Coordenador | Tudo do colaborador + dados de todos os supervisionados | Cria projetos, distribui tarefas, aprova prazos |
| Diretor | Tudo de todos + métricas consolidadas | Visão panorâmica, decisões estratégicas |

---

## O que NÃO é

- Não é um substituto do sistema de Gestão de Projetos existente. É complementar.
- Não é um chatbot genérico. É o TOM — agente com função específica.
- Não é opcional pra quem está em projeto. Se tem entrega, usa.
- Não exige que o colaborador aprenda framework nenhum. Só precisa responder WhatsApp e ticar checklist.
- Não é ferramenta pessoal do Alf. É metodologia de trabalho da LA Music inteira.

---

## Métricas de sucesso

| Métrica | Meta |
|---|---|
| Colaboradores completando fechamento diário | ≥ 80% (4 de 5 dias) |
| Projetos com 100% de tarefas com dono e prazo | 100% |
| Tempo de resposta do colaborador ao TOM | < 30 minutos |
| Resposta sobre status de projeto via Alfredo | < 10 segundos |
| Taxa de conclusão de tarefas semanais | ≥ 70% |
| Checkpoints de roadmap entregues no prazo | ≥ 85% |
| Aderência de checklists operacionais | ≥ 90% |
| Professores com presença lançada no Emusys no mesmo dia | ≥ 95% |

---

## Fases de entrega

| Fase | Escopo | Prazo estimado |
|---|---|---|
| 1 | TOM (WhatsApp) (3 rituais + cadastro de projeto via 5W2H + checklist de tarefas) | 2 semanas |
| 2 | PWA espelho (tela do dia, semana, projetos, checklist interativo) | 2-3 semanas |
| 3 | Dashboard gerencial (visão coordenador + diretor + métricas) | 1-2 semanas |
| 4 | Integração Alfredo (consultas do diretor via WhatsApp) | 1 semana |
| 5 | Checklists operacionais por departamento + Integração Emusys (agenda, presença, conteúdo) | 2-3 semanas |

---

**Próximo passo:** Documento 02 — Mapa de funcionalidades por persona.
