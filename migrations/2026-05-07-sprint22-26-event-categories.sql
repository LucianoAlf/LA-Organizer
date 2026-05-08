-- Sprint 22.26 (audit Hoje, Fatia D) — categorias dinamicas de eventos.
-- Substitui events.category (text enum hardcoded) por events.category_id (UUID FK).
-- User pode criar/renomear/deletar suas categorias pessoais (academia, medico,
-- jiu-jitsu, etc). Categorias de trabalho continuam fixas como is_system=true.
--
-- collaborator_id NULL + is_system=true = categoria global de trabalho (LA Music,
-- Mentoria, Aula particular, Outra escola, Estudio, e Pessoal generico).
-- collaborator_id NOT NULL + is_system=false = categoria pessoal do user.
--
-- events.category (text) fica nullable durante deploy; drop column em fatia futura.

-- 1. Tabela event_categories
CREATE TABLE event_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  collaborator_id UUID REFERENCES collaborators(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('work','personal')),
  icon TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(collaborator_id, slug)
);

CREATE INDEX idx_event_categories_collab ON event_categories(collaborator_id);
CREATE INDEX idx_event_categories_global_slug ON event_categories(slug) WHERE collaborator_id IS NULL;

-- 2. Seed das 6 system categories (globais)
INSERT INTO event_categories (collaborator_id, slug, label, context, is_system, sort_order) VALUES
  (NULL, 'la_music',         'LA Music',          'work',     true, 1),
  (NULL, 'mentoria',          'Mentoria',          'work',     true, 2),
  (NULL, 'aula_particular',   'Aula particular',   'work',     true, 3),
  (NULL, 'outra_escola',      'Outra escola',      'work',     true, 4),
  (NULL, 'estudio',           'Estúdio',           'work',     true, 5),
  (NULL, 'pessoal',           'Pessoal',           'personal', true, 1);

-- 3. RLS — cada user ve global + suas pessoais; nunca pessoais de outros
ALTER TABLE event_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY auth_read_event_categories ON event_categories FOR SELECT TO authenticated
  USING (collaborator_id IS NULL OR collaborator_id = current_collab_id());

CREATE POLICY auth_insert_event_categories ON event_categories FOR INSERT TO authenticated
  WITH CHECK (
    collaborator_id = current_collab_id()
    AND is_system = false
    AND context = 'personal'
  );

CREATE POLICY auth_update_event_categories ON event_categories FOR UPDATE TO authenticated
  USING (collaborator_id = current_collab_id() AND is_system = false);

CREATE POLICY auth_delete_event_categories ON event_categories FOR DELETE TO authenticated
  USING (collaborator_id = current_collab_id() AND is_system = false);

-- 4. Adiciona events.category_id e popula
ALTER TABLE events ADD COLUMN category_id UUID REFERENCES event_categories(id);

UPDATE events e SET category_id = (
  SELECT id FROM event_categories
  WHERE slug = e.category AND collaborator_id IS NULL AND is_system = true
  LIMIT 1
);

ALTER TABLE events ALTER COLUMN category_id SET NOT NULL;

-- 5. Coluna antiga events.category nullable (drop em fatia futura, sem urgencia)
ALTER TABLE events ALTER COLUMN category DROP NOT NULL;
