# Checkpoint com Responsável e Prazo — Design Spec

**Data:** 2026-05-22
**Status:** Aprovado (3 respostas do Alf)
**Migration:** ❌ Zero (schema já suporta)

## Goal

Expor `assigned_to` + `due_date` na UI de criação de checkpoint e task (hoje invisíveis), renomear "owner/leader" → "Responsável" em PT-BR, e dar ao TOM lembretes proativos de prazo via WhatsApp em D-3, D-1, D0 e D+1.

## Arquitetura

3 frentes em paralelo, sem dependências circulares:

1. **Frontend (web/)** — expandir forms inline em `CheckpointsTab.tsx`, adicionar `AssigneePicker` na criação de task, renomear strings.
2. **TOM engine (src/)** — nova função `checkProjectDeadlines()` no `dispatcher.js`, roda 9h diário, varre `project_checkpoints` com prazo nos marcos D-3/D-1/D0/D+1.
3. **TOM skills (skills/)** — atualizar `criar-checkpoint.md` (já existe) pra coletar prazo+responsável, atualizar `consultar-projeto.md` pra responder status, criar `lembrete-prazo.md` novo.

## Schema (auditado, zero migration)

```
project_checkpoints
  ├─ assigned_to  UUID nullable  → fallback: projects.created_by
  ├─ due_date     DATE nullable
  ├─ rationale    TEXT nullable
  └─ status       TEXT (pending|in_progress|done|cancelled)

tasks
  ├─ assigned_to  UUID NOT NULL  → default no INSERT: creator
  ├─ due_date     DATE nullable
  └─ checkpoint_id UUID nullable

projects
  ├─ created_by   UUID NOT NULL  → "Responsável" do projeto (fallback)
  ├─ start_date   DATE
  └─ end_date     DATE

project_members
  ├─ collaborator_id  UUID
  └─ role_in_project  TEXT (owner|coordinator|member|external)
```

## Frontend — Mudanças

### 1. `CreateCheckpointInline` (em `tabs/CheckpointsTab.tsx`)

Substituir form de 1 campo (só `name`) por form expandido:

```
┌─ NOVO CHECKPOINT ─────────────────────────────┐
│ Nome*: [Reservar local                      ] │
│                                                │
│ Prazo:       [DateInput dd/mm/aaaa]           │
│ Responsável: [AssigneePicker — fallback owner]│
│                                                │
│ ▸ Adicionar contexto (opcional)               │  ← collapse
│   [textarea rationale]                         │
│                                                │
│              [Cancelar] [Criar]                │
└────────────────────────────────────────────────┘
```

**Componentes:** `DateInput` (DS), novo `CheckpointAssigneePicker` (espelha `AssigneePicker` mas com fallback visual "👤 Responsável: {ownerName}" em cinza quando null).

**INSERT:** API `onCreateCheckpoint` muda de `(name) => void` para `(input: { name, due_date?, assigned_to?, rationale? }) => void`. `useProjectCheckpoints.create` aceita o objeto inteiro.

### 2. `CreateTaskInline` (mesmo arquivo)

Hoje: 1 input + default `assigned_to: collaboratorId` (criador).
Novo: input + `AssigneePicker` inline (opções = `assigneeOptions` do projeto) + `DateInput` opcional pra prazo.

```
┌──────────────────────────────────────────────┐
│ [O que precisa fazer...                     ]│
│ Atribuir: [Luciano Alf ▾]   Prazo: [—]      │
│                          [Cancelar] [Salvar] │
└──────────────────────────────────────────────┘
```

Default do assignee continua sendo o criador (compat). Botão pra trocar.

### 3. `CheckpointCard` header

Mostrar badge do responsável ao lado do nome (igual ao chip da task):
- Se `assigned_to` setado: chip verde com nome
- Se null: chip cinza "👤 {ownerName}" (fallback)

Click no chip → `RowMenu` pra trocar (só `canSeeAll` ou se for o owner).

### 4. Renomear "owner/leader"

Grep + substituir nas strings visíveis ao usuário (não no banco):
- `Owner` / `owner` → `Responsável` / `responsável`
- `Leader` / `leader` → `Responsável` / `responsável`
- `Líder` → `Responsável`

Manter `role_in_project = 'owner'` no banco (enum, não muda).
`MembersTab` row menu já tem isso em PT-BR — verificar consistência.

### 5. Hook `useProjectCheckpoints`

Estender `create()` pra aceitar `{ name, due_date?, assigned_to?, rationale? }`.
Estender `update()` pra permitir editar `due_date` e `assigned_to` (já tem rename).

## TOM — Mudanças

### 1. `dispatcher.js` — `checkProjectDeadlines()`

Roda no slot `09:00` (alinha com `LA_EDUCA_LEMBRETES_TIME`). Idempotente via `ritual_logs`.

```js
async function checkProjectDeadlines(today) {
  const D = (offset) => addDays(today, offset);
  const marcos = [D(-3), D(-1), today, D(+1)]; // próximos 3 dias + ontem

  const { data: cps } = await supabase
    .from('project_checkpoints')
    .select(`
      id, name, due_date, status, assigned_to, rationale,
      projects!inner(id, name, created_by, end_date)
    `)
    .neq('status', 'done')
    .neq('status', 'cancelled')
    .not('due_date', 'is', null)
    .in('due_date', marcos);

  for (const cp of cps) {
    const responsavelId = cp.assigned_to || cp.projects.created_by;
    const dias = diffDays(cp.due_date, today);

    // Idempotência: já enviou hoje pra esse checkpoint+marco?
    const refKey = `checkpoint_deadline:${cp.id}:D${dias}`;
    if (await alreadySent(responsavelId, refKey, today)) continue;

    await sendCheckpointReminder(responsavelId, cp, dias);
    await logRitualEvent(responsavelId, refKey, 'sent');
  }
}
```

**Mensagem WhatsApp:**

```
🟢 *Festival de Cordas 2026*
Checkpoint: *Montar escala*
📅 Prazo em 3 dia(s): 25/05/2026

💡 Por quê: Ensaio sem escala vira caos

Como tá o andamento? Posso ajudar com alguma coisa?
```

Emoji por marco:
- D-3, D-1: 🟢
- D0: 🟡 "Prazo é *hoje*!"
- D+1: 🔴 "⚠️ Prazo vencido há 1 dia!"

### 2. Skill `criar-checkpoint.md` (já existe)

Já cobre fluxo conversacional pra prazo+rationale. Adicionar seção sobre coletar `assigned_to` opcional ("Quem fica responsável? Se não me disser, fica com você mesmo / com o líder do projeto").

### 3. Skill nova `lembrete-prazo.md`

Quando TOM dispara o lembrete e o responsável responde:
- "tá quase" → registrar nota em `tom_memories`, não cobrar de novo até D0
- "tô atrasado" → oferecer ajuda (criar tasks de unblock, repriorizar)
- "já fiz" → marcar checkpoint como done

### 4. Skill `consultar-projeto.md`

Adicionar capacidade: "qual o status do checkpoint X?" → buscar tasks vinculadas, calcular % done, listar atribuições.

## Fallback de Responsável

**Regra (computed na UI, não persistido):**

```ts
function getCheckpointResponsavel(cp, project, members) {
  if (cp.assigned_to) {
    return members.find(m => m.collaborator_id === cp.assigned_to);
  }
  // Fallback: created_by do projeto
  return members.find(m => m.collaborator_id === project.created_by) ?? null;
}
```

Hook compartilhado: `useCheckpointResponsavel(cp)` em `web/src/hooks/`.

## Não-Goals (V1)

- Múltiplos responsáveis por checkpoint (tabela extra) — fica pra V2
- Notificação push no app PWA — só WhatsApp por enquanto
- Edição de `due_date`/`assigned_to` via TOM marker — V2 (hoje só criação)
- Histórico de mudanças de assignee — sem audit log

## Testes

1. **UI vazio + criar checkpoint completo** → checkpoint aparece com badge correto
2. **Criar sem assignee** → badge mostra owner do projeto em cinza
3. **Criar task com assignee diferente** → badge da task mostra pessoa certa
4. **Editar checkpoint, trocar responsável** → badge atualiza
5. **TOM lembrete D-1** → mensagem chega no WhatsApp do responsável, não duplica
6. **TOM lembrete D-1 com fallback** → checkpoint sem assignee → mensagem vai pro owner do projeto
7. **Idempotência** → rodar dispatcher 2x no mesmo dia, só envia 1 mensagem por checkpoint/marco
8. **Renomeação** → grep visual "owner|leader|líder" em telas → zero match
