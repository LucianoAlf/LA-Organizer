# Checkpoint com Responsável e Prazo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Expor `assigned_to` + `due_date` na UI de checkpoint/task, renomear "owner/leader" → "Responsável", lembretes TOM.

**Tech Stack:** React 18 + TS + TanStack Query 5 + Supabase + Node.js (TOM dispatcher).

**Migration:** ❌ Zero.

---

## Task 1 — Hook `useCheckpointResponsavel` + tipos

**Files:**
- Create: `web/src/hooks/useCheckpointResponsavel.ts`
- Modify: `web/src/types/projectDetail.ts` (garantir `CheckpointFull` tem `assigned_to`)

- [ ] **Step 1:** Verificar tipo `CheckpointFull` em `types/projectDetail.ts`. Se não tiver `assigned_to: string | null`, adicionar.

- [ ] **Step 2:** Criar hook que recebe `cp: CheckpointFull`, `project: ProjectFull`, `members: ProjectMember[]` e retorna `{ responsavel: ProjectMember | null, isFallback: boolean, displayName: string }`. Se `cp.assigned_to` setado → busca membro. Senão → busca membro com `collaborator_id === project.created_by`. `displayName` usa `preferred_name ?? full_name`.

- [ ] **Step 3:** Commit `feat(web): hook useCheckpointResponsavel com fallback pro owner`

## Task 2 — Estender `useProjectCheckpoints.create/update`

**Files:**
- Modify: `web/src/hooks/useProjectCheckpoints.ts`

- [ ] **Step 1:** Mudar assinatura `create` de `(name: string)` para `(input: { name: string; due_date?: string | null; assigned_to?: string | null; rationale?: string | null })`. INSERT inclui os campos quando presentes.

- [ ] **Step 2:** Estender `update` (ou `rename`) pra aceitar `{ id, name?, due_date?, assigned_to?, rationale? }`. Só envia campos definidos no patch.

- [ ] **Step 3:** Commit `feat(web): useProjectCheckpoints aceita due_date, assigned_to, rationale`

## Task 3 — `CheckpointAssigneePicker` componente

**Files:**
- Create: `web/src/components/CheckpointAssigneePicker.tsx`

- [ ] **Step 1:** Componente recebe `value: string | null`, `onChange(v)`, `options: AssigneeOption[]`, `fallbackName: string`. Quando `value === null` exibe chip cinza "👤 {fallbackName} (responsável do projeto)". Menu suspenso com opções + item "Remover atribuição".

- [ ] **Step 2:** Visual: chip arredondado, hover, focus-ring, abre dropdown abaixo. Espelhar estética de `AssigneePicker.tsx` existente.

- [ ] **Step 3:** Commit `feat(web): CheckpointAssigneePicker com fallback visual`

## Task 4 — `CreateCheckpointInline` expandido

**Files:**
- Modify: `web/src/tabs/CheckpointsTab.tsx`

- [ ] **Step 1:** Mudar prop `onCreate` de `(name: string) => void` para `(input: { name; due_date?; assigned_to?; rationale? }) => void`. Receber também `assigneeOptions`, `ownerFallbackName`.

- [ ] **Step 2:** No form aberto, layout:
  - Input nome (mantém)
  - Linha 2: `DateInput` (label "Prazo") + `CheckpointAssigneePicker`
  - Botão `▸ Adicionar contexto` colapsável → revela `<textarea>` pra rationale (3 linhas)
  - Footer com Cancelar/Criar.

- [ ] **Step 3:** Estado local: `name`, `dueDate`, `assignedTo`, `rationale`, `showRationale`. `onSubmit` chama `onCreate({ name, due_date: dueDate || null, assigned_to: assignedTo, rationale: rationale.trim() || null })`.

- [ ] **Step 4:** Atualizar `ProjetoDetalhe.tsx` pra passar o input completo: `onCreateCheckpoint={(input) => checkpointsApi.create(input)}` (signature já estendida na Task 2). Passar `assigneeOptions` e nome do owner pra `CheckpointsTab`.

- [ ] **Step 5:** Commit `feat(web): CreateCheckpointInline com prazo, responsável e contexto`

## Task 5 — `CreateTaskInline` com assignee + due_date

**Files:**
- Modify: `web/src/tabs/CheckpointsTab.tsx` (função `CreateTaskInline`)

- [ ] **Step 1:** Receber prop `assigneeOptions: AssigneeOption[]` e `defaultAssignee: string` (= collaboratorId atual).

- [ ] **Step 2:** Form aberto:
  - Input título (mantém)
  - Linha 2: `AssigneePicker` (default = criador) + `DateInput` opcional pra prazo
  - Footer Cancelar/Salvar.

- [ ] **Step 3:** INSERT em `tasks` passa `assigned_to` e `due_date` selecionados. Default `assigned_to` continua sendo `collaboratorId` se não trocou.

- [ ] **Step 4:** Atualizar chamadas em `CheckpointCard` pra passar `assigneeOptions`.

- [ ] **Step 5:** Commit `feat(web): CreateTaskInline com picker de responsável e prazo`

## Task 6 — Badge de responsável no `CheckpointCard`

**Files:**
- Modify: `web/src/tabs/CheckpointsTab.tsx` (função `CheckpointCard`)

- [ ] **Step 1:** Receber prop `responsavelLabel: { name: string; isFallback: boolean }` (computado no pai com `useCheckpointResponsavel`).

- [ ] **Step 2:** No header do card, ao lado do nome do checkpoint, renderizar chip:
  - `isFallback`: `bg-bg-elevated text-fg-muted` + ícone Crown cinza
  - Não-fallback: `bg-tom/10 text-tom border-tom/30` + ícone User

- [ ] **Step 3:** Click no chip (se `canSeeAll`) abre `RowMenu` com lista de membros pra trocar `assigned_to`.

- [ ] **Step 4:** Editar checkpoint via `checkpointsApi.update({ id, assigned_to })`.

- [ ] **Step 5:** Commit `feat(web): badge de responsável no CheckpointCard com troca inline`

## Task 7 — Renomear "owner/leader" → "Responsável" na UI

**Files:**
- Modify: vários — usar Grep pra encontrar

- [ ] **Step 1:** Rodar Grep no `web/src/` por padrão case-insensitive: `\b(owner|leader|líder)\b` em arquivos `.tsx` e `.ts`. Listar matches.

- [ ] **Step 2:** Pra cada match que é **string visível ao usuário** (JSX text, label, placeholder, title, aria-label):
  - `Owner` → `Responsável`
  - `owner` (texto) → `responsável`
  - `Leader`/`Líder` → `Responsável`

- [ ] **Step 3:** NÃO mudar:
  - Enum do banco `role_in_project = 'owner'`
  - Nomes de variáveis/funções TS (`ownerName`, `getOwner`, etc.) — só strings exibidas
  - Comentários técnicos

- [ ] **Step 4:** Commit `refactor(web): renomear "owner/leader" → "Responsável" em strings visíveis`

## Task 8 — TOM `checkProjectDeadlines()` no dispatcher

**Files:**
- Modify: `src/rituals/dispatcher.js`
- Create (talvez): `src/rituals/checkpoint-deadlines.js`

- [ ] **Step 1:** Criar `src/rituals/checkpoint-deadlines.js` com função `runCheckProjectDeadlines(supabase, sendWhatsApp, logRitualEvent, today)`. Implementa a lógica:
  - Calcula marcos D-3, D-1, D0, D+1 (datas YYYY-MM-DD)
  - Query: `project_checkpoints` JOIN `projects` WHERE status NOT IN done/cancelled, due_date IN marcos
  - Para cada cp: determinar `responsavelId = cp.assigned_to ?? cp.projects.created_by`, buscar `phone` em `collaborators`
  - Idempotência via `ritual_logs`: `ritual_type = 'checkpoint_deadline'`, `detail = 'cp:${cpId}:D${dias}'`
  - Mensagem com emoji por marco (🟢 D-3/D-1, 🟡 D0, 🔴 D+1)

- [ ] **Step 2:** No `dispatcher.js`, importar e chamar `runCheckProjectDeadlines` no slot `09:00` (mesmo slot do LA_EDUCA). Adicionar constante `CHECKPOINT_DEADLINE_TIME = '09:00'`.

- [ ] **Step 3:** Testar localmente com `node src/rituals/dispatcher.js --force=checkpoint_deadlines` (adicionar suporte ao flag). Validar com `node --check`.

- [ ] **Step 4:** Deploy SCP: `scp _remote/src/rituals/{dispatcher.js,checkpoint-deadlines.js} tom:/opt/LA-Organizer/src/rituals/` + `ssh tom "pm2 restart tom"`.

- [ ] **Step 5:** Commit `feat(tom): lembrete proativo de prazo de checkpoint via WhatsApp`

## Task 9 — Skills TOM atualizadas

**Files:**
- Modify: `skills/criar-checkpoint.md`
- Modify: `skills/consultar-projeto.md`
- Create: `skills/lembrete-prazo.md`

- [ ] **Step 1:** Em `criar-checkpoint.md`, adicionar passo 4.5 "Coletar responsável (opcional)": "Quem fica responsável por esse checkpoint? Se não me disser, fica com o {responsável do projeto}." Atualizar exemplos.

- [ ] **Step 2:** Em `consultar-projeto.md`, adicionar capacidade de responder "status do checkpoint X" → query `tasks` por `checkpoint_id`, calcular `done/total`, listar atribuições.

- [ ] **Step 3:** Criar `lembrete-prazo.md`:
  - Quando usar: TOM recebe resposta a um lembrete proativo (`checkpoint_deadline`)
  - Reações: "tá quase" / "tô atrasado" / "já fiz"
  - Para "já fiz": atualizar status do checkpoint pra `done`
  - Para "tô atrasado": oferecer ajuda (criar task de unblock, repriorizar)

- [ ] **Step 4:** Deploy via SCP: `scp _remote/skills/*.md tom:/opt/LA-Organizer/skills/` + `pm2 restart`.

- [ ] **Step 5:** Commit `feat(tom): skills atualizadas pra prazo e responsável de checkpoint`

## Task 10 — Validação E2E + screenshot

**Files:**
- (nenhuma modificação — só verificação)

- [ ] **Step 1:** Build local: `cd _remote/web && npx tsc --noEmit && npx vite build`. Esperado: 0 erros.

- [ ] **Step 2:** Preview validation: abrir `/projetos/{LA-Teclas-id}` em `localhost:4173`, validar:
  - CreateCheckpointInline expandido tem 3 campos
  - Criar checkpoint com prazo + responsável → aparece com badge
  - Criar task dentro do checkpoint com assignee custom → badge correto
  - Sem assignee → fallback "Responsável: Léo" em cinza

- [ ] **Step 3:** TOM lembrete teste (dev): inserir checkpoint com `due_date = hoje + 1 dia` em LA Teclas, rodar `node src/rituals/dispatcher.js --force=checkpoint_deadlines` → validar mensagem chega.

- [ ] **Step 4:** Commit `chore: validação E2E checkpoint responsável + prazo`

---

## Resumo de deploy

- `web/`: auto-deploy via Stop hook (commits + push origin main)
- `src/rituals/` + `skills/`: SCP direto + `pm2 restart tom`
