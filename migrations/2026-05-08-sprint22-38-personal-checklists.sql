-- Sprint 22.38 — Personal checklists (mercado, viagem, remédios, geral)
-- Owner-only via RLS. Sem cron, sem TOM notify automático. TOM lê e edita via service-role.

-- Helper genérico para triggers de updated_at (faltava em public; só existia em storage).
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE personal_checklists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_collab_id uuid NOT NULL REFERENCES collaborators(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  list_type text NOT NULL DEFAULT 'general'
    CHECK (list_type IN ('shopping','travel','meds','general')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE personal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES personal_checklists(id) ON DELETE CASCADE,
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 200),
  is_done boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX personal_checklists_owner_active_idx
  ON personal_checklists (owner_collab_id, is_active);
CREATE INDEX personal_checklist_items_list_sort_idx
  ON personal_checklist_items (list_id, sort_order);

ALTER TABLE personal_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE personal_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_checklists_owner ON personal_checklists
  FOR ALL TO authenticated
  USING (owner_collab_id = current_collab_id())
  WITH CHECK (owner_collab_id = current_collab_id());

CREATE POLICY personal_checklist_items_owner ON personal_checklist_items
  FOR ALL TO authenticated
  USING (list_id IN (SELECT id FROM personal_checklists WHERE owner_collab_id = current_collab_id()))
  WITH CHECK (list_id IN (SELECT id FROM personal_checklists WHERE owner_collab_id = current_collab_id()));

CREATE TRIGGER personal_checklists_updated
  BEFORE UPDATE ON personal_checklists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER personal_checklist_items_updated
  BEFORE UPDATE ON personal_checklist_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
