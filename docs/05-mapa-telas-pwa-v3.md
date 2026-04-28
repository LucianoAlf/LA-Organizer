# Mapa de Telas do PWA — LA Organizer

**Documento:** 05
**Versão:** 3.1
**Data:** 28 de abril de 2026
**Plataforma:** PWA mobile-first (React/TypeScript) — Vercel
**Design:** Dark mode padrão, opção light mode
**Status:** Sprints 0→7 em produção · Sprint 8 (Project Wizard) planejada

---

## Estrutura de navegação

### Bottom Navigation (4 tabs fixos)

| Tab | Ícone | Label | Tela principal |
|---|---|---|---|
| 1 | Círculo preenchido | Hoje | Visão do dia atual |
| 2 | Calendário | Semana | Visão semanal |
| 3 | Foguete | Projetos | Projetos ativos |
| 4 | Menu/Mais | Mais | Configurações, histórico, time (coord+) |

### Navegação por role

| Tela | Colaborador | Coordenador | Diretor | Status |
|---|---|---|---|---|
| Login | ✓ | ✓ | ✓ | ✅ Sprint 2 |
| Hoje | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Semana | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Projetos (lista) | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Projeto detalhe | ✓ | ✓ | ✓ | ✅ Sprint 0 |
| Dashboard do time | — | ✓ | ✓ | ✅ Sprint 0 |
| Configurações | ✓ | ✓ | ✓ | ✅ Sprint 1 |
| Histórico | ✓ | ✓ | ✓ | ✅ Sprint 1 |
| Pessoa-Detalhe `/time/:id` | — | ✓ | ✓ | ✅ Sprint 6 |
| **Project Wizard `/projetos/novo`** | **✓** | **✓** | **✓** | **🔄 Sprint 8** |
| Hábitos pessoais | ✓ | ✓ | ✓ | 📌 Sprint 8+ |
| Checklists operacionais | ✓ | ✓ | ✓ | 📌 Sprint 8+ |
| Broadcast | — | ✓ | ✓ | 📌 Sprint 8+ |
| Aderência geral | — | ✓ | ✓ | 📌 Fase 3 |
| Dashboard executivo | — | — | ✓ | 📌 Fase 3 |
| Agenda Emusys | ✓ (professor) | — | — | 📌 Fase 5 |

---

## Componentes globais

### Header
```
┌─────────────────────────────────────────┐
│  Bom dia, Quintela          [Avatar MQ] │
│  Terça, 27 de abril                     │
└─────────────────────────────────────────┘
```

### Bottom nav
```
┌────────────┬────────────┬────────────┬────────────┐
│  ●  Hoje   │ 📅 Semana  │ 🚀 Projetos│  ≡  Mais   │
└────────────┴────────────┴────────────┴────────────┘
```

---

## Telas em produção — detalhamento

---

### Tela 1 — Hoje

**Role:** Todos · **Sprint:** 0

Header com saudação + data. Bloco "📅 Compromissos hoje" (events) sobre bloco "📋 Tarefas". Tarefas com checkbox interativo e badges de overdue/prazo. FAB para criação rápida (Tarefa | Compromisso).

**Sprint 5 ampliou:** EditEventSheet acessível por tap em event row.

---

### Tela 2 — Semana

**Role:** Todos · **Sprint:** 0

Cards verticais por dia (seg–sex), events com horário em destaque pink, tasks como bullets compactos. FAB para criação rápida. Reagendar via tap → bottom sheet com date picker.

---

### Tela 3 — Projetos (lista)

**Role:** Todos (cada um vê os seus) · **Sprint:** 0

Lista de projetos ativos com: nome, badge de categoria colorida, progress bar, próximo checkpoint, status. Coord/Director vê todos os projetos que supervisiona.

**A partir da Sprint 8:** botão "+ Novo projeto" no header navega para `/projetos/novo` (Project Wizard).

---

### Tela 4 — Projeto Detalhe

**Role:** Todos (com visibilidade por role) · **Sprint:** 0

Header com nome, categoria, status, progresso. 4 abas: Resumo, Checkpoints, Tarefas, Time. Coord/Director cria tarefas no projeto.

---

### Tela 5 — Dashboard do Time

**Role:** Coordenador, Diretor · **Sprint:** 0 (ampliada Sprint 6)

**Sprint 0:** taxa de conclusão por pessoa, alertas de atraso, quem respondeu rituais.

**Sprint 6 ampliou:** bloco "📅 Compromissos hoje" agregado no topo (top 5 events do team), card de cada colaborador exibe contagens de tasks E events do dia, tap em card navega para `/time/:id` (Pessoa-Detalhe).

**Privacidade:** apenas `tasks.context='work'` e `events.context='work'`. Hábitos, conversation_history e collaborator_memory nunca expostos.

---

### Tela 6 — Configurações

**Role:** Todos · **Sprint:** 1

7 campos editáveis: briefing_time, personal_briefing_time, closing_time, planning_day, coaching_intensity, notify_deadline_alerts, notify_overdue_alerts. Form simples com toggle switches e radio cards.

---

### Tela 7 — Histórico

**Role:** Todos · **Sprint:** 1 (ampliada Sprint 3)

Últimos 30 dias do colaborador. **3 KPIs:** Tarefas (X/Y%), Compromissos (N), Dias ativos (N/30). Lista de dias com dot semântico de aderência (idle/briefed/low/mid/good).

---

### Tela 8 — Pessoa-Detalhe `/time/:id`

**Role:** Coordenador, Diretor · **Sprint:** 6

Header: avatar, nome, role, function_title, telefone mascarado. **3 KPIs:** Tarefas abertas, Compromissos hoje, Rituais enviados 7d. Bloco Tarefas pendentes (read-only), bloco Compromissos próximos 7 dias (read-only), faixa visual de aderência ritual (7 dots por dia).

**Privacidade:** query de `ritual_logs` seleciona apenas `reference_date, ritual_type, status` — nunca `response_text`. Collaborator comum acessando por URL direta é redirecionado.

---

## Tela 9 — Project Wizard `/projetos/novo` (Sprint 8 — planejada)

**Role:** Todos (com gate de aprovação para colaborador comum)

**Conceito:** wizard multi-step que replica o fluxo 5W2H do TOM no PWA, transformando cada pergunta da skill `cadastro-projeto-5w2h.md` em uma tela visual com progresso.

### Estrutura

```
┌─────────────────────────────────────────┐
│  ← Novo projeto             1/4         │
│  ▓▓▓▓░░░░░░░░░░░░░░░░░░                 │  ← progresso visual
└─────────────────────────────────────────┘
```

### Passo 1 — Identidade (1/4)

| Campo | Tipo | Validação |
|---|---|---|
| Nome do projeto (`name`) | text input | obrigatório, 3-100 chars |
| Por que esse projeto existe? (`justification`) | textarea | obrigatório, 10+ chars |

CTA: **Continuar →**

### Passo 2 — Tempo e local (2/4)

| Campo | Tipo | Validação |
|---|---|---|
| Onde vai acontecer? (`location`) | select (campo_grande / recreio / barra / online / outro) | obrigatório |
| Início (`start_date`) | date picker | obrigatório, ≥ hoje |
| Fim previsto (`end_date`) | date picker | obrigatório, > start_date |

CTA: **← Voltar** | **Continuar →**

### Passo 3 — Pessoas e método (3/4)

| Campo | Tipo | Validação |
|---|---|---|
| Quem vai participar? (`description`) | textarea | obrigatório |
| Como vai executar? (`methodology`) | textarea | obrigatório |
| Horas por semana (`estimated_hours_week`) | number input | opcional, 0-80 |

CTA: **← Voltar** | **Continuar →**

### Passo 4 — Confirmação (4/4)

Resumo visual de todos os campos preenchidos + escolha de categoria:

| Categoria | Quando usar |
|---|---|
| `pedagogical` | Aulas, currículo, formação |
| `commercial` | Vendas, marketing, captação |
| `administrative` | Processos internos, RH |
| `operational` | Operação diária da escola |
| `event` | Sarau, masterclass, apresentação |
| `infrastructure` | Reforma, equipamento, sistema |

CTA: **← Voltar** | **Criar projeto** (verde)

### Tela final

```
┌─────────────────────────────────────────┐
│              ✅                         │
│     Projeto criado!                     │
│                                          │
│  Sarau de Violinos                      │
│  📅 01/jun → 30/jul/2026                │
│  📍 Recreio · 5h/sem                    │
│                                          │
│  O TOM já foi notificado e vai          │
│  começar a distribuir as tarefas.       │
│                                          │
│  [Ver projeto]  [Criar outro]           │
└─────────────────────────────────────────┘
```

### Gate de permissão

- **Coordinator / Director:** projeto entra com `requires_approval=false`, status `planning` → engine inicia distribuição de tarefas
- **Collaborator comum:** projeto entra com `requires_approval=true`, status `planning` → engine notifica supervisor (`supervisor_id`) via WhatsApp para aprovação

### Integração com engine

Após INSERT bem-sucedido em `projects`:
1. PWA dispara POST para webhook do engine: `/internal/project-created` com `{ project_id, created_by }`
2. Engine processa equivalente a `<<PROJECT_CREATE>>`: cria checkpoints iniciais, envia mensagem WhatsApp ao criador, notifica supervisor se `requires_approval=true`

### Schema

Tabela `projects` já cobre os 7 campos do 5W2H. Mudanças:

- Adicionar coluna `requires_approval boolean DEFAULT false`
- Adicionar RLS policy `auth_insert_own_projects` permitindo INSERT a qualquer authenticated com `created_by = current_collab_id()`

### Privacidade

- Wizard só permite criar projeto para si mesmo (`created_by = self`)
- Collaborator comum não pode atribuir projeto a outro
- Coord/director pode adicionar membros depois via tela de Projeto Detalhe (mantém comportamento existente)

### Referências

- Skill backend: `skills/cadastro-projeto-5w2h.md`
- Documentação arquitetural: `docs/PROJECT-WIZARD.md`
- Schema: `docs/03-esquema-banco-dados-la-organizer.md` (tabela `projects`)

---

## Auth — Magic Link via WhatsApp

**Fluxo:**
1. Usuário acessa PWA → tela de login
2. Digita número de WhatsApp
3. TOM envia código OTP via WhatsApp (Edge Function `send-magic-link`)
4. Usuário digita código → autenticado com session JWT
5. Role carregada do banco (`collaborators.role`)

**Sem senha. Sem cadastro manual.** Fallback de email/password disponível em caso de falha do WhatsApp.

---

## Princípios de design

- **Mobile-first:** layout pensado para 375px, funciona em desktop
- **Dark mode padrão:** paleta dark com opção light coerente
- **Privacidade por design:** pessoal nunca vaza para coordenador
- **Espelho, não duplicata:** lógica de negócio fica no TOM/engine, o PWA só exibe e dispara ações estruturadas (markers via webhook quando aplicável)
- **Wizard antes de formulário:** para fluxos formativos (Project Wizard), passos guiados visualmente >>> formulário denso

---

## Tecnologia

| Camada | Escolha |
|---|---|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| PWA | vite-plugin-pwa |
| Estilização | Tailwind CSS + tokens CSS vars |
| Estado | TanStack Query + Context |
| Backend | Supabase (em produção) |
| Auth | Supabase Auth + magic link WhatsApp |
| Deploy | **Vercel** (`la-organizer.vercel.app`) |
| Hosting backend TOM | VPS (89.116.73.186, nginx + PM2) |

---

## O que muda v3.0 → v3.1

| Item | v3.0 | v3.1 |
|---|---|---|
| Total de telas | 16 (priorizadas) | 9 em produção + Project Wizard planejada |
| Status | Sprint 0 sendo planejada | Sprints 0→7 em produção |
| Project Wizard | Não previsto | **Tela 9 — `/projetos/novo` (Sprint 8)** |
| Persona criadora de projeto | Apenas coord/director | **Todos (com gate de aprovação)** |
| Hosting | A decidir | Vercel decidido (`la-organizer.vercel.app`) |
| Pessoa-Detalhe | Fase 2+ | Entregue Sprint 6 |
| EditEventSheet | Não previsto | Entregue Sprint 5 |
