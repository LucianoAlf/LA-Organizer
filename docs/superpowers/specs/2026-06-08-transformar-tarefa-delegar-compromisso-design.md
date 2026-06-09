# Transformar Tarefa (Delegar / Compromisso) — Design

**Data:** 2026-06-08 (rev. 2 — arquitetura simplificada após leitura do código)
**Autor:** Alf + Claude (brainstorming)
**Origem:** 2 áudios do Quintela. Ele cria muitas tarefas no susto pelo WhatsApp (várias são só "lembrete pra mim de repassar algo"). Quer entrar no Organizer e **lapidar**: pegar uma tarefa e transformá-la em (a) **compromisso** (evento na agenda) ou (b) **tarefa delegada** a outra pessoa.

---

## Objetivo

Permitir, dentro do Organizer (desktop + PWA), transformar uma tarefa **existente** em:
- **Compromisso** — vira um evento na agenda; a tarefa original é arquivada (com rastro), sem cobrança duplicada.
- **Tarefa delegada** — atribuída a um membro da equipe do líder; o TOM avisa o delegado pelo WhatsApp. **Só líderes** veem a ação.

## Não-objetivos (YAGNI)

- Sem loop de "aceitar/recusar" delegação (o delegado é só notificado; a tarefa já aparece pra ele).
- Sem delegação em massa (uma tarefa por vez).
- Sem reabrir a tarefa após virar compromisso.
- **Sem endpoint serverless novo nem mudança de RLS** (ver Arquitetura — reusa o padrão client-side que já existe).
- **Re-delegar tarefa de terceiro** (quem só tem `has_coord_permissions` re-atribuindo tarefa que não é sua) fica fora do v1 — limitado pela RLS atual, que NÃO vamos afrouxar.

---

## Decisões travadas (validadas com o Alf)

| Tema | Decisão |
|---|---|
| Pontos de entrada | **Dois**: menu rápido (⋯) no card da tarefa **e** seção "Transformar em" dentro do "Editar tarefa". Cada ação abre seu próprio `AdaptiveSheet`. |
| Notificar delegado | **Sim, na hora** — reusa `notifyTaskDelegated()` → `/internal/task-delegated` (já existe, envia WhatsApp imediato). |
| Pra quem delega | **Equipe direta** do líder (governance edges). Diretor vê todos. Fallback: líder sem equipe configurada → todos os ativos. |
| Quem vê "Delegar" | `role IN (coordinator, manager, director)` **OU** `has_coord_permissions = true` — **E** pode editar a tarefa (é criador/responsável, ou é coord/director pela RLS). |
| Tarefa→compromisso | Cria evento (`source='manual'`) + **arquiva** a tarefa (`status='cancelled'`, `converted_to_event_id` = id do evento). |
| Arquitetura | **Tudo client-side via Supabase** (mesmo padrão de `QuickCreateSheet`). Delegação chama o helper interno já existente. Sem serverless, sem RLS nova. |
| DS | Tokens reais (dark, verde `tom #A3BE50`, Inter). Componentes: `AdaptiveSheet`, `DateTimeInput`/`DateInput`/`TimeInput`, `CustomSelect`, `Button`, `RowMenu`. |
| Mobile + Desktop | `AdaptiveSheet` (bottom-sheet mobile / modal desktop). Testar 375px e 1440px. |

---

## Arquitetura

O app **já faz** os três fluxos (tarefa/compromisso/delegar) em `web/src/components/QuickCreateSheet.tsx`, client-side via Supabase, e a delegação já dispara WhatsApp via `notifyTaskDelegated()`. Esta feature **reusa essa lógica**, aplicada a uma tarefa **já existente**.

### 1. Pontos de entrada (UI)

**a) Menu rápido no card** (`TaskRow.tsx` → `RowMenu`, cujo `MenuItem = { label, onClick, danger?, confirm? }`):
- `📆 Transformar em compromisso` — visível pra quem pode editar a tarefa.
- `👥 Delegar` — visível só se `canDelegateThisTask` (ver Autorização).

**b) Dentro do "Editar tarefa"** (`EditTaskSheet.tsx`): mesmos dois itens numa seção "Transformar em" no rodapé.

Ambos abrem:
- `DelegateTaskSheet.tsx` (novo `AdaptiveSheet`)
- `ConvertToEventSheet.tsx` (novo `AdaptiveSheet`)

### 2. Delegar (client-side)

```
DelegateTaskSheet → supabase:
  UPDATE tasks
    SET assigned_to=<assignee>, delegated_to=<assignee>, delegated_at=now(),
        status='delegated', due_date=<prazo editado se houver>
    WHERE id=<task.id>
  → notifyTaskDelegated(task.id)   // /internal/task-delegated → WhatsApp imediato
  → showToast(sucesso | "salvo, mas WhatsApp falhou (<reason>)")
```

- **Espelha exatamente** o write do `engine.js` (delegate): seta `assigned_to` + `delegated_to` + `delegated_at` + `status='delegated'`.
- A mensagem do TOM é composta pelo próprio `/internal/task-delegated` (`"📌 {criador} delegou pra você: {título} (prazo ...)"`).
- `created_by` não muda. A aba "Delegadas" do líder filtra por `assigned_to != created_by` (derivação virtual já existente em `useAgendaTasks`).
- O recado opcional do mockup entra via `description` da tarefa (campo que o TOM já lê) — editável no sheet antes de delegar.
- **Nota de produção (dívida conhecida):** `notifyTaskDelegated` usa `VITE_INTERNAL_API_SECRET` exposto no bundle. Aceito em dev; sinalizar antes de produção (migrar `/internal/*` pra validação de JWT).

### 3. Transformar em compromisso (client-side)

Espelha o `createEvent` do `QuickCreateSheet`:

```
ConvertToEventSheet → supabase:
  cat = useEventCategories().byId(categoryId)   // default la_music
  startIso = `${startAt}:00-03:00`  endIso = `${endAt}:00-03:00`   // de DateTimeInput
  validar endIso > startIso
  INSERT events {
    title, description, collaborator_id=self, created_by=self,
    source='manual', status='scheduled', context=cat.context, category_id=cat.id,
    start_at, end_at, modality, location_text|meeting_url (regra online/hibrido),
    eisenhower_quadrant, remind_at = start-1h (se folga >=1h)
  } → returning id
  UPDATE tasks SET status='cancelled', converted_to_event_id=<event.id> WHERE id=<task.id>
  → showToast("Tarefa virou compromisso")
```

- Migra do task: título, descrição, contexto (via categoria), `project_id` (se aplicável), `eisenhower_quadrant`.
- Form: **Categoria** (`CustomSelect`, default la_music), **Início/Fim** (`DateTimeInput`), **Modalidade** (botões online/presencial/híbrido). `meeting_url` aparece em online/híbrido; `location_text` em presencial/híbrido — respeita o CHECK `events_meeting_url_for_remote`.
- Tarefa marcada `status='cancelled'` + `converted_to_event_id` (rastro). UI mostra "→ virou compromisso".

---

## Data Model (migração)

`migrations/2026-06-08-task-convert-to-event.sql`:

```sql
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS converted_to_event_id uuid
  REFERENCES events(id) ON DELETE SET NULL;
```

- **Sem** mudança em `events.source` — usamos `'manual'`, que o `events_source_check` já aceita (`'manual','tom','imported'`).
- **Sem** `pending_notifications` — notificação é imediata (decisão "avisa na hora").
- `tasks.status` já aceita `'delegated'` e `'cancelled'` (CHECK confirmado).

---

## Mapa de arquivos

### Frontend (`web/src`)
- `components/DelegateTaskSheet.tsx` — **novo**. `AdaptiveSheet`: picker de pessoa (equipe), `DateInput` (prazo pré-preenchido com `task.due_date`), textarea recado (→ `description`), botão "Delegar e avisar". Faz o UPDATE + `notifyTaskDelegated`.
- `components/ConvertToEventSheet.tsx` — **novo**. `AdaptiveSheet`: categoria/início/fim/modalidade/local-link + aviso de arquivamento. Faz INSERT event + UPDATE task.
- `components/TaskRow.tsx` — adicionar os 2 itens no `RowMenu` (Delegar gated por `canDelegateThisTask`); estados pra abrir cada sheet.
- `components/EditTaskSheet.tsx` — seção "Transformar em" no rodapé (mesmos 2 gatilhos).
- `hooks/useDelegableMembers.ts` — **novo**: resolve a equipe do líder logado. Query `governance_edges` (`leader_id = self → member_ids`) + `collaborators(is_active)`; director → todos ativos; fallback (sem arestas) → todos ativos. Exclui o próprio user.
- `contexts/AuthContext` — expor `has_coord_permissions` no `collaborator` (incluir no SELECT) e um helper `canDelegate` (role liderança OU `has_coord_permissions`).
- `lib/tomEngine.ts` — **reuso** de `notifyTaskDelegated` (sem mudança).

### Backend
- **Nenhuma mudança.** `/internal/task-delegated` já existe e já notifica.

---

## Autorização (resumo)

| Ação | Onde valida | Regra |
|---|---|---|
| Ver "Delegar" no card/editar | Frontend | `canDelegate` (role liderança OU `has_coord_permissions`) **E** pode editar a tarefa (criador/responsável, ou coord/director) |
| Escrever a delegação | RLS atual (cliente) | criador/responsável OU coord/director — **sem mudança** |
| Lista de delegáveis | Frontend (`useDelegableMembers`) | equipe direta; director=todos; fallback=todos ativos |
| Converter em compromisso | RLS atual (cliente) | dono da tarefa — sem mudança |

`canDelegateThisTask = canDelegate && (task.created_by === me || task.assigned_to === me || role ∈ {coordinator,director})`. Isso evita mostrar "Delegar" num card onde a RLS bloquearia o UPDATE (sem erro feio pro usuário).

---

## Edge cases & erros

- Delegar pra si mesmo → bloquear no UI (picker exclui o próprio user).
- Tarefa já `done`/`cancelled`/`delegated` → esconder "Transformar em".
- Delegado sem telefone/inativo → `/internal/task-delegated` já trata (`no_recipient`); UI mostra toast "salvo, WhatsApp não enviado".
- Conversão com fim ≤ início → bloquear submit (validação no sheet, mensagem "Fim precisa ser depois do início").
- `modality=presencial` com `meeting_url` → não enviar `meeting_url` (respeita CHECK).
- Erro de RLS no UPDATE (ex.: has_coord tentando tarefa de terceiro) → toast amigável "Você não tem permissão pra delegar essa tarefa".

## Testes

- **Frontend (Preview localhost:4173, 375px e 1440px):**
  - ⋯ e "Editar" abrem os sheets; "Delegar" invisível pra colaborador comum e em tarefa de terceiro.
  - Delegar tarefa própria → vira `status='delegated'`, `assigned_to`=alvo, some da lista ativa do líder, aparece em "Delegadas"; toast de WhatsApp.
  - Converter em compromisso → cria evento na agenda, tarefa some (cancelled), `converted_to_event_id` preenchido; link aparece nos meus eventos.
  - Modalidade presencial esconde "Link da reunião"; online/híbrido mostra.
- **Build:** `cd _remote/web && npx tsc --noEmit && npx vite build` sem erros.
- **Migração:** aplicar no Supabase; `converted_to_event_id` existe e aceita UPDATE.

---

## Pontos a confirmar no planejamento

1. Frontend consegue ler `governance_edges`/`governance_leaders` via RLS? (define o `useDelegableMembers`; se não, fallback = todos ativos).
2. `has_coord_permissions` está disponível no `collaborators` SELECT do AuthContext? (incluir).
