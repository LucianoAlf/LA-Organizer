# Auditoria PWA LA Organizer — Pré Versão Desktop

**Data:** 2026-05-21
**Auditor:** Claude Opus 4.7 (1M context)
**Objetivo:** Raio-x completo do estado atual do PWA mobile (React + Vite + TS) antes do Alf começar a desenvolver a versão desktop. O PRD/roadmap oficial parou no Sprint 14 (com nota de update até Sprint 26), mas o código está em ~Sprint 27+. Este relatório é a fonte da verdade ao vivo.

---

## 1. Visão geral

| Métrica | Valor |
|---|---|
| **LOC (.ts + .tsx em `web/src`)** | **36.583 linhas** |
| **Telas** (`web/src/screens/*.tsx`, recursivo) | **75 arquivos** (incluindo sub-componentes de inventário/laeduca/lajourney) |
| **Telas top-level** (rotas reais) | **38 telas** |
| **Componentes reutilizáveis** (`web/src/components/`) | **81 arquivos** |
| **Hooks customizados** (`web/src/hooks/`) | **22 hooks** |
| **Libs/services** (`web/src/lib/`) | **22 arquivos** |
| **Contextos React** (`web/src/contexts/`) | **2** (Auth, Theme) |
| **SVGs próprios** | **10 logos LA Music** (light/dark × completa/solo × normal/vazada) + favicon + `la-logo-bg.svg` |

### Stack — `package.json`

| Pacote | Versão |
|---|---|
| `react` / `react-dom` | `^18.3.1` |
| `react-router-dom` | `^6.27.0` |
| `@tanstack/react-query` | `^5.59.0` |
| `@supabase/supabase-js` | `^2.45.0` |
| `tailwindcss` | `^3.4.14` |
| `vite` | `^5.4.10` |
| `vite-plugin-pwa` | `^0.20.5` |
| `@vitejs/plugin-react-swc` | `^3.7.1` |
| `typescript` | `^5.6.3` |
| `lucide-react` | `^0.453.0` |
| `@dnd-kit/core` + `sortable` + `utilities` | `^6.3.1` / `^10.0.0` / `^3.2.2` |
| `canvas-confetti` | `^1.9.4` (celebrações de checkpoint) |
| `formidable` + `sharp` | upload de imagem (Vercel functions) |
| `@vercel/node` | `^5.8.2` (proxy serverless `/api/lareport/*`) |

**Observação:** Sem react-router lazy routes — TODAS as rotas importadas de cabeça no `App.tsx`. Bundle é provavelmente bem grande.

---

## 2. Lista completa de rotas

Todas as rotas vivem em `web/src/App.tsx`. Não há router secundário. **Nenhuma rota usa lazy loading** (todos `import` estáticos no topo).

| Path | Componente | Acesso | Lazy? |
|---|---|---|---|
| `/login` | `Login` | aberto | não |
| `/` | redirect → `/hoje` | sessão obrigatória | não |
| `/hoje` | `Hoje` | sessão obrigatória | não |
| `/semana` | `Semana` | sessão obrigatória | não |
| `/projetos` | `Projetos` | sessão obrigatória | não |
| `/projetos/novo` | `NovoProjeto` (wizard focado, sem BottomNav) | sessão obrigatória | não |
| `/projetos/:id` | `ProjetoDetalhe` | sessão obrigatória | não |
| `/mais` | `Mais` | sessão obrigatória | não |
| `/configuracoes` | `Configuracoes` | sessão obrigatória | não |
| `/historico` | `Historico` | sessão obrigatória | não |
| `/habitos` | `Habitos` | sessão obrigatória | não |
| `/habitos/:id` | `HabitoDetalhe` | sessão obrigatória | não |
| `/checklists` | `Checklists` | sessão obrigatória | não |
| `/mais/perfil` | `MeuPerfil` | sessão obrigatória | não |
| `/mais/agenda-escolar` | `AgendaEscolar` | sessão obrigatória | não |
| `/mais/eventos/:id` | `EventoDetalhe` | sessão obrigatória | não |
| `/mais/gestao-equipe` | `GestaoEquipe` | director / coordinator / manager | não |
| `/mais/gestao-equipe/novo` | `GestaoEquipeNovo` | director / coordinator / manager | não |
| `/mais/gestao-equipe/:id` | `GestaoEquipeDetalhe` | director / coordinator / manager | não |
| `/mais/comunicados` | `Comunicados` | director / coordinator | não |
| `/mais/comunicados/:id` | `ComunicadoDetalhe` | director / coordinator | não |
| `/mais/agenda-escolar/equipe` | `ConfigurarEquipe` | director / coordinator | não |
| `/mais/observabilidade` | `Observabilidade` | director / coordinator | não |
| `/mais/operacoes` | `OperacoesFilaTecnica` | director / coordinator / manager | não |
| `/mais/operacoes/:id` | `OperacaoDetalhe` | director / coordinator / manager | não |
| `/la-educa` | `LaEducaListaPage` | qualquer autenticado (RLS filtra) | não |
| `/la-educa/novo` | `LaEducaCadastroPage` | coordinator / director | não |
| `/la-educa/admin` | `LaEducaAdminTrilhaPage` | coordinator / director | não |
| `/la-educa/:id` | `LaEducaEstagiarioDetalhePage` | qualquer autenticado | não |
| `/la-educa/:id/:pilar` | `LaEducaPilarPage` | qualquer autenticado | não |
| `/la-journey` | `LaJourneyListaPage` | qualquer autenticado | não |
| `/la-journey/admin` | `LaJourneyAdminPage` | coordinator / director | não |
| `/la-journey/:checkpointId` | `LaJourneyCheckpointPage` | qualquer autenticado | não |
| `/inventario` | `InventarioListaPage` | coordinator / director / manager | não |
| `/inventario/loja` | `LojaHub` | coordinator / director / manager | não |
| `/inventario/loja/produtos` | `ProdutosPage` | coordinator / director / manager | não |
| `/inventario/loja/historico` | `HistoricoPage` | coordinator / director / manager | não |
| `/inventario/loja/reservas` | `ReservasPage` | coordinator / director / manager | não |
| `/inventario/sala/:salaId` | `InventarioSalaPage` | coordinator / director / manager | não |
| `/time` | `DashboardTime` | coordinator / director | não |
| `/time/:id` | `PessoaDetalhe` | coordinator / director | não |
| `/mais/aderencia-checklists` | `AderenciaChecklists` | director / manager | não |
| `/mais/aderencia-checklists/:id` | `AderenciaChecklistDetalhe` | director / manager | não |
| `*` | redirect → `/hoje` | — | — |

**Wrapper de proteção único:** `<ProtectedRoute requireRoles={[...]} />` (em `components/ProtectedRoute.tsx`). Sem role autorizado, redireciona pra `/hoje` (no-op visual, evita 403 explícito).

---

## 3. Inventário de telas

### Agenda (núcleo diário)
| Arquivo | Descrição |
|---|---|
| `screens/Hoje.tsx` | Tela principal de tarefas/eventos/hábitos do dia. Default ao logar. |
| `screens/Semana.tsx` | Visão de 7 dias com progresso. Compartilha `AgendaTabs` com Hoje. |
| `screens/Historico.tsx` | Aderência dos últimos 30 dias (trabalho). |

### Projetos
| Arquivo | Descrição |
|---|---|
| `screens/Projetos.tsx` | Lista de projetos do colaborador + drag-and-drop de cards. |
| `screens/NovoProjeto.tsx` | Wizard 5W2H espelhado da skill `cadastro-projeto-5w2h` do TOM (rota focada — sem BottomNav). |
| `screens/ProjetoDetalhe.tsx` | Detalhe c/ checkpoints como containers das tasks. Tabs (Tasks, Members, Runbook). |

### Hábitos & Checklists
| Arquivo | Descrição |
|---|---|
| `screens/Habitos.tsx` | Lista de hábitos com heatmap 30d + streak ring por hábito. |
| `screens/HabitoDetalhe.tsx` | Detalhe de um hábito (séries, regras). |
| `screens/Checklists.tsx` | Operacionais (template do cargo) + listas pessoais. |

### Comunicados
| Arquivo | Descrição |
|---|---|
| `screens/Comunicados.tsx` | Painel admin de comunicados (criar, agendar, anexos). |
| `screens/ComunicadoDetalhe.tsx` | Detalhe c/ status de leitura por destinatário. |
| `screens/Observabilidade.tsx` | Aprovações e métricas de envio dos comunicados. |

### Coordenação / Time
| Arquivo | Descrição |
|---|---|
| `screens/DashboardTime.tsx` | Visão de coordenação (só trabalho), por unidade. |
| `screens/PessoaDetalhe.tsx` | Drill-down em um colaborador. |
| `screens/AderenciaChecklists.tsx` | (Sprint 22.37) Aderência operacional por colaborador. |
| `screens/AderenciaChecklistDetalhe.tsx` | Detalhe de aderência por item. |
| `screens/GestaoEquipe.tsx` | (Sprint 23.6) Painel admin de colaboradores. |
| `screens/GestaoEquipeNovo.tsx` | Cadastro de novo colaborador. |
| `screens/GestaoEquipeDetalhe.tsx` | Edição (dados pessoais, role, unidade). |

### Agenda LA Music (institucional)
| Arquivo | Descrição |
|---|---|
| `screens/AgendaEscolar.tsx` | Calendário institucional (Sprint 26 v2). |
| `screens/EventoDetalhe.tsx` | Detalhe de evento (participantes, runbook). |
| `screens/ConfigurarEquipe.tsx` | Configura quem é envolvido em quais eventos. |

### Operações
| Arquivo | Descrição |
|---|---|
| `screens/OperacoesFilaTecnica.tsx` | Fila de demandas operacionais por departamento. |
| `screens/OperacaoDetalhe.tsx` | Detalhe de uma demanda. |

### Onboarding / Perfil / Auth
| Arquivo | Descrição |
|---|---|
| `screens/Login.tsx` | Magic link via WhatsApp (sendMagicLink → verifyMagicCode) + senha legada. |
| `screens/MeuPerfil.tsx` | Bio, apelido, info que o TOM usa. |
| `screens/Configuracoes.tsx` | Horários e intensidade do TOM no WhatsApp. |
| `components/OnboardingWizard.tsx` | (Não é rota — fullscreen) 4 telas no primeiro acesso. |

### Inventário (módulo bidirecional)
| Arquivo | Descrição |
|---|---|
| `screens/inventario/ListaPage.tsx` | Lista de salas por unidade. |
| `screens/inventario/SalaPage.tsx` | Itens da sala + ações (baixa, manutenção, transferência). |
| `screens/inventario/LojaHub.tsx` | Hub da lojinha (produtos, reservas, histórico). |
| `screens/inventario/ProdutosPage.tsx` | CRUD de produtos. |
| `screens/inventario/ReservasPage.tsx` | Reservas pendentes. |
| `screens/inventario/HistoricoPage.tsx` | Histórico de vendas. |
| `screens/inventario/components/*` | 22 sub-componentes (sheets, cards, FAB, etc.) — todos mobile-first. |

### LA EDUCA (estagiários)
| Arquivo | Descrição |
|---|---|
| `screens/laeduca/ListaPage.tsx` | Lista de estagiários (RLS filtra por mentor). |
| `screens/laeduca/CadastroEstagiarioPage.tsx` | Novo estagiário (coord/director). |
| `screens/laeduca/EstagiarioDetalhePage.tsx` | Visão do estagiário com 4 pilares. |
| `screens/laeduca/PilarAvaliacaoPage.tsx` | Avaliação de checkpoints de um pilar (DnD). |
| `screens/laeduca/AdminTrilhaPage.tsx` | Admin da trilha (P1-P4 com checkpoints). |

### LA Journey (jornada pedagógica do aluno)
| Arquivo | Descrição |
|---|---|
| `screens/lajourney/ListaPage.tsx` | Lista de checkpoints por programa. |
| `screens/lajourney/CheckpointPage.tsx` | Detalhe de um checkpoint (radial, consolidação, aprendizado). |
| `screens/lajourney/AdminPage.tsx` | Admin de marcos/checkpoints. |

---

## 4. Componentes reutilizáveis (`web/src/components/`)

### Design System (primitivos)
| Componente | Descrição |
|---|---|
| `Button.tsx` | Botão DS (variantes primary/secondary/ghost). |
| `Field.tsx` | Wrapper de label/erro pra inputs. |
| `Fab.tsx` | Floating Action Button (canto inferior direito). |
| `BottomSheet.tsx` | Sheet ascendente mobile-first — padrão de criação/edição. |
| `CustomSelect.tsx` | Select customizado (popover) com busca. |
| `DateInput.tsx` | Campo único DD/MM/AAAA + popover de calendário (v2). |
| `TimeInput.tsx` | Campo único HH:MM + popover de lista (30min steps). |
| `DateTimeInput.tsx` | Composição de Date + Time. |
| `Checkbox.tsx` | Checkbox quadrado custom. |
| `TaskCheckbox.tsx` | Checkbox redondo para tasks. |
| `Badge.tsx` | Badge genérico (em breve / beta / count). |
| `Card.tsx` | Container surface com sombra. |
| `Tabs.tsx` | Tabs com sublinha animada. |
| `AgendaTabs.tsx` | Segmented control iOS-style (Hoje ↔ Semana, persiste entre rotas). |
| `ChipFilterRow.tsx` | Linha de chips horizontal (filtros). |
| `UnitFilterChips.tsx` | Filtro de unidade. |
| `UnidadeChip.tsx` | Chip individual de unidade. |
| `Toast.tsx` | Sistema de toast (canto inferior direito) + `ToastHost`. |
| `ConfirmDialog.tsx` | Modal de confirmação. |
| `LoadingState.tsx` | Spinner full-screen / inline. |
| `ErrorState.tsx` | Tela de erro. |
| `EmptyState.tsx` / `EmptyDay.tsx` | Empty states. |

### Layout / Shell
| Componente | Descrição |
|---|---|
| `AppShell.tsx` | Shell raiz (Header + main + BottomNav). |
| `Header.tsx` | Header com avatar, menu (perfil, troca tema, logout, password). |
| `BottomNav.tsx` | Bottom nav mobile + top-rail desktop (md+). |
| `PageHeader.tsx` | Título + back + right slot (padrão de telas internas). |
| `ProtectedRoute.tsx` | Route guard com role check. |
| `PWAInstallPrompt.tsx` / `PWAUpdatePrompt.tsx` | Service Worker UX. |
| `LogoMark.tsx` | Logo LA Music. |

### Tasks / Eventos / Hábitos
| Componente | Descrição |
|---|---|
| `TaskRow.tsx` | Task como card individual (Sprint 22.29). |
| `TaskListItem.tsx` | Variante list-item de task. |
| `EditTaskSheet.tsx` | Sheet de edição completa de task. |
| `QuickTaskSheet.tsx` / `QuickCreateSheet.tsx` | Criação rápida. |
| `EventoSheet.tsx` / `EditEventSheet.tsx` / `EventRow.tsx` / `EventTaskSheet.tsx` | Eventos. |
| `EditHabitSheet.tsx` | CRUD de hábitos. |
| `HabitsHeatmap.tsx` | Heatmap GitHub-style. |
| `StreakRing.tsx` | Anel SVG de streak. |
| `RescheduleSheet.tsx` | Reagendamento. |
| `EisenhowerPicker.tsx` | Picker Tarefa/Compromisso. |
| `ActionTypeBadge.tsx` | Badge de tipo de ação. |
| `CategoryTag.tsx` | Tag de categoria. |
| `TimeWindowChips.tsx` | Janelas (manhã/tarde/noite). |
| `AssigneePicker.tsx` | Dropdown inline de atribuição. |
| `ParticipantsPicker.tsx` | Multi-select para compromissos. |
| `MemberPicker.tsx` | Picker de membros (NovoProjeto). |

### Projetos
| Componente | Descrição |
|---|---|
| `ProjectCard.tsx` | Card com CRUD inline + DnD. |
| `ProjectHeader.tsx` | Header do projeto. |
| `MembersTab.tsx` | Aba de membros do projeto. |
| `RunbookTab.tsx` | Aba de runbook. |
| `RowMenu.tsx` | Menu kebab para linhas. |
| `Summary.tsx` | Summary do wizard NovoProjeto. |

### Checklists / Aderência
| Componente | Descrição |
|---|---|
| `ChecklistCard.tsx`, `ChecklistItemRow.tsx`, `ChecklistItemEditRow.tsx`, `ChecklistAddItemForm.tsx`, `ChecklistTemplateSheet.tsx` | Family de checklists. |
| `PersonalChecklistCard.tsx`, `PersonalChecklistSheet.tsx` | Listas pessoais. |
| `AdherenceCard.tsx`, `TemplateBreakdownCard.tsx`, `TemplateCard.tsx` | Aderência. |
| `CollabHeaderCard.tsx` | Header com info do colaborador. |
| `TeamSummaryCard.tsx` | Summary do time. |
| `StatCard.tsx` | Card de KPI neutro. |

### Comunicados / Demandas / Outros
| Componente | Descrição |
|---|---|
| `ComunicadoSheet.tsx` | Sheet de comunicado. |
| `AprovacaoSheet.tsx` | Aprovação. |
| `DemandaSheet.tsx` | Demanda operacional. |
| `ObservationCard.tsx` | Card de observação. |
| `HubCard.tsx` | Card de hub (LojaHub etc.). |
| `DateNavHeader.tsx` | Header com chevron + label clicável + picker. |
| `ClienteAutocomplete.tsx` / `ProfessorAutocomplete.tsx` | Autocomplete pra Lojinha. |
| `OnboardingWizard.tsx` | 4 telas de boas-vindas. |

---

## 5. Hooks customizados (`web/src/hooks/`)

| Hook | Descrição |
|---|---|
| `useAccess.ts` | Wrapper do `checkAccess` por `dataType`. Retorna `{ allowed, isCollab, ... }`. |
| `useAdherence.ts` | (Sprint 22.37) Queries da tela de aderência. Estado em URL. |
| `useCreateProject.ts` | Submit do wizard NovoProjeto + notify do TOM engine. |
| `useEventCategories.ts` | Categorias dinâmicas (globais + pessoais) + CRUD. |
| `useInventarioMutations.ts` | Mutations do inventário (baixa, manutenção, transferência, venda). |
| `useInventarioStats.ts` | Stats agregadas de inventário por unidade. |
| `useIsProfessor.ts` | Helper booleano `function_role === 'professor'`. |
| `useLaEducaEstagiario.ts` | Detalhe de um estagiário. |
| `useLaEducaPilares.ts` | Lista pilares (P1-P4). |
| `useLaEducaProgresso.ts` | Progresso por estagiário. |
| `useLaEducaResponsaveis.ts` | Mentores de um estagiário. |
| `useLaEducaTrilhas.ts` | Trilhas (esteira pedagógica). |
| `useLaJourney.ts` | `useJourneyCheckpoints(programa)`. |
| `useLaReport.ts` | Cliente cross-project pro LA Report. |
| `useProjectCheckpoints.ts` | Query + CRUD + reorder. |
| `useProjectContingencies.ts` | Query + CRUD + reorder. |
| `useProjectMembers.ts` | Membros + permissions derivadas. |
| `useProjectTasks.ts` | Query + CRUD + reorder + assign. |
| `useRealtimeSala.ts` | Realtime de uma sala. |
| `useRealtimeSalas.ts` | Realtime de todas salas de uma unidade. |
| `useRealtimeSync.ts` | **Central:** invalida TanStack quando TOM escreve no banco. Sincronia WhatsApp ↔ PWA. |
| `useUnidadeSelecionada.ts` | Seleção de unidade (localStorage + URL). |

---

## 6. Libs / Services (`web/src/lib/`)

### Clientes Supabase
- **`supabase.ts`** — Cliente Supabase principal (`la-organizer` project).
- **`lareport-client.ts`** — Cliente Supabase direto ao **LA Report** (project diferente, leituras + realtime).
- **`lareport.ts`** — Cliente HTTP pros endpoints `/api/lareport/*` (Vercel serverless proxy — escritas que precisam de service_role).
- **`lareport-mutations.ts`** — Wrappers fetch pros endpoints de mutation.
- **`lareport-realtime.ts`** — Subscriptions realtime LA Report.
- **`lareport-types.ts`** — Types do schema LA Report (confirmado 2026-05-16).

### Governança / Permissões
- **`access-control.ts`** — Port TS do `la-report-access.js`. Função `checkAccess(collab, dataType)` retorna `{ allowed, unitFilter, scopeFilter, reason }`. **Single source of truth** das regras.
- **`access-rules.json`** — Sincronizado via `npm run sync-rules` (script `../scripts/sync-access-rules.mjs`). **Espelha** `la-report-access-rules.json` do TOM.
- **`roles.ts`** — `ROLE_LABELS`, `ROLE_RANK`, `ROLE_COLOR`, `FUNCTION_TITLES`.

### Realtime
- **`useRealtimeSync.ts`** (hook) — Invalida queries TanStack ao detectar INSERTs do TOM (event_create, task_create, project_create, etc.).

### Domínio
- **`adherence.ts`** — Queries da tela de aderência.
- **`events.ts`** — Lib de eventos (com `category_id` FK).
- **`laeduca.ts`** + `laeduca-types.ts` — Fetchers do LA EDUCA.
- **`lajourney.ts`** + `lajourney-types.ts` — Data layer LA Journey.
- **`onboarding.ts`** — Conteúdo do wizard customizado por `function_title`.
- **`personalChecklists.ts`** — Listas pessoais (Sprint 22.38).
- **`projectLabels.ts`** — Mapeia enums técnicos do banco pra labels humanos.
- **`tomEngine.ts`** — Cliente do endpoint interno do engine TOM (notify pós-INSERT).

### Infra Frontend
- **`queryClient.ts`** — Configuração TanStack Query.
- **`sortableSensors.ts`** — Sensors padronizados pra @dnd-kit.
- **`sortableStyle.ts`** — Estilo "card erguido" pra DnD (Sprint 22.39d).

---

## 7. Layout / Shell atual

### Estrutura
O shell raiz é **`components/AppShell.tsx`**, renderizado dentro do `ProtectedRoute`:

```
<AppShell>
  <Header />                          // sempre visível
  {showAgendaTabs && <AgendaTabs />}  // só em /hoje e /semana
  <main>
    <Outlet />                        // conteúdo da rota
  </main>
  {!focused && <BottomNav />}         // omitido em /projetos/novo
  <PWAUpdatePrompt />
  <PWAInstallPrompt />
  <ToastHost />
</AppShell>
```

### Pontos-chave do shell
- **`max-w-content` (720px)** centralizado horizontalmente — o app **já tem teto de largura**. No desktop fica uma "coluna" centralizada.
- **`max-w-screen` (480px)** existe nos tokens mas é pouco usado.
- **`pb-[88px] md:pb-md`** — padding bottom diferenciado pra dar espaço à BottomNav mobile.
- **Focused flows** (`/projetos/novo`) escondem BottomNav — padrão de wizard fullscreen.
- **`safe-area-inset-bottom`** respeitado (iOS PWA).
- **`useRealtimeSync(collaborator?.id)`** chamado no shell — listener global.
- **`OnboardingWizard` substitui o shell inteiro** quando `!collaborator.onboarding_completed`.

### Header (`components/Header.tsx`)
Composição:
- Saudação (Bom dia / Boa tarde / Boa noite + nome + data por extenso pt-BR/SP)
- Avatar + menu lateral (Perfil, Configurações, Trocar foto, Trocar senha, **toggle dark/light**, Logout)
- Refresh proativo de sessão ao voltar foreground (Sprint 27)

### BottomNav (`components/BottomNav.tsx`)
5 tabs **mobile**:
| Tab | Ícone | Rota | Notas |
|---|---|---|---|
| **Agenda** | `CalendarDays` | `/hoje` | ativa em `/hoje` e `/semana` |
| **Projetos** | `Rocket` | `/projetos` | — |
| **Checklists** | `ClipboardCheck` | `/checklists` | — |
| **Hábitos** | `Sparkles` | `/habitos` | promovido a tab no Sprint 22.11 |
| **Mais** | `Menu` | `/mais` | hub de tudo o resto |

**Desktop (md+)** o mesmo BottomNav vira **top-rail horizontal** (já existe — `hidden md:flex` no JSX), com um item extra "Time" pra coord/director. Mas é só um placeholder — não tem variação real de layout pra desktop em outras telas.

### Sidebar
**Não existe.** Toda navegação secundária está em `/mais`.

---

## 8. Conteúdo da tela `Mais` (`screens/Mais.tsx`)

### Seção "Para você" (todos)
| Label | Rota | Condição |
|---|---|---|
| Agenda LA Music | `/mais/agenda-escolar` | sempre |
| Configurações | `/configuracoes` | sempre |
| Histórico | `/historico` | sempre |

### Seção "Coordenação"
| Label | Rota | Condição |
|---|---|---|
| Dashboard do time | `/time` | coordinator / director |
| Aderência operacional | `/mais/aderencia-checklists` | director / manager |
| Operações | `/mais/operacoes` | director / coordinator / manager |
| Comunicados | `/mais/comunicados` | director / coordinator |
| Observabilidade | `/mais/observabilidade` | director / coordinator |
| Gestão de equipe | `/mais/gestao-equipe` | director / coordinator / manager |

### Seção "Educação" (renderizada se ALGUM item visível)
| Label | Rota | Condição |
|---|---|---|
| LA EDUCA | `/la-educa` | `role in {coordinator, director}` OU `isMentor` (tem estagiários vinculados) |
| LA Journey | `/la-journey` | `role !== 'manager'` |
| Inventário | `/inventario` | `useAccess('inventario').allowed` |
| Lojinha | `/inventario/loja` | `useAccess('loja_produtos').allowed` |

**Header da tela:** mostra `full_name · role · unidade`.

> **Nota:** não há link visível pra `/mais/perfil` aqui — o acesso ao perfil é via o menu do avatar no Header.

---

## 9. Design System / Tokens

### Breakpoints
Tailwind default (`sm`/`md`/`lg`/`xl`/`2xl`) — **nenhum breakpoint customizado** no `tailwind.config.js`. O único breakpoint usado de fato no código é **`md`** (768px), e quase só no BottomNav e no padding do main.

### Cores customizadas
```js
brand: { DEFAULT: '#E91451', shade: '#B01545', deep: '#740A28', light: '#F06292', dark: '#373435' }
tom:   { DEFAULT: '#A3BE50', shade: '#8BA244', deep: '#728538', light: '#BAD179', tint: '#E8F0CF' }
ink:   { 0..1000 } // 12 steps de neutro
success: '#22C55E', warning: '#F59E0B', danger: '#EF4444', info: '#3B82F6', project: '#8B5CF6'
bg:     { app, surface, elevated, subtle }  // via CSS vars
fg:     { DEFAULT, secondary, muted }       // via CSS vars
border: { DEFAULT }                          // via CSS var
```

### Theme tokens (CSS variables em `index.css`)
```css
[data-theme='dark'] (default):
  --bg-app: #0A0A0A; --bg-surface: #141414; --bg-elevated: #1A1A1A; --bg-subtle: #1E1E1E
  --fg-primary: #FFF; --fg-secondary: #CFCFCF; --fg-muted: #9E9E9E
  --border: #2A2A2A

[data-theme='light']:
  --bg-app: #F4F4F4; --bg-surface: #FFF; --bg-elevated: #FFF; --bg-subtle: #E8E8E8
  --fg-primary: #111; --fg-secondary: #424242; --fg-muted: #7A7A7A
  --border: #E0E0E0
```

### Tipografia
- **Família única:** Inter (system-ui fallback). **Não há import de fonte** no CSS — assume disponibilidade local.
- **Escala:** `screen-title` (24px/700), `section-title` (20px/700), `card-title` (18px/600), `body-lg/md/sm`, `label` (12px/700 uppercase).
- **Brand:** `hero` (96px/900), `h1-brand` (56px/900), `h2-brand` (40px/900).
- **`tabular-nums`** utility customizada para listas/stats.

### Spacing & Radius
- Spacing semântico: `xs=4`, `sm=8`, `md=16`, `lg=24`, `xl=32`, `2xl=48`.
- Radius: `sm=10`, `md=16`, `lg=20`, `brand=18`.

### Shadows
- `soft`, `offset-brand`, `card` (light-mode only — dark usa só contraste).

### Max-widths
- `screen: 480px` (mobile lock)
- `content: 720px` (centralizado no AppShell)

### Utilities especiais
- `.surface` — card padrão (rounded-md + border + bg-surface + shadow só light)
- `.halftone-soft` / `.halftone-strong` — pontilhado brand (login/hero)
- `.la-watermark` — gradiente sutil brand
- `.brand-offset` — offset shadow estilo brutalist
- `.focus-ring` — anel padrão de foco
- Scrollbar customizada thin (Sprint 22.34) — Firefox + Webkit

### Assets SVG (em `web/public/`)
- 8 logos LA Music (light/dark × completa/solo × normal/vazada)
- `favicon.svg`, `la-logo-bg.svg`
- `tom-avatar.png`, `Avata-Tom.png`, `og-image.png`, `icon-192.png`, `icon-512.png`

---

## 10. Contextos React

### `contexts/AuthContext.tsx`
- **Provê:** `session`, `collaborator`, `role`, `loading`, `sendMagicLink`, `verifyMagicCode`, `signIn`, `signOut`, `updateProfile`, `refreshCollaborator`, `ensureSession`.
- **Bootstrap:** lê sessão Supabase + subscribe `onAuthStateChange`.
- **Resolve collaborator:** via `session.user.email` (row em `collaborators`).
- **Sprint 27 — Refresh proativo:** `visibilitychange` → `refreshSession()` quando aba volta foreground (PWA fica horas em background).
- **`ensureSession()`:** chamado antes de operações sensíveis pra garantir token + collaborator válidos.
- **Provider montado em:** `main.tsx` (envolve `BrowserRouter`).

### `contexts/ThemeContext.tsx`
- **Provê:** `theme: 'dark' | 'light'`, `toggle()`, `setTheme()`.
- **Default:** `dark` (não respeita `prefers-color-scheme` automaticamente — só localStorage).
- **Side-effects:** seta `document.documentElement.dataset.theme` + `meta[theme-color]` (status bar iOS).
- **Provider montado em:** `main.tsx` (entre `QueryClientProvider` e `AuthProvider`).

---

## 11. Sistema de permissões / governança

### 3 camadas (`collaborators`)
1. **`role`** — Nível de permissão hierárquico
   - `collaborator` (rank 0)
   - `leader` (rank 1)
   - `coordinator` (rank 2)
   - `manager` (rank 3) — escopo por unidade
   - `director` (rank 4) — bypass de qualquer regra
2. **`function_role`** — Função operacional. Valores observados em `access-rules.json`:
   - `ops_tecnicas`, `farmer`, `hunter`, `marketing`, `tech`
   - `backoffice_fin`, `backoffice_rh`, `backoffice_cs`
   - `professor`
3. **`pedagogical_role`** — Papel pedagógico (apenas presença/ausência testada nas regras).

### Regras de acesso por `dataType` (em `lib/access-rules.json`)

**Resolução:** `checkAccess()` em `lib/access-control.ts` — fonte única, port TS do `la-report-access.js`. Director sempre passa. `manager` ganha unit filter quando rule tem `manager_unit: true`. `Krissya` recebe bypass especial em rules com `krissya_all_comercial: true`.

#### RESTRITO
| dataType | Quem tem |
|---|---|
| `faturamento` | director + `backoffice_fin` |
| `valor_parcela` | director + `backoffice_fin` |
| `comissao` | director + `backoffice_fin` |
| `salario` | director + `backoffice_fin`, `backoffice_rh` |
| `ltv` | director + `backoffice_fin` |
| `ticket_medio` | director + `backoffice_fin` |
| `dados_pessoais_rh` | director + `backoffice_rh` |
| `avaliacao_360` | director, coordinator |

#### SENSÍVEL
| dataType | Quem tem |
|---|---|
| `inadimplencia` | director + `backoffice_fin`, `farmer` (unit_filter + manager_unit) |
| `health_score` | director, coordinator + `backoffice_cs`, `farmer` (unit_filter + manager_unit) |
| `whatsapp_aluno` | director, coordinator + `marketing`, `farmer` + pedagógico (unit_filter + manager_unit) |
| `evasao` | director, coordinator + `backoffice_cs`, `farmer` (unit_filter + manager_unit) |
| `renovacao` | director, coordinator + `backoffice_cs`, `farmer`, `hunter` (unit_filter + manager_unit) |
| `performance_prof` | director, coordinator + `farmer` + pedagógico (unit_filter + manager_unit) |
| `leads` | director + `marketing`, `farmer`, `hunter` (unit_filter + manager_unit + krissya_all_comercial) |
| `funil` | director + idem leads |
| `kpis_comerciais` | director + `marketing`, `farmer` (idem + krissya) |
| `experimentais` | director + `marketing`, `farmer`, `hunter` (unit_filter + manager_unit) |
| `valor_patrimonial` | director + `ops_tecnicas`, `backoffice_fin` |

#### ABERTO
| dataType | Quem tem |
|---|---|
| `aluno_cadastro` | director, coordinator + farmer/hunter/backoffice_cs + pedagogico_seus + professor_seus_unidades |
| `aluno_horario` | idem aluno_cadastro |
| `aluno_presenca` | director, coordinator + farmer/backoffice_cs + pedagogico_seus + professor_seus_unidades |
| `contagem_alunos` | director, coordinator, manager + farmer/hunter/backoffice_cs |
| `professor_cadastro` | director, coordinator, manager + ops_tecnicas/farmer/hunter/tech + pedagogico + professor |
| `whatsapp_prof` | **all: true** (todo mundo) |
| `aderencia_emusys` | director, coordinator + farmer + pedagogico + professor_seus_unidades (unit_filter + manager_unit) |
| `salas` | director, coordinator, manager + ops_tecnicas/farmer/tech + pedagogico + professor_seus_unidades |
| `inventario` | director, coordinator + ops_tecnicas/farmer/tech + pedagogico + professor_seus_unidades (unit_filter + manager_unit) |
| `movimentacoes` | director, coordinator + ops_tecnicas/farmer/tech (unit_filter + manager_unit) |
| `loja_produtos` | director + ops_tecnicas/farmer/backoffice_fin (unit_filter + manager_unit) |
| `loja_vendas` | director + ops_tecnicas/farmer/backoffice_fin (unit_filter + manager_unit) |

### Flags especiais nas regras
- **`unit_filter: true`** — restringe ao próprio `collab.unit` quando aplica function_role
- **`manager_unit: true`** — manager ganha acesso filtrado pela unidade dele
- **`pedagogico: true`** — qualquer pedagogical_role passa
- **`pedagogico_seus: true`** — ganha acesso com `scopeFilter: 'seus_alunos'`
- **`professor_seus_unidades: true`** — professor cai em `allowed: false` com reason "sem unidades vinculadas"
- **`professor: true`** — professor passa direto
- **`krissya_all_comercial: true`** — bypass especial pra `full_name === 'Krissya'`
- **`all: true`** — todo autenticado passa

---

## 12. Features que provavelmente NÃO estão no PRD antigo

> O PRD oficial (`docs/06-prd-la-organizer-v3.md`) é de 2026-04-28 e o roadmap parou em Sprint 26 textual. Tudo abaixo é Sprint 22+ ou mais recente.

| Feature | Status | Telas | Tabelas Supabase principais |
|---|---|---|---|
| **Inventário bidirecional** (Salas, itens, pendências, manutenção, transferências, baixas, estornos) | parece **estável** | 6 páginas + 22 sub-componentes em `screens/inventario/` | LA Report: `salas`, `itens_inventario`, `movimentacoes`, `pendencias`, `manutencoes`, `transferencias` |
| **Lojinha** (Produtos, Vendas, Reservas, Histórico, Estornos, Wizard de venda c/ autocompletes) | parece **estável** | `LojaHub`, `ProdutosPage`, `ReservasPage`, `HistoricoPage` + sheets | LA Report: `loja_produtos`, `loja_vendas`, `loja_reservas`, `loja_estornos` |
| **TOM bidirecional** (WhatsApp ↔ PWA via realtime + markers) | **estável crítico** | hook `useRealtimeSync` global no shell | múltiplas — invalida ao detectar markers EVENT_CREATE/TASK_CREATE/etc. |
| **LA EDUCA** (estagiários, 4 pilares, trilhas, checkpoints, avaliação c/ DnD, justificativa modal) | parece **estável** | 5 páginas + 5 sub-componentes em `screens/laeduca/` | `la_educa_estagiarios`, `la_educa_pilares`, `la_educa_trilhas`, `la_educa_checkpoints`, `la_educa_avaliacoes` |
| **LA Journey** (jornada pedagógica do aluno por programa, marcos, radial/consolidação/aprendizado) | em **construção tardia** (admin existe) | 3 páginas + 7 sub-componentes em `screens/lajourney/` | `la_journey_checkpoints`, `la_journey_marcos`, `la_journey_progresso` |
| **Sistema de Projetos completo** (wizard 5W2H, checkpoints como containers, membros, runbook, contingências, DnD, celebrações com confetti) | parece **estável** | `Projetos`, `NovoProjeto`, `ProjetoDetalhe` | `projects`, `project_checkpoints`, `project_tasks`, `project_members`, `project_contingencies` |
| **Operações** (fila técnica de demandas por departamento) | parece **estável** | `OperacoesFilaTecnica`, `OperacaoDetalhe` + `DemandaSheet` | `tasks` (com `department_id`) |
| **Comunicados** (criação, agendamento, anexos, status de leitura, aprovações) | parece **estável** | `Comunicados`, `ComunicadoDetalhe`, `Observabilidade` | `comunicados`, `comunicado_leituras`, `comunicado_anexos` |
| **Observabilidade** (aprovações + métricas de envio de comunicados) | parece **estável** | `Observabilidade` | idem comunicados |
| **Sistema de Aderência de checklists** (Sprint 22.37, painel por colaborador c/ janela em URL) | parece **estável** | `AderenciaChecklists`, `AderenciaChecklistDetalhe` | `checklist_templates`, `checklist_items`, `checklist_completions` |
| **Sistema de governança 3 camadas** (role + function_role + pedagogical_role + access-rules.json) | **estável crítico** | `GestaoEquipe*` (admin) + `useAccess` em todo lugar | `collaborators` + `access-rules.json` |
| **Listas pessoais** (Sprint 22.38) | parece **estável** | embutidas em `Checklists.tsx` | `personal_checklists`, `personal_checklist_items` |
| **Agenda Escolar v2** (Sprint 26, 5 visualizações, CRUD, link c/ Comunicados) | parece **estável** | `AgendaEscolar`, `EventoDetalhe`, `ConfigurarEquipe` | `events`, `event_categories`, `event_participants` |
| **Hábitos com Heatmap + Streak** (Sprint 11 F2+) | parece **estável** | `Habitos`, `HabitoDetalhe` + `HabitsHeatmap`, `StreakRing` | `habits`, `habit_completions` |
| **Magic link via WhatsApp** (Sprint atual — `sendMagicLink` por telefone, `verifyMagicCode` por email) | parece **estável** | `Login` | `collaborators.phone` |
| **PWA install/update prompts** (Sprint 23.7+) | parece **estável** | embutido no shell | — |
| **Onboarding wizard** (4 telas custom por function_title) | parece **estável** | `OnboardingWizard` substitui shell | `collaborators.onboarding_completed` |
| **Dark/Light theme** com CSS vars + meta theme-color iOS | parece **estável** | global | — |
| **Realtime sync com refresh proativo de sessão** (Sprint 27) | parece **estável recente** | global | — |

---

## 13. Recomendações para a versão desktop

> Análise honesta, do que vi no código.

### O que vai ser FÁCIL portar pra desktop
- **Tabelas/listas longas** — `Projetos`, `GestaoEquipe`, `AderenciaChecklists`, `Observabilidade`, `inventario/ProdutosPage`, `lajourney/ListaPage`, `laeduca/ListaPage`: escalam naturalmente com mais largura. Hoje moram dentro de `max-w-content: 720px` — basta liberar pra `max-w-screen-xl` ou similar.
- **Páginas de stats/dashboard** — `Historico`, `DashboardTime`, `inventario/HistoricoPage`: cabem bem em grids 2-3 colunas.
- **Wizards focados** (`NovoProjeto`, `GestaoEquipeNovo`, `LaEducaCadastroPage`) — já são fullscreen sem BottomNav. Vão funcionar em desktop com centralização + max-width.
- **Sistema de tokens (CSS vars)** — Theme dark/light + spacing semântico vão funcionar 1:1.
- **TanStack Query + realtime** — não precisa tocar; só responsividade visual.

### O que vai ser DIFÍCIL
- **`BottomSheet`** — Padrão dominante em todo o app (mais de 20 sheets: `EditTaskSheet`, `EventoSheet`, `DemandaSheet`, `VendaWizardSheet`, `ProdutoFormSheet`, todos os de inventário…). Em desktop precisam virar **modais centrais** OU **side panels** OU **drawers**. Decisão importante: criar um `<Sheet variant="auto">` que escolhe entre bottom (mobile) e center (desktop), ou hard-fork.
- **`Fab`** — Padrão "criar" mobile. No desktop vira botão fixo no header da seção ou Action menu na top-rail.
- **Drill-down profundos** (`Lista → Detalhe → Filho → Detalhe → Filho`) — Comum em projetos e LA EDUCA. Em desktop pede master-detail (split view) ao invés de full-page navigation.
- **`AgendaTabs` segmented control** — Bonito mobile, no desktop pode virar tabs normais ou ir pra sidebar.
- **`PageHeader` com botão back** — Em desktop com sidebar/breadcrumb fica redundante. Decidir entre breadcrumbs ou manter back.
- **`max-w-content: 720px` hardcoded no AppShell** — Está no shell raiz; portar pra desktop exige conditionally widening ou novo shell `<DesktopShell>`.
- **BottomNav transformando em top-rail** — Já existe (`hidden md:flex`) mas é mais "esconder o bottom" do que "sidebar real". Sem opção de sidebar lateral hoje.

### Padrões que precisam ser repensados
1. **Navegação** — Adicionar sidebar persistente (left rail estilo Linear/Notion) com todas as áreas do `Mais` planas. BottomNav existe só pra mobile.
2. **Layout de listas** — Hoje cada tela faz seu container. Padronizar em `<Page>` com layouts `single` / `master-detail` / `dashboard-grid`.
3. **Sheets → Dialogs adaptáveis** — Criar `<AdaptiveSheet>` que vira bottom-sheet em mobile e modal/drawer em desktop. Refatorar incrementalmente.
4. **Onboarding wizard** — Hoje substitui shell inteiro; pode ficar como modal grande em desktop.
5. **Header** — Greeting + data por extenso pode ser muito grande em desktop. Avatar menu pode virar dropdown discreto no canto direito.

### Componentes do DS que vão precisar de variantes desktop
| Componente | Variante necessária |
|---|---|
| `BottomSheet` | `desktop="modal" | "drawer-right"` |
| `Fab` | esconder/converter em CTA na barra de seção |
| `BottomNav` | sidebar real (não só top-rail) |
| `PageHeader` | breadcrumb mode |
| `AppShell` | criar `DesktopShell` ou flag `layout="desktop"` |
| `TaskRow` | row-mode mais denso (menos padding, mais info inline) |
| `ProjectCard` | grid responsivo (1 / 2 / 3 colunas) |
| `Tabs` | tabs no topo OU vertical na sidebar |
| `AgendaTabs` | converter pro padrão geral de tabs em desktop |
| `Toast` | reposicionar (top-right é mais comum em desktop) |

### Sugestão de breakpoint principal
Hoje o código usa **só `md` (768px)**, e mesmo assim só pra BottomNav. Recomendo:
- **`md` (768px)** — começa a esconder o BottomNav, ativa sidebar colapsada
- **`lg` (1024px)** — **breakpoint principal de "desktop mode"** — sidebar expandida + multi-coluna + sheets viram modais
- **`xl` (1280px)** — opção de master-detail em listas
- **`2xl` (1536px)** — limite máximo do conteúdo (não esticar infinitamente)

**Estratégia incremental:** começar habilitando `lg+` em telas one-shot (Dashboard, Historico, Projetos) e ir migrando aos poucos. Sheets podem ser migrados por último — o adapter pattern (`<AdaptiveSheet>`) permite refatorar gradualmente sem quebrar mobile.

### Recomendação final
**Não rasgar o shell mobile.** Criar um `<DesktopShell>` paralelo que envolve o mesmo `<Outlet>` quando `window.innerWidth >= 1024` (ou via media query CSS pura). O shell mobile continua funcionando 100% — desktop vira progressivamente uma versão "luxo" do mesmo app, sem fork de telas. As telas que ganharem variantes desktop usam responsive utilities; as que ainda não, herdam o layout mobile centralizado num `max-w-content` confortável. Isso permite ship incremental ao invés de big-bang.
