# Tela de leitura de tarefa (expandir descrição) — agenda pessoal/delegada + workspace de grupo

**Data:** 2026-06-25
**Autor:** catraca (revisor) + Alf
**Status:** design aprovado (Abordagem A), aguardando review da spec

## Problema

A descrição de uma tarefa só é legível **dentro do formulário de edição**, num campo apertado que **corta/rola**:

- **Agenda (Hoje/Semana):** tocar a tarefa só abre o menu ⋮ → Editar → `EditTaskSheet`. A descrição aparece num bloco travado em `max-h-64` (256px) que rola por dentro (`EditTaskSheet.tsx:255`), no meio de um form cheio de campos de edição.
- **Workspace do grupo:** tocar o card abre direto o `GroupTaskSheet` (edição); a descrição é um `<textarea>` travado em 320px que rola por dentro (`GroupTaskSheet.tsx:50`).

Feedback real da equipe (WhatsApp, 25/06): *"tem como fazer a descrição ficar em um texto só, sem cortar? quando o texto fica grande ele corta."*

Para uma tarefa **delegada**, a descrição **é a instrução do que fazer** — enterrá-la num form de edição apertado é a pior UX possível pra quem só quer ler e executar.

## Objetivo

Ao **tocar uma tarefa** — na agenda (Hoje/Semana) ou no workspace do grupo — abrir uma **view de LEITURA** que mostra a descrição **inteira, grande, sem corte** (rola junto com a tela), com ações rápidas (Concluir / Editar). Vale para tarefa **delegada, pessoal e de grupo**.

## Não-objetivos

- Não mexer no comportamento/voz do TOM (sagrado).
- Não mudar o fluxo de **edição** — o `EditTaskSheet`/`GroupTaskSheet` continuam intactos, agora atrás do botão `Editar`.
- Não transformar descrição em rich-text — descrição de tarefa é **texto puro**; render preserva quebras de linha, nada mais.
- Não tocar no schema (a não ser um join de leitura na query da agenda).

## Abordagem (A — aprovada)

Tocar o card abre uma **tela de leitura** (não o form). A edição vira secundária (botão `Editar`). Leitura e edição separadas — cada uma boa no que faz. Reaproveita `AdaptiveSheet` (bottom-sheet no mobile, painel no desktop) — mesmo padrão dos sheets atuais, zero overlay novo.

## Arquitetura

### Componente novo: `TaskDetailSheet` (read-only)
`web/src/components/TaskDetailSheet.tsx`, base `AdaptiveSheet` (`size="md"`). Props **normalizadas** (cada caller adapta seu tipo de tarefa):

```ts
interface TaskDetailSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  metaLine: React.ReactNode;        // "Delegada por X" | "👥 grupo · criada por X" | "pessoal"
  description: string | null;
  dueLabel?: string | null;         // "25/06" / "hoje" / "atrasada 22/06"
  statusTone?: 'neutral' | 'warning' | 'danger' | 'success';
  statusLabel?: string | null;      // "pendente" | "atrasada" | "concluída"
  doneByLine?: React.ReactNode;     // "concluída por Y" quando done
  isDone?: boolean;
  isRecurring?: boolean;
  canComplete?: boolean;            // esconde o botão pra quem não pode
  completing?: boolean;
  onComplete?: () => void;
  onReopen?: () => void;
  onEdit?: () => void;              // abre o form de edição existente
}
```

**Render da descrição (o coração):** `<div className="whitespace-pre-wrap break-words text-body-md text-fg">` **SEM** `max-height` — rola junto com a sheet, nunca corta. Quando vazia, mostra "(sem descrição)" discreto.

**Rodapé de ações:** `Concluir` (✓, se `canComplete && !isDone`) · `Reabrir` (se `isDone && onReopen`) · `Editar` (se `onEdit`) · `Fechar`. Gestor não-membro (read-only no grupo): só `Fechar`.

### Superfície 1 — Agenda (mobile + desktop)
Dois componentes de linha, dois caminhos de toque hoje:
- **Mobile** (`Hoje.tsx`, `Semana.tsx`) usa `TaskRow.tsx` — o card **não** tem clique no corpo hoje (só o menu ⋮). Adicionar prop opcional `onOpen?(task)`: o **corpo do card** vira clicável → abre a leitura. O menu ⋮ (Editar/Reagendar/Excluir/...) e o checkbox continuam iguais e **não** disparam `onOpen` (stopPropagation).
- **Desktop** (`agenda/leftPanel/DayPanel.tsx`, `WeekPanel.tsx`, `MonthPanel.tsx`) usa `CompactTaskRow.tsx`, que **já tem `onClick`** — hoje abre o `EditTaskSheet`. Passa a abrir a leitura (`TaskDetailSheet`); o `Editar` de dentro da leitura é que abre o `EditTaskSheet`.
- Os parents (Hoje/Semana mobile + o container do leftPanel desktop) montam **um** `TaskDetailSheet` e mapeiam:
  - `metaLine`: delegada (`created_by≠eu` e `assigned_to=eu`) → "Delegada por {creator}"; pool de grupo (`assigned_group_id`) → "👥 {grupo} · criada por {creator}"; senão "pessoal".
  - `onComplete` → o toggle de baixa já existente; `onEdit` → abre o `EditTaskSheet` atual; `onReopen` quando aplicável.
- `useAgendaTasks.ts`: **adicionar o join do criador** no select (`creator:collaborators!tasks_created_by_fkey(preferred_name, full_name)`) — hoje só vem `created_by` (id). É o que alimenta "Delegada por / criada por". Mesmo padrão já usado no fix do TOM (grupo). (Já existe `useCollaboratorNames` no leftPanel pra resolver nome do delegado — reusar/alinhar em vez de duplicar.)

### Superfície 2 — Workspace do grupo
- `GrupoWorkspace.tsx`: `PoolRow.onOpen` passa a abrir o `TaskDetailSheet` (leitura) em vez de `setEditing` (form). O `Editar` da leitura chama `setEditing` → abre o `GroupTaskSheet` atual (intacto).
  - `metaLine`: "👥 {grupo} · criada por {creator_name}" (já disponível em `PoolTaskRow.creator_name`).
  - `onComplete` → `onToggle`; `onReopen` → `onReopen` existente; `onEdit` → `setEditing(t)`.

## Estados e permissões (reusar regras existentes)
- **Delegada:** o assignee conclui; o creator pode dar baixa do lado dele (regra atual). `Editar` conforme já é hoje.
- **Concluída:** mostra `doneByLine` ("concluída por X") + botão `Reabrir`.
- **Gestor não-membro (grupo):** `readOnly` → só lê + `Fechar` (sem Concluir/Editar), igual o `readOnly` atual do `GroupTaskSheet`.

## Decisões
1. **Leitura ≠ edição:** a view é só pra ler; toda edição fica atrás do `Editar` (forms atuais preservados). (Decisão Alf 25/06.)
2. **Descrição texto puro:** `whitespace-pre-wrap`, **sem teto de altura**. Sem rich-text.
3. **Reusar `AdaptiveSheet`** (consistência mobile/desktop), não criar overlay novo.
4. **Bloco de descrição nos forms de edição:** o cap (`max-h-64` no `EditTaskSheet`, 320px no `GroupTaskSheet`) deixa de ser o caminho de leitura. Pode permanecer (inofensivo) — a leitura primária migra pro `TaskDetailSheet`. Sem mudança obrigatória neles.

## Testes / validação
- `npx tsc --noEmit` + `npx vite build` limpos.
- **Preview (localhost:4173), mobile 375px:** abrir uma tarefa **delegada com descrição longa** na agenda → descrição **inteira, sem corte**; `Concluir` dá baixa; `Editar` abre o form; voltar funciona.
- **Desktop 1440px:** mesma coisa (guardrail desktop — mobile intacto).
- **Grupo:** tocar card no workspace → leitura; `Editar` → `GroupTaskSheet`; `Concluir` dá baixa do pool.
- **Regressão:** menu ⋮ e fluxo de edição/save intactos; checkbox não abre a leitura; 38 rotas de produção sagradas.

## Fora de escopo (possível depois)
- Preview de 1–2 linhas da descrição no próprio card (dica de que "tem mais").
- Mesma leitura em outras telas que listam tarefa (PessoaDetalhe, etc.).
