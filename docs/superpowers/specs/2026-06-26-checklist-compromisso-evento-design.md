# Checklist de Compromisso/Evento — Design

**Data:** 2026-06-26
**Autor:** chat coordenação (revisor/catraca)
**Status:** aprovado (escopo "Tudo: UI + TOM", primitivo = tabela-satélite)

## Problema

A feature de checklist/subtarefa (entregue 26/06) cobre tarefa pessoal/delegada/grupo
reusando `tasks.parent_task_id`. **Compromisso é EVENTO** — mora na tabela `events`,
que NÃO tem `parent_task_id`. Logo o motor de checklist de tarefa não alcança evento.
O Alf pediu o checklist também no compromisso (pauta/preparação da reunião).

## Decisão de arquitetura

**Primitivo: nova tabela-satélite `event_checklist_items`** (idiomático — eventos JÁ usam
`event_participants` e `event_reminders` como satélites). Descartados: JSONB no evento
(marcar 1 item = reescrever o array, risco de clobber, foge do padrão de linha) e reuso de
`event_runbook` (timeline com offset de minutos, semântica errada pra pauta).

**Semântica:** PAUTA/PREPARAÇÃO. Marcar item NÃO conclui o compromisso (diferente de
tarefa, onde o pai pode ser concluído). É só uma lista de "o que preparar/cobrir".

## Esquema

```sql
create table event_checklist_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  done boolean not null default false,
  sort_position int,
  created_by uuid references collaborators(id),
  created_at timestamptz not null default now()
);
create index event_checklist_items_event_idx on event_checklist_items(event_id);
```

**RLS** (espelhar `event_reminders`/`event_participants`):
- SELECT: quem enxerga o evento-pai (dono `collaborator_id` OU participante OU visão de
  coordenação que já vê o evento). Reusar exatamente o predicado de visibilidade do
  `event_reminders`/`events`.
- INSERT/UPDATE/DELETE: **dono do evento** (`events.collaborator_id = current_collab_id()`)
  — o dono monta/gerencia a pauta. (v1 simples; participante-marca pode ser fatia futura.)
- Engine escreve via `service_role` (ignora RLS) — `created_by` vem do remetente real.

## Superfícies (paridade com o checklist de tarefa)

| Superfície | Arquivo | Comportamento |
|---|---|---|
| **Criar** | `QuickCreateSheet.tsx` (aba Compromisso, `createEvent`) | Campo "Checklist" (rascunho local `string[]`) → após o `insert` do evento, insere os itens com `event_id`. Igual ao `ChecklistDraftField` da tarefa. |
| **Editar** | `EditEventSheet.tsx` + `EventEditDrawer.tsx` (desktop) | Seção `EventChecklistSection` (ver/marcar/add/remover) — evento já existe, usa o hook. |
| **Ver** | `EventoDetalhe.tsx` | Seção `EventChecklistSection` (ver/marcar). |

**Componentes novos (PWA):**
- `useEventChecklist(eventId, opts)` — React Query: `{ items, progress, addItem, toggleItem, removeItem }`. Espelha `useTaskChecklist`, mas sobre `event_checklist_items` (campo `done` em vez de `status`).
- `EventChecklistSection({ eventId, editable })` — espelha `TaskChecklistSection`. SEM `<form>` aninhado (botão `type=button` + Enter `preventDefault`) — `EditEventSheet`/`QuickCreateSheet` são `<form>`.
- `EventChecklistDraftField({ items, onChange })` — rascunho local na criação (igual ao da tarefa). (Pode ser o mesmo componente genérico do draft.)

**Permissão de marcar:** `editable` quando o usuário é o **dono do evento** (`collaborator_id === meId`). Outros (participantes/coordenação) veem read-only no v1.

## TOM

Estender o handler `<<EVENT_CREATE>>` (engine.js ~2165) com campo opcional
`checklist: ["item1", "item2"]`. Após o `insert` do evento (já existe, retorna `id`),
inserir os itens em `event_checklist_items` (service_role, `created_by` = remetente).
Best-effort (não derruba a criação do evento se falhar). Anti-confab: só dizer "com
checklist de N" se de fato emitiu/persistiu N. Atualizar a skill de criar evento/compromisso.

## Fora de escopo (v1)

- Participante (não-dono) marcar item — fatia futura se o Alf pedir.
- `<<EVENT_UPDATE>>` add/marca item via TOM — v1 só cria no `EVENT_CREATE`; gestão fica na UI.
- Recorrência de evento + checklist: mesma limitação da tarefa (itens ficariam no template).
  Esconder o campo de checklist quando o evento é recorrente (igual à tarefa).

## Zero-regressão

- Eventos NÃO aparecem nas listas de tarefa, então não há "linchpin F2" aqui — a tabela é
  isolada. Risco principal = RLS (não vazar pauta de evento pra quem não vê o evento) e o
  `<form>` aninhado (resolvido com botão `type=button`).
- Não tocar `event_runbook`, `event_participants`, `event_reminders`.
