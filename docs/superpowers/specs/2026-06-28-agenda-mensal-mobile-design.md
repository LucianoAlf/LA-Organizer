# Agenda Mensal Mobile (aba "Mês") — Design

**Data:** 2026-06-28
**Origem:** brainstorm com Alf (mockups com tokens reais aprovados)
**Status:** aprovado no brainstorm — pronto pro plano

---

## Objetivo

Adicionar a visão **"Mês"** à agenda do PWA mobile, ao lado de **Dia** e **Semana**. Hoje o desktop já tem mês (`?view=month`), mas o mobile não. O mês mobile é uma **grade de calendário bonita** (estilo do app de referência do Alf): cada dia mostra chips coloridos por tipo/status; tocar um dia sobe um **painel deslizante** (bottom-sheet) com os itens daquele dia, oferecendo **as mesmas ações que o Dia já tem** (concluir, editar, reagendar, excluir, recorrência, lembrete) — por **reuso** dos componentes existentes, sem reinventar nada.

## Princípios

1. **Reuso máximo.** Editar/reagendar/excluir/recorrência/lembrete já existem e são reusados como estão. Recorrência ("Cron") e Lembrete vêm de graça porque vivem dentro do `EditTaskSheet`.
2. **Guardrail (CLAUDE.md).** `Hoje.tsx` e `Semana.tsx` são sagrados — **não serão alterados** nesta v1. O mês é aditivo.
3. **Fiel aos tokens.** Verde `tom` (#A3BE50), escala tipográfica, raios e spacing reais. Nada de cor/medida inventada.
4. **Sem carnaval de sheets.** Empilhamento se comporta como navegação: **um sheet visível por vez**, "voltar" desempilha um nível.

---

## Estado atual (verificado no código)

- **Rotas mobile:** `/hoje` → `Hoje.tsx` (Dia), `/semana` → `Semana.tsx` (Semana). `AgendaTabs.tsx` = segmented control com **2 slots**. Não existe `/mes` mobile.
- **Desktop:** `?view=month` já existe (`AgendaShell` tem Dia/Semana/Mês; `MonthView.tsx` = grade só-eventos; `MonthPanel.tsx` = resumo).
- **Linha de tarefa** (`TaskRow.tsx`):
  - toque no **corpo** → `onOpen` → `TaskDetailSheet` (leitura, descrição inteira — mudança de 25/06) → botão **"Editar"** → `EditTaskSheet`.
  - **checkbox** → `onToggle` (conclui/reabre direto).
  - **"..." (`RowMenu`)** → Editar / Reagendar / 📆 Transformar em compromisso / 👥 Delegar / Excluir (confirm inline).
- **`EditTaskSheet.tsx`** (campos, nesta ordem): Título · Tipo (Trabalho/Pessoal) · Checklist (só tarefa-mãe) · Para quando (`DateInput` + `TimeInput`) · **Lembretes** (`RemindersField`, multi) · **Recorrência** (`RecurrencePicker`, RRULE) · Prioridade (`EisenhowerPicker`) · Transformar em (Compromisso/Delegar) · Cancelar/Salvar. Ao salvar recorrente → `RecurrenceScopeDialog` ("só esta" / "esta e as próximas").
- **`RescheduleSheet.tsx`** = reagendar rápido (só `DateInput`).
- **Compromisso:** `EditEventSheet.tsx` (editar, cancelar, excluir; sem recorrência — não existe pra evento).
- **Primitivo de sheet:** `AdaptiveSheet` → `BottomSheet` no mobile (`fixed inset-0 z-50`, backdrop, slide-up 220ms, fecha por backdrop/Esc; sem arrasto funcional). Padrão de troca já usado: detalhe **fecha** antes do editar **abrir** (`setReadingTask(null); setEditingTask(rt)`).
- **Dados:** `useAgendaTasks` (range em `due_date` → `TaskForPanel[]`) e `useAgendaEvents` (range em `start_at` → `EventForGrid[]`).
- **Breakpoint:** `useBreakpoint` — mobile `< 768px`.

---

## Arquitetura

```
/mes (mobile)  ──►  Mes (tela)
                      ├─ AgendaTabs (Dia · Semana · [Mês])         ← +1 slot
                      ├─ DateNavHeader (‹ junho 2026 ›, step=mês)
                      └─ MonthGrid (grade dom→sáb, chips por dia)
                            └─ toca um dia ►  MonthDaySheet (bottom-sheet do dia)
                                                 └─ DayBoard (lista + ações)        ← NOVO, reusa sheets leaf
                                                      ├─ TaskRow → TaskDetailSheet → EditTaskSheet → RecurrenceScopeDialog
                                                      │            (checkbox / RowMenu: Reagendar=RescheduleSheet, Excluir)
                                                      └─ EventRow → EditEventSheet
/mes (tablet/desktop) ──► Navigate /agenda?view=month   (já existe)
```

**Novos componentes**
1. **`Mes`** — tela `/mes` (espelha `Hoje`/`Semana`: tabs + nav + conteúdo).
2. **`MonthGrid`** — a grade do calendário (adapta `MonthCalendar` do design system pra começar no **domingo**).
3. **`DayBoard`** — componente **novo** que renderiza a lista de itens de um dia **e encapsula toda a pilha de sheets de ação** (detalhe/editar/reagendar/excluir/transformar/evento). Reusa os componentes-folha existentes (não reimplementa nada deles).
4. **`MonthDaySheet`** — o bottom-sheet do dia; renderiza `<DayBoard>` dentro.

**Modificações (mínimas, aditivas)**
- `AgendaTabs.tsx` — 3º `<NavLink to="/mes">` "Mês".
- `App.tsx` — rota `/mes` → `MesOrDesktopAgenda` (mobile: `MesMobile`; senão `Navigate /agenda?view=month`).
- `AppShell.tsx` — incluir `/mes` em `AGENDA_PATHS` (pra exibir o `AgendaTabs`).
- `BottomNav.tsx` — `matchPaths` do item Agenda passa a casar `/mes`.

---

## A grade (`MonthGrid`)

- **Semana domingo→sábado**, 5–6 linhas. Usa a lib de grid de mês (`getMonthGrid`, já existe no desktop) ou o `MonthCalendar` ajustado pra `weekStartsOn=0`.
- **Célula:** número do dia no topo; **hoje** = bolinha preenchida `tom-deep` (#728538) com número branco; dias **fora do mês** esmaecidos (`fg-muted` claro).
- **Chips:** teto de **3 por célula** + **"+N"**; texto truncado com `…`; cor = semântica (abaixo). Toque na célula → abre `MonthDaySheet` daquele dia.
- **Não** mostra hábitos diários (apareceriam todo dia; ficam no Dia).

### Cores dos chips (v1 — semântica)

| Item | Condição | Cor (fundo / texto) |
|---|---|---|
| Tarefa atrasada | `due_date < hoje` e `status != done` | danger — `#FCEBEB` / `#A32D2D` |
| Tarefa no prazo | aberta, não atrasada | tom — `#E8F0CF` / `#3B6D11` |
| Tarefa feita | `status == done` | muted + ~~riscado~~ — `#9E9E9E` |
| Compromisso | evento `scheduled` | info — `#E6F1FB` / `#0C447C` |

Regra de atraso = a mesma de `TaskRow.statusOf` (considera `task_reminders`/`remind_at` como referência quando houver, senão `due_date`). **Fora de escopo v1:** evento usar `category_color` (→ v2).

---

## Dados

- Busca via **`useAgendaTasks` + `useAgendaEvents`** com `range = [gridStart, gridEnd]` (o domingo da 1ª linha até o sábado da última — **não** só o 1º–último do mês, pra preencher os chips das células de borda, ex. "Pacote Mo" em 1º/jul).
- Mesma origem do desktop (zero query nova).
- Agrupa por dia (YMD local, `localYmd`/`todaySP` — nunca `toISOString().slice` pra não deslocar o dia após 21h BRT).

---

## `MonthDaySheet` (painel do dia)

- `AdaptiveSheet`/`BottomSheet`. Abre **parcial** (~60% inferior); o mês fica escurecido atrás (backdrop) e espiando em cima. Arrastável pra cima num dia cheio (lista rola dentro). Fecha por ✕ / backdrop / arrasto.
- **Header:** `seg 15 de junho` + `N itens` + ✕ (e grab handle visual).
- **Corpo:** `<DayBoard date={dia} tasks={doDia} events={doDia} />`.
- **Rodapé:** **"Ver dia completo"** → navega `/hoje` com a data selecionada (a tela cheia do dia, com stats/hábitos).
- **Vazio:** "nada nesse dia — toque + pra criar".

---

## `DayBoard` (novo, reusável)

**Responsabilidade:** dado um dia + seus itens, renderizar as linhas e **possuir** a máquina de ações (mesma do Dia), reusando os componentes-folha.

- **Props:** `date`, `tasks` (do dia), `events` (do dia), `onChanged?` (invalidação opcional).
- **Renderiza:** `TaskRow` (com `onToggle`, `onOpen`, `onEdit`, `onReschedule`, `onDelete`, `onTransformToEvent`, `onDelegate`) e a linha de evento (toque → `EditEventSheet`; toggle done).
- **Encapsula a pilha de sheets:** `TaskDetailSheet`, `EditTaskSheet`, `RescheduleSheet`, `EditEventSheet`, e os fluxos de transformar (`ConvertToEventSheet`/`DelegateTaskSheet`) — exatamente os mesmos componentes que `Hoje.tsx` usa. **Recorrência + Lembrete vêm de graça** (vivem no `EditTaskSheet`).
- **Mutação de concluir/reabrir:** mesma lógica do Dia (toggle status + invalidar `['tasks']`/`['events']`).
- **`Hoje.tsx` NÃO é alterado nesta v1** (guardrail). `DayBoard` é novo e usado só pelo `MonthDaySheet`. *(v2 opcional: `Hoje` adota `DayBoard` pra unificar de vez — fora de escopo agora.)*

---

## Interação (empilhamento = navegação, sem carnaval)

**Um sheet visível por vez.** Pilha de navegação:

```
Mês →[toca dia]→ MonthDaySheet →[toca tarefa]→ TaskDetailSheet →[Editar]→ EditTaskSheet →[salvar recorrente]→ RecurrenceScopeDialog
        ‹ fecha            ‹ fecha                  ‹ fecha             ‹ fecha
```

- **Mecanismo recomendado:** **swap-com-restauração** — cada filho **fecha o pai e o restaura ao voltar** (o `MonthDaySheet` guarda o dia aberto e reabre quando o detalhe fecha). É o mesmo padrão que `Hoje` já usa (detalhe↔editar), então **não precisa mexer em z-index**: em nenhum momento há mais de 2 sheets visíveis, e o único caso de 2 (`RecurrenceScopeDialog` sobre `EditTaskSheet`) **já funciona hoje**.
- **Fallback** (se o swap "piscar" feio no teste): adicionar uma prop opcional `level` ao `AdaptiveSheet`/`BottomSheet` (z-index incremental) pra overlay real. Mudança pequena e contida — **só se necessário**.

---

## Navegação do mês

- `DateNavHeader` adaptado pra **passo de mês**: `‹ junho 2026 ›`. Toque no rótulo → seletor mês/ano. **Swipe** lateral troca o mês *(nice-to-have; pode cair pra fase 2 se apertar o escopo)*.

---

## Estados

- **Mês vazio:** grade limpa (sem chips).
- **Loading:** skeleton da grade.
- **Dia vazio (sheet):** empty curto + atalho de criar.

---

## Fora de escopo (v1 → eventuais v2)

- Recorrência de **compromisso** (não existe no app; manter).
- **Cards de resumo** no mês mobile (calendário puro, como o exemplo do Alf).
- Chip de evento usar **`category_color`** (semântica v1 é por tipo/status).
- **Hábitos diários** como chip.
- Refatorar `Hoje` pra usar `DayBoard`.
- Swipe pra trocar mês (pode ir pra fase 2).

---

## Roteamento / guardrail

- `/mes` mobile → `MesMobile`; tablet/desktop → `Navigate /agenda?view=month` (intacto).
- **Não tocar** `Hoje.tsx` / `Semana.tsx`.
- Testar **375px** (mobile) e confirmar desktop `?view=month` inalterado.
- Design System: nada de `<input>`/`<select>` nativo — usar DS (`DateInput`/`TimeInput`/etc.), que os componentes reusados já fazem.

---

## Arquivos

**Criar**
- `web/src/screens/Mes.tsx` — tela mobile do mês.
- `web/src/screens/agenda/mobile/MonthGrid.tsx` — a grade.
- `web/src/screens/agenda/mobile/MonthDaySheet.tsx` — bottom-sheet do dia.
- `web/src/screens/agenda/mobile/DayBoard.tsx` — lista + máquina de ações reusável.

**Modificar**
- `web/src/components/AgendaTabs.tsx` — slot "Mês".
- `web/src/App.tsx` — rota `/mes` (dispatcher).
- `web/src/components/AppShell.tsx` — `AGENDA_PATHS` + `/mes`.
- `web/src/components/BottomNav.tsx` — `matchPaths` Agenda + `/mes`.
- *(reuso)* `web/src/screens/agenda/lib/monthGrid.ts` e/ou `web/src/design/views/MonthCalendar.tsx` (ajuste domingo-first, se preciso).

---

## Testes

- **Unit:** `monthGrid` (domingo-first, 5–6 linhas, dias de borda); mapeamento status→cor; agrupamento de itens por dia (YMD local).
- **Component:** `MonthDaySheet` abre o dia certo e lista tarefas+eventos; `DayBoard` abre detalhe→editar, reagendar, excluir; tarefa recorrente dispara `RecurrenceScopeDialog`.
- **Visual (375px):** hoje destacado; "+N"; sheet parcial e arrastável; pilha desempilha (voltar nível a nível).
- **Regressão:** `Hoje`/`Semana` e desktop `?view=month` intactos.

---

## Riscos / decisões abertas

- **Duplicação parcial** da fiação de ações (DayBoard x Hoje) — aceita em v1 pra **não tocar** o `Hoje` sagrado; unificação fica pra v2.
- **Swap pode piscar** → fallback prop `level` (z-index).
- **`getMonthGrid` domingo-first?** confirmar na implementação (a lib existe; pode precisar de `weekStartsOn`).
