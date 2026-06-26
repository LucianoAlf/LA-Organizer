# Checklist de Compromisso/Evento — Plano

**Goal:** Checklist (pauta/prep) em compromisso, via tabela-satélite `event_checklist_items`, nas 3 superfícies (criar/editar/ver) + TOM cria via `<<EVENT_CREATE>>`.

**Arquitetura:** Tabela-satélite (espelha `event_participants`/`event_reminders`). Hook + componente PWA clonados do checklist de tarefa, mas sobre `event_checklist_items` (campo `done` bool). Reuso do `ChecklistDraftField` (já existe no QuickCreateSheet) pra criação. Engine insere itens após o `insert` do evento.

## Global Constraints
- Voz/comportamento do TOM = sagrado (só ação/persistência).
- `.deploy-hold` na raiz ANTES de editar `src/` (G4). Deploy coordenado com OK do Alf (G5).
- Sem `<form>` aninhado (botão `type=button` + Enter `preventDefault`).
- Semântica PAUTA: marcar item NÃO conclui o evento.
- Engine escreve via service_role; `created_by` = remetente real.

---

### G1: Migration `event_checklist_items` (tabela + RLS)
**Files:** `migrations/2026-06-26-event-checklist-items.sql` (criar) + aplicar via Supabase MCP (`apply_migration`/`execute_sql`, projeto `cesnbnrynvxvgdhfmaua`).

```sql
CREATE TABLE event_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  done BOOLEAN NOT NULL DEFAULT false,
  sort_position INT,
  created_by UUID REFERENCES collaborators(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_event_checklist_items_event ON event_checklist_items(event_id);
ALTER TABLE event_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_event_checklist ON event_checklist_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_checklist_items.event_id AND (
    e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id()
    OR (e.context = 'work' AND current_collab_role() IN ('coordinator','director'))
    OR EXISTS (SELECT 1 FROM event_participants ep WHERE ep.event_id = e.id AND ep.collaborator_id = current_collab_id())
  )));

CREATE POLICY auth_write_event_checklist ON event_checklist_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM events e WHERE e.id = event_checklist_items.event_id AND (
    e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id()
  )))
  WITH CHECK (EXISTS (SELECT 1 FROM events e WHERE e.id = event_checklist_items.event_id AND (
    e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id()
  )));
```
**Verify:** `SELECT` na tabela (vazia, sem erro) + `list_tables` mostra `event_checklist_items` com RLS on.

---

### G2: PWA hook + componente (clone do checklist de tarefa)
**Files:** `web/src/hooks/useEventChecklist.ts` (criar), `web/src/components/EventChecklistSection.tsx` (criar).

`useEventChecklist(eventId, meId)` — espelha `useTaskChecklist` mas sobre `event_checklist_items`:
- query: `select id,title,done,sort_position from event_checklist_items where event_id=eventId order by sort_position nulls first, created_at`. queryKey `['event-checklist', eventId]`.
- `addItem(title)`: insert `{ event_id, title, done:false, sort_position:max+1, created_by:meId }`.
- `toggleItem({id,done})`: update `{ done }`.
- `removeItem(id)`: **hard DELETE** (pauta não precisa de histórico; tabela não tem status).
- `progress`: `{ done: items.filter(i=>i.done).length, total: items.length }`.
- invalidate `['event-checklist', eventId]` + `['events']`.

`EventChecklistSection({ eventId, editable })` — clone do `TaskChecklistSection`:
- header "CHECKLIST" + `done/total`; itens com `TaskCheckbox` (size sm) `done={it.done}` `disabled={!editable}`; botão remover X (se editable); add row (input + botão `type=button` + Enter `preventDefault`).
- `if (items.length === 0 && !editable) return null`.
- SEM canCheckItem: `editable` controla marcar+add+remover (dono do evento). Não-editável = read-only.

**Verify:** `tsc --noEmit` limpo.

---

### G3: Wire nas 3 superfícies
**Files:** `web/src/components/QuickCreateSheet.tsx` (Compromisso), `web/src/components/EditEventSheet.tsx`, `web/src/screens/agenda/components/EventEditDrawer.tsx`, `web/src/screens/EventoDetalhe.tsx`.

- **Criar (QuickCreateSheet, aba event):** reusar o `ChecklistDraftField` + estado `checklistDraft` já existentes. Renderizar na aba Compromisso (guard `!recurrenceRule`). Em `createEvent`, após o `insert` do evento retornar `inserted.id`, inserir filhas em `event_checklist_items` (se `!recurrenceRule` e `checklistDraft.length`): `{ event_id: inserted.id, title, done:false, sort_position:i+1, created_by:collab.id }`.
- **Editar (EditEventSheet):** `<EventChecklistSection eventId={event.id} editable={event.collaborator_id === collaborator?.id} />` após o bloco Participantes, antes dos botões. (ler arquivo no exec p/ âncora exata — já lido: inserir após o `</div>` do bloco Participantes ~linha 453.)
- **Editar desktop (EventEditDrawer):** mesma seção, `editable` pelo dono. (ler no exec p/ âncora.)
- **Ver (EventoDetalhe):** `<EventChecklistSection eventId={...} editable={dono} />`. (ler no exec p/ âncora + como pega meId/owner.)

**Verify:** `tsc` + `vite build` limpos.

---

### G4: TOM — `<<EVENT_CREATE>>` com `checklist`
**Files:** `src/engine.js` (handler EVENT_CREATE ~2165-2580), `skills/<criar-evento|compromisso>.md`.
- `.deploy-hold` na raiz ANTES de editar.
- No handler, após o `insert` do evento (já retorna id; ver ~2498 área de participants/reminders), se `Array.isArray(a.checklist) && a.checklist.length`: inserir em `event_checklist_items` `{ event_id, title, done:false, sort_position, created_by: collaborator.id }` (service_role). Best-effort (try/catch, não derruba o evento).
- Validar marker: aceitar `checklist` como array de strings (ignorar não-strings). Não rejeitar evento se checklist malformado — só dropar o campo.
- Skill: documentar `checklist:[...]` + anti-confab ("só diga 'com checklist de N' se emitiu N").
- **Verify:** `node --check src/engine.js`. Deploy SCP + `pm2 restart` no G5 (com OK).

---

### G5: Validação + preview E2E + deploy + registro
- `tsc` + `vite build` + `node --check` + sweep de testes backend.
- Preview: criar compromisso com checklist pela tela "Novo" → verificar no banco (`event_checklist_items` com event_id certo) → abrir EventoDetalhe/EditEventSheet e ver a seção → limpar lixo de teste.
- **Checkpoint de produção (OK do Alf)** → liberar `.deploy-hold`, deploy (web auto + scp engine + pm2 restart).
- Memória `project_subtasks_checklist.md` (Compromisso = ENTREGUE) + known-issue se aplicável.

## Self-review
- Spec coberta: tabela (G1), hook/componente (G2), 3 superfícies (G3), TOM (G4), validação/deploy (G5). ✓
- Recorrência: guard no create (igual tarefa). Edit/ver não escondem (anexa ao evento editado). ✓
- RLS: write = dono; read = dono/criador/coordenação/participante. ✓
- Sem `<form>` aninhado (G2 botão type=button). ✓
