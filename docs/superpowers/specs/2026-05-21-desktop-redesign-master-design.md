# Desktop Redesign — Master Spec

**Data:** 2026-05-21
**Status:** Aprovado para implementação por fases
**Owner:** Luciano Alf
**Stack alvo:** React 18 + TypeScript + Vite + Tailwind 3.4 (sem mudança)

---

## 1. Contexto e problema

O LA Organizer evoluiu como PWA mobile-first. A versão desktop (`DesktopShell`, Fases D1-D4 concluídas) entregou shell responsivo, layouts D2, sheets adaptativos e lazy loading — mas o resultado visual é "mobile esticado": cards inflados, hierarquia visual fraca, sem patterns de dashboard premium.

**Audit de 21/05/2026:**
- 9/44 telas com layout D2 responsivo
- 35/44 telas ainda em single-column mobile-first
- 3 telas críticas com modal overlay problemático (LaEduca admin/pilar/estagiario)
- Padrão dominante: `<div className="space-y-{md|lg}">` vertical stack
- Componentes base consistentes: `PageHeader` em 27 telas, `Tabs`, `EmptyState`, `LoadingState`

**Mobile (PWA) está validado e perfeito.** O redesign é EXCLUSIVAMENTE para desktop/tablet. `AppShell` mobile não é tocado.

---

## 2. Metodologia

Três fases sequenciais, com aprovação visual antes de cada etapa de código:

### Fase 0 — Audit (concluída neste documento)
Mapeamento estrutural de todas as telas, agrupamento por padrão visual, definição de prioridade.

### Fase 1 — Foundation
Criação da nova linguagem visual desktop em **mockups HTML+Tailwind estáticos** servidos em `localhost:55825`. Aprovação visual de cada primitivo antes de codificar no projeto real. Output: design tokens + shell v2 + page primitives + view patterns.

### Fase 2+ — Aplicação por grupo funcional
Cada grupo tem seu próprio ciclo: brainstorm → spec → plan → implementation → preview validation. Ordem:

| # | Grupo | Telas | Justificativa |
|---|-------|-------|---------------|
| 2 | Agenda | Hoje, Semana, **novo Mês**, Agenda LA Music | Porta de entrada; demanda do time |
| 3 | Projetos | Lista, Kanban, Calendário, Timeline, Por Pessoa, Detalhe | Maior salto de valor — multi-view |
| 4 | Gestão | Dashboard time, Aderência, Operações, Observabilidade, Comunicados, Gestão equipe | Cara de painel premium |
| 5 | Educação | LA Educa (5 telas), LA Journey (3 telas) | Já existe skill LA Journey DS |
| 6 | Operações | Inventário (6 telas), Lojinha (4 telas) | Funcional, baixa prioridade visual |
| 7 | Resto | Checklists, Hábitos, Histórico, Configurações, Perfil | Cleanup final |

---

## 3. Decisões de direção

| Tópico | Decisão | Justificativa |
|---|---|---|
| **Escopo** | Só visual + view switchers | Sem integrações externas (Google Calendar fica pra outro momento). Foco em entregar dashboard premium com dados existentes. |
| **Tom visual** | Mesma família LA Report | Coerência entre produtos LA Music. Compartilha patterns (kanban, timeline, calendário). Cada produto mantém sua cor de marca (Tom green vs LA Report roxo). |
| **Densidade** | Média (estilo Stripe / LA Report) | Tipografia 13-14px corpo, padding 12-16px em cards, linhas de tabela 40-44px. Funciona bem em 1440px+ e ainda confortável em 1024px. |
| **Mockup tool** | HTML + Tailwind estático em `localhost:55825` | `npx http-server -p 55825` na pasta `_remote/.mockups/`. Você aprova no Simple Browser, depois eu codifico no projeto real. |
| **Mobile** | Intocado | `AppShell` e componentes mobile-specific (BottomNav, mobile sheets) preservados. Toda mudança fica em `DesktopShell` + novos componentes desktop. |

---

## 4. Foundation — escopo detalhado (Fase 1)

### A) Design tokens desktop
- Tipografia: 11/12/13/14/16/20/24px (mais densa que mobile)
- Spacing granular: `xs=4, sm=6, md=8, lg=12, xl=16, 2xl=24, 3xl=32`
- Densidade alvo: linhas de tabela 40px, padding card 12-16px
- Cores: mantém Tom green primary; adiciona 3 níveis de surface escuro para hierarquia (`bg-app` → `bg-surface` → `bg-elevated` → `bg-elevated-2`)
- Sombras/bordas: padrões para elevação sutil em cards interativos

### B) Shell refinado
- **`Sidebar v2`**: grupos colapsáveis, busca rápida (Cmd+K), badge de notif por seção, separação visual maior entre seções
- **`Topbar v2`**: breadcrumb dinâmico (em vez de "Boa noite, Luciano"), ações contextuais por rota, quick-action (+) global

### C) Page primitives
- **`PageShell`**: header (title + breadcrumb + actions) + toolbar (filtros + view switcher) + body
- **`Toolbar`**: pattern unificado para filtros em pill + view switcher + busca + ações
- **`ViewSwitcher`**: tabs ícone+label, persiste em localStorage por rota
- **`FilterPill`**: chips removíveis com count, popover para adicionar
- **`DetailDrawer`**: drawer direito (450px) para preview rápido sem sair da lista
- **`EmptyStateDesktop`**: variante com ilustração + CTA primário (vs mobile simples)
- **`PageHeaderDesktop`**: maior, com breadcrumb, eyebrow, actions à direita

### D) View patterns (templates reutilizáveis)
- **`DenseTable`**: tabela com sticky header, hover row, sort, resize columns
- **`KanbanBoard`**: colunas com count, drag-drop, card denso (estilo LA Report)
- **`MonthCalendar`**: estilo Google Calendar (mês cheio + side panel do dia selecionado)
- **`WeekCalendar`**: timeline horizontal com slots de hora
- **`TimelineGantt`**: barras coloridas com swimlanes (estilo LA Report)
- **`PersonGrid`**: cards por pessoa com avatar + métricas

### E) Modais & sheets desktop
- **`Modal`**: ampliar variantes do `AdaptiveSheet` existente
- **`CommandPalette`**: Cmd+K global (busca + ações rápidas)
- **`ContextMenu`**: right-click padronizado em listas/cards

### F) Estados
- Loading skeleton pattern denso
- Error boundary visual
- Confirmação inline (Toast já existe)

### O que NÃO entra na Foundation
- Páginas concretas (Hoje, Projetos, etc.) — entram nas fases dos grupos
- Lógica de negócio (mutations, queries) — preservada
- Integrações externas (Google Calendar, etc.) — fora de escopo
- Componentes de domínio (TaskRow, EventRow, ChecklistItem) — preservados como estão

---

## 5. Plano de mockups da Foundation

Cada mockup é um arquivo HTML standalone em `_remote/.mockups/`, servido em `localhost:55825`.

| Ordem | Mockup | Foco |
|---|---|---|
| 1 | `00-shell-projetos.html` | Shell completo (Sidebar v2 + Topbar v2) + exemplo de página Projetos com toolbar + view switcher + kanban denso |
| 2 | `01-tokens.html` | Styleguide: tipografia, cores, espaçamentos, sombras |
| 3 | `02-page-shell.html` | PageShell + PageHeaderDesktop + Toolbar + FilterPill em isolamento |
| 4 | `03-views.html` | DenseTable, KanbanBoard, MonthCalendar, WeekCalendar, TimelineGantt, PersonGrid |
| 5 | `04-detail-drawer.html` | DetailDrawer right-side com exemplo de tarefa/evento |
| 6 | `05-empty-loading.html` | EmptyStateDesktop variants + LoadingSkeleton patterns |

Após aprovação visual de cada mockup, segue-se a etapa de implementação (escrita de plano via `writing-plans` skill, depois código).

---

## 6. Estrutura de arquivos esperada após Foundation

```
_remote/web/src/
├── design/                       # NEW — Foundation primitives
│   ├── tokens.css               # design tokens desktop
│   ├── shell/
│   │   ├── SidebarV2.tsx
│   │   └── TopbarV2.tsx
│   ├── primitives/
│   │   ├── PageShell.tsx
│   │   ├── PageHeaderDesktop.tsx
│   │   ├── Toolbar.tsx
│   │   ├── ViewSwitcher.tsx
│   │   ├── FilterPill.tsx
│   │   ├── DetailDrawer.tsx
│   │   ├── EmptyStateDesktop.tsx
│   │   └── CommandPalette.tsx
│   └── views/
│       ├── DenseTable.tsx
│       ├── KanbanBoard.tsx
│       ├── MonthCalendar.tsx
│       ├── WeekCalendar.tsx
│       ├── TimelineGantt.tsx
│       └── PersonGrid.tsx
├── components/                    # EXISTING — preserved
├── screens/                       # EXISTING — gradualmente migra para usar design/
└── ...
```

A pasta `design/` é nova e contém SÓ primitivos desktop. Páginas continuam em `screens/`, mas passam a importar de `design/` no lugar dos wrappers mobile-first.

`DesktopShell.tsx` migra para usar `SidebarV2` + `TopbarV2` (substituindo `Sidebar.tsx` e `Topbar.tsx` originais — esses ficam só para histórico até serem deletados).

---

## 7. Critérios de sucesso

A Foundation está pronta quando:
- [ ] Todos os 6 mockups aprovados visualmente no `localhost:55825`
- [ ] Tokens definidos em CSS variables consumíveis por Tailwind via `tailwind.config.ts`
- [ ] Todos os primitivos (`design/`) implementados, com TypeScript strict, sem erros
- [ ] Storybook ou rota `/design-system` opcional para visualização dos primitivos
- [ ] `DesktopShell` v2 substituindo o v1, com zero regressão em mobile
- [ ] Pelo menos uma página real (Projetos, recomendado) migrada para usar os primitivos como prova de conceito

Cada fase de grupo (2+) é considerada pronta quando todas as telas do grupo migraram para usar `design/`, todas as views novas são funcionais com dados reais, e screenshots de validação confirmam o resultado.

---

## 8. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Inconsistência entre Foundation e telas atuais durante transição | Foundation entra como sistema paralelo (`design/`). Telas migram uma a uma. Telas não-migradas continuam funcionando com layout antigo. |
| Quebra de algum fluxo mobile durante refactor | `AppShell` mobile é fisicamente separado. `DesktopShell` só é renderizado para `bp !== 'mobile'`. Cobertura via teste de breakpoint em 375px/1024px/1440px no preview. |
| Foundation grande demais → trava progresso visual | Mockups visuais ANTES de qualquer código garantem que você aprova a direção sem dependência de tooling. Se Foundation atrasar, podemos quebrar em sub-fases (1a Shell, 1b Page primitives, 1c Views). |
| Decisões de design "no escuro" sem ver o resultado real | Cada primitivo tem mockup → validação → implementação → preview com `mcp__Claude_Preview__`. Sempre vejo o resultado antes de fechar a etapa. |

---

## 9. Próximos passos

1. Aprovação deste master spec (você)
2. Plano de execução da Fase 1 (Foundation) via `writing-plans` skill
3. Início dos mockups (`00-shell-projetos.html` primeiro)

---

*Master spec · LA Organizer Desktop Redesign · Maio 2026*
