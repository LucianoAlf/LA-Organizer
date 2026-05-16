-- =====================================================================
-- LA Journey — Expansão Kids/Iniciação
-- Data: 2026-05-16
-- - Renomeia Heart 1/2 → Iniciação 1/2 (preserva ids p/ FKs)
-- - Adiciona Iniciação 3/4 (4 marcos, com consolidação)
-- - Espelha mentores do School pro Kids/Iniciação (4 instrumentos)
-- =====================================================================

UPDATE la_journey_checkpoints SET codigo='iniciacao1', nome='Iniciação 1' WHERE id='kids_heart1';
UPDATE la_journey_checkpoints SET codigo='iniciacao2', nome='Iniciação 2' WHERE id='kids_heart2';

INSERT INTO la_journey_checkpoints
  (id, programa_id, codigo, nome, equivalencia, foco, tipo, separa_por_curso, marcos_total, tem_consolidacao, sort_order)
VALUES
  ('kids_iniciacao3', 'kids', 'iniciacao3', 'Iniciação 3', '8 a 10 anos',  'Aprofundamento técnico',                'iniciacao', true, 4, true, 9),
  ('kids_iniciacao4', 'kids', 'iniciacao4', 'Iniciação 4', '10 a 12 anos', 'Consolidação e transição para School', 'iniciacao', true, 4, true, 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO la_journey_curso_mentores
  (curso_id, programa_id, collaborator_id, papel, atribuido_por, ativo)
SELECT curso_id, 'kids', collaborator_id, papel, atribuido_por, true
FROM la_journey_curso_mentores
WHERE programa_id='school' AND ativo=true
  AND curso_id IN ('bateria','canto','cordas','teclas')
ON CONFLICT DO NOTHING;
