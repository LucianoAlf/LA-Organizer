-- 2026-06-26 — Checklist (pauta/preparação) de compromisso.
-- Tabela-satélite de events (espelha event_participants / event_reminders). NÃO usa
-- tasks.parent_task_id (evento é outra tabela). Semântica: pauta, não conclusão do evento.

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

-- SELECT: quem enxerga o evento-pai (dono / criador / coordenação em work / participante).
CREATE POLICY auth_read_event_checklist ON event_checklist_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_checklist_items.event_id
        AND (
          e.created_by = current_collab_id()
          OR e.collaborator_id = current_collab_id()
          OR (e.context = 'work' AND current_collab_role() IN ('coordinator', 'director'))
          OR EXISTS (
            SELECT 1 FROM event_participants ep
            WHERE ep.event_id = e.id AND ep.collaborator_id = current_collab_id()
          )
        )
    )
  );

-- WRITE (insert/update/delete): só o dono/criador do evento gerencia a pauta.
CREATE POLICY auth_insert_event_checklist ON event_checklist_items FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_checklist_items.event_id
        AND (e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id())
    )
  );

CREATE POLICY auth_update_event_checklist ON event_checklist_items FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_checklist_items.event_id
        AND (e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id())
    )
  );

CREATE POLICY auth_delete_event_checklist ON event_checklist_items FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_checklist_items.event_id
        AND (e.created_by = current_collab_id() OR e.collaborator_id = current_collab_id())
    )
  );
