# Transformar Tarefa (Delegar / Compromisso) — Design

**Data:** 2026-06-08
**Autor:** Alf + Claude (brainstorming)
**Origem:** 2 áudios do Quintela. Ele cria muitas tarefas no susto pelo WhatsApp (várias são só "lembrete pra mim de repassar algo"). Quer entrar no Organizer e **lapidar**: pegar uma tarefa e transformá-la em (a) **compromisso** (evento na agenda) ou (b) **tarefa delegada** a outra pessoa.

---

## Objetivo

Permitir, dentro do Organizer (desktop + PWA), transformar uma tarefa existente em:
- **Compromisso** — vira um evento na agenda; a tarefa original é arquivada (com rastro), sem cobrança duplicada.
- **Tarefa delegada** — atribuída a um membro da equipe do líder; o TOM avisa o delegado pelo WhatsApp. **Só líderes** podem delegar.

## Não-objetivos (YAGNI)

- Sem loop de "aceitar/recusar" delegação (o delegado é só notificado; a tarefa já aparece pra ele).
- Sem delegação em massa / multi-seleção (uma tarefa por vez).
- Sem reabrir a tarefa após virar compromisso (a conversão é deliberada; pode recriar manualmente se errar).
- Sem alterar a RLS de `tasks` (autorização de delegação é server-side, ver abaixo).

---

## Decisões travadas (validadas com o Alf)

| Tema | Decisão |
|---|---|
| Pontos de entrada | **Dois**: menu rápido (⋯) no card da tarefa **e** seção "Transformar em" dentro do "Editar tarefa". Cada ação abre seu próprio modal (igual o "Reagendar"). |
| Notificar delegado | **Sim, na hora** pelo WhatsApp, via `sendProativo` (respeitando horário de silêncio). |
| Pra quem delega | **Equipe direta** do líder (governance edges / `resolveLeadersOf`). Diretor vê todos. Fallback: líder sem equipe configurada → lista todos os ativos (pra feature não nascer morta). |
| Quem pode delegar | `role IN (coordinator, manager, director)` **OU** `has_coord_permissions = true`. |
| Tarefa→compromisso | Cria evento + **arquiva** a tarefa original mantendo rastro (link `converted_to_event_id`). |
| DS | Tokens reais (dark, verde `tom #A3BE50`, Inter, cards radius 16). Componentes DS: `AdaptiveSheet`/`BottomSheet`, `DateInput`, `TimeInput`, `Button`, `CustomSelect`. |
| Mobile + Desktop | `AdaptiveSheet`: bottom-sheet no mobile, modal central no desktop. Testar 375px e 1440px. |

---

## Arquitetura

Três peças independentes:

### 1. Pontos de entrada (UI)

**a) Menu rápido no card** (`TaskRow.tsx` → `RowMenu`):
- Adicionar seção "Transformar em" com:
  - `📆 Compromisso` — sempre visível (qualquer um pode converter a própria tarefa).
  - `👥 Delegar` — **só se `canDelegate`** (ver Autorização).

**b) Dentro do "Editar tarefa"** (`EditTaskSheet.tsx`):
- Seção "Transformar em" no rodapé, com dois botões (`Compromisso`, `Delegar` — este último gated por `canDelegate`).

Ambos abrem os mesmos modais:
- `DelegateTaskSheet.tsx` (novo)
- `ConvertToEventSheet.tsx` (novo)

### 2. Delegar (fluxo com servidor)

Delegação precisa de autorização que a RLS não cobre (`has_coord_permissions`) e de disparo de WhatsApp (que mora na engine). Por isso **não é só Supabase direto** — passa por um endpoint serverless autenticado:

```
Navegador
  → POST /api/tasks/delegate   (web/api serverless, Bearer JWT)
       body: { task_id, assignee_id, due_date?, note? }
  → requireCollaborator(req)   → ator autenticado
  → AUTORIZA (server-side):
       ator.role ∈ {coordinator,manager,director}  OU  ator.has_coord_permissions
       E  assignee_id ∈ equipe(ator)   (ou ator é director, ou fallback sem-equipe)
  → UPDATE tasks (service_role): assigned_to=assignee_id, status='delegated', due_date=?
  → POST {ENGINE_INTERNAL_URL}/internal/task-delegated   (x-internal-secret, server→server)
       body: { task_id, actor_name, note, proactive: true }
  → Engine: compõe msg e envia via sendProativo (quiet-aware) ao delegado
```

- O `x-internal-secret` vive no **env do servidor** (Vercel/engine), nunca no bundle do navegador.
- A engine é dona do `sendProativo` + do guard de horário de silêncio; por isso o WhatsApp é disparado lá, não no serverless.
- `created_by` **não muda** (continua quem criou). A identidade do delegador vai na mensagem via `actor_name` (passado pelo endpoint a partir do JWT).

**Mensagem do TOM ao delegado** (composta na engine):
```
👋 Oi {primeiro_nome}! O {actor_name} te delegou uma tarefa:
*{título}*
🗓️ Prazo: {due_date BR}        (se houver)
💬 "{note}"                      (se houver)
```

**Horário de silêncio:** `/internal/task-delegated` passa a aceitar `proactive: true` e roteia por `sendProativo`. Se `deferido` (silêncio), enfileira em `pending_notifications` (ver Data Model) pra reenvio na próxima janela permitida pelo dispatcher. O delegado já vê a tarefa no app de imediato; o WhatsApp é o empurrão.

**Pós-delegação (UI):** a tarefa sai da lista ativa do líder e fica marcada `→ {Nome} (delegada)`. Quando o delegado conclui/reagenda, o `notifyTaskCreatorOfAction` (já existe) avisa o criador.

### 3. Transformar em compromisso (fluxo client-side)

Conversão da própria tarefa do usuário na própria agenda → sem gate de liderança e sem notificação cross-user → **Supabase direto** (RLS atual já cobre):

```
ConvertToEventSheet → supabase:
  1) INSERT events { collaborator_id=self, title, context, project_id,
                     eisenhower_quadrant, start_at, end_at, modality,
                     location_text | meeting_url, source='task_conversion',
                     created_by=self }
  2) UPDATE tasks { status='cancelled', converted_to_event_id=<novo event.id> }
```

- Migra do task: título, contexto, `project_id`, `eisenhower_quadrant`.
- Form: **Data** (`DateInput`), **Início/Fim** (`TimeInput`), **Modalidade** (`CustomSelect`/segmented: online/presencial/híbrido).
  - `meeting_url` aparece em online/híbrido; `location_text` em presencial/híbrido.
- Tarefa marcada `status='cancelled'` (não infla métrica de "concluída") + `converted_to_event_id` preserva o rastro. UI mostra "→ virou compromisso".

---

## Data Model (migração)

`migrations/2026-06-08-task-transform.sql`:

```sql
-- (1) Rastro tarefa→evento
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS converted_to_event_id uuid REFERENCES events(id) ON DELETE SET NULL;

-- (2) events.source aceita 'task_conversion'
--     (ajustar o CHECK existente de events.source incluindo o novo valor)

-- (3) Fila de reenvio de notificação proativa adiada por silêncio
CREATE TABLE IF NOT EXISTS pending_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                 -- 'task_delegated'
  recipient_id uuid NOT NULL REFERENCES collaborators(id),
  payload jsonb NOT NULL,             -- { task_id, actor_name, note }
  context text NOT NULL DEFAULT 'work',
  attempts int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
```

> Confirmar se `events.source` tem CHECK constraint; se sim, recriá-lo com `'task_conversion'`. Se for texto livre, item (2) é no-op.
> Confirmar que `tasks.status='cancelled'` é aceito pelo CHECK (já consta no enum atual).

---

## Mapa de arquivos

### Frontend (`web/src`)
- `components/TaskRow.tsx` — itens "Transformar em ▸ Compromisso / Delegar" no `RowMenu` (Delegar gated).
- `components/EditTaskSheet.tsx` — seção "Transformar em" no rodapé.
- `components/DelegateTaskSheet.tsx` — **novo**. AdaptiveSheet: picker de pessoa (equipe), `DateInput` (prazo pré-preenchido), textarea recado, prévia WhatsApp, botão "Delegar e avisar".
- `components/ConvertToEventSheet.tsx` — **novo**. AdaptiveSheet: data/hora/modalidade/local-link + aviso de arquivamento.
- `hooks/useTeamMembers.ts` — **novo** (ou estender `useProjectMembers`): resolve a equipe do líder logado (via mesma lógica de governance; pode bater num endpoint `/api/team/members` se a resolução exigir service_role).
- `hooks/useTaskTransform.ts` — **novo**: `delegate()` (chama `/api/tasks/delegate`) e `convertToEvent()` (Supabase direto).
- `contexts/AuthContext` — expor `canDelegate` (role liderança OU `has_coord_permissions`); incluir `has_coord_permissions` no carregamento do collaborator.
- `lib/events.ts` — `createEvent()` se ainda não existir helper.

### Backend
- `web/api/tasks/delegate.ts` — **novo** serverless. `requireCollaborator` → autoriza → update via service_role → chama `/internal/task-delegated`.
- `web/api/_lib/auth.ts` — incluir `has_coord_permissions` no SELECT de `requireCollaborator`.
- `web/api/_lib/team.ts` — **novo** (ou reuso de `governance-edges`/`leader-routing` portados): `isInTeam(actor, assigneeId)` + `listTeam(actor)`.
- `src/internal-api.js` — endpoint `/internal/task-delegated`: aceitar `proactive` + `actor_name`; rotear por `sendProativo`; no `deferido`, inserir em `pending_notifications`.
- `src/rituals/dispatcher.js` — job que drena `pending_notifications` na abertura de cada janela permitida (reenvia via `sendProativo`, marca `sent_at`).
- `src/services/send-proativo.js` — reutilizado (sem mudança).

---

## Autorização (resumo)

| Ação | Onde valida | Regra |
|---|---|---|
| Ver botão "Delegar" | Frontend (`canDelegate`) | `role ∈ {coordinator,manager,director}` OU `has_coord_permissions` |
| Executar delegação | **Servidor** (`/api/tasks/delegate`) | mesmo predicado **+** `assignee ∈ equipe(ator)` (director=todos; fallback sem-equipe=todos ativos) |
| Atualizar task na delegação | service_role no serverless | não depende de RLS do cliente (sem afrouxar policy) |
| Converter em compromisso | RLS atual (cliente) | dono da tarefa (creator/assignee) — sem mudança |

**Identidade do ator** sempre derivada do **JWT** (`requireCollaborator`), nunca do corpo da requisição (alinhado à regra de dado sensível no caminho service_role).

---

## Edge cases & erros

- Delegar pra si mesmo → bloquear no UI e no servidor (no-op).
- Tarefa já delegada/concluída/cancelada → esconder "Transformar em" (ou mostrar desabilitado com motivo).
- Delegado sem telefone/inativo → grava a delegação mesmo assim; pula WhatsApp (loga); aparece no app dele.
- Conversão sem data/hora válida → bloquear submit (validação no sheet).
- `/api/tasks/delegate` falha após update mas antes do WhatsApp → idempotência: `/internal/task-delegated` já dedupe via `marker_logs TASK_DELEGATED`; reenvio seguro.
- Silêncio → enfileira em `pending_notifications`; dispatcher reenvia. Sem perda, sem ping 2h da manhã.

## Testes

- **Backend (engine):** `/internal/task-delegated` com `proactive:true` em horário normal → envia; em silêncio → não envia, enfileira. Dedup por `marker_logs`.
- **Serverless:** autorização — coordinator OK; collaborator puro 403; `has_coord_permissions` OK; assignee fora da equipe 403; director qualquer um OK.
- **Dispatcher:** drena `pending_notifications`, marca `sent_at`, não reenvia duplicado.
- **Frontend (manual no Preview localhost:4173, 375px e 1440px):** ⋯ e Editar abrem os modais; Delegar invisível pra colaborador comum; conversão em compromisso arquiva a tarefa e cria o evento; tarefa delegada some da lista ativa e mostra `→ Nome`.

---

## Pontos a confirmar no planejamento

1. `events.source` tem CHECK? (define se precisa recriar o constraint).
2. Resolução de equipe no frontend exige service_role? Se sim, criar `/api/team/members`; senão, resolver via Supabase autenticado no hook.
3. `ENGINE_INTERNAL_URL` acessível a partir do serverless (Vercel → VPS): confirmar URL/porta e rede.
