# Grupos de Tarefas (tarefa-mãe + subtarefas) — Design

**Data:** 2026-06-09
**Autor:** Alf + Claude (brainstorming, telas validadas no Visual Companion)
**Origem:** Rose (gerente Recreio) usa o Microsoft To-Do pra "Conciliação Cartões" — tarefa mensal com steps ("Cartão Barra", "Mercado Pago"...). Ela pediu o que o To-Do **não dá**: prazo e lembrete **por subtarefa** ("cada cartão tem um vencimento e o prazo delas é diferente" — Barra dia 12, EMLA dia 12, Recreio dia 17, MP dia 25, Kids 1/2 dia 27). Objetivo do Alf: um "to-do super poderoso" pra ela — organiza E corre atrás (TOM cobra no WhatsApp no dia de cada cartão).

---

## Objetivo

Permitir criar um **grupo de tarefas** no painel de tarefas (Agenda/Hoje): uma tarefa-mãe que agrupa subtarefas, cada subtarefa com **prazo, hora e lembretes próprios**, com **recorrência mensal do grupo inteiro**, drag-and-drop pra ordenar, barra de progresso, em **mobile e desktop**.

## Não-objetivos (YAGNI — v1)

- TOM **criar** grupos por conversa (fase 2; no v1 ele enxerga, lembra, cobra e conclui).
- Grupos aninhados (subtarefa não tem filhas).
- Delegar/transformar-em-compromisso a mãe ou as filhas (menus dessas ações ficam ocultos em tasks de grupo no v1 — evita órfãos no grupo).
- Recorrência semanal/diária de grupo (v1: **mensal** ou **sem repetição**; o modelo comporta as outras depois).
- Compartilhar grupo entre pessoas (grupo é pessoal: `assigned_to` = dono em mãe e filhas).

---

## Decisões travadas (validadas com o Alf, telas aprovadas no Companion)

| # | Tema | Decisão |
|---|---|---|
| 1 | Natureza da subtarefa | **Tarefa real** (linha em `tasks`): aparece nas visões do dia no dia do seu prazo, TOM lembra/cobra/conclui como tarefa normal. |
| 2 | Recorrência | **O grupo inteiro renasce 1x/mês** (modelo To-Do): motor materializa a árvore (mãe + filhas), preservando o **dia-do-mês** de cada filha (clamp em mês curto: 31→30) e clonando lembretes com delta. |
| 3 | Conclusão da mãe | **Auto + cascata**: última filha concluída → mãe auto-conclui (celebração 🎉); concluir a mãe manualmente pergunta "concluir as N subtarefas abertas?" e fecha tudo. |
| 4 | TOM no v1 | PWA cria/edita; TOM **enxerga** (briefing/contexto com selo "· grupo X" nas filhas), lembra (`task_reminders`), e o toggle por WhatsApp em filha dispara a auto-conclusão da mãe (paridade com o PWA). |
| 5 | UI no Hoje | **Card inline (opção A)**: o grupo aparece na lista do dia como card com barra de progresso ("2/6 · junho"), com as filhas **do dia dentro dele** (sem linha duplicada) e resumo "+N no mês". |
| 6 | Detalhe do grupo | Sheet/modal com o ciclo corrente: filhas com ⠿ drag-and-drop (`sort_position`), prazo/lembrete por filha, "＋ Adicionar subtarefa" inline, rodapé com prazo do grupo + repetição. Tocar na filha abre o editor normal de tarefa. |
| 7 | Criação | 4º kind "🗂️ Grupo" no `QuickCreateSheet`: título, Trabalho/Pessoal, subtarefas com chips inline (📅 dia, 🕐 hora, 🔔 lembrete), Repetição (Mensal/Não repete), prazo do grupo opcional. **Grupo mensal escolhe prazo da filha como "dia do mês" (1–31)**, não data completa. |
| 8 | Desktop | Hoje: mesmo card em largura cheia. Agenda (painel compacto): grupo = linha expansível ▼/▸ com mini-barra + contagem; dias futuros mostram colapsado com a filha que vence. Criação em modal central (`AdaptiveSheet` já faz). |

---

## Modelo de dados

### Migração

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;

-- Guard de 1 nível: filha não pode ser grupo (CHECK simples)
ALTER TABLE tasks ADD CONSTRAINT tasks_no_nested_groups
  CHECK (NOT (is_group AND parent_task_id IS NOT NULL));
```

- **Mãe:** `is_group=true`, `due_date` opcional (prazo do grupo), `recurrence_rule` opcional (`FREQ=MONTHLY;BYMONTHDAY=1` — âncora interna dia 1; o usuário só vê "Mensal").
- **Filha:** `parent_task_id=<mãe>`, `due_date`/`due_time`/`task_reminders` próprios, `sort_position` (DnD — coluna já existe), `context` herdado da mãe.
- **RLS:** inalterada — mãe e filhas são tasks normais do dono (`assigned_to`). O `ON DELETE CASCADE` remove filhas ao apagar a mãe.

### Recorrência em árvore (a peça nova do motor)

Estado hoje: template (`recurrence_rule` NOT NULL, `recurrence_parent_id` NULL) materializa instâncias (`recurrence_parent_id=template`) no horizonte de 30 dias — `src/services/recurrence-engine.js` (00:30 BRT) + espelho client `web/src/lib/materialize-recurrence.ts`; lembretes clonam com delta (`_cloneRemindersForInstances`).

Extensão: ao materializar uma ocorrência de **mãe-template** (`is_group=true`):
1. Cria a **mãe-instância** (como hoje: `recurrence_parent_id=mãe-template`, due_date com dia-do-mês preservado).
2. Para cada **filha-template** (`parent_task_id=mãe-template`): cria **filha-instância** com:
   - `parent_task_id = mãe-instância.id`
   - `recurrence_parent_id = filha-template.id` (liga instância→template; dá idempotência)
   - `due_date` = **mesmo dia-do-mês da filha-template** no mês da ocorrência (clamp: `min(dia, último_dia_do_mês)`)
   - `due_time`, `sort_position`, `description` copiados; `status='pending'`
   - `task_reminders` clonados com delta (mecanismo existente)
3. **Idempotência:** pula se já existe task com (`recurrence_parent_id=filha-template` AND `parent_task_id=mãe-instância`); mãe segue a idempotência atual (mesmo due_date).
4. Espelhar a MESMA lógica no client (`materialize-recurrence.ts`) — criar grupo recorrente materializa o 1º ciclo na hora.

Ciclo anterior inacabado **não fecha sozinho**: filhas atrasadas de junho continuam atrasadas (cobrança normal) mesmo após nascer julho. O card mostra o mês do ciclo ("· junho").

### Visibilidade (sem vazamento de template/filha)

Regra nova nas queries de lista (Hoje, Semana, useAgendaTasks, briefing): **filha nunca aparece como linha solta** — `parent_task_id IS NULL` no filtro base. Filhas entram **pelo card do grupo** (nested select). Isso também esconde as filhas-template de graça (a mãe-template já é escondida pelo filtro de template atual).

Busca do Hoje (modelo A): além das tasks soltas do dia, buscar **mães-instância relevantes pro dia** = (alguma filha `due_date<=dia` não concluída) OU (filha concluída no dia) OU (**ciclo do mês corrente/atrasado**: mãe aberta com `due_date` no mês do dia ou anterior — visível o mês todo, ciclos futuros já materializados ficam fora) OU (grupo simples sem prazo criado no dia) OU (mãe concluída no dia), com filhas embutidas (`tasks!parent_task_id(...)` ordenadas por `sort_position`). O card destaca as filhas do dia/atrasadas e resume o resto ("+N no mês"). *(Regra refinada no E2E de 10/06 — a original escondia o grupo recém-criado e vazava o ciclo futuro.)*

---

## Comportamento

### Conclusão (cascata dupla)
- Toggle de filha → done. Se era a **última** aberta do grupo: mãe → done + toast/celebração ("🎉 Conciliação Cartões de junho concluída!").
- Toggle da mãe → se há filhas abertas, `ConfirmDialog` "Concluir também as N subtarefas abertas?" → sim: fecha todas + mãe; não: cancela (mãe não conclui com filhas abertas).
- Reabrir filha de grupo concluído → mãe reabre (`status='pending'`, `completed_at=null`).
- **Paridade no engine:** o caminho de `complete` de task via WhatsApp (`applyTaskActions`) ganha o mesmo pós-processamento (última filha → mãe done; TOM celebra na resposta).

### TOM (v1)
- Lembretes: automáticos (filhas têm `task_reminders` — job existente).
- Briefing/contexto (`system.js` renderTaskList): filha ganha sufixo `· 🗂️ <nome do grupo>`; mãe aparece como `🗂️ Grupo <nome> (2/6)` em vez de listar como tarefa comum. Truncamento existente (8 linhas) preservado.
- Toggle por conversa: já funciona (filha = task). Auto-conclusão da mãe via item acima.

### Edição
- Tocar na filha → `EditTaskSheet` normal (título/data/hora/lembretes). Em grupo **recorrente**, mudanças estruturais (renomear, mudar dia, adicionar/remover filha) perguntam o escopo com o `RecurrenceScopeDialog` **existente**: "só este mês" (edita instância) ou "deste mês em diante" (edita template + instâncias futuras já materializadas).
- DnD: reordena `sort_position` das filhas da instância (e do template quando escopo "em diante").
- Apagar grupo: confirm; cascade remove filhas. Grupo recorrente pergunta escopo (só este mês = apaga instância; sempre = apaga template+instâncias futuras não concluídas).

---

## Mapa de arquivos

### Migração
- `migrations/2026-06-09-task-groups.sql` — `parent_task_id`, `is_group`, índice, CHECK.

### Backend (engine)
- `src/services/recurrence-engine.js` — materialização em árvore (mãe-template com filhas) + idempotência.
- `src/engine.js` — pós-processamento de `complete`/`toggle` de filha (auto-conclui mãe); contexto/briefing com selo de grupo fica em `src/prompts/system.js` (renderTaskList + query de tasks com `parent_task_id`/`is_group`).

### Frontend (`web/src`)
- `lib/materialize-recurrence.ts` — espelho da materialização em árvore.
- `lib/taskGroups.ts` — **novo**: fetch de grupos do dia (mãe+filhas nested), cascata de conclusão (`completeChild`, `completeGroup`), helpers de ciclo ("junho").
- `components/TaskGroupCard.tsx` — **novo**: card do grupo (Hoje mobile/desktop) — cabeçalho (🗂️ nome · x/y · ciclo · prazo), `gbar` progresso, filhas do dia com `TaskCheckbox`, "+N no mês".
- `components/TaskGroupSheet.tsx` — **novo**: detalhe do grupo (AdaptiveSheet) — lista completa do ciclo com DnD (`dnd-kit`, padrão `PersonalChecklistCard`), add-subtarefa inline, rodapé (prazo, repetição), menu (editar/apagar com escopo).
- `components/QuickCreateSheet.tsx` — 4º kind `group`: form da tela aprovada (chips dia-do-mês 1–31 quando Mensal; `DateInput` quando sem repetição); cria mãe+filhas+lembretes e materializa 1º ciclo se recorrente.
- `screens/Hoje.tsx` — filtro `parent_task_id IS NULL` na query + busca de grupos do dia + render `TaskGroupCard` no topo da seção; contadores incluem filhas.
- `screens/Semana.tsx` — filtro `parent_task_id IS NULL` + o mesmo `TaskGroupCard` no dia em que o grupo é relevante (reuso direto, card colapsável).
- `screens/agenda/hooks/useAgendaTasks.ts` + `screens/agenda/leftPanel/` — filtro `parent_task_id IS NULL`; Agenda desktop: linha expansível do grupo no painel (componente compacto novo `GroupRow`, padrão da tela aprovada: ▼/▸ + mini-barra + contagem; dias futuros colapsado com a filha que vence).
- `components/EditTaskSheet.tsx` — quando task é filha/mãe de grupo: esconder "Transformar em" (não-objetivo v1); filha mostra "🗂️ do grupo X".
- `types.ts` — `Task.parent_task_id?`, `Task.is_group?`, `Task.subtasks?: Task[]`.

---

## Erros & bordas

- Mês curto: dia 29/30/31 → clamp pro último dia (motor e criação).
- Grupo sem filhas: card mostra "0 subtarefas — adicionar"; mãe se comporta como tarefa simples até ganhar filhas.
- Filha sem prazo: permitida; aparece só no detalhe (nunca nas listas do dia) e sem lembrete.
- Conclusão simultânea (PWA + WhatsApp): cascata é idempotente (re-checa contagem de abertas antes de fechar a mãe).
- Instâncias futuras já materializadas quando o template muda ("em diante"): re-sincronizar (apagar não-concluídas e re-materializar) — mesmo padrão do `editTaskSeries` atual.
- KPI/contadores: filhas contam como tarefas (decisão: são reais).

## Testes

- **Unit (vitest):** clamp de dia-do-mês; idempotência da materialização em árvore (client); cascata (última filha→mãe; mãe→todas; reabrir filha→reabre mãe).
- **Unit (node:test, engine):** materialização em árvore no recurrence-engine; auto-conclusão via toggle do engine.
- **Manual (Preview 375px/1440px):** criar grupo mensal com 4 filhas (dias 12/12/17/25) → card no Hoje no dia 12 com 2 filhas; concluir todas → 🎉 e mãe fecha; virada de mês (forçar materialização) → grupo renasce com dias certos; DnD persiste; desktop painel expansível.
- **TOM (VPS):** lembrete de filha dispara no dia; "conclui o cartão Barra" via WhatsApp fecha filha (e mãe se for a última); briefing mostra selo do grupo.

---

## Riscos & honestidades

- **Materialização em árvore** é a parte mais delicada (escolha consciente do Alf — modelo To-Do). Mitigação: idempotência por (`recurrence_parent_id` filho-template + `parent_task_id` mãe-instância), testes de virada de mês, e o motor já roda há semanas estável pra tasks planas.
- **Queries do Hoje** ganham 1 busca extra (grupos do dia). Volume é baixo (single-digit grupos por pessoa).
- Briefing: pessoas com muitos grupos podem estourar o truncamento de 8 linhas — mães agregadas ("🗂️ X (2/6)") até ALIVIAM o problema vs. filhas soltas.
