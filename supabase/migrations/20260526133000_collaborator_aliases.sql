-- Adiciona coluna aliases[] em collaborators e popula com apelidos conhecidos.
-- Caso: TOM não casava "Alf" → Luciano Alf, "Juju" → Juliana, "Gerê" → Jereh,
-- "Leonardo" → Leo, etc. Agora findCollaboratorByName busca em full_name,
-- preferred_name E aliases[] (todos normalizados sem diacritics).

ALTER TABLE collaborators
  ADD COLUMN IF NOT EXISTS aliases text[] DEFAULT '{}'::text[];

CREATE INDEX IF NOT EXISTS collaborators_aliases_gin
  ON collaborators USING GIN (aliases);

COMMENT ON COLUMN collaborators.aliases IS
  'Apelidos/codinomes pra resolução fuzzy de nomes em TOM. Inclui variantes (Gerê/Gere), apelidos (Juju), nome completo (Leonardo). Match é normalizado (lowercase + sem acentos).';

-- Seed inicial — apelidos conhecidos
UPDATE collaborators SET aliases = ARRAY['Luciano','Lu'] WHERE full_name='Luciano Alf';
UPDATE collaborators SET aliases = ARRAY['Juju'] WHERE full_name='Juliana';
UPDATE collaborators SET aliases = ARRAY['Gerê','Gere','Jeremias'] WHERE full_name='Jereh';
UPDATE collaborators SET aliases = ARRAY['Léo','Leonardo'] WHERE full_name='Leo';
UPDATE collaborators SET aliases = ARRAY['Kris','Krys'] WHERE full_name='Krissya';
UPDATE collaborators SET aliases = ARRAY['Matheus','Mati'] WHERE full_name='Matheus Felipe';
UPDATE collaborators SET aliases = ARRAY['Rafa','Rafael'] WHERE full_name='Rafinha';
