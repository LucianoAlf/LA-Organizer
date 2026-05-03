# PRD — LA Organizer

**Documento:** 06 — PRD Completo  
**Versão:** 2.0  
**Data:** 25 de abril de 2026  
**Autor:** Luciano Alf (produto) + Claude (arquitetura)  
**Desenvolvimento:** A definir  
**Stakeholder:** Luciano Alf (CEO LA Music)  
**Agente:** TOM  
**Consolida:** Documentos 01 (Conceito v2.0), 02 (Funcionalidades v2.0), 03 (Banco v2.0), 04 (Fluxos v2.0), 05 (Telas v2.0)

---

## 1. Visão do produto

### 1.1 O que é

O LA Organizer é o sistema operacional de vida e trabalho da LA Music. O **TOM** — agente WhatsApp que organiza o dia a dia completo dos colaboradores — vida pessoal e profissional — através de rituais diários, gestão de projetos com roadmap e checkpoints, checklists operacionais por departamento, hábitos pessoais, e integração com Emusys para controle pedagógico. O espelho visual é um PWA mobile-first onde cada pessoa interage com suas tarefas e o gestor tem visão panorâmica (apenas do trabalho — o pessoal é privado).

É uma metodologia de desenvolvimento pessoal e profissional proprietária da LA Music, transformada em software. O colaborador não vê como "ferramenta que o chefe mandou usar" — vê como app que organiza a vida dele e de quebra conecta com o trabalho. Replicável para qualquer escola mentorada.

### 1.2 Problema

Os colaboradores da LA Music são músicos que trabalham muito, mas não têm hábito de planejamento. Projetos ficam sem prazo, tarefas passam batido, demandas novas subscrevem as anteriores. Professores esquecem de lançar presença e conteúdo no Emusys. Rotinas operacionais (abertura, fechamento, fiscalização) não são registradas. A coordenação não tem visibilidade do que está acontecendo. O diretor cobra no escuro.

O sistema de gestão de projetos existe, mas está vazio por dentro porque ninguém alimenta. O problema não é falta de ferramenta — é falta de ritual.

### 1.3 Solução

O ritual vai até onde o colaborador já vive: o WhatsApp. O TOM conduz 3 rituais fixos (planejamento semanal, briefing diário, fechamento diário), cadastra projetos via conversa guiada, distribui e cobra tarefas, envia checklists operacionais, e lembra o professor de lançar presença no Emusys. Tudo alimenta um banco de dados centralizado que o PWA exibe de forma visual.

Por baixo do capô, dois frameworks validados guiam a arquitetura sem jamais aparecer pro usuário: 5W2H estrutura o cadastro de projetos, e Eisenhower prioriza as tarefas automaticamente.

### 1.4 Contexto operacional

| Dado | Valor |
|---|---|
| Alunos ativos | 1.200+ |
| Unidades | 3 (Campo Grande, Recreio, Barra) |
| Professores | ~40 |
| Staff total (com coordenação e gestão) | ~70 |
| Usuários iniciais do sistema | ~40 (time pedagógico + gestão) |
| Sistema pedagógico | Emusys |
| WhatsApp corporativo | UAZAPI |

---

## 2. Personas

### 2.1 Colaborador

Professor, assistente pedagógico, mentor. Não gerencia ninguém. Tem entregas em projetos e rotinas operacionais.

**Necessidade:** organizar seu dia, lembrar suas tarefas, não esquecer de lançar presença, cumprir checklists operacionais.

**Comportamento:** vive no WhatsApp, não fica na frente do computador, resolve tudo entre aulas e deslocamento. TDAH frequente. Responde bem a cobranças diretas e curtas.

### 2.2 Coordenador

Juliana Baltazar, Marcos Quintela. Gerenciam equipes de professores e assistentes. Criam projetos, distribuem tarefas, acompanham execução.

**Necessidade:** saber quem tá entregando e quem tá devendo, criar roadmaps com prazos reais, ser alertado quando algo atrasa, ter dados pra cobrar com fundamento.

**Comportamento:** está na escola parte do dia, outra parte em deslocamento. Faz gestão pelo celular. Primeiro ano como gestores — precisam de estrutura, não de liberdade.

### 2.3 Diretor

Luciano Alf. CEO e fundador. Não opera no dia a dia, mas precisa de panorama completo pra tomar decisões e dar feedback estratégico.

**Necessidade:** perguntar "como tá a Juliana?" ou "como tá o Projeto da Turminha?" e ter resposta em 10 segundos com dados reais.

**Comportamento:** usa o Alfredo (agente pessoal via OpenClaw) como interface principal. Acessa PWA quando precisa de visão detalhada.

---

## 3. Arquitetura conceitual

### 3.1 Sete pilares

| Pilar | Função | Motor | Privacidade |
|---|---|---|---|
| Agenda | Planejamento semanal + briefings separados (pessoal + trabalho) + fechamento | Rituais via WhatsApp | Pessoal: privado. Trabalho: hierarquia |
| Roadmap | Projetos com timeline, checkpoints, responsáveis | 5W2H invisível | Hierarquia + dinâmica por projeto |
| Checklist de tarefas | Execução do dia a dia com priorização | Eisenhower invisível | Pessoal: privado. Trabalho: hierarquia |
| Checklist operacional | Rotinas padronizadas por departamento/função | Templates configuráveis | Hierarquia |
| Hábitos pessoais | Rotinas pessoais com templates, streaks e lembretes | Templates + tracking | 100% privado |
| Broadcast | Comunicações em massa com follow-up, confirmação e relatório | TOM envia, cobra e reporta | Hierarquia |
| Integração Emusys | Presença, conteúdo, agenda de aulas | Polling via endpoint | Hierarquia |

### 3.2 Três camadas (fluxo top-down)

```
PROJETO
  → cadastrado via conversa com TOM (5W2H)
  → gera roadmap com timeline e checkpoints

ROADMAP + CHECKPOINTS
  → cada checkpoint se desdobra em tarefas
  → tarefas têm dono, prazo, prioridade

CHECKLIST + PRIORIZAÇÃO
  → tarefas priorizadas automaticamente (Eisenhower)
  → colaborador tica conforme executa
  → TOM cobra, sugere delegação, alerta atrasos
  → rituais diários fecham o ciclo
```

### 3.3 Ciclo operacional

```
Domingo (planejamento) → Seg-Sex (briefing 8h → execução → fechamento 19h) → Domingo (retrospectiva)
```

### 3.4 Frameworks invisíveis

**5W2H — Cadastro de projeto.** TOM conduz conversa natural que preenche 7 campos estruturados: nome (What), justificativa (Why), local (Where), prazo (When), equipe (Who), metodologia (How), horas estimadas (How much). Usuário não sabe que é 5W2H.

**Eisenhower — Priorização automática.** Sistema classifica cada tarefa em 4 quadrantes com base em prazo (≤2 dias = urgente) e importância (vinculada a projeto = importante). Briefing das 8h já vem na ordem certa. Colaborador não classifica nada.

### 3.5 Hierarquia dupla

**Fixa (organizacional):** `role` + `supervisor_id` na tabela `collaborators`. Permanente.

```
Diretor (Alf) → vê tudo de trabalho
  └── Gerente → vê supervisionados
       └── Coordenador (Juliana, Quintela) → vê supervisionados
            └── Colaborador → vê só o próprio
```

**Dinâmica (por projeto):** `role_in_project` na tabela `project_members`. Transitória — vive e morre com o projeto. Ex: Jordão é collaborator na hierarquia fixa, mas leader no Sarau de Violinos. O TOM reconhece ambas.

Implementada via `supervisor_id` recursivo + `role_in_project` com RLS no Supabase.

### 3.6 Arquitetura de identidade do TOM

Inspirada em OpenClaw e Hermes, adaptada pro modelo multi-usuário.

| Componente | Implementação |
|---|---|
| SOUL.md | Arquivo único na VPS — identidade imutável do TOM |
| AGENTS.md | Arquivo único na VPS — regras operacionais, permissões, protocolos |
| USER profiles | Tabela `collaborator_profiles` — perfil evolutivo por pessoa, montado no prompt a cada interação |
| MEMORY | Tabela `collaborator_memory` — fatos aprendidos, busca semântica. Tabela `conversation_history` — curto prazo |
| SKILLS | Arquivos markdown na VPS + catálogo no banco — procedimentos que evoluem com uso |

O TOM aprende com o uso: ajusta perfis, cria skills, consolida memória. Quanto mais o time usa, mais inteligente fica.

---

## 4. Stack técnico

| Componente | Tecnologia | Justificativa |
|---|---|---|
| TOM (WhatsApp) | Motor centralizado (Node ou Python) na VPS Hostinger | Um motor, contexto por pessoa. Escalável sem 1 instância por cabeça |
| Conexão WhatsApp | UAZAPI | Já em uso na LA Music |
| Inteligência | Claude Sonnet 4.6 via assinatura Max | Custo fixo, sem token. Qualidade superior pra conversa natural |
| Banco de dados | Supabase PostgreSQL | RLS nativo, pg_cron, pg_net, Edge Functions. Stack já dominado |
| Lembretes | pg_cron a cada 15 min → consulta preferências → Edge Function → UAZAPI | Horários configuráveis por pessoa sem cron por cabeça |
| PWA | React/TypeScript | Mobile-first, installable, dark mode |
| Hospedagem PWA | Vercel ou Supabase Hosting | Deploy simples, CDN global |
| Google Calendar | API via OAuth | Sincronização bidirecional de tarefas e checkpoints |
| Emusys | Endpoint API (polling) | Agenda de aulas, presença, conteúdo |
| Integração Alfredo | Acesso de leitura ao banco via RPC | Consultas do diretor sem reconstruir o Alfredo |

---

## 5. Modelo de dados

**27 tabelas em 9 domínios.** Detalhamento completo no Documento 03.

### 5.1 Resumo das tabelas

| Domínio | Tabelas |
|---|---|
| Pessoas | `collaborators`, `user_preferences`, `collaborator_profiles` |
| Projetos | `projects`, `project_members` (com role_in_project: owner/leader/member), `project_checkpoints` |
| Tarefas | `tasks` (com campo context: work/personal), `task_comments` |
| Rituais | `daily_plans`, `daily_plan_items`, `weekly_plans`, `ritual_logs` |
| Checklists operacionais | `op_checklists`, `op_checklist_items`, `op_checklist_completions`, `op_checklist_item_completions` |
| Hábitos pessoais | `habit_templates`, `habits`, `habit_logs` |
| Broadcast | `broadcast_messages`, `broadcast_responses` |
| Emusys | `emusys_classes` |
| Sistema | `conversation_history`, `collaborator_memory`, `notifications`, `google_calendar_sync` |

### 5.2 Tabelas críticas (resumo de campos-chave)

**collaborators:** full_name, phone (unique, identifica no WhatsApp), role (director/manager/coordinator/collaborator), function_title, unit, supervisor_id (FK recursiva), onboarding_completed.

**user_preferences:** briefing_time, closing_time, planning_day, planning_time, coaching_intensity (light/normal/hard), google_calendar_connected, google_calendar_token (jsonb).

**projects:** name, description, justification (Why), location (Where), start_date, end_date (When), methodology (How), estimated_hours_week (How much), category, status, progress_percent (calculado automaticamente), color.

**tasks:** title, assigned_to, project_id, checkpoint_id, priority, eisenhower_quadrant (calculado por trigger), status, due_date, scheduled_date, delegated_to, source (manual/agent/coordinator/system).

**emusys_classes:** collaborator_id, emusys_class_id, student_name, class_date, class_time, attendance_registered, content_registered, reminder_sent.

### 5.3 Triggers automáticos

| Trigger | Função |
|---|---|
| mark_overdue | Marca tasks e checkpoints como 'overdue' quando due_date < hoje |
| calculate_eisenhower | Recalcula quadrante ao criar/atualizar tarefa |
| update_project_progress | Recalcula progress_percent do projeto ao mudar status de checkpoint |
| update_daily_completion | Recalcula taxa de conclusão do dia ao ticar item |
| auto_create_preferences | Cria user_preferences com defaults ao inserir collaborator |

### 5.4 Crons programados

| Job | Frequência | Função |
|---|---|---|
| dispatch_rituals | 15 min | Dispara rituais pra quem está no horário configurado |
| mark_overdue | Diário 6h | Marca tarefas e checkpoints atrasados |
| send_deadline_alerts | Diário 7h | Notifica tarefas vencendo hoje/amanhã |
| sync_google_calendar | 15 min | Sincroniza itens com Google Calendar |
| sync_emusys | 30 min | Puxa agenda e status do Emusys |
| check_emusys_pending | 15 min | Lembra professor de aula sem presença |
| dispatch_op_checklists | 15 min | Envia checklists operacionais no turno |
| check_op_checklists | Diário 20h | Alerta checklists não preenchidos |
| calculate_weekly_metrics | Domingo 23h | Consolida métricas semanais |

### 5.5 RLS resumido

| Nível | Regra |
|---|---|
| Colaborador | Vê só dados próprios (assigned_to = user_id) |
| Coordenador | Vê dados de trabalho de supervisionados + próprios. NUNCA vê pessoal de outros |
| Diretor | Vê dados de trabalho de todos. NUNCA vê pessoal de outros |
| Pessoal | Tarefas com context='personal', hábitos e habit_logs: visíveis APENAS pro próprio colaborador |
| Exceção | Conversas são privadas: coordenador vê métricas, não conteúdo |

---

## 6. Funcionalidades por persona e canal

Detalhamento completo no Documento 02.

### 6.1 Colaborador

**WhatsApp (motor principal):**
- Recebe briefing pessoal (7h) com compromissos, hábitos e streaks
- Recebe briefing trabalho (8h) com 3 tarefas priorizadas
- Recebe fechamento diário — reporta o que fez (pessoal + trabalho separados)
- Recebe planejamento semanal — define entregas pessoais e de trabalho
- Tica tarefas, reagenda, delega, pede prazo — tudo por mensagem
- Cria e acompanha hábitos pessoais com templates prontos
- Recebe lembrete Emusys pós-aula (professor)
- Recebe checklist operacional no início do turno
- Aceita áudio — transcreve e processa

**PWA (espelho visual):**
- Tela "Hoje" com tarefas pessoais + trabalho separadas + projetos + Emusys
- Tela "Semana" com entregas distribuídas
- Tela "Projetos" com roadmap e checkpoints
- Checklist operacional interativo
- Hábitos pessoais com streaks, templates e tracking visual
- Agenda Emusys (professor)
- Configurações pessoais (briefing pessoal/trabalho separados) + Google Calendar
- Histórico de conclusão

### 6.2 Coordenador (herda tudo do colaborador +)

**WhatsApp:**
- Resumo do time diário (após fechamentos)
- Alertas de pedido de prazo, projeto em risco, inatividade
- Cria projetos via conversa guiada (5W2H)
- Cria tarefas e delega pra colaboradores
- Aprova/nega extensões de prazo
- Cobra colaboradores via TOM

**PWA:**
- Dashboard do time com ranking e alertas
- Pessoa detalhe (tarefas, rituais, checklists, Emusys por pessoa)
- Aderência geral (rituais + checklists + Emusys)
- Gestão de templates de checklists operacionais
- Visão de todos os projetos

### 6.3 Diretor (herda tudo do coordenador +)

**Via Alfredo:**
- Consultas sobre pessoas, projetos, métricas — resposta em segundos
- Alertas de inatividade e projetos em risco

**PWA:**
- Dashboard executivo com métricas consolidadas e evolução mensal

---

## 7. Fluxos conversacionais

Detalhamento completo no Documento 04. Resumo dos 13 fluxos:

| # | Fluxo | Trigger | Duração |
|---|---|---|---|
| 1 | Onboarding | Primeiro contato | 3 min |
| 2 | Planejamento semanal | Cron domingo/segunda | 5 min |
| 3 | Briefing do dia | Cron 8h (configurável) | 1 min |
| 4 | Fechamento do dia | Cron 19h (configurável) | 3 min |
| 5 | Cadastro de projeto (5W2H) | "Criar projeto" | 5 min |
| 6 | Ações sob demanda | Mensagem livre | Variável |
| 7 | Resumo do time | Cron 19h30 | Passivo |
| 8 | Retrospectiva semanal | Cron domingo | Passivo |
| 9 | Consulta do diretor | Via Alfredo | Variável |
| 10 | Tratamento de áudio | Áudio recebido | Automático |
| 11 | "Não me incomoda" | Pedido do colaborador | 30 seg |
| 12 | Lembrete Emusys | Cron pós-aula | 1 min |
| 13 | Checklist operacional | Cron início de turno | 2 min |
| 14 | Broadcast com follow-up | Pedido do coordenador | Envio 1 min + follow-up até 24h |

**Tom do TOM:** direto, informal, sem frescura. Mensagens curtas (máx 3 parágrafos). Uma pergunta por vez. Adapta intensidade por configuração (leve/normal/duro) e por perfil evolutivo (collaborator_profiles). Aceita áudio. Respeita "agora não". Não reenvia se ignorado em 30 min.

**Mapa de intenções:** 25 intenções reconhecidas por texto livre (task_complete, task_reschedule, task_delegate, task_create, deadline_extension, status_check, project_status, project_create, team_status, emusys_check, emusys_status, checklist_complete, checklist_partial, checklist_issue, do_not_disturb, planning_request, help, settings, personal_task, habit_create, habit_complete, habit_templates, broadcast_send, broadcast_status).

---

## 8. Mapa de telas do PWA

Detalhamento completo no Documento 05.

**16 telas + 3 modais. Dark mode padrão, light mode opcional.**

| # | Tela | Rota | Quem vê |
|---|---|---|---|
| 1 | Hoje | /hoje | Todos |
| 2 | Semana | /semana | Todos |
| 3 | Projetos (lista) | /projetos | Todos |
| 4 | Projeto detalhe | /projetos/:id | Membros + coord+ |
| 5 | Menu "Mais" | /mais | Todos |
| 6 | Checklists operacionais | /checklists | Todos |
| 7 | Agenda Emusys | /emusys | Professor |
| 8 | Hábitos pessoais | /habitos | Todos (privado) |
| 9 | Configurações | /configuracoes | Todos |
| 10 | Histórico | /historico | Todos |
| 11 | Dashboard do time | /time | Coord + Dir |
| 12 | Pessoa detalhe | /time/:id | Coord + Dir |
| 13 | Aderência geral | /aderencia | Coord + Dir |
| 14 | Gestão de checklists | /checklists/gestao | Coord + Dir |
| 15 | Dashboard executivo | /dashboard | Dir |

**Navegação:** 4 tabs fixos (Hoje, Semana, Projetos, Mais). Itens de gestão ficam no menu "Mais" com seções por role.

---

## 9. Personalização

Cada colaborador configura via onboarding (WhatsApp) ou tela de configurações (PWA):

| Preferência | Opções | Default |
|---|---|---|
| Horário do briefing pessoal | 5h–9h | 7h |
| Horário do briefing trabalho | 6h–10h | 8h |
| Horário do fechamento | 17h–21h | 19h |
| Dia do planejamento semanal | Domingo ou segunda | Domingo |
| Horário do planejamento | 17h–21h | 19h |
| Intensidade da cobrança | Leve, normal, duro | Normal |
| Notificações de prazo | On/off | On |
| Notificações de atraso | On/off | On |
| Google Calendar | Conectado/desconectado | Desconectado |

O pg_cron roda a cada 15 minutos e consulta a tabela de preferências. Dispara apenas pra quem está no horário. Escalável pra centenas de usuários sem criar crons adicionais.

---

## 10. Integrações

### 10.1 Google Calendar

- Conexão via OAuth (login com Google, um clique)
- Sincronização automática: tarefas → eventos, checkpoints → eventos, reuniões → eventos
- Bidirecional: mover evento no calendário → reagenda tarefa no sistema
- Cron de sync a cada 15 min
- Tabela de controle: `google_calendar_sync`

### 10.2 Emusys

- Polling via endpoint API a cada 30 min
- Puxa agenda de aulas do dia, status de presença e conteúdo
- Lembrete pós-aula (class_end_time + 10 min) se presença não lançada
- Aderência calculada por professor: presença % + conteúdo %
- Tabela: `emusys_classes`

### 10.3 Alfredo (OpenClaw)

- Acesso de leitura ao banco do LA Organizer via RPC ou query direta
- Alf pergunta → Alfredo consulta → responde com dados reais
- Não modifica dados — apenas leitura
- Nenhuma mudança no Alfredo — só conecta numa fonte de dados nova

### 10.4 UAZAPI

- Motor do TOM conecta via API UAZAPI
- Envio e recebimento de mensagens, áudio, imagens
- Webhook de recebimento configura na UAZAPI
- Número dedicado para o TOM organizador (separado do WhatsApp comercial)

---

## 11. Métricas de sucesso

| Métrica | Meta | Como medir |
|---|---|---|
| Fechamento diário completado | ≥ 80% (4 de 5 dias) | ritual_logs com type=daily_closing e status=responded / total |
| Projetos com tarefas com dono e prazo | 100% | tasks com assigned_to NOT NULL e due_date NOT NULL / total |
| Tempo de resposta ao TOM | < 30 min | ritual_logs.response_time_minutes média |
| Status de projeto via Alfredo | < 10 seg | Tempo de consulta (validação manual) |
| Taxa de conclusão semanal | ≥ 70% | weekly_plans.completion_rate média |
| Checkpoints no prazo | ≥ 85% | project_checkpoints com status=done e completed_at ≤ due_date / total |
| Aderência checklists operacionais | ≥ 90% | op_checklist_completions completos / esperados |
| Presença Emusys no mesmo dia | ≥ 95% | emusys_classes com attendance_registered=true / total de aulas dadas |

---

## 12. Fases de entrega

| Fase | Escopo | Prazo | Dependências |
|---|---|---|---|
| **1** | TOM (WhatsApp): 3 rituais + cadastro de projeto (5W2H) + checklist de tarefas + priorização Eisenhower | 2 semanas | VPS, UAZAPI, Supabase, Claude Max |
| **2** | PWA espelho: Hoje, Semana, Projetos, Checklist interativo, Configurações | 2-3 semanas | Fase 1 (banco populado) |
| **3** | Dashboard gerencial: Time, Pessoa detalhe, Aderência, Gestão de checklists, Dashboard executivo | 1-2 semanas | Fase 2 |
| **4** | Integração Alfredo: consultas do diretor via WhatsApp | 1 semana | Fase 1 (banco com dados) |
| **5** | Checklists operacionais por departamento + Integração Emusys (agenda, presença, conteúdo) + Google Calendar | 2-3 semanas | Fase 2 |

**Prazo total estimado:** 8-11 semanas

**MVP (Fases 1+2):** 4-5 semanas. TOM funcionando no WhatsApp + PWA com as telas principais. Já resolve o problema central.

---

## 13. Riscos e mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Colaboradores não respondem os rituais | Alta | Alto | Intensidade configurável. Notificar coordenador após 3 dias sem resposta. Cobrar via reunião presencial |
| Endpoint Emusys instável ou limitado | Média | Médio | Polling com retry. Se API cair, funcionalidade Emusys degrada sem afetar o resto |
| VPS sobrecarregada com TOM + Alfredo | Baixa | Alto | Monitor de recursos. TOM é leve (stateless, consulta banco). Se necessário, separar em VPS dedicada |
| Coordenadores não criam projetos no sistema | Média | Alto | Treinamento presencial + primeiro projeto criado junto no treinamento |
| Google Calendar OAuth expira | Baixa | Baixo | Refresh token automático. Se falhar, notifica colaborador pra reconectar |
| Excesso de notificações irrita o colaborador | Média | Médio | Horários configuráveis. Sem reenvio após 30 min. Opção de silenciar por tipo |

---

## 14. O que NÃO é

- Não substitui o sistema de Gestão de Projetos existente (Pedagógico). É complementar.
- Não é chatbot genérico. Tem função específica: organizar, cobrar, acompanhar.
- Não é opcional pra quem tá em projeto. Se tem entrega, usa.
- Não exige que o colaborador aprenda framework nenhum.
- Não é "ferramenta que o chefe mandou usar." É app que organiza a VIDA do cara — e de quebra conecta com o trabalho.
- Não é Asana, Trello, Monday. É gestão operacional de escola de música — simples, direto, no WhatsApp.
- O pessoal é pessoal. Coordenador e diretor NUNCA veem tarefas pessoais, hábitos ou compromissos privados do colaborador. Empatia é valor da LA Music.

---

## 15. Documentos de referência

| Doc | Conteúdo | Arquivo |
|---|---|---|
| 01 | Documento de conceito v2.0 (visão, 7 pilares, hierarquia dupla, arquitetura TOM) | 01-documento-de-conceito-la-organizer.md |
| 02 | Mapa de funcionalidades v2.0 por persona e canal (inclui broadcast) | 02-mapa-funcionalidades-la-organizer.md |
| 03 | Esquema de banco de dados v2.0 (27 tabelas, 9 domínios, profiles, memory, broadcast) | 03-esquema-banco-dados-la-organizer.md |
| 04 | Fluxos conversacionais do TOM v2.0 (14 fluxos, 25 intenções NLU) | 04-fluxos-conversacionais-agente-la-organizer.md |
| 05 | Mapa de telas do PWA v2.0 (16 telas + 3 modais) | 05-mapa-telas-pwa-la-organizer.md |
| 06 | PRD completo v2.0 (este documento) | 06-prd-la-organizer.md |

### Documentos complementares (a criar)

| Doc | Conteúdo | Status |
|---|---|---|
| TOM-SOUL.md | Identidade, personalidade, equação de valor, regras | A criar |
| TOM-AGENTS.md | Regras operacionais, startup de sessão, permissões por role | A criar |
| TOM-USER-TEMPLATE.md | Template do perfil evolutivo de cada colaborador | A criar |
| TOM-MEMORY-ARCHITECTURE.md | Sistema de memória: curto/longo prazo, consolidação, busca | A criar |
| TOM-SKILLS-CATALOG.md | Skills iniciais + mecanismo de criação autônoma | A criar |

---

---

## 16. Backlog — Sprints futuras

### 16.1 Checklist de Evento com Gestão de Equipe

**Origem:** Template Mestre de Checklist para Eventos e Projetos (coordenador LA Music, abril 2026)  
**Prioridade:** Alta — gap identificado pelo coordenador com artefato real  
**Status:** Backlog — NÃO implementar até spec aprovada  
**Spec inicial:** a criar via `superpowers:brainstorming` quando a sprint for aberta

#### Gap identificado

Quando um evento/projeto é cadastrado via 5W2H, o sistema não oferece:

| # | Gap | Impacto |
|---|-----|---------|
| 1 | Tarefas agrupadas por **setor** (Logística / Técnica / Pedagógico / Comunicação / Foto&Vídeo / Alimentação / Fornecedores) | Coordenador não consegue delegar por área de responsabilidade |
| 2 | **Mapa de equipe no dia do evento** — setor → responsável + equipe de apoio | Sem visão de quem faz o quê no dia D |
| 3 | **Linha do tempo automática** — geração de tarefas em -30d / -15d / -7d / -1d a partir da data do evento | Tarefas pré-evento não aparecem no checklist com antecedência adequada |
| 4 | Campo **`notes/observações`** por tarefa | Sem espaço para contexto ou instrução específica por item |
| 5 | **Status rico** por tarefa: `em_andamento` / `urgente` / `aguardando_confirmacao` (além do binário `done`/`pending`) | Status atual não reflete o estado real de execução |

#### O que o app já tem

- `projects` — cadastro via 5W2H (nome, data, local, objetivo, responsável, envolvidos)
- `tasks` — tarefas com `due_date` + `assigned_to` + Eisenhower
- `project_checkpoints` — marcos do projeto

#### Perguntas abertas para a spec

1. Os setores são fixos (enum) ou o coordenador configura por evento?
2. O mapa de equipe é uma view do projeto ou uma tabela separada (`event_team_map`)?
3. A linha do tempo automática é gerada pelo TOM na conversa ou configurada no template de evento?
4. O campo `notes` é texto livre ou estruturado (tipo, link, file)?
5. O status rico substitui ou complementa o `eisenhower_quadrant` atual?

---

*PRD LA Organizer v2.0 — LA Music — 25 de abril de 2026 — Agente: TOM*
