# PRD — LA Organizer

**Documento:** 06 — PRD Completo
**Versão:** 3.1
**Data:** 28 de abril de 2026
**Autor:** Luciano Alf (produto) + Claude + OpenClaw (arquitetura)
**Stakeholder:** Luciano Alf (CEO LA Music)
**Agente:** TOM
**Status:** Fase 1 funcionalmente concluída — Fase 2 (PWA) em produção · Sprints 0→7 fechadas

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
| Skills e docs | 10+ skills ativas + referências internas | ✅ Revisadas pelo OpenClaw |
| Proteção | 4 guards (serialização, dedupe, validação de markers, anti-leak) | ✅ Em produção |
| Observabilidade | ritual_logs + marker_logs + v_recent_events | ✅ Em produção |
| Resiliência | restart behavior + fallback provider + segredos | ✅ Em produção |
| Espelho visual | PWA React mobile-first | ✅ Em produção (Vercel) |
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

| Funcionalidade | Status |
|---|---|
| Onboarding (5 perguntas) | ✅ |
| Briefing trabalho (8h) | ✅ |
| Briefing pessoal (7h) | ✅ |
| Fechamento do dia (19h) | ✅ |
| Planejamento semanal (domingo) | ✅ |
| Alertas de prazo e atraso | ✅ |
| Criar tarefa pessoal / trabalho / lembrete | ✅ |
| Ticar, reagendar, delegar tarefa | ✅ |
| Pedir prazo + aprovação coordenador | ✅ |
| Demanda nova vira task (não memória) | ✅ |
| Coordenador cria e delega tarefa | ✅ |
| Criar projeto 5W2H via WhatsApp (7 perguntas) | ✅ |
| Criar/atualizar/cancelar/concluir compromisso (event) via WhatsApp | ✅ |
| Briefing inclui compromissos do dia | ✅ |
| Separação pessoal × trabalho | ✅ |
| Hábitos pessoais (criar, marcar, streak) | ✅ |
| Checklists operacionais | ✅ |
| Resumo do time (coordenador, 19h30) | ✅ |
| Retrospectiva semanal (coordenador, domingo) | ✅ |
| Do not disturb (janela por colaborador) | ✅ |
| Consolidação de memória (cron domingo 22h) | ✅ |
| Tratamento de áudio (Whisper) | ✅ |
| 4 guards de proteção | ✅ |
| Observabilidade (ritual_logs + marker_logs) | ✅ |
| Resiliência (restart, fallback, segredos) | ✅ |

### 4.2 Deferred (documentado)

| Item | Motivo |
|---|---|
| WEBHOOK_SECRET HMAC strict mode | Aguarda UAZAPI suportar assinatura — porta 3100 já fechada via nginx |
| collaborator_profiles auto-update qualitativo | Precisa de uso real com múltiplos usuários antes |
| Emusys/checklist nas seções do resumo | Aguarda tabelas completas das integrações |
| Hermes (evolução autônoma de skills) | Metacapacidade — entra após validação com usuários reais |

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

### 5.3 Telas em produção (Sprints 0→7)

| Tela | Role | Sprint |
|---|---|---|
| Login (magic link WhatsApp) | Todos | Sprint 2 |
| Hoje | Todos | Sprint 0 |
| Semana | Todos | Sprint 0 |
| Projetos (lista) | Todos | Sprint 0 |
| Projeto detalhe | Todos | Sprint 0 |
| Dashboard do time | Coordenador+ | Sprint 0 |
| Configurações | Todos | Sprint 1 |
| Histórico | Todos | Sprint 1 |
| Pessoa-Detalhe `/time/:id` | Coordenador+ | Sprint 6 |

### 5.4 Telas planejadas

| Tela | Role | Sprint planejada |
|---|---|---|
| **Project Wizard `/projetos/novo`** | **Todos (com gate)** | **Sprint 8** |
| Hábitos pessoais | Todos | Sprint 8+ |
| Checklists operacionais | Todos | Sprint 8+ |
| Broadcast no PWA | Coordenador+ | Sprint 8+ |
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
| Fase 2 | PWA espelho visual + Project Wizard | 🔄 Em andamento (Sprints 0→7 fechadas, 8 planejada) |
| Fase 3 | Dashboard gerencial avançado + check-in RH | 📌 Planejado |
| Fase 4 | Integração Alfredo (OpenClaw) | 📌 Planejado |
| Fase 5 | Checklists operacionais avançados + Emusys completo + Google Calendar | 📌 Planejado |
| Fase 1E | Hermes (evolução autônoma de skills) | 📌 Após validação com usuários |

---

## 8. Estratégia de rollout

1. **Concluído:** Alf testou sozinho (Sprints 0→4)
2. **Concluído:** Anne Susan entrou (collaborator, Campo Grande) na Sprint 2
3. **Próximo:** Juliana e Quintela (coordenadores) — pré-requisito: Sprint 8 (Project Wizard) entregue
4. **Produção:** time completo (~40 pessoas) — após estabilização do Project Wizard com 4-5 usuários

---

## 9. Decisões de arquitetura relevantes

- **Markers vs structured output:** markers (`<<ACTION>>...<<END>>`) funcionam no MVP com guard de validação. Migração para structured output considerada para Onda 1 de arquitetura.
- **engine.js:** atualmente god object — refactor planejado para Sprint de Arquitetura (Onda 1) quando Fase 2 estiver estável.
- **Segredos:** repo privatizado, rotação Supabase concluída na Sprint 7, UAZAPI rotacionado na Sprint 5.
- **Áudio:** Whisper (OpenAI) ativo — ~$1.80/mês no volume atual.
- **Anti-leak guard:** Sprint 7 adicionou regex no engine bloqueando vazamento de termos de stack ao usuário (Supabase, banco, MCP, tabela, sql, permissão de acesso).
- **MCP tools desligadas no TOM:** Sprint 7 desabilitou ferramentas externas no Claude CLI do engine — TOM só consome texto + marker, nunca tenta tool calls.
- **Project Wizard cria via PWA, executa via engine:** wizard é UI; criação efetiva e distribuição de tarefas é responsabilidade do engine TOM (princípio "PWA é espelho").

---

## 10. Mudanças v3.0 → v3.1

| Item | v3.0 | v3.1 |
|---|---|---|
| Status Fase 2 | Iniciando | Sprints 0→7 em produção, Sprint 8 planejada |
| Project Wizard | Não previsto | Documentado como Sprint 8 (seção 6) |
| Persona Colaborador | Apenas executa | **Cria projetos** (treinamento de coordenação estende skill ao time) |
| Anti-leak guard | Não existia | Documentado em 3.2 e 9 |
| Telas em produção | Lista P0/P1 | Lista por sprint entregue |
| Privatização repo | Pendente | Concluído |
| Rotação segredos | Pendente | Concluída (Supabase Sprint 7, UAZAPI Sprint 5) |
