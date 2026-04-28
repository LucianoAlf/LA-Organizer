# Mapa de Telas do PWA — LA Organizer

**Documento:** 05
**Versão:** 3.0
**Data:** 27 de abril de 2026
**Plataforma:** PWA mobile-first (React/TypeScript)
**Design:** Dark mode padrão, opção light mode

---

## Estrutura de navegação

### Bottom Navigation (4 tabs fixos)

| Tab | Ícone | Label | Tela principal |
|---|---|---|---|
| 1 | Círculo preenchido | Hoje | Visão do dia atual |
| 2 | Calendário | Semana | Visão semanal |
| 3 | Play/Seta | Projetos | Projetos e roadmap |
| 4 | Menu/Mais | Mais | Checklists, Emusys, configurações, histórico |

### Navegação por role

| Tela | Colaborador | Coordenador | Diretor | MVP |
|---|---|---|---|---|
| Hoje | ✓ | ✓ | ✓ | ✅ P0 |
| Semana | ✓ | ✓ | ✓ | ✅ P0 |
| Projetos (lista) | ✓ | ✓ | ✓ | ✅ P0 |
| Projeto detalhe | ✓ | ✓ | ✓ | ✅ P0 |
| Dashboard do time | — | ✓ | ✓ | ✅ P0 |
| Configurações | ✓ | ✓ | ✓ | ✅ P1 |
| Histórico | ✓ | ✓ | ✓ | ✅ P1 |
| Hábitos pessoais | ✓ | ✓ | ✓ | 📌 Fase 2+ |
| Checklists operacionais | ✓ | ✓ | ✓ | 📌 Fase 2+ |
| Agenda Emusys | ✓ (professor) | — | — | 📌 Fase 5 |
| Pessoa detalhe | — | ✓ | ✓ | 📌 Fase 2+ |
| Aderência geral | — | ✓ | ✓ | 📌 Fase 3 |
| Gestão de checklists | — | ✓ | ✓ | 📌 Fase 2+ |
| Broadcast | — | ✓ | ✓ | 📌 Fase 2+ |
| Dashboard executivo | — | — | ✓ | 📌 Fase 3 |
| Todos os projetos | — | ✓ | ✓ | 📌 Fase 2+ |

---

## Sprint 0 — MVP do PWA

**Objetivo:** fundação técnica + 5 telas núcleo com dados reais do Supabase.

### O que entra no Sprint 0

1. Setup: React + TypeScript + PWA manifest + auth magic link WhatsApp
2. Layout base: bottom nav, header com role, tema dark/light
3. Role gating visual
4. **Tela: Hoje**
5. **Tela: Semana**
6. **Tela: Projetos (lista)**
7. **Tela: Projeto detalhe**
8. **Tela: Dashboard do time** (coordenador — dados já existem no banco)

### O que fica depois do Sprint 0

- Hábitos visuais
- Checklists operacionais interativos
- Broadcast no PWA
- Aderência geral detalhada
- Pessoa detalhe profunda
- Dashboard executivo completo
- Agenda Emusys

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
│  ●  Hoje   │ 📅 Semana  │ ▶ Projetos │  ≡  Mais  │
└────────────┴────────────┴────────────┴────────────┘
```

---

## Telas do MVP — detalhamento

---

### Tela 1 — Hoje (P0)

**Role:** Todos

**Conteúdo:**
- Header com saudação + data
- Bloco de tarefas do dia (context=work, ordenado por Eisenhower)
- Checkbox interativo por tarefa
- Badge de atraso (🔴) e prazo próximo (⏳)
- Seção de tarefas pessoais (context=personal) — visível só para o próprio colaborador
- Estado vazio: "Sem tarefas hoje. Bora planejar?"

**Ações:**
- Ticar tarefa (chama endpoint → marca done no banco)
- Criar tarefa rápida (modal simples)
- Ver detalhe da tarefa

**Dados do banco:**
```sql
SELECT * FROM tasks
WHERE assigned_to = $user_id
  AND scheduled_date = today
ORDER BY eisenhower_quadrant, due_date;
```

---

### Tela 2 — Semana (P0)

**Role:** Todos

**Conteúdo:**
- Navegador de semana (← semana atual →)
- 5 colunas (seg a sex) com tarefas por dia
- Indicador de carga por dia
- Tarefas arrastáveis entre dias (reagendar)
- Domingo: planejamento semanal em destaque

**Dados do banco:**
```sql
SELECT * FROM tasks
WHERE assigned_to = $user_id
  AND scheduled_date BETWEEN $week_start AND $week_end
ORDER BY scheduled_date, eisenhower_quadrant;
```

---

### Tela 3 — Projetos — Lista (P0)

**Role:** Todos (cada um vê os seus)

**Conteúdo:**
- Lista de projetos ativos com:
  - Nome
  - Badge de categoria (cor)
  - Progress bar (progress_percent)
  - Próximo checkpoint
  - Status

**Coordenador/Diretor vê também:**
- Todos os projetos que supervisiona
- Filtro por unidade

**Ações:**
- Abrir projeto detalhe
- Criar novo projeto (→ abre fluxo 5W2H ou redireciona pro TOM)

---

### Tela 4 — Projeto Detalhe (P0)

**Role:** Todos (com visibilidade por role)

**Conteúdo:**
- Header: nome, categoria, status, progresso
- Timeline de checkpoints com status
- Lista de tarefas do projeto
- Membros da equipe (sem dado pessoal)
- Histórico de atividade recente

**Ações:**
- Ticar checkpoint
- Criar tarefa no projeto (coordenador+)
- Ver membros

---

### Tela 5 — Dashboard do Time (P0 — Coordenador/Diretor)

**Role:** Coordenador, Diretor

**Conteúdo:**
- Resumo do dia do time (dados do team_summary já gerado pelo TOM às 19h30)
- Taxa de conclusão por pessoa
- Alertas de atraso
- Quem respondeu / quem não respondeu rituais
- Projetos em risco

**Dados do banco:**
- Usa dados já calculados pelo dispatcher
- Sem chamada Claude — só leitura

**Privacidade:**
- Só tasks.context = 'work'
- Nunca hábitos, pessoal ou memória

---

### Tela 6 — Configurações (P1)

**Role:** Todos

**Conteúdo:**
- Horários (briefing, fechamento, planejamento)
- Intensidade de cobrança (leve/normal/duro)
- Notificações
- Perfil básico

**Dados:** user_preferences

---

### Tela 7 — Histórico (P1)

**Role:** Todos

**Conteúdo:**
- Dias anteriores com taxa de conclusão
- Gráfico simples de aderência
- Tarefas concluídas por período

---

### Tela 8 — Pessoa-Detalhe (P1 — Coordenador/Diretor) — Sprint 6

**Rota:** `/time/:id`
**Role:** apenas `coordinator` e `director` (guard via `<ProtectedRoute requireRoles>`); RLS faz a defesa em profundidade.

**Acesso:** tap em qualquer badge de colaborador no DashboardTime ou no bloco "Compromissos hoje".

**Conteúdo:**
- **Header**: avatar/inicial, nome completo, role (capitalizado), `function_title`, telefone mascarado (`••••XXXX`). Botão "voltar" pra `/time`.
- **3 KPIs em row**:
  - Tarefas abertas (count de tasks `work` `not in (done, cancelled)`)
  - Compromissos hoje (count de events `work` cujo `start_at` é hoje SP)
  - Rituais enviados 7d (count de `ritual_logs.status='sent'` últimos 7 dias)
- **Bloco "Tarefas em aberto · trabalho"** — `TaskRow` em modo `readOnly` (sem checkbox, sem reschedule). Limit 20.
- **Bloco "Próximos 7 dias · compromissos"** — `EventRow` sem `onClick` (já é read-only por design). Limit 10.
- **Bloco "Rituais enviados · últimos 7 dias"** — faixa visual de 7 dots: verde se houve `sent`, neutro se fim de semana, warning se dia útil sem envio. Subtítulo deixa explícito que é métrica de envio do TOM, não de aderência real.

**Privacidade explícita:**
A métrica "Rituais enviados (7d)" mede operação do TOM (entregue/não entregue), não comportamento do colaborador. **Aderência real** (responder o briefing) exige outra métrica (contagem em `conversation_history` ou flag em `ritual_logs.responded_at`/`response_text`) e fica para sprint futura.

A query usada na tela seleciona apenas `reference_date, ritual_type, status` de `ritual_logs`. Conteúdo de resposta (`detail` ou similar) **nunca** é exposto ao cliente, mesmo que `auth_read_ritual_logs_coord` permita coord ler tudo. Proteção via call-site.

**Fora desta tela (deferido):**
- Editar tasks/events de outro colaborador
- Mensagem direta ou broadcast para o colaborador
- Conteúdo de `conversation_history` ou `collaborator_memory`
- Métricas de aderência real (resposta ao briefing)
- Histórico estendido (>7d) ou filtros avançados

---

## Auth — Magic Link via WhatsApp

**Fluxo:**
1. Usuário acessa PWA → tela de login
2. Digita número de WhatsApp
3. TOM envia link mágico
4. Usuário clica → autenticado com session JWT
5. Role carregada do banco (`collaborators.role`)

**Sem senha. Sem cadastro manual.**

---

## Princípios de design

- **Mobile-first:** layout pensado para 375px, funciona em desktop
- **Dark mode padrão:** paleta dark com opção light
- **Privacidade por design:** pessoal nunca vaza para coordenador
- **Espelho, não duplicata:** lógica de negócio fica no TOM/engine, o PWA só exibe e dispara ações simples
- **Offline-first:** telas de leitura funcionam com cache; ações de escrita precisam de conexão

---

## Tecnologia

| Camada | Escolha |
|---|---|
| Framework | React + TypeScript |
| Build | Vite |
| PWA | vite-plugin-pwa |
| Estilização | Tailwind CSS |
| Estado | Zustand ou React Query |
| Backend | Supabase (já em produção) |
| Auth | Supabase Auth + magic link |
| Deploy | Vercel ou Netlify |

---

## O que muda do mapa v2.0 para v3.0

| Item | v2.0 | v3.0 |
|---|---|---|
| Total de telas | 16 (todas simultâneas) | 16 (priorizadas: 7 no MVP) |
| Marcação de prioridade | Não tinha | P0 / P1 / Fase 2+ / Fase 3 / Fase 5 |
| Sprint 0 definida | Não | Sim — 5 telas núcleo |
| Auth | Descrita genérica | Magic link WhatsApp definido |
| Tech stack | React/TS mencionado | Stack completa definida |
| Dashboard do time | Fase futura | P0 — dados já existem no banco |
