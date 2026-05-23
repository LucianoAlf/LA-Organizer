# Agenda Desktop — Design Spec

**Sub-projeto:** A (UI desktop completa + reutilização do backend TOM existente)
**Data:** 2026-05-23
**Autor:** brainstorming com Alf
**Status:** approved — pronto pra implementation plan

---

## Goal

Construir a versão desktop da tela Agenda do LA Organizer com três views (Dia, Semana, Mês) sobre a tabela `events` que já existe, painel lateral de `tasks` integrado, CRUD completo via timegrid drag/click, e zero mudança no backend do TOM (que já cria, edita, cancela e despacha lembretes de eventos via WhatsApp).

## Architecture

Frontend puro em React + TypeScript + Tailwind, reaproveitando `useEvents`, `useTasks`, `useRealtimeSync` e o `EditEventSheet` (lógica) existentes do mobile. Uma única tela `AgendaDesktop` com shell de 3 painéis fixos, primitivo compartilhado `TimeGrid` (Day = 1 coluna, Week = 7 colunas), `MonthView` separada para a vista Mês. Estado de view via query param `?view=day|week|month` (deep link), atualizado com `navigate({replace:true})` para não poluir o histórico do browser.

## Tech Stack

- React 18 + TypeScript + Vite + Tailwind 3.4
- TanStack Query 5 (optimistic mutations + cache invalidation)
- `@dnd-kit/core` (drag-to-move events)
- Hook custom `useResize` (pointer events manual) para drag-to-resize
- Supabase Realtime (já em uso via `useRealtimeSync`)
- DS interno: `DateInput`, `TimeInput`, `CustomSelect`, `Button`, `Field`, `DetailDrawer`, `Fab`, `BottomSheet`

## Escopo e decomposição

Este spec cobre **Sub-projeto A** apenas. Os outros sub-projetos foram identificados durante o brainstorm e ficam para ciclos próprios:

| Sub-projeto | Escopo | Estado |
|---|---|---|
| **A — Agenda Desktop UI** | 3 views + CRUD + drag + filtros + painel tasks + integração TOM (sem código novo, só consumir) | **Este spec** |
| B — Google Calendar OAuth + Connect | Settings com botão "Conectar Google", OAuth, token storage | Próximo ciclo após A validado |
| C — Sync bidirecional Supabase ↔ Google | Worker no TOM, push/pull, conflict resolution, webhooks | Após B |

---

## Seção 1 — Arquitetura de rotas e componentes

### Rotas

| Rota | Antes | Depois |
|---|---|---|
| `/hoje` | mobile + desktop usam `Hoje.tsx` | mobile usa `Hoje.tsx` (intocado); desktop redireciona para `/agenda?view=day` |
| `/semana` | mobile + desktop usam `Semana.tsx` | mobile usa `Semana.tsx` (intocado); desktop redireciona para `/agenda?view=week` |
| `/agenda` | inexistente | nova rota canônica desktop; query param `?view=day\|week\|month` (default `day`) |

Sidebar item "Agenda" passa a apontar para `/agenda?view=day`. Trocar view no topbar usa `navigate(url, { replace: true })` para que o back do browser saia da Agenda em vez de navegar entre views.

### Arquivos novos (todos sob `web/src/screens/`)

```
Agenda.tsx                  ← dispatcher mobile vs desktop
AgendaDesktop.tsx           ← orquestra shell + view switcher + estado URL
agenda/
├── AgendaShell.tsx         (shell 3 painéis + topbar; controla qual componente vai na coluna direita)
├── AgendaLeftRail.tsx      (mini-cal + counts + filtros)
├── TasksPanel.tsx          (coluna direita quando view=day|week)
├── views/
│   ├── DayView.tsx         (wrapper fino sobre TimeGrid)
│   ├── WeekView.tsx        (wrapper fino sobre TimeGrid)
│   └── MonthView.tsx       (grid 7×6 com chips)
├── components/
│   ├── TimeGrid.tsx
│   ├── EventBlock.tsx
│   ├── EventChip.tsx       (chip compacto do Mês)
│   ├── MiniCalendar.tsx
│   ├── QuickCreatePopover.tsx
│   ├── EventEditDrawer.tsx
│   └── MonthDayDrawer.tsx  (coluna direita quando view=month)
└── hooks/
    ├── useAgendaEvents.ts  (wrapper sobre useEvents existente + aplicação de filtros)
    ├── useAgendaTasks.ts   (wrapper sobre useTasks existente)
    ├── useResize.ts        (drag-to-resize manual via pointer events)
    └── useAgendaFilters.ts (estado dos chips + persistência localStorage)
```

### Dispatcher (`Agenda.tsx`)

Padrão idêntico ao `Projetos.tsx`:

```tsx
import { useBreakpoint } from '../hooks/useBreakpoint';
import { Hoje } from './Hoje';
import { AgendaDesktop } from './AgendaDesktop';

export default function Agenda() {
  const bp = useBreakpoint();
  if (bp === 'mobile') return <Hoje />;
  return <AgendaDesktop />;
}
```

`AgendaShell` controla qual componente renderiza na coluna direita baseado em `view`:

```tsx
{view === 'month'
  ? <MonthDayDrawer selectedDay={selectedDay} ... />
  : <TasksPanel date={currentDate} filters={activeFilters} ... />}
```

---

## Seção 2 — Layout shell e topbar

### Estrutura

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 📅 Agenda  [Dia|Semana|Mês]   ‹ Hoje · sáb 23/05 ›             [+ Novo]    │ ← topbar 56px sticky
├──────────────┬───────────────────────────────────────┬──────────────────────┤
│ MINI-CAL     │                                       │ TAREFAS DO DIA       │
│ Mai 2026     │                                       │ ☐ Revisar...         │
│              │                                       │ ☐ Feedback...        │
│ PRA HOJE 3   │           VIEW CONTENT                │                      │
│ CONCLUÍDAS 1 │     (Day / Week / Month)              │ (ou MonthDayDrawer   │
│ ATRASADAS 0  │                                       │  quando view=month)  │
│              │                                       │                      │
│ FILTRAR      │                                       │                      │
│ ● Trabalho 3 │                                       │                      │
│ ● Pessoal 2  │                                       │                      │
│ ● Delegadas 0│                                       │                      │
└──────────────┴───────────────────────────────────────┴──────────────────────┘
   260px                   flex-1 min-w-0                      320px
```

### Dimensões

- Left rail: 260px fixo, `shrink-0`, scroll interno se overflow
- Center: `flex-1 min-w-0`, scroll vertical interno (timegrid scrolla)
- Right rail: 320px fixo, `shrink-0`, scroll interno
- Topbar: 56px, `sticky top-0 z-10`, `bg-bg-surface border-b border-border`

### Topbar (3 grupos)

- **Esquerda:** ícone calendário + título "Agenda" + view switcher pill (`Dia | Semana | Mês`)
- **Centro:** `‹ [label adaptativo] ›` + botão `Hoje`
  - View Dia: "sáb 23/05" / Week: "18/05 – 23/05" / Month: "Maio 2026"
- **Direita:** botão `+ Novo` (variant primary/tom). Click abre menu com 2 opções: **Evento** (default Enter) ou **Tarefa**

### Criação contextual (define o fluxo de criar evento)

| Origem do click | Comportamento |
|---|---|
| Slot vazio em DayView/WeekView | `QuickCreatePopover` em modo Evento com `start_at` pré-preenchido (sem menu) |
| Célula vazia no MonthView | `QuickCreatePopover` em modo Evento com `date` pré-preenchida (sem hora; hora obrigatória antes de salvar) |
| Botão `+ Novo` da topbar | Menu Evento/Tarefa (criação genérica, sem contexto) |

### Responsivo

- Right rail colapsa para ícone-only abaixo de 1280px (botão para expandir)
- Estado salvo em `localStorage('agenda.rightRail.collapsed')`
- Default: aberto em ≥1280px, fechado em <1280px

### Atalhos de teclado

- `D` / `W` / `M` → trocar view
- `T` → ir pra hoje
- `←` / `→` → navegar período anterior/próximo
- `N` → abrir + Novo (menu)
- `Esc` → fechar Drawer/Popover; cancela drag em andamento (via `KeyboardSensor` do `@dnd-kit`)

---

## Seção 3 — TimeGrid (primitivo) + DayView + WeekView

### Componente TimeGrid

```tsx
<TimeGrid
  days={Date[]}              // 1 dia (Day) ou 7 dias (Week)
  events={EventForGrid[]}    // já filtrados por context/categoria
  startHour={6}              // 06:00
  endHour={23}               // 23:00
  slotMinutes={30}           // 30min por slot visual
  snapMinutes={15}           // granularidade do drag/resize
  onSlotClick={(date, time) => openQuickCreate(...)}
  onEventClick={(event) => openEditDrawer(event)}
  onEventDrop={(event, newStart) => updateEvent(...)}
  onEventResize={(event, newEnd) => updateEvent(...)}
/>
```

### Layout numérico

- Gutter de horários (esquerda): 60px com labels `06:00`, `07:00`...
- Cada hora: 64px de altura (cada slot 30min = 32px)
- Min height de bloco: 24px (15min = metade de um slot)
- Day = 1 coluna; Week = 7 colunas equiwidth

### Detalhes funcionais

- **Linha "agora"**: barra horizontal `bg-danger` que cruza colunas do dia corrente, atualiza a cada 60s. Só renderiza se hoje está visível.
- **Sticky header** dos dias durante scroll do timegrid.
- **Coluna do dia atual destacada** em WeekView (`bg-tom/5`).
- **Eventos sobrepostos**: algoritmo greedy de "lanes" (column assignment). Dividem largura igualmente. Cap de 3 colunas + "+N mais" fica para v2.
- **Scroll inicial inteligente:** `isToday ? Math.max(7, currentHour - 1) : 7`
- **Click vs drag threshold:** 5px (PointerSensor `activationConstraint: { distance: 5 }`, igual Kanban)

### Conversão tempo ↔ pixel

- `timeToY(date, time)`: `((hour - startHour) * 60 + minute) / 60 * 64` (px)
- `yToTime(y)`: inverso, com snap em `snapMinutes`

### Cores do bloco

- Background: `${eventColor}33` (RGBA alpha 0.2)
- Border-left: 3px sólida na `eventColor`
- Hover: alpha 0.3
- Texto: contrast-aware (`text-white` ou `text-fg`)
- `eventColor` vem de `event.category.color` (via JOIN com `event_categories`), com fallback binário por `context` (work=`#A3BE50`, personal=`#64748B`)

### Não-goals v1

- All-day band, recorrentes, multi-day events, zoom horário

---

## Seção 4 — MonthView

### Layout

Grid 7 colunas × 5–6 linhas (depende do mês). Cabe direto no flex-1 central.

```
┌────┬────┬────┬────┬────┬────┬────┐
│DOM │SEG │TER │QUA │QUI │SEX │SÁB │  ← header sticky
├────┼────┼────┼────┼────┼────┼────┤
│ 26 │ 27 │ 28 │ 29 │ 30 │  1 │  2 │  ← dias fora do mês: opacity-40
│ ▪R │ ▪R │ ▪R │ ▪R │ ▪R │ ▪R │ ▪R │  ← chips de event (cor categoria)
│ +1 │    │    │ +2 │    │    │    │
├────┼────┼────┼────┼────┼────┼────┤
│ 23★│ 24 │ 25 │ ...                  ← 23 = hoje (círculo bg-tom)
```

### Componente

```tsx
<MonthView
  monthDate={Date}             // 1º dia do mês visualizado
  events={EventForGrid[]}
  selectedDay={Date | null}
  onDayClick={(date) => setSelectedDay(date)}
  onDayDoubleClick={(date) => switchToDay(date)}
  onEventClick={(event) => openEditDrawer(event)}
  onEmptyAreaClick={(date) => openQuickCreate({ date })}  // time obrigatório no popover (Seção 6)
/>
```

### Comportamento de click (tabela canônica)

| Alvo | Ação |
|---|---|
| Número do dia | abre `MonthDayDrawer` daquele dia |
| Área vazia da célula | quick-create Evento (date pré, sem hora) |
| Chip de evento | abre `EventEditDrawer` |
| `+N mais` | abre `MonthDayDrawer` |
| Double-click no dia | troca para `view=day` focado |

### Layout da célula

- Altura: `flex-1 min-h-[100px]` (5-6 linhas dividem o vertical disponível)
- Padding interno: 4px
- Número no topo, 12px tabular
- Chips empilhados, 18px alto, gap 2px
- Cap dinâmico: `floor((cellHeight - 24) / 20)` chips visíveis; sobrou → `+N mais`
- Dias fora do mês: `opacity-40`
- Hoje: número dentro de círculo `bg-tom text-black`

### EventChip

- Quadradinho 6×6px `bg-eventColor` cheio
- Hora compacta (omite minutos se :00) + título truncado
- bg chip: `eventColor/15`, hover `eventColor/25`

### MonthDayDrawer (coluna direita quando view=month)

```
┌──────────────────────────────┐
│ Sábado, 23 de maio        ✕  │
│ 3 eventos · 5 tarefas        │  ← contadores respeitam filtros ativos
├──────────────────────────────┤
│ EVENTOS DO DIA               │
│ ┃ 09:00–10:00                │
│ ┃ Reunião de Equipe          │  ← cards clicáveis → EventEditDrawer
│ ┃ 🏢 Sede Barra              │
│                              │
│ TAREFAS DO DIA               │
│ ☐ Revisar checklist          │  ← reusa TaskRow
│                              │
│ [+ Novo evento]  [+ Tarefa]  │
├──────────────────────────────┤
│ [ Abrir vista Dia → ]        │
└──────────────────────────────┘
```

Os contadores no header (`3 eventos · 5 tarefas`) refletem os filtros ativos, não o total bruto.

### Não-goals v1 do Mês

- Drag chip entre dias, all-day chips visualmente distintos, vista Ano

---

## Seção 5 — EventBlock + drag/resize

### Estrutura visual

```
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓ ← border-left 3px sólida (eventColor)
┃ 09:00–10:00                ┃   bg: eventColor/20
┃ Reunião com Rodrigo        ┃   hover: eventColor/30 + cursor-grab
┃ 🏢 Sede Barra              ┃
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
        ═════                  ← handle de resize: 8px alto, visible no hover
```

### Conteúdo por altura

| Altura | Conteúdo |
|---|---|
| ≥48px (≥45min) | hora + título + location (3 linhas) |
| 24–47px (15–30min) | hora + título (2 linhas, truncado) |
| <24px | só título (1 linha, hora some) |

### Drag-to-move

- `@dnd-kit/core` com `useDraggable`
- `data: { type: 'event', event }`
- Activation constraint: 5px
- `DragOverlay` renderiza ghost (mesma cor, opacity 0.85)
- Original durante drag: `opacity 0.3`
- Cada slot de 15min do TimeGrid é `useDroppable` com `data: { type: 'slot', date, time }`
- WeekView: arrastar para outra coluna muda `date`
- DayView: só muda hora

#### Cálculo no drop (preserva duração)

```ts
const durationMs = oldEnd.getTime() - oldStart.getTime();
await updateEvent({
  id,
  start_at: newStart.toISOString(),
  end_at: new Date(newStart.getTime() + durationMs).toISOString(),
});
```

### Drag-to-resize

- Handle dedicado: `<div className="absolute bottom-0 inset-x-0 h-2 cursor-ns-resize opacity-0 group-hover:opacity-100">`
- Hook custom `useResize` com `pointerdown`/`pointermove`/`pointerup` (NÃO usar `@dnd-kit` aqui — isolamento evita conflito)
- Snap 15min em tempo real (visual estica)
- Min duration: 15min; max: 12h
- Release → `updateEvent({ id, end_at: newEnd.toISOString() })`

### Optimistic updates

TanStack `useMutation` com `onMutate` que faz `setQueryData` antes do PATCH. Rollback no `onError`. Padrão idêntico ao DnD do Kanban.

### Estado durante drag

- Linha "drop preview" no slot de destino: `bg-tom/20 border-y border-tom`
- Tooltip flutuante: `"09:30 – 10:30"` (atualiza em tempo real)
- Esc cancela (via `KeyboardSensor`)

### Conflitos / overlap

- **Permite overlap**. Algoritmo de lanes divide largura.
- Indicador visual: ícone ⚠️ `text-warning` no canto. Click abre tooltip com lista dos eventos em conflito.

### Realtime durante drag

- UPDATE remoto do mesmo evento enquanto local arrasta: ignora até soltar (evita teletransporte). Próximo fetch sincroniza.
- DELETE remoto durante drag: cancela drag, toast `"Esse evento foi removido em outro dispositivo"`, fecha overlay.

### Não-goals v1

- Drag em touchscreen, resize pela borda superior, drag entre views, eventos `done`/`cancelled` permitem drag (visual `opacity-50 line-through`)

---

## Seção 6 — QuickCreatePopover + EventEditDrawer

### 6.1 QuickCreatePopover

Popover inline (não modal) ancorado próximo ao slot/célula clicada. Componente unificado para Evento e Tarefa via prop `mode`.

```tsx
<QuickCreatePopover
  mode="event" | "task"      // muda campos e handler
  anchor={{ date, time? }}
  onCreate={(payload) => createEvent(payload) | createTask(payload)}
  onMoreOptions={(draft) => openEditDrawer(draft)}  // só mode=event
  onClose={() => closePopover()}
/>
```

**Mode "event" — campos:**
| Campo | Default | Onde edita |
|---|---|---|
| `title` | `""` (autofocus) | inline |
| `start_at` | data+hora do slot | inline (DateInput + TimeInput) |
| `end_at` | `start_at + 1h` | dropdown "Duração" (15/30/45/60/90/120min) |
| `category` | última usada (`localStorage`) ou `la_music` | chip dropdown |
| `context` | derivado de category (`pessoal`→`personal`, demais→`work`) | chip dropdown |
| `modality` | `presencial` | só no Drawer (via "Mais opções") |
| `location_text`, `meeting_url`, `project_id` | null | só no Drawer |

**Mode "task" — campos:**
| Campo | Default |
|---|---|
| `title` | `""` (autofocus) |
| `due_date` | date do anchor |
| `context` | última usada |
| `priority` | `normal` |

### Comportamento (ambos os modes)

- `Enter` salva
- `Esc` fecha (sem confirmação se vazio)
- `Tab` navega campos
- Click fora fecha (com confirm se título já digitado)
- Posicionamento via portal; default acima do anchor, fallback abaixo
- "Mais opções" (só mode=event): preserva o que foi digitado e abre `EventEditDrawer` com aqueles valores
- Quando aberto via célula de Mês: TimeInput vazio (`--:--`) — obrigatório preencher antes de salvar

### 6.2 EventEditDrawer

Drawer lateral 480px à direita, reutiliza primitivo `DetailDrawer`.

#### Campos editáveis

- `title` (obrigatório, 1–200 chars)
- `description` (opcional, textarea)
- `start_at` (DateInput + TimeInput)
- `end_at` (DateInput + TimeInput)
- `category` (CustomSelect com chips coloridos)
- `context` (segmented: Trabalho / Pessoal)
- `modality` (segmented: Presencial / Online / Híbrido)
- `location_text`
- `meeting_url` (só se modality ∈ {online, hibrido})
- `project_id` (CustomSelect opcional)
- `status` (segmented: Agendado / ✓ Concluído / ✕ Cancelado)
- Metadados read-only: `source` (manual/tom/imported) + criado em

#### Componentes DS reutilizados

- `DateInput`, `TimeInput` (separados; `DateTimeInput` opcional como wrapper)
- `CustomSelect` (categoria, projeto)
- `Field` (label + input + helper)
- `Button` (primary/ghost/danger)
- `DetailDrawer` (shell)

#### Validação client-side

- `title` obrigatório
- `end_at > start_at`; multi-day rejeitado com helper "evento de múltiplos dias não suportado"
- `modality === 'presencial'` + `meeting_url` preenchido → bloqueia salvar com erro "Eventos presenciais não têm link"
- `category === 'pessoal'` → auto-set `context = 'personal'` + warning visual "🛡 Pessoal não é visto por coordenação"
- `meeting_url` formato URL válida

#### Botões de ação (footer)

- Esquerda: `🗑️ Deletar` (ghost-danger)
- Direita: `Cancelar` (ghost) + `Salvar` (primary)

#### Deletar vs Cancelar (semânticas distintas)

| Ação | Comportamento | UI no grid |
|---|---|---|
| Status = `cancelled` | soft delete; evento continua no banco | renderiza com `opacity-50 line-through` |
| Botão Deletar | hard delete; `DELETE` na tabela | some do grid |

ConfirmDialog do botão Deletar: "Deletar esse evento? Essa ação não pode ser desfeita." Sucesso: fecha drawer, optimistic remove, toast "Evento deletado".

**Nota para Sub-projeto B (Google Sync):** preservar esta diferença é importante — `cancelled` → `google.events.update({status: 'cancelled'})`, `deleted` → `google.events.delete()`.

#### Diff inteligente no save

`useMemo` calcula `patch = diff(initial, current)` e envia só campos alterados (PATCH parcial). Idêntico ao `ProjectEditDrawer`.

### Não-goals v1

- Convidados (`event_participants` existe mas UI desktop não expõe), múltiplos lembretes, recorrência, anexos

---

## Seção 7 — LeftRail + TasksPanel

### 7.1 LeftRail (260px)

Três blocos empilhados com borda divisória.

#### MiniCalendar

- Grid 7×6 de células 24px
- Mês visualizado sincronizado com `currentDate` da view central
- Click em dia → `navigate({view:'day', date:clicked})`
- Indicador: dot 4px embaixo do número (`bg-tom` se event, `bg-fg-muted` se só task). Query agregada cacheada por mês.
- Hoje: número em círculo `bg-tom text-black`
- Dia selecionado: `ring-1 ring-tom`
- Header `‹ Mês YYYY ›` navega o center (não independe)

#### Counts (block)

| Métrica | Filtro | Cor |
|---|---|---|
| PRA HOJE | `scheduled_date === today && status !== 'done'` | `text-fg` (neutro) |
| CONCLUÍDAS | `status === 'done' && updated_at >= today` | `text-success` |
| ATRASADAS | `due_date < today && status NOT IN ('done', 'cancelled')` | `text-danger` |

Source: tasks do colaborador autenticado, filtradas pelos chips ativos.
Click em cada count → scroll-into-view do bloco correspondente no TasksPanel.

#### Filter chips

3 toggles persistidos em `localStorage('agenda.filters')`:

| Chip | Filtro tasks | Filtro events | Cor dot |
|---|---|---|---|
| Trabalho | `context='work' && delegated_to IS NULL` | `context='work'` | `tom` (verde) |
| Pessoal | `context='personal'` | `context='personal'` | `#7B61FF` (roxo) |
| Delegadas | `delegated_to IS NOT NULL` | (eventos não têm — chip não afeta events) | `#06B6D4` (ciano) |

Estado: on (cor cheia) / off (cinza, opacity-50). Aplica a tasks **e** events simultaneamente.

### 7.2 TasksPanel (320px, quando view=day|week)

```
┌──────────────────────────────┐
│ TAREFAS                      │
│ Sáb 23/05 · 3 pendentes      │  ← header contextual à view
├──────────────────────────────┤
│ ATRASADAS (0)                │
├──────────────────────────────┤
│ ▼ PRA HOJE (3)               │
│ ☐ Revisar checklist abert.   │  ← TaskRow do DS (reuso mobile)
├──────────────────────────────┤
│ ▼ CONCLUÍDAS (1)             │
│ ☑ Enviar relatório semanal   │  ← opacity-60 line-through
├──────────────────────────────┤
│ [+ Tarefa]                   │
└──────────────────────────────┘
```

- Source: `useTasks({ filters, period })`
- Period derivado da view:
  - Day → tasks com `(scheduled_date ?? due_date) === currentDate`
  - Week → tasks com `(scheduled_date ?? due_date) within [weekStart, weekEnd]` (`scheduled_date` prevalece se preenchido para evitar duplicação)
  - Month → não aplicável (MonthDayDrawer toma o lugar)
- Click em task → `EditTaskSheet` existente (reusa do mobile)
- Toggle complete → `updateTask({id, status:'done'})` optimistic
- "+ Tarefa" → `QuickCreatePopover` em `mode="task"`

Seções (Atrasadas/Pra hoje/Concluídas) colapsáveis. Default colapsada se count=0 (atrasadas) ou se concluídas. Estado em `localStorage('agenda.tasksPanel.collapsed')`.

### Não-goals v1

- Drag de task para timegrid (não converte em evento; criação explícita via click no slot)

---

## Seção 8 — Migration, Realtime, Testing, Acceptance

### 8.1 Migration — JÁ APLICADA (não rodar)

A migration `add_color_to_event_categories` já está aplicada no banco `cesnbnrynvxvgdhfmaua`. Slugs reais das 5 categorias existentes e cores populadas:

| Slug | Cor | Uso |
|---|---|---|
| `la_music` | `#A3BE50` | atividades da escola |
| `mentoria` | `#7B61FF` | sessões de mentoria |
| `estudio` | `#EC4899` | gravação/mixagem |
| `show` | `#F59E0B` | apresentações |
| `pessoal` | `#64748B` | médico, família, lazer |

**Não existem** `outra_escola` nem `aula_particular` como slugs.

Fallback em código para `color IS NULL` (categoria nova criada futuramente sem cor): cor binária por `context` (work=`#A3BE50`, personal=`#64748B`).

### 8.2 Realtime

`useRealtimeSync` existente já cobre INSERT/UPDATE/DELETE em `events` e `tasks`. Agenda Desktop apenas:

- Subscribe quando `AgendaDesktop` monta, unsubscribe no unmount
- INSERT remoto (TOM criou via WhatsApp): toast `"📅 Novo evento: <title>"` + invalidação
- UPDATE: invalidação silenciosa
- DELETE: remove do grid sem toast
- Guard contra teletransporte durante drag (ver Seção 5)

### 8.3 TOM integração — zero novo backend

Auditoria confirmou que TOM já cobre 100% do ciclo de eventos via WhatsApp:

| Capacidade | Status | Origem |
|---|---|---|
| TOM cria event via WhatsApp | ✅ | Skill `criar-compromisso` + marker `<<EVENT_CREATE>>` (Sprint 4) |
| TOM reagenda / cancela / conclui | ✅ | Marker `<<EVENT_UPDATE>>` (Sprint 5) |
| Engine valida markers | ✅ | `src/engine.js` Guards |
| Detecção evento vs tarefa | ✅ | Pickskill em `priorizacao-inteligente` |
| Lembretes pré-evento via WhatsApp | ✅ | `checkEventReminders()` no dispatcher (Sprint 22.50) |
| Auditoria de integridade | ✅ | Skill `integridade-agenda` |
| Resumo agenda sob demanda | ✅ | Skill `lista-mental` |

Sub-projeto A consome o que já existe. Zero `<<EVENT_*>>` novo, zero skill nova, zero handler novo no engine.

### 8.4 Testing approach

TDD light por componente:

- `TimeGrid.tsx`: testes unitários de `timeToY`, `yToTime`, algoritmo de lanes
- `MonthView.tsx`: teste de `getMonthGrid(date)` (35 ou 42 dias)
- `EventBlock.tsx`: render visual por altura (3 buckets de conteúdo)
- `useResize.ts`: hook puro, testável isolado
- Integração: 1 teste e2e Playwright opcional cobrindo "criar → mover → editar → deletar evento" (gold path)

Screens (AgendaDesktop, views) testadas via preview MCP + screenshots, sem TDD obrigatório.

### 8.5 Acceptance criteria (gold paths)

| # | Ritual | Critério |
|---|---|---|
| 1 | Abrir `/agenda` em hoje | Carrega <1s, view=day, scroll posicionado em 07:00 ou `hora atual − 1` |
| 2 | Criar event rápido | Click slot vazio → popover abre → digitar título → Enter → bloco aparece otimisticamente |
| 3 | Arrastar event | Drag 2h → release → bloco no novo lugar, `start_at`/`end_at` atualizados (duração preservada) |
| 4 | Redimensionar | Drag borda inferior +30min → `end_at` aumenta |
| 5 | TOM cria via WhatsApp | Realtime → bloco aparece em <1s + toast `"📅 Novo evento: ..."` |
| 6 | Trocar pra Mês | View Mês carrega; click no dia 23 → drawer lateral mostra eventos+tarefas |
| 7 | Filtrar Pessoal off | Events `context=personal` + tasks pessoais somem do grid e do panel |
| 8 | Deletar event | Drawer → Deletar → confirma → some do grid e do banco |
| 9 | Cancelar event | Drawer → status Cancelado → save → bloco fica `line-through`, continua no grid |
| 10 | Browser back | Back do navegador sai da Agenda (não volta entre views) |

### 8.6 Non-goals consolidados v1

❌ All-day events
❌ Eventos recorrentes
❌ Multi-day events
❌ Convidados / attendees na UI
❌ Múltiplos lembretes (UI; só `events.remind_at` single)
❌ Anexos
❌ Drag entre views
❌ Drag de task → timegrid
❌ Touch no timegrid (mobile usa screens próprias)
❌ Vista Ano
❌ Zoom horário
❌ Customização de cor por categoria pelo usuário (vem com defaults; v2)
❌ Cap de 3 colunas + "+N mais" no overlap (greedy puro hoje)
❌ Google Calendar sync (Sub-projeto B)

---

## Decision log (resumo das decisões do brainstorm)

| # | Decisão | Justificativa |
|---|---|---|
| 1 | Sub-projeto A puro (UI), B/C deferidos | Decompor escopo gigante; A entrega valor sozinho |
| 2 | Reuso de `events` + `tasks` (zero nova tabela) | Auditoria confirmou tudo já existe |
| 3 | Shell 3-pane fixo nas 3 views | Consistência visual + tarefas sempre presentes |
| 4 | Cor por `event_categories.color` (single migration) | Flexível, conecta filtros aos blocos visuais |
| 5 | 4 interações no timegrid (click bloco, click slot, drag, resize) | UX completa de calendário moderno |
| 6 | Filtros aplicam a events E tasks | Consistência — desligar Pessoal esconde tudo pessoal |
| 7 | Click no dia do Mês → drawer lateral com detalhe | Híbrido entre navegação e peek |
| 8 | Cancelar (soft) vs Deletar (hard) — ambos existem | Semânticas distintas; preserva histórico vs erro |
| 9 | `QuickCreatePopover` unificado via prop `mode` | Mesmo shell, campos diferentes |
| 10 | Realtime: ignora UPDATE remoto durante drag local | Evita teletransporte; sincroniza após soltar |

---

## Próximo passo

Plan de implementação via `superpowers:writing-plans` com decomposição em tasks pequenas (TDD por componente, frequent commits, subagent-driven execution).
