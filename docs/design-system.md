# LA Organizer — Design System

**Versão:** 22.20 (Sprint 22 — PWA Audit & Polish, Phase A)
**Status:** contrato vivo. Atualizar quando token mudar.

Este documento é a referência única pra cores, espaçamento, tipografia e componentes
do PWA. Quando uma tela for refatorada, segue este molde — não inventa variação.

---

## §1. Tokens (definidos em `web/tailwind.config.js`)

### §1.1. Cores

| Token | Uso | Hex (default) |
|---|---|---|
| `tom` (primária) | CTAs, FAB, tabs ativos, agent touchpoints | `#A3BE50` (olive) |
| `tom-shade` / `tom-deep` / `tom-light` / `tom-tint` | Hover, fundos esmaecidos | derivações |
| `brand` (secundária) | Identidade LA, splash, alguns títulos | `#E91451` (pink) |
| `success` | Status concluído | `#22C55E` |
| `warning` | Status atenção (pause, Q2) | `#F59E0B` |
| `danger` | Status erro/atrasado (Q1) | `#EF4444` |
| `info` | Status informativo (Q3) | `#3B82F6` |
| `project` | Identidade de projeto | `#8B5CF6` |
| `bg-app` / `bg-surface` / `bg-elevated` / `bg-subtle` | Camadas de fundo (light/dark) | CSS vars |
| `fg` / `fg-secondary` / `fg-muted` | Hierarquia de texto (light/dark) | CSS vars |
| `border` | Borda sutil | CSS var |

**Regra:** nunca usa `bg-brand` em CTA operacional — esse é `tom`. `brand` fica pra
identidade da marca, não pra fluxo.

### §1.2. Categorias de projeto (paleta dedicada — Sprint 22.19)

Discreta, texto suave, sem uppercase. Não pode colidir com status nem Eisenhower.

| Categoria | Background | Texto |
|---|---|---|
| `pedagogical` | `bg-[#8B5CF6]/15` | `text-[#C4B5FD]` (violet) |
| `commercial` | `bg-[#D946EF]/15` | `text-[#F0ABFC]` (fuchsia) |
| `administrative` | `bg-[#06B6D4]/15` | `text-[#A5F3FC]` (cyan) |
| `operational` | `bg-[#14B8A6]/15` | `text-[#99F6E4]` (teal) |
| `event` | `bg-[#F43F5E]/15` | `text-[#FECDD3]` (rose) |
| `infrastructure` | `bg-[#64748B]/20` | `text-[#CBD5E1]` (slate) |

Renderiza via `<CategoryTag />` (ver §3.1). Não duplicar palette em outro arquivo.

### §1.3. Eisenhower (dot inline 6px)

| Quadrante | Classe |
|---|---|
| Q1 (urgente+importante) | `bg-danger` |
| Q2 (importante) | `bg-warning` |
| Q3 (urgente) | `bg-info` |
| Q4 | sem dot |

---

## §2. Tipografia

| Token | Uso |
|---|---|
| `text-screen-title` (24px / 700) | Título da tela (ex: "Hoje", "Projetos") |
| `text-section-title` (20px / 700) | Cabeçalho de seção dentro da tela |
| `text-card-title` (18px / 600) | Título de card (projeto, dia, etc.) |
| `text-body-lg` (16px / 500) | Conteúdo destacado |
| `text-body-md` (15px / 400) | Conteúdo padrão |
| `text-body-sm` (13px / 400) | Metadados, descrição secundária |
| `text-label` (12px / 700) | Chips de status, dias da semana |

`tabular-nums` em qualquer número (data, percentual, contador). Datas curtas tipo
"DD/MM" sempre com tabular-nums pra não dançar.

---

## §3. Espaçamento e raios

Spacing escala: `xs=4` `sm=8` `md=16` `lg=24` `xl=32` `2xl=48`. Usa esses,
nada de números soltos.

Raio: `rounded-sm=10px` (chips, tags), `rounded-md=16px` (cards), `rounded-lg=20px`
(painéis maiores), `rounded-full` (checkbox, FAB, pill).

Sombra: `shadow-card` em cards no light mode (`dark:shadow-none`). `shadow-soft`
pra modais/sheets.

---

## §4. Componentes globais (criados na prep da Phase A)

### §4.1. `<CategoryTag project={{ name, category }} />`

Substitui as 3 cópias de palette inline em `TaskRow`, `ProjectCard`, `Semana`.
Renderiza chip com cor da categoria; se sem categoria, fallback `bg-bg-elevated text-fg-muted`.

```tsx
<CategoryTag project={task.projects} />
```

Path: `web/src/components/CategoryTag.tsx`

### §4.2. `<TaskCheckbox task done overdue size onClick />`

Checkbox redondo (border-2, rounded-full). Estados:
- `done`: `bg-tom border-tom`, ícone check branco
- `overdue && !done`: `border-danger`
- `pending`: `border-fg-muted hover:border-tom`
- Disabled: `opacity-50 cursor-not-allowed`

Tamanhos: `sm` (h-4 w-4), `md` (h-6 w-6).

Path: `web/src/components/TaskCheckbox.tsx`

### §4.3. `<EmptyDay message />`

Estado vazio compacto pra dia/seção sem itens. Texto em `text-body-sm text-fg-muted italic`.

```tsx
<EmptyDay message="Nenhuma tarefa" />
```

Path: `web/src/components/EmptyDay.tsx`

---

## §5. Padrões de tela

### §5.1. Card padrão (`surface`)

```tsx
<section className="surface p-md">…</section>
```

`surface` é classe utilitária (definida em `index.css`) = `bg-bg-surface rounded-md
border border-border shadow-card dark:shadow-none`. Reaproveita.

### §5.2. Badge de status (chip)

`text-label text-fg-muted bg-bg-elevated rounded-full px-2 py-0.5 border border-border`.
Mostrar **apenas** quando status difere do default ("active" não merece chip).

### §5.3. Headers de seção

`text-section-title` + opcional `text-body-sm text-fg-muted` abaixo. Espaço entre
header e conteúdo: `space-y-md` (16px).

### §5.4. Progress bar

```tsx
<div className="h-1.5 w-full bg-bg-elevated rounded-full overflow-hidden">
  <div className="h-full bg-tom transition-[width]" style={{ width: `${pct}%` }} />
</div>
```

Variante de header: `h-1` (mais fino).

### §5.5. Bloco "Por que" / Rationale (Sprint 22 Phase A)

Card destacado renderizado **acima** dos itens de um checkpoint expandido.

```tsx
<div className="bg-tom/5 border-l-2 border-tom rounded-sm p-md text-body-sm text-fg-secondary">
  <div className="text-label text-tom mb-1">💡 POR QUE ESSE CHECKPOINT</div>
  {rationale}
</div>
```

Renderiza só se `rationale` preenchido. Suporta markdown básico (parágrafos, ênfase) —
usar `react-markdown` simples, sem extensions.

### §5.6. Bloco Contingências (Sprint 22 Phase A)

Seção dobrável, colapsada por padrão. Abre com ícone `🚨` e título "Contingências".
Cada item: card com `scenario` em `text-body-md font-semibold` e `protocol` em
`text-body-sm text-fg-muted` abaixo. Stack vertical com `space-y-2`.

---

## §6. Anti-padrões (não fazer)

- `bg-brand` em CTA operacional → use `bg-tom`.
- `text-label uppercase tracking-wide` em chips de categoria → barulho visual; categoria fica suave (lowercase, font-medium).
- Cor diferente da §1.2 pra categoria → quebra contrato.
- Verde forte (`text-success`/`text-tom`) em duas coisas competindo na mesma tela
  (ex: status "concluído" + categoria escola) → escolha uma.
- Margens em pixels soltos (`mt-3.5`, `gap-[18px]`) → usa escala §3.
- Duplicar palette de categoria em arquivo novo → importa `<CategoryTag />`.

---

## §7. Próximas adições previstas

- Sprint 22 Phase B: padrão pra tabelas densas (DashboardTime, ConfigurarEquipe).
- Sprint 22 Phase C: padrão pra sheets/modais (RescheduleSheet, QuickCreateSheet, etc.).
- Sprint 24: bloco "Runbook T-minus" (Dia do Evento) — paleta provavelmente derivada
  de `event` (rose) com escala temporal própria.
