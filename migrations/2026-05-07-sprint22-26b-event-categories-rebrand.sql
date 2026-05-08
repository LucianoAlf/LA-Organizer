-- Sprint 22.26b — refinar lista de categorias system de eventos.
-- User decidiu: LA Music | Aula Particular/Mentoria | Gravacao/Producao | Show | Pessoal
-- (+ "+ Nova Categoria Pessoal" sentinel da UI, criado via createPersonal).
--
-- Migracoes:
-- - mentoria: label vira "Aula Particular/Mentoria" (merge conceitual)
-- - estudio: label vira "Gravacao/Producao"
-- - aula_particular + outra_escola: deletadas (zero events)
-- - show: nova categoria work
-- - pessoal: mantida (fallback generico personal)
--
-- Pre-check (executado live antes da migration):
--   la_music = 4 events, mentoria = 1, demais = 0 → safe drop.

UPDATE event_categories
  SET label = 'Aula Particular/Mentoria', sort_order = 2
  WHERE slug = 'mentoria' AND collaborator_id IS NULL;

UPDATE event_categories
  SET label = 'Gravação/Produção', sort_order = 3
  WHERE slug = 'estudio' AND collaborator_id IS NULL;

DELETE FROM event_categories
  WHERE slug IN ('aula_particular', 'outra_escola') AND collaborator_id IS NULL;

INSERT INTO event_categories (collaborator_id, slug, label, context, is_system, sort_order)
  VALUES (NULL, 'show', 'Show', 'work', true, 4);

UPDATE event_categories SET sort_order = 1 WHERE slug = 'la_music' AND collaborator_id IS NULL;
