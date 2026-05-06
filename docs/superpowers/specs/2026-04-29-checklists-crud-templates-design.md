# Spec: CRUD de Templates de Checklists Operacionais (Sprint 2)
**Data:** 2026-04-29
**Status:** Aprovado — pronto para writing-plans

---

## Contexto

Sprint 1 entregou checklists operacionais com dispatch via WhatsApp + marcação no PWA. Templates eram seed fixo — coordenador não conseguia criar ou editar. Esta sprint adiciona gestão completa de templates para director e coordinator, com audit log automático via trigger Postgres.

---

## Decisões de design (P1–P5)

| # | Decisão | Escolha |
|---|---|---|
| P1 | Quem pode editar | director + coordinator, com audit log obrigatório. Colaboradores comuns: somente leitura via RLS |
| P2 | Onde fica a tela | `/mais` → substituir card "EM BREVE" por link ativo (visível só para director/coordinator) |
| P3 | Apagar template | Soft delete — `active boolean DEFAULT true`. Cron ignora `active=false`. Histórico preservado |
| P4 | Reordenar itens | Botões ↑/↓ por item. Sem drag & drop (mobile-hostile, sem dependência nova) |
| P5 | Navegação | Tela única + BottomSheet modais (padrão do app — sem subroutas) |

---

## Abordagem arquitetural

**Abordagem 1 — Trigger Postgres + RLS** (aprovada)

- Tabela `op_checklists_audit` para audit log completo
- Triggers automáticos em `op_checklists` e `op_checklist_items`
- RLS permite escrita apenas para director/coordinator
- PWA faz CRUD normal; audit acontece no DB

---

## Seção 1: Schema & RLS

### Migration

```sql
-- 1. Soft delete em op_checklists
ALTER TABLE op_checklists
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- 2. Tabela de auditoria
CREATE TABLE IF NOT EXISTS op_checklists_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES op_checklists(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN (
    'created','updated','deleted','activated','deactivated',
    'item_added','item_removed','item_updated','reordered'
  )),
  changed_by uuid REFERENCES collaborators(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  details jsonb
);
CREATE INDEX idx_op_checklists_audit_template
  ON op_checklists_audit(template_id, changed_at DESC);

-- 3. Trigger em op_checklists
CREATE OR REPLACE FUNCTION op_checklists_audit_fn() RETURNS trigger AS $$
DECLARE
  uid uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
    VALUES (NEW.id, 'created', uid,
      jsonb_build_object('name', NEW.name));
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.active = true AND NEW.active = false THEN
      INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
      VALUES (NEW.id, 'deactivated', uid, NULL);
    ELSIF OLD.active = false AND NEW.active = true THEN
      INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
      VALUES (NEW.id, 'activated', uid, NULL);
    ELSE
      INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
      VALUES (NEW.id, 'updated', uid, jsonb_build_object(
        'before', row_to_json(OLD)::jsonb - 'updated_at',
        'after',  row_to_json(NEW)::jsonb - 'updated_at'
      ));
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_op_checklists_audit
  AFTER INSERT OR UPDATE ON op_checklists
  FOR EACH ROW EXECUTE FUNCTION op_checklists_audit_fn();

-- 4. Trigger em op_checklist_items
CREATE OR REPLACE FUNCTION op_checklist_items_audit_fn() RETURNS trigger AS $$
DECLARE
  uid uuid := nullif(current_setting('app.current_user_id', true), '')::uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
    VALUES (NEW.checklist_id, 'item_added', uid,
      jsonb_build_object('item_id', NEW.id, 'description', NEW.description));
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.sort_order != NEW.sort_order THEN
      INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
      VALUES (NEW.checklist_id, 'reordered', uid,
        jsonb_build_object('item_id', NEW.id,
          'from', OLD.sort_order, 'to', NEW.sort_order));
    ELSE
      INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
      VALUES (NEW.checklist_id, 'item_updated', uid,
        jsonb_build_object('item_id', NEW.id,
          'before', OLD.description, 'after', NEW.description));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO op_checklists_audit (template_id, action, changed_by, details)
    VALUES (OLD.checklist_id, 'item_removed', uid,
      jsonb_build_object('item_id', OLD.id, 'description', OLD.description));
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_op_checklist_items_audit
  AFTER INSERT OR UPDATE OR DELETE ON op_checklist_items
  FOR EACH ROW EXECUTE FUNCTION op_checklist_items_audit_fn();
```

### RLS Policies

```sql
ALTER TABLE op_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE op_checklists_audit ENABLE ROW LEVEL SECURITY;

-- op_checklists: todos leem; só director/coordinator escrevem
CREATE POLICY op_checklists_select ON op_checklists
  FOR SELECT TO authenticated USING (true);

CREATE POLICY op_checklists_write ON op_checklists
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM collaborators
    WHERE id = (SELECT id FROM collaborators WHERE id = auth.uid()::uuid)
      AND role IN ('director','coordinator')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM collaborators
    WHERE id = auth.uid()::uuid
      AND role IN ('director','coordinator')
  ));

-- op_checklist_items: mesma política
CREATE POLICY op_checklist_items_select ON op_checklist_items
  FOR SELECT TO authenticated USING (true);

CREATE POLICY op_checklist_items_write ON op_checklist_items
  FOR ALL TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM collaborators
    WHERE id = auth.uid()::uuid
      AND role IN ('director','coordinator')
  ));

-- op_checklists_audit: director/coordinator só leem; INSERT via trigger (SECURITY DEFINER)
CREATE POLICY op_checklists_audit_select ON op_checklists_audit
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM collaborators
    WHERE id = auth.uid()::uuid
      AND role IN ('director','coordinator')
  ));
```

### ⚠️ Nota de implementação — mapeamento auth → collaborator

A Task 9 da Sprint 1 revelou que `collaborators.id ≠ auth.users.id` neste projeto. O `useAuth()` expõe `collaborator.id` (da tabela `collaborators`), não o UUID do auth. O implementador deve verificar como as outras RLS policies do projeto fazem esse cruzamento (buscar padrão em `web/src/screens/Habitos.tsx` e nas policies existentes em `project_tasks` ou similar) e replicar o mesmo padrão nas policies desta migration.

### Como `changed_by` chega no trigger

O PWA executa `supabase.rpc('set_config', { key: 'app.current_user_id', value: collaborator.id })` antes de cada mutação. O trigger lê `current_setting('app.current_user_id', true)`. Se vazio (ex: psql manual sem set), `changed_by` fica NULL — não trava a operação.

---

## Seção 2: PWA — Componentes

### Arquivos

```
web/src/
├── screens/
│   └── ChecklistsTemplates.tsx     # Lista de templates (nova tela)
├── components/
│   ├── ChecklistTemplateSheet.tsx  # BottomSheet criar/editar
│   └── ChecklistItemEditRow.tsx    # Linha de item com ↑/↓ + delete
```

### Rota e acesso

`App.tsx`:
```tsx
<Route path="mais/checklists-templates" element={<ChecklistsTemplates />} />
```

`Mais.tsx` — substituir card "EM BREVE":
```tsx
{(role === 'director' || role === 'coordinator') && (
  <NavLink to="/mais/checklists-templates">
    Checklists operacionais
    <span>Criar e gerenciar templates</span>
  </NavLink>
)}
```

### `ChecklistsTemplates.tsx`

- Query: `op_checklists` filtrado por `active=true` (toggle "Mostrar arquivados" inclui `active=false`)
- Join com `op_checklist_items` (count) e último registro de `op_checklists_audit` (quem + quando)
- Cada card: nome, função, turno, horário dispatch, threshold, nº de itens, "Editado por [nome] em [data]"
- Ações: ✏️ Editar → abre sheet | 🗃️ Arquivar (active=false) / Reativar
- FAB `+` → abre sheet em modo "criar"

### `ChecklistTemplateSheet.tsx`

BottomSheet com duas seções:

**Seção A — Campos do template:**

| Campo | Input | Validação |
|---|---|---|
| Nome | text | obrigatório, max 80 chars |
| Função (`function_role`) | select | obrigatório |
| Unidade | select: all, barra, recreio, campo_grande | obrigatório |
| Turno | select: morning, afternoon, evening, full | obrigatório |
| Dias da semana | checkboxes Seg–Dom | ao menos 1 dia |
| Horário de disparo | time input | obrigatório |
| Threshold (%) | number 0–100 | obrigatório, default 80 |

**Seção B — Itens:**

- Lista de `ChecklistItemEditRow` com estado local
- Campo "Adicionar item" inline no final
- Botão "Salvar": desabilitado se formulário inválido
- Ao salvar:
  1. `set_config('app.current_user_id', collaborator.id)` via RPC
  2. UPSERT em `op_checklists`
  3. Sync completo de itens: DELETE itens removidos, UPSERT itens existentes/novos
  4. `invalidateQueries(['checklists-templates'])`

### `ChecklistItemEditRow.tsx`

```
[↑] [↓]  [input texto editável]  [🗑️]
```

- ↑ desabilitado no item 0, ↓ desabilitado no último
- Swap de `sort_order` no estado local
- DELETE marca item como removido localmente (removido no DB ao salvar)

---

## Seção 3: Error Handling & Edge Cases

| Cenário | Comportamento |
|---|---|
| Role sem permissão tenta salvar | RLS rejeita → toast "Sem permissão para editar templates" |
| Nome vazio ou threshold inválido | Validação client-side; botão Salvar desabilitado |
| Arquivar template com completions ativas hoje | Permitido sempre — completions já disparadas continuam; cron ignora `active=false` a partir do próximo tick |
| `changed_by` vazio no trigger | `changed_by = NULL` no log — mutação não trava |
| Reordenar além dos limites | Botão ↑/↓ desabilitado no extremo — nunca chega ao DB em estado inválido |
| Conexão cai no meio do save | Sheet permanece aberta com toast de erro; nenhuma mutação parcial visível (itens commitados sequencialmente) |

---

## Seção 4: Testing

### DB

```sql
-- Trigger audit em UPDATE de nome
UPDATE op_checklists SET name='Novo Nome' WHERE id='<id>';
SELECT action, details FROM op_checklists_audit
WHERE template_id='<id>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: action='updated', details.before.name='Nome Antigo'

-- Soft delete gera 'deactivated'
UPDATE op_checklists SET active=false WHERE id='<id>';
SELECT action FROM op_checklists_audit
WHERE template_id='<id>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: 'deactivated'

-- item_added
INSERT INTO op_checklist_items (checklist_id, description, sort_order)
VALUES ('<id>', 'Novo item', 8);
SELECT action, details FROM op_checklists_audit
WHERE template_id='<id>' ORDER BY changed_at DESC LIMIT 1;
-- Expected: action='item_added', details.description='Novo item'
```

### PWA (manual no Simple Browser)

1. Director → link "Checklists operacionais" visível em /mais
2. Colaborador comum → link NÃO aparece
3. Criar template → aparece na lista com contagem de itens
4. Editar nome → card mostra "Editado por [nome] em [data]"
5. Reordenar → ↑ desabilitado no primeiro item
6. Arquivar → desaparece; toggle "Mostrar arquivados" revela; Reativar funciona
7. Salvar sem nome → botão desabilitado

---

## Fora de escopo

- Templates pessoais por colaborador (sprint futura)
- Tela de histórico de audit completo (dado está no DB)
- Drag & drop para reordenar
- Notificar colaboradores quando template muda
