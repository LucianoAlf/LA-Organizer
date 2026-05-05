# PRD — LA Organizer

**Documento:** 06 — PRD Completo
**Versão:** 3.7
**Data:** 2026-05-05 (atualizado Sprint 20 — fase de expansão de departamentos encerrada)
**Autor:** Luciano Alf (produto) + Claude + OpenClaw (arquitetura)
**Stakeholder:** Luciano Alf (CEO LA Music)
**Agente:** TOM
**Status:** Sprints 0→20 fechadas. 4 departamentos operacionais maduros. Próxima fase: governança da liderança.

> **Limites de papel do TOM:** ver `docs/TOM-LIMITES.md` (formalizado 2026-05-05). TOM é organizador de governança e organização pessoal da liderança — não é canal permanente de comunicação interpessoal entre toda a equipe.

---

## 1. Visão do produto

### 1.1 O que é

O LA Organizer é o sistema operacional de vida e trabalho da LA Music. O **TOM** — agente WhatsApp — organiza o dia a dia completo dos colaboradores — vida pessoal e profissional — através de rituais diários, gestão de projetos, checklists operacionais, hábitos pessoais e integração com Emusys. O espelho visual é um PWA mobile-first onde cada pessoa interage com suas tarefas e o gestor tem visão panorâmica do trabalho.

É uma metodologia de desenvolvimento pessoal e profissional proprietária da LA Music, transformada em software. Replicável para qualquer escola mentorada.

### 1.2 Problema

Os colaboradores da LA Music são músicos que trabalham muito, mas não têm hábito de planejamento. Projetos ficam sem prazo, tarefas passam batido, demandas novas subscrevem as anteriores. Professores esquecem de lançar presença no Emusys. Rotinas operacionais não são registradas. A coordenação não tem visibilidade real.

### 1.3 Solução

O ritual vai até onde o colaborador já vive: o WhatsApp. O TOM conduz rituais fixos (planejamento semanal, briefing diário, fechamento diário), cadastra projetos via conversa guiada, distribui e cobra tarefas, envia checklists operacionais, e lembra o professor de lançar presença no Emusys. Tudo alimenta um banco centralizado que o PWA exibe de forma visual.

### 1.4 Contexto operacional

| Dado | Valor |
|---|---|
| Alunos ativos | 1.200+ |
| Unidades | 3 (Campo Grande, Recreio, Barra) |
| Professores | ~40 |
| Staff total | ~70 |
| Usuários iniciais | ~40 |
| Sistema pedagógico | Emusys |
| WhatsApp corporativo | UAZAPI |

---

## 2. Personas

### 2.1 Colaborador
Professor, assistente pedagógico, mentor. Vive no WhatsApp. Responde bem a cobranças diretas e curtas. **Cria projetos pessoais e de trabalho** via PWA ou WhatsApp — habilidade desenvolvida no treinamento de coordenação.

### 2.2 Coordenador
Juliana, Quintela. Criam projetos, distribuem tarefas, acompanham execução. Fazem gestão pelo celular.

### 2.3 Diretor
Luciano Alf. Usa o Alfredo (OpenClaw) como interface principal. Acessa PWA quando precisa de visão detalhada.

### 2.4 Princípio formativo

A LA HQ tem um propósito: **transformar vidas**. O sistema não serve só ao trabalho — serve à vida do colaborador como um todo. Aprender a fazer projeto com início, meio, fim, checklist, lembretes e entregas é uma skill pessoal. Quem desenvolve essa habilidade no trabalho passa a aplicá-la na vida pessoal, e vice-versa. Por isso a criação de projetos não é privilégio de coordenador — é capacidade que **todo o time** desenvolve via treinamento e usa via PWA/TOM.

---

## 3. Arquitetura

### 3.1 Camadas do sistema

| Camada | Componente | Status |
|---|---|---|
| Agente conversacional | TOM via WhatsApp (UAZAPI) | ✅ Fase 1 concluída |
| Backend | Node.js + Supabase (PostgreSQL) | ✅ Em produção |
| Skills e docs | 17 skills ativas + referências internas (atualizado Sprint 15) | ✅ Revisadas pelo OpenClaw |
| Proteção | 4 guards (serialização, dedupe, validação de markers, anti-leak) | ✅ Em produção |
| Observabilidade | ritual_logs + marker_logs + tela PWA Observabilidade (atualizado Sprint 13 F3) | ✅ Em produção |
| Resiliência | restart behavior + fallback provider + segredos | ✅ Em produção |
| Espelho visual | PWA React mobile-first | ✅ Em produção (VPS) |
| Integração executiva | Alfredo (OpenClaw) | 📌 Fase 4 |

### 3.2 Privacidade por design

- `context = 'personal'`: visível apenas pelo próprio colaborador
- Hábitos: 100% privados — nem coordenador, nem diretor
- Memória e perfil: privados por padrão
- Coordenador vê dados de trabalho, nunca pessoal
- **Anti-leak guard:** TOM nunca expõe nomes de stack (Supabase, banco, MCP, tabelas) ao usuário — bloqueado por regex no engine, registrado em `marker_logs` como `LEAK_BLOCKED`

---

## 4. Estado atual — Fase 1

### 4.1 O que está em produção hoje

| Funcionalidade | Status | Sprint |
|---|---|---|
| Onboarding (5 perguntas) | ✅ | Fase 1 |
| Briefing trabalho (8h) | ✅ | Fase 1 |
| Briefing pessoal (7h) | ✅ | Fase 1 |
| Fechamento do dia (19h) | ✅ | Fase 1 |
| Planejamento semanal (domingo) | ✅ | Fase 1 |
| Alertas de prazo e atraso | ✅ | Fase 1 |
| Criar tarefa pessoal / trabalho / lembrete | ✅ | Fase 1 |
| Ticar, reagendar, delegar tarefa | ✅ | Fase 1 |
| Pedir prazo + aprovação coordenador | ✅ | Fase 1 |
| Demanda nova vira task (não memória) | ✅ | Fase 1 |
| Coordenador cria e delega tarefa | ✅ | Fase 1 |
| Criar projeto 5W2H via WhatsApp (7 perguntas) | ✅ | Fase 1 |
| Criar/atualizar/cancelar/concluir compromisso (event) via WhatsApp | ✅ | Fase 1 |
| Briefing inclui compromissos do dia | ✅ | Fase 1 |
| Separação pessoal × trabalho | ✅ | Fase 1 |
| Hábitos pessoais (criar, marcar, streak) | ✅ | Fase 1 |
| Checklists operacionais (dispatch + WhatsApp + PWA) | ✅ | Sprint 11 F2+ |
| CRUD de templates de checklists (PWA, coord+) | ✅ | Sprint 11 F2+ |
| Comunicados segmentados com fila e aprovação 2-stage | ✅ | Sprint 13 F1+F3 |
| Eventos institucionais com plano de comunicação automático (T-3/T-1/T0) | ✅ | Sprint 13 F2+T0 |
| Dashboard Observabilidade PWA (fila aprovações, métricas, anti-spam) | ✅ | Sprint 13 F3 |
| Tarefas de eventos por setor (PWA `/mais/eventos/:id`) | ✅ | Sprint 14 F1 |
| Auto-geração de kit de tasks ao criar evento via TOM (5 famílias, 32 tasks) | ✅ | Sprint 14 F2 |
| Mapa de equipe por unidade e setor (`event_team_map`) | ✅ | Sprint 14 F2 |
| Tela "Configurar Equipe" (`/mais/agenda-escolar/equipe`) | ✅ | Sprint 14 F2 |
| Lembretes WhatsApp T-1 para tasks de evento pendentes | ✅ | Sprint 14 F2 |
| Camada operacional replicável — tabelas `departments` + `department_request_types` | ✅ | Sprint 15 F1 |
| Seed Operações Técnicas (6 tipos de requisição) + Rafinha como responsável padrão | ✅ | Sprint 15 F1 |
| Skill TOM `operacoes-tecnicas` — triagem de demandas via WhatsApp (3 turnos) | ✅ | Sprint 15 F2 |
| Engine: `applyTaskActions` aceita `department_id`, `request_type_id`, `description`, `notes`; auto-derive department; auto-status `awaiting_confirmation` | ✅ | Sprint 15 F2 |
| Dispatcher: `checkDepartmentOperational` — briefing semanal segunda 07:30 BRT por departamento | ✅ | Sprint 15 F4 |
| Dispatcher: `checkChecklistConsequences` — cria task automática quando item com `generates_request_type_id` é marcado false | ✅ | Sprint 15 F4 |
| PWA: tela Operações Técnicas `/mais/operacoes` — fila por prioridade, 4 filtros, sem criação direta | ✅ | Sprint 15 F3 |
| Resumo do time (coordenador, 19h30) | ✅ | Fase 1 |
| Retrospectiva semanal (coordenador, domingo) | ✅ | Fase 1 |
| Do not disturb (janela por colaborador) | ✅ | Fase 1 |
| Consolidação de memória (cron domingo 22h) | ✅ | Fase 1 |
| Nudge de aderência (19h, cond: ≥2 atrasadas) | ✅ | Fase 1 |
| Tratamento de áudio (Whisper) | ✅ | Fase 1 |
| 4 guards de proteção | ✅ | Fase 1 |
| Observabilidade (ritual_logs + marker_logs) | ✅ | Fase 1 |
| Resiliência (restart, fallback, segredos) | ✅ | Fase 1 |

### 4.2 Deferred (documentado)

| Item | Motivo |
|---|---|
| WEBHOOK_SECRET HMAC strict mode | Aguarda UAZAPI suportar assinatura — porta 3100 já fechada via nginx |
| collaborator_profiles auto-update qualitativo | Precisa de uso real com múltiplos usuários antes |
| Emusys/checklist nas seções do resumo | Aguarda tabelas completas das integrações |
| Hermes (evolução autônoma de skills) | Metacapacidade — entra após validação com usuários reais |
| Override de equipe por evento | Diferido Sprint 14 — aguarda uso real da feature base |
| Lembretes múltiplos T-3 + T-1 para tasks de evento | Diferido Sprint 14 — risco de spam; aguarda feedback |
| Aprovação para eventos institucionais | Fora de escopo Sprint 13 F3 — futura |

---

## 5. Fase 2 — PWA

### 5.1 Objetivo
Criar o espelho visual do TOM — um PWA mobile-first que permite ao colaborador ver e interagir com suas tarefas, projetos, compromissos e hábitos. Para coordenadores, visão do time. Para o diretor, panorama executivo.

### 5.2 Princípios do PWA

- Mobile-first, dark mode padrão
- Espelho do banco — não duplica lógica de negócio (isso é responsabilidade do TOM/engine)
- Login via magic link por WhatsApp
- Role gating visual (colaborador ≠ coordenador ≠ diretor)
- Privacidade por design (pessoal não vaza para coordenador)
- **Ações estruturadas que disparam markers do TOM** quando aplicável (ex.: criação de projeto via wizard dispara `<<PROJECT_CREATE>>` no engine)

### 5.3 Telas em produção (Sprints 0→15)

| Tela | Role | Sprint |
|---|---|---|
| Login (magic link WhatsApp) | Todos | Sprint 2 |
| Hoje | Todos | Sprint 0 |
| Semana | Todos | Sprint 0 |
| Projetos (lista) | Todos | Sprint 0 |
| Projeto detalhe | Todos | Sprint 0 |
| Dashboard do time `/time` | Coordenador+ | Sprint 0 |
| Configurações | Todos | Sprint 1 |
| Histórico | Todos | Sprint 1 |
| Pessoa-Detalhe `/time/:id` | Coordenador+ | Sprint 6 |
| Hábitos `/habitos` | Todos | Sprint 8+ |
| Project Wizard `/projetos/novo` | Todos (com gate) | Sprint 8 |
| Checklists `/checklists` | Todos | Sprint 11 F2+ |
| Templates de Checklists `/mais/checklists-templates` | Coord+ | Sprint 11 F2+ |
| Comunicados `/mais/comunicados` | Coord+ | Sprint 13 F1 |
| Agenda Escolar `/mais/agenda-escolar` | Coord+ | Sprint 13 F2 |
| Observabilidade `/mais/observabilidade` | Coord+ | Sprint 13 F3 |
| Evento Detalhe `/mais/eventos/:id` | Coord+ | Sprint 14 F1 |
| Configurar Equipe `/mais/agenda-escolar/equipe` | Coord+ | Sprint 14 F2 |
| Operações Técnicas `/mais/operacoes` | Coord+ | Sprint 15 F3 |

### 5.4 Telas planejadas (futuro)

| Tela | Role | Sprint planejada |
|---|---|---|
| Aderência geral | Coordenador+ | Fase 3 |
| Dashboard executivo | Diretor | Fase 3 |
| Agenda Emusys | Professor | Fase 5 |

---

## 6. Project Wizard (Sprint 8)

### 6.1 Por que existe

Hoje a criação de projeto é exclusivamente via TOM no WhatsApp — um fluxo conversacional de 7 perguntas (skill `cadastro-projeto-5w2h`). Funciona, mas tem dois problemas:

1. **Limita quem cria.** A skill tem gate de permissão para coord/director, mas a metodologia 5W2H é uma habilidade que **todo o time precisa desenvolver** — é parte do treinamento de coordenação que se estende a colaboradores. O propósito formativo da LA HQ exige que essa skill esteja acessível.
2. **WhatsApp-first não é mobile-first visual.** Para uma habilidade que se está ensinando, ter feedback visual (progresso, campos preenchidos, confirmação visual) acelera o aprendizado.

### 6.2 O que é

Wizard multi-step no PWA que replica o fluxo 5W2H do TOM em telas guiadas. Acessível a todos os colaboradores, com gate diferenciado:

- **Coordenador / Diretor:** wizard completo, projeto entra em produção imediato
- **Colaborador comum:** wizard completo, projeto entra como `status='planning'` aguardando aprovação do coordenador supervisor

### 6.3 Fluxo (4 passos)

| Passo | Campos | Validação |
|---|---|---|
| 1 — Identidade | `name` (O quê) · `justification` (Por quê) | Ambos obrigatórios |
| 2 — Tempo e local | `location` (Onde) · `start_date` · `end_date` (Quando) | end_date > start_date |
| 3 — Pessoas e método | `description` (Quem) · `methodology` (Como) · `estimated_hours_week` (Quanto) | Description e methodology obrigatórios |
| 4 — Confirmação | Resumo de tudo + escolha de `category` | category obrigatório |

Cada passo tem barra de progresso visual (1/4, 2/4, 3/4, 4/4). Tela final: "✅ Projeto criado! O TOM já foi notificado." e redirect para `/projetos/:id`.

### 6.4 Integração com o engine

O PWA não duplica lógica de criação. Após confirmação do passo 4:

1. PWA insere row em `projects` via Supabase (RLS valida gate)
2. PWA dispara webhook ao engine TOM com payload equivalente a `<<PROJECT_CREATE>>`
3. Engine processa: cria checkpoints iniciais, registra membros, envia mensagem WhatsApp ao criador confirmando, opcionalmente notifica supervisor

### 6.5 Schema

**Sem nova tabela.** A tabela `projects` existente já cobre todos os 7 campos do 5W2H. Mudança necessária:

- Adicionar RLS policy `auth_insert_own_projects` permitindo INSERT a qualquer authenticated com `created_by = current_collab_id()`
- Adicionar coluna `requires_approval boolean DEFAULT false` em `projects` para diferenciar projetos criados por colaborador comum (true) vs coord/director (false)

### 6.6 Documentação completa

Ver `docs/PROJECT-WIZARD.md` para decisões arquiteturais detalhadas, mapeamento step→campo, integração com engine, e UX por role.

---

## 7. Roadmap geral

| Fase | Conteúdo | Status |
|---|---|---|
| Fase 0 | Infraestrutura (VPS, banco, webhook) | ✅ Concluída |
| Fase 1 | TOM WhatsApp (agente completo) | ✅ Funcionalmente concluída |
| Fase 2 | PWA espelho visual + Project Wizard + Coordenação operacional | ✅ Sprints 0→15 entregues (atualizado Sprint 15) |
| Fase 3 | Dashboard gerencial avançado + check-in RH | 📌 Planejado |
| Fase 4 | Integração Alfredo (OpenClaw) | 📌 Planejado |
| Fase 5 | Emusys completo + Google Calendar | 📌 Planejado |
| Fase 1E | Hermes (evolução autônoma de skills) | 📌 Após validação com usuários |

> Para histórico detalhado sprint a sprint, ver `docs/roadmap-la-organizer.md`.

---

## 8. Estratégia de rollout

1. **Concluído:** Alf testou sozinho (Sprints 0→4)
2. **Concluído:** Anne Susan entrou (collaborator, Campo Grande) na Sprint 2
3. **Concluído (atualizado Sprint 14):** Project Wizard entregue; Juliana e Quintela (coordenadores) podem onboardar
4. **Concluído (atualizado Sprint 15):** Camada operacional replicável entregue; Rafinha cadastrado como responsável padrão de Operações Técnicas
5. **Próximo:** validar Sprint 15 em uso real — confirmar se briefing semanal segunda 07:30 BRT funciona na prática, se checklist consequences geram tasks corretas
5. **Produção plena:** time completo (~40 pessoas) — após estabilização com 4-5 usuários coordenadores

---

## 9. Decisões de arquitetura relevantes

- **Markers vs structured output:** markers (`<<ACTION>>...<<END>>`) funcionam no MVP com guard de validação. Migração para structured output considerada para Onda 1 de arquitetura.
- **engine.js:** atualmente god object — refactor planejado para Sprint de Arquitetura (Onda 1) quando Fase 2 estiver estável.
- **Segredos:** repo privatizado, rotação Supabase concluída na Sprint 7, UAZAPI rotacionado na Sprint 5.
- **Áudio:** Whisper (OpenAI) ativo — ~$1.80/mês no volume atual.
- **Anti-leak guard:** Sprint 7 adicionou regex no engine bloqueando vazamento de termos de stack ao usuário (Supabase, banco, MCP, tabela, sql, permissão de acesso).
- **MCP tools desligadas no TOM:** Sprint 7 desabilitou ferramentas externas no Claude CLI do engine — TOM só consome texto + marker, nunca tenta tool calls.
- **Project Wizard cria via PWA, executa via engine:** wizard é UI; criação efetiva e distribuição de tarefas é responsabilidade do engine TOM (princípio "PWA é espelho").
- **Kit de tasks hardcoded em engine.js (Sprint 14):** 5 famílias × 8 tipos de evento — decisão deliberada de YAGNI; editável via código enquanto o produto não tem multi-dev.
- **Kits de tasks por evento_type, não por evento individual:** mapa de equipe é por unidade × setor, não por evento específico — simplifica gestão, override diferido para uso real.
- **Deploy via scp sem CI/CD (atualizado Sprint 14):** aceitável single-dev; tsc clean exigido antes de cada deploy. Histórico mantido no GitHub.
- **Bundle PWA 633KB (dívida Sprint 14):** code-splitting diferido — só prioridade se carregamento incomodar usuários.
- **Briefing semanal segunda 07:30 BRT (Sprint 15):** timing de ação escolhido sobre sexta 17h — coerência com briefing matinal pessoal e pareamento com daily_plans.
- **Camada operacional replicável (Sprint 15):** `departments` + `department_request_types` projetados para suportar múltiplos departamentos; Operações Técnicas é o primeiro.

---

## 10. Histórico de versões

### v3.0 → v3.1 (2026-04-28)

| Item | v3.0 | v3.1 |
|---|---|---|
| Status Fase 2 | Iniciando | Sprints 0→7 em produção, Sprint 8 planejada |
| Project Wizard | Não previsto | Documentado como Sprint 8 (seção 6) |
| Persona Colaborador | Apenas executa | **Cria projetos** (treinamento de coordenação estende skill ao time) |
| Anti-leak guard | Não existia | Documentado em 3.2 e 9 |
| Telas em produção | Lista P0/P1 | Lista por sprint entregue |
| Privatização repo | Pendente | Concluído |
| Rotação segredos | Pendente | Concluída (Supabase Sprint 7, UAZAPI Sprint 5) |

### v3.3 → v3.7 (2026-05-05) — pós-Sprint 16/17/18/19/20 + radar

| Item | v3.3 | v3.7 |
|---|---|---|
| Status | Sprints 0→15 | Sprints 0→20 |
| Departamentos operacionais | 1 (Operações Técnicas) | **4** (+ Marketing, Pedagógico, Gerência) |
| Tabelas DB | 38 | 39 (+ pedagogical_assignments, Sprint 19) |
| Colunas novas | — | tasks.subdomain, collaborators.pedagogical_role (Sprint 19) |
| Skills TOM | 17 | **19** (+ pedagogico, gerencia) + 3 auxiliares globais (coordenacao-conversacional Sprint 16, integridade-agenda Sprint 18, pedagogico Sprint 19) |
| Coordenação conversacional | — | Sprint 16: relay/relay_assisted/followup, COORD_HINT, alçada |
| ACC | — | Sprint 17: FOCUS_CANDIDATE com confidence high/medium/low/none |
| Integridade de agenda | — | Sprint 18: detectores de conflito + dup semântica + hygiene de tasks |
| Camada pedagógica | — | Sprint 19: hierarquia (lead/assistant/mentor), subdomain (LA Music School/Kids), gate de alçada DENY > ALLOW |
| Camada gerencial | — | Sprint 20: 3 gerentes de unidade + filtro inteligente + fronteira pedagógico |
| Colaboradores | + Rafinha | **16 ativos** (+ Juliana/Quintela/6 assistentes/3 mentores/3 gerentes/Yuri) |
| TOM-LIMITES.md | — | NOVO — formaliza papel do TOM (não vira "menino de recado") |
| Hotfixes UX (radar Sprint 20) | — | 11: cadência self-intro, microconfirmação numerada, Eisenhower, dedup defensivo, cooldown deadline, COORD_HINT contexto, etc. |
| Decisão estratégica | — | **Encerrada fase de expansão de departamentos** (2026-05-05). Próxima frente: governança da liderança |

### v3.2 → v3.3 (2026-05-03) — pós-Sprint 15

| Item | v3.2 | v3.3 |
|---|---|---|
| Status Fase 2 | Sprints 0→14 entregues | Sprints 0→15 entregues |
| Telas em produção | 17 telas | 18 telas (+ Operações Técnicas) |
| DB tabelas | 36 | 38 (+ departments, department_request_types) |
| Skills TOM | 16 skills | 17 skills (+ operacoes-tecnicas) |
| Dispatcher blocos | 12 | 14 (+ checkDepartmentOperational, checkChecklistConsequences) |
| Engine markers | + SCHOOL_EVENT_ACTION | `<<TASK_UPDATE>>` aceita novos campos: department_id, request_type_id, description, notes |
| Colaboradores | Alf + Anne Susan (+ coords) | + Rafinha (id c9e72a40, role collaborator, unit all) |
| Briefing semanal | Não existia | Segunda 07:30 BRT por departamento ativo |
| Checklist consequences | Não existia | Item não cumprido → task automática (source='system') |

### v3.1 → v3.2 (2026-05-03) — pós-Sprint 14

| Item | v3.1 | v3.2 |
|---|---|---|
| Status Fase 2 | Sprints 0→7 fechadas, Sprint 8 planejada | Sprints 0→14 entregues |
| Telas em produção | 9 telas | 18 telas (+ Hábitos, Wizard, Checklists, Comunicados, Agenda, Observabilidade, EventoDetalhe, ConfigEquipe) |
| Coordenação operacional | Não previsto | Checklists, Comunicados+Aprovação, Eventos Institucionais (Sprints 11+13) |
| Tarefas de eventos | Não previsto | CRUD por setor + auto-kit + mapa de equipe + lembretes T-1 (Sprint 14) |
| Skills TOM | 10+ | 16 skills (aprovacao-comunicados, comunicados, eventos-institucionais, checklists-operacionais, aprovar-projeto) |
| Engine markers | PROJECT_CREATE, TASK_UPDATE, MEMORY_SAVE, ONBOARDING_DONE | + CHECKLIST_ACTION, CHECKPOINT_BATCH, ANNOUNCEMENT_ACTION, ANNOUNCEMENT_APPROVAL, SCHOOL_EVENT_ACTION, EVENT_CREATE, PROJECT_REJECT |
| Deploy infra | Vercel (PWA) | VPS única (3 processos pm2: tom, web, tunnel) |
| Backup | Não documentado | Backup diário às 03h → `/opt/LA-Organizer/backups/` (60d) |
| Roadmap geral | Fase 2 em andamento | Fase 2 concluída; Fase 3+ planejadas |
| Fase 5 — escopo | Checklists avançados + Emusys + Google Calendar | Emusys + Google Calendar (checklists já entregues na Fase 2) |
| Dívidas técnicas conhecidas | Não listadas | Bundle 633KB, categoria tasks, due_date NOT NULL, sem testes automatizados |
