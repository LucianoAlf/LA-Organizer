# Agenda Desktop Redesign v2 — Mobile-espelho + Timegrid

> **Status:** Aprovado em brainstorm 2026-05-24. Pronto pra escrita de plano de implementação.
>
> **Mockups de referência:**
> - `D:\la-organizer\.superpowers\brainstorm\31029-1779626907\content\layout-b-refined.html` (Dia)
> - `D:\la-organizer\.superpowers\brainstorm\31029-1779626907\content\layout-week-month.html` (Semana / Mês)

---

## 1. Contexto e Problema

A versão atual do `AgendaDesktop` divergiu do modelo mental do mobile:

- Usa vocabulário inventado ("Evento") em vez do consagrado ("Compromisso").
- Sumiu com **Hábitos** e **gradação de urgência** das tarefas atrasadas.
- Substituiu **tabs de contexto** (Trabalho/Pessoal/Delegadas) por filtros laterais visuais não-intuitivos.
- Não mostra dots de **Eisenhower** que são padrão no mobile.
- Tem mini-calendário ocupando espaço sem ganho proporcional (navegação já é resolvida no topbar).
- O painel direito ficou redundante com o timegrid central (listava "EVENTOS" que já são blocos no grid).

O usuário usa o app primariamente em mobile. Quando troca pro desktop, estranha a interface — quebra paridade de mental model.

## 2. Objetivo

Reaproximar a Agenda Desktop do modelo mental mobile, **preservando o ganho específico do desktop**: o timegrid visual amplo. Resultado: usuário transita mobile↔desktop sem reaprender.

## 3. Princípios de Design

1. **Mobile-first mental model:** vocabulário, hierarquia e nomenclatura espelham o mobile.
2. **Timegrid é o ganho desktop:** ocupa a maior parte da viewport.
3. **Tabs sincronizadas:** Trabalho/Pessoal/Delegadas filtra **tudo** (compromissos no timegrid, painel esquerdo, all-day strip, hábitos).
4. **Reuso máximo:** componentes mobile são importados e reusados. Wrappers `*Desktop.tsx` só quando layout exige (nunca sobrescrever mobile).
5. **YAGNI:** sem mini-cal, sem coluna direita, sem filtro de ação (TOM), sem widgets que não existem no mobile.

## 4. Layout

### 4.1 Estrutura geral (todas as views)

```
┌────────────────────────────────────────────────────────────────┐
│ TOPBAR (h-14): 📅 Agenda · [Dia|Semana|Mês] · ‹ Hoje [data] › │
│                       [Trabalho · N] [Pessoal · N] [Delegadas]│
│                                              🔔 🌙 👤         │
├──────────────────┬─────────────────────────────────────────────┤
│ PAINEL ESQUERDO  │  CENTRO (varia por view)                    │
│ 400px (fixo)     │                                             │
│ overflow-y-auto  │                                             │
│                  │                                             │
└──────────────────┴─────────────────────────────────────────────┘
                                                          [FAB +]
```

- Sem coluna direita.
- Sem mini-calendário.
- FAB fixo bottom-right (já existe).
- Painel esquerdo `400px` largura fixa, scrollable.
- Centro `flex-1`.

### 4.2 Topbar (AgendaShell)

**Layout linear (sem segunda linha):**

```
[📅 Agenda]  [Dia|Semana|Mês]  ‹ [Hoje] {label data} ›   [chip Trabalho · 5] [chip Pessoal · 2] [chip Delegadas · 1]   🔔  🌙  👤
```

- **Seg control** Dia/Semana/Mês — reusa `AgendaTabs.tsx` ou pattern equivalente.
- **Label de data** dinâmico:
  - Dia: `dom · 24/05/2026`
  - Semana: `24/05 – 30/05 · maio 2026`
  - Mês: `maio de 2026`
- **Tabs contexto**: chips `bg-tom/15 text-tom` quando ativo; `bg-elevated text-muted` quando inativo. Mostra count.
- **Bell/Theme/Avatar**: mantidos como hoje em `AgendaShell.tsx`.

### 4.3 Painel esquerdo por view

#### 4.3.1 View Dia

```
Meu Dia
domingo, 24 de maio
────────────────────────────────
[3 Pra hoje] [4 Atrasadas]💔 [2 Feitas]💚

▼ 🔥 HÁBITOS HOJE                  2/3 · 🔥12d
   ☑ Meditação + leitura         🔥 5
   ☑ Beber água                  🔥 12
   ☐ Academia

▼ 🕒 COMPROMISSOS                  3
   ☐ ● 09:00 Reunião Familiar    [Pessoal] 🎥
   ☐ ● 11:00 Reunião pedagógica  [LA Music] 📍
   ☐ ● 14:00 Gravação estúdio    [Estúdio]

▼ 📋 TAREFAS                       7
   🚨 PAROU HÁ 4+ DIAS · 1
      ☐ ● Aprovar folha mai/2026  [5d]
   🟠 ATRASOU 2-3 DIAS · 1
      ☐ ● Pagar Pronampe (EMLA)   [2d]
   🔴 ATRASOU ONTEM · 2
      ☐ ● PG Verisure
      ☐ ○ Sistema Emusys (Recreio)
   ⭐ PRA HOJE · 3
      ☐ ● Feedback prof. Peterson
      ☐ ● Alinhar Festival Cordas
      ☐ ○ Revisar checklist abertura
   ▶ CONCLUÍDAS · 2 (colapsada)
```

- Cada seção tem **chevron + título + count** clicável (colapsa/expande).
- Subgrupos de urgência das tarefas (4+ dias / 2-3 / ontem / hoje / concluídas) **espelham `Hoje.tsx` mobile**.
- **Eisenhower dot** inline (Q1=vermelho, Q2=âmbar, Q3=azul, Q4=nada).
- **Stats clicáveis** pulam pra primeira tarefa daquele grupo (scroll-into-view).

#### 4.3.2 View Semana

```
Esta semana
24 a 30 de maio · 7 dias
────────────────────────────────
[17 Total] [4 Atrasadas]💔 [9 Feitas]💚

▼ 🔥 HÁBITOS DA SEMANA              12/21
   Meditação + leitura  [D ▢ ▢ ▢ ☑ 🟢 ▢]   ← heatmap 7 dias
   Academia             [▢ ☑ ☑ ▢ ☑ 🟢 ▢]
   Beber água           [☑ ☑ ☑ ☑ ☑ 🟢 ▢]
                                       ↑ hoje em outline tom

▼ 📆 POR DIA                        17 itens
   ─ DOM 24 (hoje · 3 itens) ──────────  ← header destacado
      ☐ ● 09:00 Reunião Familiar [Pess.]
      ☐ ● Aprovar folha mai/2026  [5d]
      ☐ ● Feedback prof. Peterson
   ─ SEG 25 · 4 itens ──────────────────
      ☐ ● 08:00 1:1 Léo [LA]
      ☐ ○ PG Cartão LAMK 8434
      ...
   ─ TER 26 · 2 itens ──────────────────
   ─ QUA 27 · 3 itens ──────────────────
   ─ QUI 28 · 1 item ───────────────────
   ─ SEX 29 · 3 itens ──────────────────
   ─ SÁB 30 · 1 item ───────────────────
```

- Hábitos viram **heatmap horizontal** (7 quadrados D-S-T-Q-Q-S-S, preenchidos quando feito).
- Lista por dia: compromissos com hora, depois tarefas (com badges de atraso).
- Dia atual em destaque (label `text-tom font-semibold`).
- Clicar num cabeçalho de dia muda `currentDate` e troca view pra Day automaticamente (atalho).

#### 4.3.3 View Mês — sem dia selecionado

```
Maio · resumo
selecione um dia pra ver detalhe
────────────────────────────────
[67 Total] [12 Atrasadas]💔 [41 Feitas]💚

▼ 🚨 TOP ATRASOS                    12
   PAROU 15+ DIAS · 3
      ☐ ● PG Geraldo Contador [25/01]
      ☐ ● PG Pronampe Recreio [02/02]
   PAROU 5-14 DIAS · 9
      ☐ ● PG Verisure débito [14/05]

▶ 📋 TAREFAS DO MÊS · 28  (colapsada)
▶ 🕒 COMPROMISSOS DO MÊS · 39 (colapsada)
▶ 🔥 HÁBITOS · ADESÃO 73% (colapsada)
```

- Foco em **acionar atrasos** (grandes ofensores), não despejar 67 itens.
- Outras seções colapsadas por padrão (evita scroll infinito).

#### 4.3.4 View Mês — com dia selecionado

```
Quinta · 28/05               ← voltar ao mês
dia selecionado
────────────────────────────────
[5 Pra qui 28] [2 Atrasadas]💔 [0 Feitas]

▼ 🕒 COMPROMISSOS                   2
   ☐ ● 10:00 Mentoria Levi  [Ment.]
   ☐ ● 15:30 Pedagógica mensal [LA]

▼ 📋 TAREFAS                        3
   ⭐ PRA QUI 28 · 3
      ☐ ● Fechar folha mai/2026
      ☐ ● Enviar boletim alunos
      ☐ ○ Confirmar fornecedores junho

▶ 🔥 HÁBITOS DO DIA · 0/3

┌──────────────────────────────┐
│  Abrir dia 28 em Day view →  │
└──────────────────────────────┘
```

- Painel vira **drawer do dia clicado** (substitui `MonthDayDrawer` que ficava à direita).
- Botão "← voltar ao mês" no topo (limpa selectedDay).
- Botão "Abrir dia em Day view →" no rodapé (troca currentDate + view='day').
- Equivalente conceitual ao `MonthDayDrawer.tsx` mobile, só que dentro do painel esquerdo.

### 4.4 Centro

- **Dia:** `TimeGrid` existente com `all-day strip` no topo (novo). Strip lista tarefas com `due_date === currentDate` que **não têm hora** (sem `remind_at`).
- **Semana:** `TimeGrid` em 7 colunas + `all-day strip` agregando vencimentos da semana.
- **Mês:** `MonthView` existente.

### 4.5 All-day strip (novo)

```
─────────────────────────────────────────────────
DIA TODO · vencimentos sem hora
[● Q2 Revisar checklist] [Enviar relatório]
─────────────────────────────────────────────────
```

- Aparece acima do timegrid em Dia e Semana.
- Cada item é uma `pill` clicável → abre `EditTaskSheet`.
- Esconde se vazio (`hidden: items.length === 0`).
- Dot Eisenhower no início da pill quando `quadrant != null`.

## 5. Componentes a Reusar (do mobile)

Todos importados sem modificação:

| Componente | Caminho | Uso desktop |
|---|---|---|
| `EventRow` | `src/components/EventRow.tsx` | Linha de compromisso no painel esquerdo |
| `TaskRow` | `src/components/TaskRow.tsx` | Linha de tarefa no painel esquerdo |
| `StatCard` | `src/components/StatCard.tsx` | Os 3 stats do topo do painel |
| `EisenhowerPicker` | `src/components/EisenhowerPicker.tsx` | Edição (já usado em sheets) |
| `Badge`, `Button`, `CategoryTag` | `src/components/*` | Genéricos |
| `AdaptiveSheet` | `src/components/AdaptiveSheet.tsx` | Drawer/modal — em desktop vira modal |
| `QuickCreateSheet` | `src/components/QuickCreateSheet.tsx` | Acionada pelo FAB |
| `EditTaskSheet`, `EditEventSheet`, `RescheduleSheet` | `src/components/*Sheet.tsx` | Edição/reagendamento |
| `useAgendaTasks`, `useAgendaEvents`, `useAgendaFilters` | `src/screens/agenda/hooks/*` | Data layer |
| `useBreakpoint`, `useTheme`, `useAuth` | `src/contexts/*` ou `src/hooks/*` | Estado global |
| `TimeGrid`, `EventBlock`, `MonthView`, `MiniCalendar` | `src/screens/agenda/components/*` | Centro |

## 6. Componentes Novos (Desktop-only)

Criar ao lado dos mobile, **nunca sobrescrever**:

| Novo componente | Responsabilidade |
|---|---|
| `AgendaDesktopLeftPanel.tsx` | Container do painel esquerdo 400px. Recebe `view`, renderiza estado correto. |
| `AgendaDesktopLeftPanel.Day.tsx` | Painel Dia (stats + hábitos + compromissos + tarefas agrupadas). |
| `AgendaDesktopLeftPanel.Week.tsx` | Painel Semana (stats + hábitos heatmap + por dia). |
| `AgendaDesktopLeftPanel.Month.tsx` | Painel Mês (stats + top atrasos quando sem dia / drawer quando dia selecionado). |
| `CollapsibleSection.tsx` | Wrapper `<section>` com chevron + título + count + persistência `localStorage`. |
| `HabitWeekHeatmap.tsx` | Linha hábito × 7 dias quadrados. |
| `AllDayStrip.tsx` | Strip acima do timegrid com tarefas sem hora. |
| `ContextTabs.tsx` (ou reusar `Tabs.tsx`) | Tabs Trabalho/Pessoal/Delegadas no topbar com count. |

`TasksPanel.tsx` atual é **deprecado** (substituído por `AgendaDesktopLeftPanel`).
`AgendaLeftRail.tsx` atual é **deprecado** (mini-cal + filtros são removidos).

## 7. Tokens e Cores

Reusar tokens existentes (`bg-tom`, `text-tom`, `bg-elevated`, `border-border`, `text-fg-muted`, `bg-bg-app`, etc.).

**Contextos** (definidos no banco em `event_categories`):
- `work` → `#A3BE50` (olive)
- `personal` → `#A78BFA` (purple — corrigido na sessão anterior)
- Demais (mentoria, estúdio, etc.) usam `category.color`

**Eisenhower dot**:
- Q1 → `bg-danger` (#ef4444)
- Q2 → `bg-warning` (#f59e0b)
- Q3 → `bg-info` (#3b82f6)
- Q4 / null → sem dot

## 8. Comportamentos e Interações

### 8.1 Sincronização tabs ↔ painel ↔ timegrid

Clicar numa tab (Trabalho/Pessoal/Delegadas) atualiza um estado `currentContext` que:

- Filtra **events** mostrados no timegrid (`event.context === currentContext`)
- Filtra **tasks** mostradas no painel esquerdo (`task.context === currentContext` ou critério de delegada)
- Filtra **hábitos** mostrados (hábitos do contexto correspondente)
- Filtra **all-day strip**

Implementação: extender `useAgendaFilters` com `context` (atualmente só tem flags Trabalho/Pessoal/Delegadas como toggles — virar enum único).

### 8.2 Seções colapsáveis (persistência)

Usar `localStorage` key `agenda.desktop.leftPanel.collapsed` (JSON `Record<string, boolean>`).

Estados iniciais:
- Hábitos: aberto
- Compromissos: aberto
- Tarefas: aberto
- Concluídas: colapsada
- (Mês sem dia) Tarefas/Compromissos/Hábitos do mês: colapsadas
- (Mês sem dia) Top atrasos: aberto

### 8.3 Click em item

- **Compromisso row**: abre `EditEventSheet` (drawer direita em desktop)
- **Tarefa row**: abre `EditTaskSheet`
- **Checkbox**: toggle done com mutation otimista (reusa `useTaskMutations` / `useEventMutations`)
- **Stat card**: scroll-into-view do primeiro item daquele grupo

### 8.4 Click em dia (View Mês)

- Atualiza `selectedMonthDay` no estado de `AgendaDesktop`
- Painel esquerdo re-renderiza no modo "dia selecionado"
- Centro destaca célula com `outline-2 outline-tom`

### 8.5 Click em label de dia (View Semana)

- Atualiza `currentDate` para aquele dia
- Troca `view` pra `'day'`
- `navigate(/agenda?view=day, {replace: true})`

### 8.6 FAB

- Mantém comportamento atual: abre `QuickCreateSheet` com `defaultDueDate = currentDate`
- Posição: `bottom-6 right-6`, `bg-tom`

### 8.7 Drag & drop

- `TimeGrid` mantém DnD existente (preserva duração)
- Reagendar pela lista do painel: usa `RescheduleSheet`

## 9. Guardrails (não-negociáveis)

1. **Mobile intocado**: nenhum componente em `src/components/*.tsx` ou `src/screens/Hoje.tsx`, `src/screens/Semana.tsx` é modificado se for compartilhado. Mudanças desktop ficam em `src/screens/agenda/AgendaDesktop*.tsx` ou novos arquivos.
2. **Dispatcher Agenda.tsx**: `bp === 'mobile'` → redirect `/hoje`. Tablet e desktop → `AgendaDesktop`.
3. **Navegação**: `navigate(..., { replace: true })` para mudanças de view (não polui histórico).
4. **DnD**: drop preserva duração (drag muda apenas start).
5. **Drawer**: edição abre pela direita (modal AdaptiveSheet em desktop, bottom em mobile).
6. **Tabs filtram tudo**: events + tasks + hábitos + all-day strip.
7. **Cache busting**: SW pode servir bundle stale. Antes de marcar pronto, validar via `mcp__Claude_Preview__preview_eval` + `preview_screenshot` no Simple Browser `localhost:4173` (preferência registrada do usuário).
8. **PT-BR em toda UI**: vocabulário "Compromisso" (não "Evento"), "Tarefa", "Delegada", "Hábito".

## 10. Critérios de Aceitação

- [ ] View Dia: painel esquerdo replica a hierarquia mobile (Stats → Hábitos → Compromissos → Tarefas com 4 subgrupos de urgência)
- [ ] View Semana: hábitos viram heatmap horizontal; lista por dia agrupa compromissos+tarefas
- [ ] View Mês sem dia selecionado: top atrasos expandido, outras seções colapsadas
- [ ] View Mês com dia selecionado: painel vira drawer do dia, botões "voltar"/"Day view"
- [ ] Tabs Trabalho/Pessoal/Delegadas no topbar com count e filtram tudo
- [ ] All-day strip acima do timegrid mostra tarefas sem hora
- [ ] FAB acionável em todas as views
- [ ] Hábitos colapsável; estado persistido em localStorage
- [ ] Vocabulário "Compromisso" (não "Evento") em toda a UI
- [ ] Eisenhower dot visível nas tarefas e compromissos
- [ ] Mini-cal removido; coluna direita removida; filtro de ação removido
- [ ] `TasksPanel.tsx` e `AgendaLeftRail.tsx` removidos do código
- [ ] Mobile (Hoje/Semana) inalterado — smoke test
- [ ] Tablet acessa AgendaDesktop normalmente (bp !== mobile)
- [ ] Validação via Claude_Preview antes de "concluído"

## 11. Fora de Escopo (YAGNI)

- Visão Kanban / Lista (a la Superfolha)
- Drag-drop entre seções no painel esquerdo
- Filtro de ação TOM (chamar/email/revisar)
- Mini-calendário lateral
- Multi-select de tarefas
- Compactação de hora customizável
- Snooze de hábito
- Métricas históricas (gráficos)

## 12. Riscos e Mitigações

| Risco | Mitigação |
|---|---|
| Painel 400px muito largo em telas <1280px | Media query: <1280 → painel 360px; <1024 → tablet usa layout mobile-like (já redireciona) |
| SW serve bundle stale | Validar via `preview_eval` antes de declarar pronto |
| Reuso de `TaskRow`/`EventRow` quebrar layout em 400px | Smoke visual em ambos breakpoints; ajustar via wrapper se necessário |
| `useAgendaFilters` refactor quebrar tela mobile | Manter API atual + adicionar `context: string \| null` opcional; mobile não consome a nova prop |
| Tabs no topbar quebrarem em viewport estreito | Tabs colapsam pra dropdown <1100px (fallback) |

## 13. Estrutura de Arquivos Esperada Pós-Implementação

```
src/screens/agenda/
├── AgendaShell.tsx                     (mantido, ajuste topbar)
├── AgendaDesktop.tsx                   (orquestrador, ajustes)
├── leftPanel/                          (NOVO)
│   ├── AgendaDesktopLeftPanel.tsx
│   ├── Day.tsx
│   ├── Week.tsx
│   ├── Month.tsx
│   ├── CollapsibleSection.tsx
│   └── HabitWeekHeatmap.tsx
├── components/
│   ├── TimeGrid.tsx                    (mantido + all-day strip)
│   ├── AllDayStrip.tsx                 (NOVO)
│   ├── EventBlock.tsx                  (mantido)
│   ├── MonthDayDrawer.tsx              (DEPRECADO — substituído pelo painel esquerdo)
│   └── MiniCalendar.tsx                (mantido — mas não usado mais aqui)
├── views/                              (mantidos)
└── hooks/
    └── useAgendaFilters.ts             (extender com `currentContext`)

src/screens/agenda/TasksPanel.tsx       → REMOVER
src/screens/agenda/AgendaLeftRail.tsx   → REMOVER
```

## 14. Próximo passo

Após aprovação desta spec, invocar `superpowers:writing-plans` para gerar plano detalhado de implementação task-por-task.
