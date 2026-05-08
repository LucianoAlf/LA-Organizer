-- Sprint 22.32 — Convidados em eventos.
-- Permite escolher pessoas do time pra um compromisso. Cada participant tem
-- status RSVP (invited/confirmed/declined/tentative). TOM dispara WhatsApp
-- pra notificar (Sprint 22.33+ via cron ou trigger).

CREATE TABLE event_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  collaborator_id UUID NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'confirmed', 'declined', 'tentative')),
  invited_by UUID REFERENCES collaborators(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  notified_at TIMESTAMPTZ,
  UNIQUE(event_id, collaborator_id)
);

CREATE INDEX idx_event_participants_event ON event_participants(event_id);
CREATE INDEX idx_event_participants_collab ON event_participants(collaborator_id);

ALTER TABLE event_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_event_participants ON event_participants FOR SELECT TO authenticated
  USING (
    collaborator_id = current_collab_id()
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND (
          e.created_by = current_collab_id()
          OR e.collaborator_id = current_collab_id()
          OR (e.context = 'work' AND current_collab_role() IN ('coordinator', 'director'))
        )
    )
  );

CREATE POLICY auth_insert_event_participants ON event_participants FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = current_collab_id()
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_id
        AND (
          e.created_by = current_collab_id()
          OR (e.context = 'work' AND current_collab_role() IN ('coordinator', 'director'))
        )
    )
  );

CREATE POLICY auth_update_event_participants ON event_participants FOR UPDATE TO authenticated
  USING (
    collaborator_id = current_collab_id()
    OR EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.created_by = current_collab_id()
    )
  );

CREATE POLICY auth_delete_event_participants ON event_participants FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = event_participants.event_id
        AND e.created_by = current_collab_id()
    )
  );
